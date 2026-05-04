# 01_AUDITORIA_SEGURANCA.md
## Snakeys — Auditoria de Segurança e Risk Management

> **Perspectiva:** Auditor de Segurança + Risk Manager de Cassinos Online.
> **Escopo:** Análise crítica do `00_CONTRATO_MESTRE.md` v1.0 e da arquitetura atual.
> **Nível de ameaça alvo:** Jogadores mal-intencionados, bugs de concorrência, falhas de infraestrutura.

---

**Versão:** 1.0.0
**Data:** 03 de maio de 2026
**Classificação:** INTERNO — não distribuir publicamente

---

## Sumário

1. [Vulnerabilidades de Exploit Financeiro](#1-vulnerabilidades-de-exploit-financeiro)
2. [Edge Cases e Resiliência a Falhas](#2-edge-cases-e-resiliência-a-falhas)
3. [Anti-Cheat: Análise e Reforço](#3-anti-cheat-análise-e-reforço)
4. [Escalabilidade PrimeHub — 10.000 Jogadores Simultâneos](#4-escalabilidade-primehub--10000-jogadores-simultâneos)
5. [Módulos Inacabados: Esqueletos Lógicos](#5-módulos-inacabados-esqueletos-lógicos)
6. [Prioridades de Implementação — Próxima Fase](#6-prioridades-de-implementação--próxima-fase)

---

## 1. Vulnerabilidades de Exploit Financeiro

### 1.1 CRÍTICO — Double Settlement via `matchId` Não Protegido

**Cenário:** O client chama `POST /wallet/match/settle` com o mesmo `matchId` duas vezes (rede instável, retry automático do frontend). Se o backend não tiver um guarda de unicidade por `(userId, matchId)`, o jogador recebe o payout em dobro.

**Estado atual:** O `idempotencyKey` protege depósitos e saques, mas o contrato NÃO define uma constraint `@unique` para `matchId` no contexto de settlement. O payout cap de 100× não ajuda aqui — o segundo pagamento respeita o cap individualmente.

**Exploit:**
```
1. Jogador termina match com payout = R$500
2. Client envia POST /wallet/match/settle { matchId: "abc", payout: 500 }
3. Rede falha na resposta (timeout)
4. Client reenvia (sem idempotencyKey explícita no settle)
5. Backend processa duas vezes → payout de R$1.000
```

**Correção obrigatória:**

```prisma
// schema.prisma
model MatchSettlement {
  id        String   @id @default(uuid())
  userId    String
  matchId   String
  payout    Decimal  @db.Decimal(18, 8)
  settledAt DateTime @default(now())

  @@unique([userId, matchId])  // ← GUARDA CENTRAL
}
```

```typescript
// wallet.service.ts — settleMatchForUser()
async settleMatchForUser(userId: string, matchId: string, payout: number) {
  return this.prisma.$transaction(async (tx) => {
    // Tentativa de insert — falha com P2002 se já settled
    const settlement = await tx.matchSettlement.create({
      data: { userId, matchId, payout },
    }).catch((e) => {
      if (e.code === 'P2002') throw new ConflictException('Match already settled');
      throw e;
    });
    // ... resto do settlement
  });
}
```

---

### 1.2 CRÍTICO — Race Condition TOCTOU no Saldo (Time-Of-Check-Time-Of-Use)

**Cenário:** Jogador tem `balanceAvailable = R$10`. Abre duas abas e envia dois saques de R$8 simultaneamente. Ambas as requisições passam pela verificação `balanceAvailable >= 8` antes de qualquer delas debitar. Resultado: saldo vai para -R$6.

**Estado atual:** O código verifica o saldo mas não usa `SELECT FOR UPDATE` ou `optimistic locking`. Duas transações PostgreSQL concorrentes podem ler o mesmo valor stale.

**Exploit:**
```
Thread A: SELECT balance = 10 → OK para sacar 8
Thread B: SELECT balance = 10 → OK para sacar 8
Thread A: UPDATE SET balance = 2
Thread B: UPDATE SET balance = 2  ← sobrescreve, saldo vai para 2 (não -6)
                                     MAS dois saques de 8 foram registrados!
```

**Correção obrigatória:**

```typescript
// Usar UPDATE atômico com condição — PostgreSQL garante atomicidade
await this.prisma.$transaction(async (tx) => {
  const result = await tx.$executeRaw`
    UPDATE "Wallet"
    SET "balanceAvailable" = "balanceAvailable" - ${amount},
        "balanceLocked"    = "balanceLocked"    + ${amount},
        "version"          = "version"          + 1
    WHERE "userId" = ${userId}
      AND "balanceAvailable" >= ${amount}
    RETURNING id
  `;

  if (result === 0) {
    throw new UnprocessableEntityException('Saldo insuficiente ou atualização concorrente detectada');
  }
});
```

**Alternativa:** Usar `SELECT FOR UPDATE` explícito no início da transação para serializar o acesso à linha do Wallet.

---

### 1.3 ALTO — Cash-Out Durante Ghost: Validação Apenas Client-Side

**Cenário:** O Contrato Mestre define que cash-out só fica disponível após o fim do ghost (60s). Mas se essa validação existe apenas no frontend (botão desabilitado), um atacante pode chamar diretamente o endpoint de cash-out com seu `matchId`.

**Estado atual:** Não há evidência de que o backend valide `world.now > ghostUntil` antes de processar um cash-out.

**Exploit:**
```
1. Jogador faz spawn em R$50 de pote
2. Imediatamente (t=0s) chama POST /internal/match/result { payout: R$50 × 0.70 }
3. Embolsa R$35 sem nenhum risco real
4. Ainda está em ghost, imortal
```

**Correção:**

```typescript
// game-server — ao receber cashout_request do socket
function handleCashoutRequest(player: ServerPlayer, room: GameRoom): void {
  const now = Date.now();

  // 1. Ghost ainda ativo?
  if (now < player.ghostUntil) {
    socket.emit('error', { code: 'GHOST_ACTIVE', message: 'Cash-out indisponível durante proteção de spawn.' });
    return;
  }

  // 2. Cooldown respeitado?
  if (player.lastCashOut && (now - player.lastCashOut) < 180_000) {
    socket.emit('error', { code: 'COOLDOWN', message: 'Aguarde o cooldown de 3 minutos.' });
    return;
  }

  // 3. Pote mínimo?
  if (player.accumulatedValue <= 0) {
    socket.emit('error', { code: 'EMPTY_POT', message: 'Nenhum valor acumulado para resgatar.' });
    return;
  }

  // Processar cash-out...
}
```

---

### 1.4 ALTO — Rake Bypass via Acumulação no Servidor

**Cenário:** O game-server acumula kills em memória (`A.pendingKillPot += net`). Se o game-server aplica o rake ANTES de acumular (deduzindo 10%), e depois o settlement no backend também aplica rake, o jogador sofre dupla tributação. O inverso (nenhum dos dois aplica rake) resulta em zero rake — perda de receita.

**Estado atual:** A sequência no §3.5 do Contrato Mestre é ambígua sobre ONDE o rake é calculado: no game-server (passo 4) ou no backend (`/internal/match/result`).

**Regra que resolve a ambiguidade:**

```
REGRA: O rake é calculado e registrado EXCLUSIVAMENTE pelo backend.
       O game-server envia os valores BRUTOS (gross) e o backend calcula o net.

Game-server envia: { gross: 70.00 }   // pote bruto da vítima
Backend calcula:   rake = 70 × 0.10 = 7.00
                   net  = 63.00
Backend registra: Transaction(FEE=7, WIN=63)
```

**Contrato atualizado para `/internal/match/result`:**

```typescript
// DTO — internal/match/result
interface MatchResultDto {
  userId:      string;   // vítima ou vencedor
  matchId:     string;
  betAmount:   number;   // entrada original do usuário
  grossPayout: number;   // valor BRUTO a receber (antes do rake)
  rakeRate:    number;   // ex: 0.10 (10%) — definido pelo modo
}

// WalletService.processMatchResult()
const rake   = grossPayout * rakeRate;
const net    = grossPayout - rake;
// Transaction(FEE, rake) + Transaction(WIN, net)
```

---

### 1.5 MÉDIO — matchId Gerado pelo Cliente (Replay Attack)

**Cenário:** O `matchId` é gerado pelo backend em `startMatchForUser`, o que é correto. Mas se em algum fluxo o matchId vier do cliente, um atacante pode reutilizar um matchId de um match passado para tentar um segundo settlement.

**Proteção adicional além da constraint `@@unique([userId, matchId])`:**

```typescript
// WalletService.startMatchForUser() — o matchId é SEMPRE gerado pelo backend
const matchId = randomUUID(); // nunca aceitar do cliente

// Em settleMatchForUser(), além da constraint de unicidade,
// verificar que o BET transaction para este matchId existe e está COMPLETED
const betTx = await this.prisma.transaction.findFirst({
  where: { userId, matchId, type: 'BET', status: 'COMPLETED' },
});
if (!betTx) throw new NotFoundException('Match não encontrado ou aposta não registrada');
```

---

### 1.6 MÉDIO — Empate Cabeça-Cabeça Sem Auditoria do Pote Destruído

**Cenário:** No empate cabeça-cabeça, o pote de ambos os jogadores vai para a casa (100% rake). Isso é intencional, mas DEVE ser registrado como `Transaction(FEE, potA + potB)` para rastreabilidade financeira e compliance. Atualmente não há menção de como esse pote é auditado.

**Correção:**

```typescript
// No game-server, ao resolver empate
if (result === 'mutual') {
  // Pote de A e B vão para a casa
  await reportMutualKill({
    matchId,
    playerA: { userId: a.id, grossLost: a.currentMatchPot },
    playerB: { userId: b.id, grossLost: b.currentMatchPot },
  });
}

// No backend — /internal/match/mutual-kill (endpoint novo)
// Registra Transaction(FEE, potA) para userId A
// Registra Transaction(FEE, potB) para userId B
// balanceLocked -= entryA e -= entryB (libera os locks)
```

---

## 2. Edge Cases e Resiliência a Falhas

### 2.1 CRÍTICO — Crash do Game-Server Durante Kill Settlement

**Cenário:** O game-server processa um kill (B.pot transferido para A em memória), mas trava antes de chamar `/internal/match/result` para B. O dinheiro de B está "desaparecido": B.pot = 0 (em memória, perdida no crash), mas a Transaction de BET de B ainda está `locked` no banco.

**Estado atual:** O Contrato Mestre menciona "job de reconciliação" mas não detalha a implementação.

**Solução — Máquina de Estado de Match:**

```prisma
model Match {
  id          String      @id @default(uuid())
  mode        String
  status      MatchStatus // BETTING | ACTIVE | SETTLING | SETTLED | ABANDONED
  startedAt   DateTime    @default(now())
  endedAt     DateTime?
  timeoutAt   DateTime    // startedAt + duracao_max + 10min buffer
  participants MatchParticipant[]
}

model MatchParticipant {
  matchId    String
  userId     String
  betAmount  Decimal   @db.Decimal(18, 8)
  payout     Decimal?  @db.Decimal(18, 8)  // null = não settled ainda
  settledAt  DateTime?

  @@id([matchId, userId])
}

enum MatchStatus {
  BETTING   // BET transactions em andamento
  ACTIVE    // todos com BET COMPLETED, jogo em curso
  SETTLING  // game-server enviando resultados
  SETTLED   // todos os participantes receberam payout
  ABANDONED // match expirou sem settlement
}
```

**Job de Reconciliação (cron a cada 5 minutos):**

```typescript
// Ver implementação completa na Seção 5.1
```

---

### 2.2 CRÍTICO — Backend Timeout em `/internal/match/result` (Double-Settlement via Retry)

**Cenário:** Game-server chama `/internal/match/result` para liquidar um kill. O backend processa, mas a resposta de sucesso não chega (timeout de rede). O game-server faz retry e a requisição é processada duas vezes.

**Solução:** Cada chamada a `/internal/match/result` deve incluir um `idempotencyKey` derivado deterministicamente de `matchId + userId + event_sequence_number`:

```typescript
// Game-server — ao fazer retry, usa EXATAMENTE o mesmo idempotencyKey
const idempotencyKey = `${matchId}:${userId}:kill:${sequenceNumber}`;

// Backend — interno ao processMatchResult()
const existing = await this.prisma.transaction.findUnique({
  where: { idempotencyKey },
});
if (existing) return existing; // idempotente — retorna o resultado anterior
```

---

### 2.3 ALTO — Desconexão do Cliente Durante Cash-Out

**Cenário:**
```
1. Cliente envia cashout_request
2. Game-server processa: accumulatedValue = 0, lastCashOut = now
3. Game-server chama /internal/match/result com payout
4. Backend credita R$84
5. Socket.io não consegue entregar cashout_result ao cliente
6. Cliente reconecta, não sabe que cash-out ocorreu
7. Tenta cash-out novamente
```

**Estado da reconexão — o servidor deve enviar:**

```typescript
// Ao reconectar, game-server envia o estado completo do jogador
socket.on('reconnect', async () => {
  const player = room.getPlayer(userId);
  socket.emit('player_state_sync', {
    accumulatedValue: player.accumulatedValue,
    lastCashOut:      player.lastCashOut,
    ghostUntil:       player.ghostUntil,
    cashoutHistory:   player.cashoutHistory, // últimos N cash-outs com timestamps
  });
});
```

**E no backend, o jogador pode consultar suas transactions recentes para verificar se o cash-out foi processado.**

---

### 2.4 ALTO — Pools do Big Fish vs. Fim de Match Simultâneo

**Cenário:** Um pool de massa spawna em `t=955s`. O match termina em `t=960s`. Jogadores correm para o pool; o settlement é iniciado; pellets de pool ainda estão no mundo. O ranking de massa capturado no momento do settlement pode ser inconsistente se o settlement e a ingestão de pool ocorrerem no mesmo tick.

**Solução:**

```typescript
// Ao iniciar a sequência de settlement, congelar o estado imediatamente
function endMatch(room: GameRoom): void {
  room.frozen = true; // novo flag — ignora inputs de direção/sprint

  // Snapshot de rankings ANTES de qualquer cleanup
  const finalRankings = room.snakesAlive
    .sort((a, b) => b.mass - a.mass)
    .map((s, i) => ({ rank: i + 1, userId: s.id, mass: s.mass }));

  // Remover todos os pellets de pool (evitar ingestão pós-freeze)
  room.pellets = room.pellets.filter(p => !p.pool);

  // Iniciar settlement com o snapshot
  settleMatch(room.matchId, finalRankings);
}
```

---

### 2.5 MÉDIO — Jogador Entre em Dois Matches Simultaneamente

**Cenário:** Jogador abre duas abas. Na aba A, entra em um match HH (BET locked). Na aba B, tenta entrar em outro match. O backend deveria rejeitar a segunda entrada enquanto a primeira `BET` está `PENDING` ou o match está `ACTIVE`.

**Proteção:**

```typescript
// startMatchForUser() — antes de criar o BET
const activeMatch = await this.prisma.matchParticipant.findFirst({
  where: {
    userId,
    match: { status: { in: ['BETTING', 'ACTIVE', 'SETTLING'] } },
  },
});
if (activeMatch) {
  throw new ConflictException('Você já está em um match ativo.');
}
```

---

### 2.6 BAIXO — Big Fish com Menos de 3 Jogadores Vivos no Settlement

**Cenário:** 30 jogadores entram. Apenas 1 sobrevive (os outros morreram de fome ou kills). O split 50/30/20 é definido para Top 3, mas só há 1 vivo.

**Regra:** O pool completo vai para o único sobrevivente? Ou apenas os 50%?

**Decisão de negócio (registrar aqui):**

```typescript
// Política: o survivor recebe apenas sua fatia proporcional.
// O restante (50% do pool se só 1 vivo, 20% se só 2 vivos) vai para a casa.
// Isso incentiva os jogadores a lutar até o fim em vez de se esconder.

const PAYOUT_FRACTIONS = [0.50, 0.30, 0.20];
for (let i = 0; i < Math.min(rankings.length, 3); i++) {
  payouts[i] = pool * PAYOUT_FRACTIONS[i];
}
// Restante do pool: pool - sum(payouts) → rake adicional
```

> **ALTERNATIVA:** Pagar 100% ao único sobrevivente (estimula PvP menos conservador). Decidir antes do launch e registrar aqui.

---

## 3. Anti-Cheat: Análise e Reforço

### 3.1 Speed Hack — Deficiência do Threshold de 10%

**Problema no §5.3 do Contrato Mestre:** A tolerância de 10% por tick parece conservadora, mas a matemática revela uma brecha:

```
Tick = 50ms = 0.05s
Velocidade máxima legítima = BASE_SPEED × SPRINT_MULTIPLIER × dt
                           = 170 × 1.7 × 0.05 = 14.45 unidades/tick

Com 10% de tolerância: 14.45 × 1.10 = 15.9 unidades/tick

Speed hack a 1.5× (50% mais rápido): 14.45 × 1.5 = 21.67 unidades/tick
21.67 / 15.9 = 1.36× → excede o threshold em cada tick, mas...

violation_count++ por tick com decay = -1 por tick legítimo
Se o hack é usado 50% do tempo: violações se cancelam.
→ O hacker NUNCA é kickado!
```

**Sistema robusto — Sliding Window com Buffer:**

```typescript
interface AntiCheatState {
  speedViolations: CircularBuffer<{ ts: number; excess: number }>; // últimas 200 entradas
  teleportViolations: number;
  autoAimScore: number;        // [0,1] — score de "robot-likeness"
  lastKickWarning: number;
}

// Threshold absoluto por tick (sem decay generoso)
const MAX_SPEED_PER_TICK = BASE_SPEED * SPRINT_MULTIPLIER * DT * 1.05; // apenas +5%

function checkSpeedViolation(player: ServerPlayer, newPos: Vec2): void {
  const delta = Vec2.distance(player.serverPos, newPos);

  if (delta > MAX_SPEED_PER_TICK) {
    const excess = delta - MAX_SPEED_PER_TICK;
    player.anticheat.speedViolations.push({ ts: Date.now(), excess });
    player.serverPos = player.serverPos; // forçar posição corrigida
  } else {
    player.serverPos = newPos; // aceitar
  }

  // Analisar janela dos últimos 5 segundos (100 ticks)
  const window = player.anticheat.speedViolations.recentWindow(5000);
  const violationRate = window.length / 100; // ticks violados / total ticks

  if (violationRate > 0.15) warnPlayer(player); // 15% dos ticks violados
  if (violationRate > 0.30) kickPlayer(player, 'speed_hack_sustained');
}
```

---

### 3.2 Teleport Hack — Detecção por Delta Absoluto

**Problema:** Um hack que teletransporta a cobra (não apenas aumenta a velocidade) não é detectado pelo sistema de 10% — porque o delta é tão grande que excede qualquer threshold razoável, mas isso não acumula violações suficientes se usado raramente.

**Detecção:**

```typescript
const TELEPORT_THRESHOLD = BASE_SPEED * SPRINT_MULTIPLIER * DT * 3.0; // 3× a máxima

function checkTeleportViolation(player: ServerPlayer, newPos: Vec2): void {
  const delta = Vec2.distance(player.serverPos, newPos);

  if (delta > TELEPORT_THRESHOLD) {
    player.anticheat.teleportViolations++;
    auditLog(AuditEvent.ANTI_CHEAT_VIOLATION, {
      userId: player.userId,
      type: 'TELEPORT',
      delta,
      pos: newPos,
    });

    player.serverPos = player.serverPos; // recusar movimento

    // Teleport é imediatamente suspeito — kick após 3 ocorrências
    if (player.anticheat.teleportViolations >= 3) {
      kickPlayer(player, 'teleport_hack');
    }
  }
}
```

---

### 3.3 Auto-Aim / Bot Detection (Análise Estatística)

**Problema:** Um bot sempre aponta exatamente para o pellet mais próximo, com tempo de reação = 0ms e sem "jitter" humano. Um humano tem:
- Reação: 150-300ms de delay ao mudar de alvo
- Variância angular: ±2-5° em movimentos contínuos
- Pausas ocasionais (sem mudança de direção)

**Score de "robot-likeness" (acumular durante o match):**

```typescript
interface DirectionSample {
  ts: number;
  angle: number;
  deltaAngle: number; // mudança em relação ao frame anterior
}

function updateAutoAimScore(player: ServerPlayer, newAngle: number): void {
  const prev = player.lastAngle;
  const delta = Math.abs(normalizeAngle(newAngle - prev));
  const dt = Date.now() - player.lastAngleSampleTs;

  player.angleSamples.push({ ts: Date.now(), angle: newAngle, deltaAngle: delta });

  // Limitar janela de análise a 60 segundos
  player.angleSamples = player.angleSamples.filter(s => Date.now() - s.ts < 60_000);

  // Análise de padrão: calcular variância dos deltas angulares
  const deltas = player.angleSamples.map(s => s.deltaAngle);
  const variance = computeVariance(deltas);

  // Humanos têm alta variância; bots têm variância muito baixa ou padrões repetitivos
  const HUMAN_MIN_VARIANCE = 0.01; // rad²
  if (variance < HUMAN_MIN_VARIANCE && player.angleSamples.length > 100) {
    player.anticheat.autoAimScore = Math.min(1.0, player.anticheat.autoAimScore + 0.01);
  } else {
    player.anticheat.autoAimScore = Math.max(0.0, player.anticheat.autoAimScore - 0.005);
  }

  // Score > 0.7 por mais de 2 minutos → flag para revisão manual
  if (player.anticheat.autoAimScore > 0.7) {
    auditLog(AuditEvent.ANTI_CHEAT_VIOLATION, {
      userId: player.userId, type: 'SUSPECTED_BOT', score: player.anticheat.autoAimScore,
    });
  }
}
```

> **Importante:** Auto-aim detection NÃO deve resultar em kick automático sem revisão humana. Falso-positivos são ruins para jogadores legítimos muito habilidosos. Usar como flag para revisão de replay.

---

### 3.4 Mass Spoofing — Servidor Não Calcula Massa Independentemente

**Problema:** Atualmente o servidor não recalcula a massa do jogador — ele confia na massa reportada pelo cliente para decisões de desempate (head-head collision threshold de 10%). Um cliente modificado pode reportar massa = 99999 e sempre ganhar desempates.

**Solução — Rastreamento Autoritário de Massa:**

```typescript
// game-server — ServerPlayer inclui massa calculada pelo servidor
interface ServerPlayer {
  // ...
  serverMass: number;        // calculado pelo servidor, NUNCA do cliente
  clientReportedMass: number; // para detectar discrepâncias
}

// A cada tick, recalcular massa no servidor:
function updateServerMass(player: ServerPlayer, dt: number): void {
  // Sprint drain
  if (player.sprinting && player.serverMass >= SPRINT_MIN_MASS) {
    player.serverMass -= SPRINT_DRAIN_RATE * dt;
  }

  // Fome (Big Fish)
  if (room.mode === 'big-fish') {
    player.serverMass -= hungerDrainPerSec(room.elapsedSeconds) * dt;
  }

  // Verificar discrepância com o que o cliente reporta
  const massDrift = Math.abs(player.clientReportedMass - player.serverMass) / player.serverMass;
  if (massDrift > 0.20) { // 20% de divergência
    auditLog(AuditEvent.ANTI_CHEAT_VIOLATION, {
      userId: player.userId, type: 'MASS_SPOOF',
      serverMass: player.serverMass, clientMass: player.clientReportedMass,
    });
  }
}

// TODA lógica de colisão usa player.serverMass, nunca clientReportedMass
function resolveHeadHead(a: ServerPlayer, b: ServerPlayer) {
  const ratio = a.serverMass / b.serverMass; // ← serverMass aqui
  // ...
}
```

---

### 3.5 Collusion Detection — Pot Farming Entre Alts

**Cenário:** Dois jogadores controlados pela mesma pessoa (alt accounts) entram no mesmo match HH. O alt entra com R$50 e intencionalmente morre para o principal, que fica com R$45 líquidos. O mesmo CPF não pode ter duas contas, mas nada impede múltiplos CPFs fraudulentos.

**Detecção passiva:**

```typescript
// Analisar padrões de kill:
// 1. A matou B em menos de 5s após o fim do ghost de B?
// 2. A e B se conectaram via o mesmo IP?
// 3. A matou B em múltiplos matches (padrão recorrente)?

interface KillEvent {
  matchId:    string;
  killerId:   string;
  victimId:   string;
  killedAt:   number; // ms desde o início do match
  victimGhostExpiredAt: number;
  killerIp:   string;
  victimIp:   string;
}

function scoreCollusionRisk(killEvent: KillEvent): number {
  let score = 0;

  // Kill muito cedo após fim do ghost
  const timeSinceGhostEnd = killedAt - victimGhostExpiredAt;
  if (timeSinceGhostEnd < 5_000) score += 0.4;

  // Mesmo IP
  if (killerIp === victimIp) score += 0.5;

  // Histórico de kills mútuos
  const priorKills = await queryPriorKillsBetween(killerId, victimId);
  if (priorKills > 2) score += Math.min(0.4, priorKills * 0.1);

  return Math.min(1.0, score);
}
// Score > 0.7 → flag para revisão manual + payout retido em escrow temporário
```

---

### 3.6 Replay Attack no Cash-Out (Request Capture)

**Problema:** Um atacante captura o pacote WebSocket de `cashout_request` e o reenvia após o cooldown.

**Proteção atual:** Cooldown verificado pelo server (`now - lastCashOut >= 180s`). **Mas e se o atacante esperar 3 minutos e então replays?**

O replay válido DEVE ser tratado como um segundo cash-out legítimo — o cooldown já passou. A proteção real é a lógica de negócio: `accumulatedValue = 0` após o primeiro cash-out. Um segundo cash-out de R$0 é processado como operação válida mas sem efeito financeiro.

**Garantir no servidor:**
```typescript
if (player.accumulatedValue <= 0) {
  socket.emit('cashout_result', { payout: 0, message: 'Nenhum valor a resgatar.' });
  return; // não chamar /internal/match/result com amount=0
}
```

---

## 4. Escalabilidade PrimeHub — 10.000 Jogadores Simultâneos

### 4.1 Análise de Capacidade Atual

| Recurso | Capacidade Atual | Necessário para 10k | Gap |
|---------|-----------------|---------------------|-----|
| Game rooms | ~33 (1 server) | ~333 (HH=100p, BF=30p) | 10× |
| Game-server (Node.js) | 1 instância | ~5 instâncias | 5× |
| Backend (NestJS) | 1 instância | ~3 instâncias | 3× |
| PostgreSQL | 1 instância | 1 + read replicas | — |
| WebSocket messages | ~10k msg/seg | ~100k msg/seg | 10× |
| DB transactions/hora | ~5k (estimado) | ~50k | 10× |

### 4.2 Game-Server: Socket.io Redis Adapter

**Problema:** O game-server atual é single-node. Para escalar horizontalmente, múltiplas instâncias precisam compartilhar o estado de rooms ou rotear clientes para a instância correta.

**Solução:** Sticky sessions no load balancer + Redis Adapter para broadcast cross-node:

```typescript
// game-server/src/main.ts
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

const pubClient  = createClient({ url: process.env.REDIS_URL });
const subClient  = pubClient.duplicate();

await Promise.all([pubClient.connect(), subClient.connect()]);

io.adapter(createAdapter(pubClient, subClient));

// Load balancer: MUST use sticky sessions (ip_hash no Nginx)
// Reason: Socket.io handshake e dados de sala devem ir para o mesmo processo
```

**Configuração Nginx:**
```nginx
upstream game_servers {
  ip_hash;  # ← sticky sessions
  server game1:3000;
  server game2:3000;
  server game3:3000;
}
```

---

### 4.3 Delta Encoding de Game State (Redução de 70-80% no Tráfego)

**Problema atual:** A cada 100ms, o servidor broadcast o estado completo de todos os jogadores para cada cliente. Para 100 jogadores × 333 rooms = 33.300 broadcasts/segundo de payloads de ~5KB cada = **~165 MB/seg de dados brutos**.

**Solução — Enviar apenas deltas:**

```typescript
interface GameStateDelta {
  frame: number;
  // Apenas jogadores que se moveram desde o último frame enviado a ESTE cliente
  moved:   Array<{ id: string; x: number; y: number; angle: number; mass: number }>;
  died:    string[];  // IDs de jogadores que morreram
  spawned: Array<{ id: string; x: number; y: number; mass: number; color: string }>;
  pellets: { added: Pellet[]; removed: string[] }; // IDs removidos
}

class GameStateDeltaEncoder {
  private lastSentState: Map<string, PlayerSnapshot> = new Map();

  encode(currentState: GameSnapshot): GameStateDelta {
    const delta: GameStateDelta = { frame: currentState.frame, moved: [], died: [], spawned: [], pellets: { added: [], removed: [] } };

    for (const player of currentState.players) {
      const prev = this.lastSentState.get(player.id);
      if (!prev) {
        delta.spawned.push(player);
      } else if (hasPlayerMoved(prev, player)) {
        delta.moved.push({ id: player.id, x: player.x, y: player.y, angle: player.angle, mass: player.mass });
      }
      this.lastSentState.set(player.id, player);
    }

    // Detectar mortes
    for (const [id] of this.lastSentState) {
      if (!currentState.playerIds.has(id)) {
        delta.died.push(id);
        this.lastSentState.delete(id);
      }
    }

    return delta;
  }
}
```

**Resultado esperado:** Payload médio de ~5KB reduzido para ~200-800 bytes em frames normais (90%+ dos frames não têm eventos de morte/spawn).

---

### 4.4 Kill Settlement Queue (Durabilidade com Bull/BullMQ)

**Problema:** O game-server chama `/internal/match/result` de forma síncrona. Se o backend estiver lento ou indisponível, o game-server fica bloqueado ou perde kills.

**Solução — Queue durável com BullMQ + Redis:**

```typescript
// game-server — ao invés de chamar o backend diretamente
import { Queue } from 'bullmq';

const killSettlementQueue = new Queue('kill-settlement', {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 },
  },
});

async function onKillEvent(killer: ServerPlayer, victim: ServerPlayer): Promise<void> {
  await killSettlementQueue.add('process-kill', {
    matchId:      room.matchId,
    killerId:     killer.id,
    victimId:     victim.id,
    victimGross:  victim.currentMatchPot,
    timestamp:    Date.now(),
    idempotencyKey: `${room.matchId}:kill:${victim.id}:${Date.now()}`,
  });
  // Não bloqueia o game loop
}

// Worker separado (pode rodar no backend)
const worker = new Worker('kill-settlement', async (job) => {
  await backendApi.post('/internal/match/result', job.data);
}, { connection: redis });
```

---

### 4.5 PostgreSQL: Connection Pooling e Read Replicas

**Configuração recomendada para 10k usuários:**

```yaml
# docker-compose.yml — adicionar PgBouncer
pgbouncer:
  image: edoburu/pgbouncer
  environment:
    DB_USER: postgres
    DB_PASSWORD: postgres
    DB_HOST: postgres
    DB_NAME: snakeys
    POOL_MODE: transaction          # transaction pooling para NestJS
    MAX_CLIENT_CONN: 1000
    DEFAULT_POOL_SIZE: 20

# Leituras pesadas (inventory, marketplace, progressão) → read replica
postgres-replica:
  image: postgres:15
  # configurar streaming replication
```

**Prisma — usar read replica para queries de leitura:**

```typescript
// prisma.service.ts
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL, // primary — writes
    },
  },
});

// Para leituras, usar extensão de read replica ou instância separada
const prismaRead = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_READ_URL } },
});
```

---

### 4.6 Checklist de Infraestrutura para 10k Players

- [ ] Redis (6.x+): sessões JTI, kill queue, Socket.io adapter, delta encoder cache
- [ ] Socket.io Redis Adapter + sticky sessions no load balancer
- [ ] Nginx (ou Caddy) com ip_hash para game-server
- [ ] PgBouncer em modo `transaction` na frente do PostgreSQL
- [ ] PostgreSQL read replica para queries de inventory/marketplace
- [ ] BullMQ + Worker para kill settlement queue durável
- [ ] Delta encoding de game state (redução de 80% no tráfego WS)
- [ ] CDN para assets estáticos do frontend (skins, imagens)
- [ ] Horizontal scaling do backend (3+ instâncias) com sticky sessions para JWT
- [ ] Monitoramento: Prometheus + Grafana (latência de settlement, WS connections/sec, DB pool saturation)

---

## 5. Módulos Inacabados: Esqueletos Lógicos

### 5.1 `reconcileAbandonedMatches()` — Job de Reconciliação

**Propósito:** Detectar e liquidar matches que o game-server não conseguiu finalizar (crash, timeout, partição de rede).

```typescript
// backend/src/internal/reconciliation.service.ts

@Injectable()
export class ReconciliationService {
  constructor(private prisma: PrismaClient, private wallet: WalletService) {}

  // Executar a cada 5 minutos via @Cron
  @Cron('*/5 * * * *')
  async reconcileAbandonedMatches(): Promise<void> {
    const now = new Date();

    // Encontrar matches que passaram do timeout sem settlement
    const abandonedMatches = await this.prisma.match.findMany({
      where: {
        status: { in: ['BETTING', 'ACTIVE', 'SETTLING'] },
        timeoutAt: { lt: now },
      },
      include: { participants: true },
    });

    for (const match of abandonedMatches) {
      await this.prisma.$transaction(async (tx) => {
        // Marcar match como ABANDONED
        await tx.match.update({
          where: { id: match.id },
          data: { status: 'ABANDONED', endedAt: now },
        });

        // Para cada participante sem payout → reembolsar aposta original
        for (const p of match.participants) {
          if (p.settledAt !== null) continue; // já settled

          // Reembolso: WIN = betAmount (devolve o que foi locked)
          await this.wallet.processMatchResult(
            p.userId,
            match.id,
            p.betAmount.toNumber(),
            p.betAmount.toNumber(), // payout = refund total (sem rake em abandono)
            { idempotencyKey: `reconcile:${match.id}:${p.userId}` },
          );

          await tx.matchParticipant.update({
            where: { matchId_userId: { matchId: match.id, userId: p.userId } },
            data: { payout: p.betAmount, settledAt: now },
          });
        }

        await auditLog(AuditEvent.MATCH_SETTLEMENT, {
          matchId: match.id,
          reason: 'RECONCILIATION_ABANDONED',
          participantsRefunded: match.participants.filter(p => !p.settledAt).length,
        });
      });
    }
  }
}
```

---

### 5.2 `verifyPixOwnership()` — Verificação de Titularidade do Pix

**Propósito:** Garantir que a chave Pix do saque pertence ao CPF cadastrado no sistema, prevenindo saque para contas de terceiros.

```typescript
// backend/src/wallet/pix-verification.service.ts

@Injectable()
export class PixVerificationService {
  constructor(private pixGateway: PixGatewayService) {}

  async verifyPixOwnership(
    pixKey: string,
    expectedCpf: string,
  ): Promise<PixOwnershipResult> {
    // Consultar o gateway de pagamento para resolver a chave Pix
    // A maioria dos gateways BR (Celcoin, Juno, Gerencianet) oferece endpoint
    // de consulta de chave Pix que retorna dados do titular
    const pixInfo = await this.pixGateway.resolveKey(pixKey);

    if (!pixInfo) {
      return { verified: false, reason: 'PIX_KEY_NOT_FOUND' };
    }

    // Normalizar CPF para comparação (apenas dígitos)
    const normalizedExpected = expectedCpf.replace(/\D/g, '');
    const normalizedActual   = pixInfo.ownerTaxId.replace(/\D/g, '');

    if (normalizedExpected !== normalizedActual) {
      await auditLog(AuditEvent.WITHDRAW_REQUESTED, {
        userId: this.ctx.userId,
        pixKey,
        expectedCpf: normalizedExpected,
        actualCpf:   normalizedActual,
        reason:      'CPF_MISMATCH',
      });
      return { verified: false, reason: 'CPF_MISMATCH' };
    }

    return { verified: true, ownerName: pixInfo.ownerName };
  }
}

// Usar em WalletService.requestWithdraw():
const ownership = await this.pixVerification.verifyPixOwnership(pixKey, user.cpf);
if (!ownership.verified) {
  throw new ForbiddenException(`Chave Pix não pertence ao CPF cadastrado: ${ownership.reason}`);
}
```

---

### 5.3 `AntiCheatAnalyzer` — Consolidação das Detecções

```typescript
// game-server/src/anticheat/anticheat-analyzer.ts

export class AntiCheatAnalyzer {
  private violations: Map<string, PlayerViolationState> = new Map();

  analyze(playerId: string, event: AntiCheatEvent): AntiCheatVerdict {
    const state = this.violations.get(playerId) ?? this.initState(playerId);

    switch (event.type) {
      case 'POSITION_DELTA':
        return this.checkSpeedViolation(state, event);
      case 'TELEPORT':
        return this.checkTeleportViolation(state, event);
      case 'DIRECTION_SAMPLE':
        return this.checkAutoAim(state, event);
      case 'MASS_DELTA':
        return this.checkMassSpoofing(state, event);
    }
  }

  private checkSpeedViolation(state: PlayerViolationState, event): AntiCheatVerdict {
    // Implementação do sliding window (ver §3.1)
    const violationRate = state.speedWindow.violationRate(5000);
    if (violationRate > 0.30) return { action: 'KICK',   reason: 'speed_hack_sustained' };
    if (violationRate > 0.15) return { action: 'WARN',   reason: 'speed_hack_suspected' };
    return { action: 'ALLOW' };
  }

  private checkTeleportViolation(state: PlayerViolationState, event): AntiCheatVerdict {
    state.teleportCount++;
    if (state.teleportCount >= 3) return { action: 'KICK', reason: 'teleport_hack' };
    return { action: 'CORRECT_POSITION' };
  }

  private checkAutoAim(state: PlayerViolationState, event): AntiCheatVerdict {
    state.autoAimScore = updateAutoAimScore(state, event);
    if (state.autoAimScore > 0.7) return { action: 'FLAG_FOR_REVIEW', reason: 'suspected_bot' };
    return { action: 'ALLOW' };
  }

  private checkMassSpoofing(state: PlayerViolationState, event): AntiCheatVerdict {
    const drift = Math.abs(event.clientMass - event.serverMass) / event.serverMass;
    if (drift > 0.20) return { action: 'USE_SERVER_VALUE', reason: 'mass_spoof' };
    return { action: 'ALLOW' };
  }
}
```

---

### 5.4 `AuditLogger` — Logger Estruturado com Retenção

```typescript
// backend/src/audit/audit-logger.service.ts

@Injectable()
export class AuditLoggerService {
  private readonly logger = new Logger('Audit');

  // Dados sensíveis que NÃO devem aparecer em logs
  private readonly REDACTED_FIELDS = ['cpf', 'password', 'pixKey', 'cardNumber'];

  async record(event: AuditEvent, context: AuditContext): Promise<void> {
    const entry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      event,
      userId:   context.userId,
      matchId:  context.matchId,
      amount:   context.amount?.toString(), // Decimal → string para precisão
      ip:       context.ip,
      meta:     this.redact(context.meta ?? {}),
    };

    // 1. Escrever no logger estruturado (Winston/Pino → arquivo rotacionado)
    this.logger.log(JSON.stringify(entry));

    // 2. Persistir no banco para consultas de compliance (opcional mas recomendado)
    await this.prisma.auditLog.create({ data: entry });
  }

  private redact(obj: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) =>
        this.REDACTED_FIELDS.includes(k) ? [k, '[REDACTED]'] : [k, v],
      ),
    );
  }
}

// Retenção:
// - Eventos financeiros (DEPOSIT_*, WITHDRAW_*, MATCH_*): 5 anos (compliance fiscal)
// - Eventos de gameplay e anti-cheat: 90 dias
// - Eventos de auth: 1 ano
// Implementar via particionamento de tabela por data ou policy de arquivamento
```

---

### 5.5 `JtiBlacklist` com Redis (Logout em Escala)

```typescript
// backend/src/auth/jti-blacklist.service.ts

@Injectable()
export class JtiBlacklistService {
  constructor(@InjectRedis() private readonly redis: Redis) {}

  async revoke(jti: string, expiresAt: Date): Promise<void> {
    const ttlSeconds = Math.ceil((expiresAt.getTime() - Date.now()) / 1000);
    if (ttlSeconds > 0) {
      // A chave expira automaticamente do Redis quando o JWT também expiraria
      await this.redis.set(`jti:${jti}`, '1', 'EX', ttlSeconds);
    }
  }

  async isRevoked(jti: string): Promise<boolean> {
    const result = await this.redis.get(`jti:${jti}`);
    return result !== null;
  }
}

// JWT Strategy — usar no validate()
async validate(payload: JwtPayload): Promise<User> {
  const revoked = await this.jtiBlacklist.isRevoked(payload.jti);
  if (revoked) throw new UnauthorizedException('Token revogado');
  // ...
}
```

---

### 5.6 `IWalletProvider` — Interface para Migração PrimeHub

```typescript
// backend/src/wallet/wallet-provider.interface.ts

export interface WalletBalance {
  available: Decimal;
  locked:    Decimal;
}

export interface IWalletProvider {
  getBalance(userId: string): Promise<WalletBalance>;

  lockFunds(
    userId:    string,
    amount:    Decimal,
    reference: string, // matchId ou idempotencyKey
  ): Promise<{ lockId: string }>;

  releaseLock(
    lockId:  string,
    payout:  Decimal,  // quanto do lock virar WIN (restante = FEE)
    rake:    Decimal,
  ): Promise<void>;

  transfer(
    fromUserId: string,
    toUserId:   string,
    amount:     Decimal,
    reason:     string,
  ): Promise<{ txId: string }>;
}

// Implementação atual
@Injectable()
export class LocalWalletProvider implements IWalletProvider {
  constructor(private prisma: PrismaClient) {}
  // Chama diretamente o banco PostgreSQL
}

// Implementação futura
@Injectable()
export class PrimeHubWalletProvider implements IWalletProvider {
  constructor(private http: HttpService) {}
  // Chama a API REST da PrimeHub
}

// Module — trocar provider via feature flag
const walletProvider = process.env.USE_PRIMEHUB_WALLET === 'true'
  ? PrimeHubWalletProvider
  : LocalWalletProvider;
```

---

## 6. Prioridades de Implementação — Próxima Fase

### Classificação de Risco

| Severidade | Descrição |
|-----------|-----------|
| 🔴 P0 — BLOQUEANTE | Impede ir para produção; risco financeiro ou legal direto |
| 🟠 P1 — CRÍTICO | Deve ser resolvido antes do Beta; risco de perda de dinheiro |
| 🟡 P2 — ALTO | Importante para estabilidade; resolver antes do Scale |
| 🟢 P3 — MÉDIO | Melhoria significativa; resolver antes do PrimeHub |

---

### Backlog Priorizado

| # | Item | Severidade | Esforço | Módulo |
|---|------|-----------|---------|--------|
| 1 | Constraint `@@unique([userId, matchId])` em `MatchSettlement` | 🔴 P0 | 1h | Backend/DB |
| 2 | UPDATE atômico de saldo com condição (anti-TOCTOU) | 🔴 P0 | 4h | WalletService |
| 3 | Validação server-side de `ghostUntil` antes do cash-out | 🔴 P0 | 2h | Game-Server |
| 4 | `idempotencyKey` em `/internal/match/result` (anti-retry) | 🔴 P0 | 3h | Game-Server + Backend |
| 5 | `reconcileAbandonedMatches()` — job cron a cada 5min | 🔴 P0 | 8h | Backend/Scheduler |
| 6 | `ItemTransactionLog` no schema Prisma | 🔴 P0 | 2h | DB |
| 7 | Grosso vs. net no kill: estabelecer contrato único de rake | 🔴 P0 | 2h | Game-Server + Backend |
| 8 | `MatchSettlement` table + status de match (BETTING→SETTLED) | 🟠 P1 | 6h | DB |
| 9 | Rastreamento autoritário de massa no game-server (`serverMass`) | 🟠 P1 | 8h | Game-Server |
| 10 | Anti-cheat: sliding window de velocidade + teleport detection | 🟠 P1 | 12h | Game-Server |
| 11 | `verifyPixOwnership()` via gateway | 🟠 P1 | 6h | WalletService |
| 12 | Proteção de jogador em dois matches simultâneos | 🟠 P1 | 3h | WalletService |
| 13 | Settlement correto com < 3 vivos no Big Fish | 🟠 P1 | 2h | Game-Server |
| 14 | `JtiBlacklist` com Redis (atual: PostgreSQL) | 🟡 P2 | 4h | Auth |
| 15 | `AuditLogger` estruturado com retenção de 5 anos | 🟡 P2 | 8h | Backend |
| 16 | `GameStateDeltaEncoder` para WebSocket | 🟡 P2 | 12h | Game-Server |
| 17 | Socket.io Redis Adapter + sticky sessions | 🟡 P2 | 6h | Infra |
| 18 | `BullMQ` kill settlement queue (durabilidade) | 🟡 P2 | 8h | Game-Server |
| 19 | Auto-aim detection (análise estatística de ângulo) | 🟡 P2 | 10h | Game-Server |
| 20 | Collusion detection (padrão de kills entre contas) | 🟡 P2 | 16h | Backend |
| 21 | Gateway Pix real integrado | 🔴 P0 | ∞ (depende de contrato) | Payments |
| 22 | PgBouncer + read replica | 🟢 P3 | 8h | Infra |
| 23 | `IWalletProvider` interface para migração PrimeHub | 🟢 P3 | 6h | Backend |
| 24 | Marketplace rake (5%) | 🟢 P3 | 2h | MarketplaceService |
| 25 | KYC/AML: limites de depósito por CPF verificado | 🟢 P3 | 8h | WalletService |

---

### Ordem de Implementação Recomendada

```
Sprint 1 (Segurança Financeira — 1 semana):
  Items: #1, #2, #3, #4, #7, #6

Sprint 2 (Resiliência — 1 semana):
  Items: #5, #8, #12, #13

Sprint 3 (Anti-Cheat Core — 2 semanas):
  Items: #9, #10, #11

Sprint 4 (Infra + Auditoria — 1 semana):
  Items: #14, #15, #17

Sprint 5 (Scale — 2 semanas):
  Items: #16, #18, #22

Sprint 6 (PrimeHub Prep — 1 semana):
  Items: #19, #20, #23, #24

Beta Launch (requer Sprints 1-4 completos + gateway Pix real)
Scale Launch (requer Sprint 5)
PrimeHub Migration (requer Sprint 6)
```

---

## Apêndice — Sumário Executivo de Riscos

| Risco | Probabilidade | Impacto Financeiro | Mitigação |
|-------|--------------|-------------------|----------|
| Double settlement | Alta (bug de rede) | Alto (100% do payout duplicado) | Constraint única matchId+userId |
| Race condition de saldo | Média | Alto (saldo negativo) | UPDATE condicional atômico |
| Cash-out durante ghost | Baixa (exploiter ativo) | Médio | Validação server-side |
| Game-server crash | Média (instabilidade) | Alto (saldo locked infinito) | Job de reconciliação |
| Speed hack | Baixa (cheater ativo) | Baixo (vantagem de gameplay) | Sliding window AC |
| Mass spoofing | Baixa | Baixo (kills indevidos) | serverMass autoritário |
| Collusion | Baixa-Média | Alto (lavagem de pote) | Kill pattern analysis |
| DB contention (10k users) | Alta (sem PgBouncer) | Médio (latência) | Connection pooling |

---

*Fim da Auditoria — Versão 1.0.0*
*Próxima revisão recomendada: após Sprint 3 (anti-cheat implementado)*
