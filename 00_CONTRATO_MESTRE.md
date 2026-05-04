# 00_CONTRATO_MESTRE.md
## Snakeys — Documento de Referência Absoluta

> **AVISO AOS MODELOS DE LINGUAGEM:** Este documento é a única fonte de verdade para o desenvolvimento do Snakeys. Em caso de conflito entre este documento e o código, o código **implementado e testado** tem precedência; atualize este documento para refletir a realidade. Em caso de dúvida sobre mecânicas novas, consulte as invariantes das Seções 2 e 3 antes de gerar código.

---

**Versão:** 1.1.0
**Data:** 03 de maio de 2026
**Autor:** Engenharia Snakeys
**Status:** VIGENTE

---

## Sumário

1. [Diagnóstico do Projeto Atual](#1-diagnóstico-do-projeto-atual)
2. [Engenharia de Gameplay](#2-engenharia-de-gameplay)
3. [Engenharia Financeira](#3-engenharia-financeira)
4. [Sistema de Itens](#4-sistema-de-itens)
5. [Segurança e Anti-Cheat](#5-segurança-e-anti-cheat)
6. [Infraestrutura e Deploy](#6-infraestrutura-e-deploy)
7. [Roadmap e Migração PrimeHub](#7-roadmap-e-migração-primehub)

---

## 1. Diagnóstico do Projeto Atual

### 1.1 Stack Tecnológica

| Camada | Tecnologia | Versão |
|--------|-----------|--------|
| Backend | NestJS + TypeScript | 10.0 / 5.6 |
| ORM | Prisma | latest |
| Banco de Dados | PostgreSQL | 15 |
| Autenticação | JWT (Passport) | — |
| Frontend | React + Vite + Tailwind CSS | 18.3 / 5.4 / 3.4 |
| Game Engine | Canvas 2D (offline, client-driven) | custom |
| Game Server | Socket.io + Express | 4.7 |
| Containerização | Docker Compose (Postgres only) | — |

### 1.2 Estrutura de Pastas

```
c:\Snakeys\
├── backend/
│   ├── src/
│   │   ├── auth/           # Registro, login, JWT, email verification
│   │   ├── wallet/         # Saldo, depósito, saque, settlement de matches
│   │   ├── user/           # CRUD de usuário
│   │   ├── inventory/      # Listagem de itens do usuário
│   │   ├── cosmetics/      # Mint, equip/unequip de skins
│   │   ├── marketplace/    # Criação/compra de listings
│   │   ├── progression/    # XP, leveling, curva de progresso
│   │   ├── battle-pass/    # Recompensas por level, claims idempotentes
│   │   ├── payments/       # Webhook validation do gateway de pagamento
│   │   └── internal/       # Endpoints privados para o game-server
│   └── prisma/
│       ├── schema.prisma   # Fonte de verdade do banco de dados
│       └── seed.ts         # Semente de itens/rewards
├── frontend/
│   └── src/
│       ├── pages/          # Login, Lobby, Play, Game
│       ├── game/           # engine.ts, modes.ts, renderer.ts
│       └── lib/            # api.ts (cliente HTTP tipado)
└── game-server/
    └── src/                # GameRoom, socket events, tick loop
```

### 1.3 Estado Atual dos Módulos

| Módulo | Estado | Observações |
|--------|--------|-------------|
| Auth (registro/login/JWT) | ✅ Implementado | CPF único, email verification, logout c/ JTI revocation |
| Wallet (saldo, locked) | ✅ Implementado | Decimal(18,8), idempotency keys, payout cap 100× |
| Depósito via Pix | ⚠️ Sandbox | QR code fictício — gateway real pendente |
| Saque via Pix | ⚠️ Manual | Fluxo backend OK, processamento ops manual |
| Settlement de Match | ✅ Implementado | BET → FEE + WIN transactions, XP award |
| Game Engine (offline) | ✅ Implementado | Client-driven, modos HH e BF funcionais |
| Game Server (online) | ✅ Implementado | Socket.io, tick 50ms, colisão server-side básica |
| Inventário / Skins | ✅ Implementado | serialNumber, floatValue, usageCount |
| Marketplace | ✅ Implementado | atomic buy, uma listing ativa por item |
| Progressão / XP | ✅ Implementado | Dual XP (account + season), curva quadrática |
| Battle Pass | ✅ Implementado | 100 níveis, claims idempotentes |
| Anti-Cheat Server-Side | ⚠️ Parcial | Cap 100×, CPF check, HMAC webhook — validação de física pendente |
| Reconciliação de Matches | ❌ Ausente | Job para liquidar matches abandonados |
| Auditoria Estruturada | ❌ Ausente | Log financeiro com retenção de 5 anos |
| Redis / JTI Blacklist | ❌ Ausente | Atualmente só PostgreSQL |

### 1.4 A Regra de Ouro (Invariante Absoluta)

> **MASSA e POTE são trilhos separados. Nunca misture suas lógicas.**

```
MASSA  → gameplay puro (crescimento, velocidade, colisão, fome)
         Unidade: unidades de jogo (float)
         Vive em: memória do servidor durante o match

POTE   → financeiro real (R$ apostados e ganhos)
         Unidade: Decimal(18,8) BRL
         Vive em: PostgreSQL — tabelas Wallet + Transaction
```

Massa **influencia** o Pote apenas em dois pontos controlados:
- O **gatilho de kill** no Hunt-Hunt (via ranking de massa no desempate)
- O **ranking de massa** no Big Fish (determina Top 3)

Fora desses pontos, as duas variáveis são mutuamente invisíveis.

---

## 2. Engenharia de Gameplay

### 2.1 Constantes do Motor

```typescript
// world
WORLD_RADIUS       = 2600   // unidades de jogo (raio do círculo)

// snake — cinemática
BASE_SPEED         = 170    // unidades/segundo
SPRINT_MULTIPLIER  = 1.7    // fator sobre BASE_SPEED
SPRINT_MIN_MASS    = 15     // massa mínima para ativar sprint
SPRINT_DRAIN_RATE  = 4.2    // massa/segundo consumida ao sprinting
BASE_TURN_SPEED    = 3.4    // rad/segundo (clamped)

// snake — corpo
BREADCRUMB_SPACING = 4      // unidades entre cada ponto da trilha
BODY_LENGTH(m)     = 60 + 0.55 * m  // comprimento da trilha em unidades

// pellets
PELLET_SMALL_MASS  = 0.8
PELLET_LARGE_MASS  = 2.4
PELLET_POOL_MASS   = 4.5    // Big Fish: pellets de pool

// colisão — eating
EAT_MAGNETISM      = 6      // unidades extras no raio de ingestão
eatRadius(m)       = radiusOf(m) + EAT_MAGNETISM

// sprint drain — pellets dropados
DROP_THRESHOLD     = 1.0    // acumular antes de dropar 1 pellet de sprint
```

> **Regra de ouro de constantes:** Nunca codifique essas constantes diretamente em lógica de negócio. Sempre importe de um único arquivo de configuração. Mudanças requerem re-teste de balanceamento.

### 2.2 Modelo Cinemático da Cobra

#### Integração por Frame

```typescript
// dt = segundos desde o último frame
const speed = snake.sprinting ? BASE_SPEED * SPRINT_MULTIPLIER : BASE_SPEED;

// Virada suavizada (clamped angular velocity)
let delta = normalizeAngle(snake.targetAngle - snake.angle);
const maxTurn = BASE_TURN_SPEED * dt;
snake.angle += clamp(delta, -maxTurn, maxTurn);

// Integração de posição
snake.headX += Math.cos(snake.angle) * speed * dt;
snake.headY += Math.sin(snake.angle) * speed * dt;

// Confinamento ao mundo
const dist = Math.hypot(snake.headX, snake.headY);
if (dist > WORLD_RADIUS) {
  snake.headX = (snake.headX / dist) * WORLD_RADIUS;
  snake.headY = (snake.headY / dist) * WORLD_RADIUS;
  killSnake(snake, 'boundary');
}
```

#### Gerenciamento da Trilha (Breadcrumbs)

```typescript
const maxCrumbs = Math.ceil(BODY_LENGTH(snake.mass) / BREADCRUMB_SPACING);
snake.trail.unshift({ x: snake.headX, y: snake.headY });
if (snake.trail.length > maxCrumbs) snake.trail.length = maxCrumbs;
```

### 2.3 Colisão: Fórmulas e Regras de Desempate

#### 2.3.1 Cabeça-Corpo (Head-Body)

```typescript
function checkHeadBody(attacker: Snake, victim: Snake): boolean {
  const hitR = radiusOf(attacker.mass) + radiusOf(victim.mass) * 0.6;
  for (let i = 0; i < victim.trail.length; i += 3) {
    const dx = attacker.headX - victim.trail[i].x;
    const dy = attacker.headY - victim.trail[i].y;
    if (dx * dx + dy * dy < hitR * hitR) return true;
  }
  return false;
}
```

**Resultado:** Attacker mata victim. Sem desempate — cabeça-corpo é sempre fatal para a vítima.

#### 2.3.2 Cabeça-Cabeça (Head-Head)

```typescript
function resolveHeadHead(a: Snake, b: Snake): 'a_wins' | 'b_wins' | 'mutual' {
  const ADVANTAGE_THRESHOLD = 0.10; // 10% de vantagem de massa

  const ratio = a.mass / b.mass;
  if (ratio > 1 + ADVANTAGE_THRESHOLD) return 'a_wins';
  if (ratio < 1 - ADVANTAGE_THRESHOLD) return 'b_wins';
  return 'mutual'; // empate → ambos morrem, pote vai para a casa
}
```

**Tabela de desempate:**

| Situação | Resultado | Destino do Pote |
|----------|-----------|----------------|
| Massa A ≥ 10% > Massa B | A vence, B morre | Pote de B (menos rake) → A |
| Massa B ≥ 10% > Massa A | B vence, A morre | Pote de A (menos rake) → B |
| Diferença < 10% | Ambos morrem | Pote de ambos → Casa (100%) |

> **MECÂNICA INTENCIONAL:** O empate de cabeça-cabeça resulta em perda total do pote de ambos. Isso é documentado na UI para o usuário como "Empate Fatal".

### 2.4 Ciclo de Vida da Massa

```
SPAWN
  └─ massa inicial = 10 (configurável por modo)

INGESTÃO (cresce)
  ├─ pellet pequeno   +0.8
  ├─ pellet grande    +2.4
  ├─ pellet de pool   +4.5  (Big Fish)
  └─ kill scatter     ~70% da massa da vítima (em pellets)

CONSUMO (diminui)
  ├─ sprint drain     -4.2/seg (só enquanto sprinting)
  └─ fome progressiva (Big Fish)  ver §2.6

MORTE (zera)
  └─ 70% da massa vira pellets distribuídos ao longo da trilha
     30% é descartado (House Edge da massa)
```

**Raio em função da massa:**

```typescript
function radiusOf(mass: number): number {
  return 4 + Math.sqrt(mass) * 0.7;
}
```

### 2.5 Modo Hunt-Hunt (HH)

| Parâmetro | Valor |
|-----------|-------|
| Capacidade | 100 jogadores |
| Duração máxima | 60 minutos |
| Proteção de spawn | 60 segundos (ghost — colisão desativada) |
| Cash-out antecipado | disponível após o fim do ghost |
| Taxa de cash-out antecipado | 30% do pote acumulado (70% retorna) |
| Cooldown de cash-out | 3 minutos entre cash-outs |

#### Fluxo de Kill (Transferência de Pote)

```
Jogador A mata Jogador B (pot_B = R$70):
  rake    = R$70 × 0.10 = R$7.00
  net     = R$70 - R$7.00 = R$63.00

  → A.pendingKillPot += R$63.00
  → B.currentMatchPot = 0
  → Enfileirar evento: { killer: A, victim: B, gross: R$70, rake: R$7, net: R$63 }
```

> **INVARIANTE:** O game-server acumula kills em memória durante o match. O settlement financeiro (Transaction) ocorre APENAS no backend via `/internal/match/result`, NUNCA diretamente pelo game-server no banco de dados.

#### Cash-Out Antecipado

```
accumulatedValue: R$120.00

Cooldown OK? (now - lastCashOut ≥ 180s) → sim
  gross = R$120.00
  taxa  = R$120.00 × 0.30 = R$36.00
  net   = R$84.00

→ POST /internal/match/result { userId: A, payout: 84, rake: 36 }
→ A.accumulatedValue = 0
→ A.lastCashOut = now
→ Jogador permanece vivo com pote zerado
```

#### Estado de Ghost

```
ghostUntil = spawnTime + 60_000ms

Durante ghost:
  - Ignorar colisões de entrada (snake.ghostUntil > world.now)
  - Renderizar translúcido (alpha ~0.4)
  - NÃO pode acumular kills de pote
  - Pode comer pellets normalmente
```

### 2.6 Modo Big Fish (BF)

| Parâmetro | Valor |
|-----------|-------|
| Capacidade | 30 jogadores |
| Duração | 16 minutos (960 segundos) |
| Pool de prêmio | Σ(entradas) × 0.90 (10% rake) |
| Distribuição Top 3 | 50% / 30% / 20% do pool |
| Jogadores mortos | R$ 0.00 (forfeit total) |

#### Sistema de Fome Progressiva

```typescript
function hungerDrainPerSec(t: number): number {
  // t em segundos [0, 960]; drenagem vai de 0 a 16 mass/sec
  return (t / 960) * 16;
}

// Por frame
snake.mass -= hungerDrainPerSec(elapsedSeconds) * dt;
if (snake.mass < SPRINT_MIN_MASS) snake.sprinting = false;
if (snake.mass <= 0) killSnake(snake, 'starvation');
```

#### Pools de Massa (a cada 4 minutos)

```
t=240s, t=480s, t=720s:
  1. Aviso: "POOL EM 15 SEGUNDOS" (t-15s)
  2. Spawn: 80 pellets PELLET_POOL_MASS=4.5 em posição aleatória
  3. Marcador no minimapa
  4. Pellets desaparecem após 60s se não coletados
```

#### Settlement Big Fish

```typescript
const rankings = snakesAlive.sort((a, b) => b.mass - a.mass);
const pool = totalEntries * 0.90;

// Payouts apenas se houver jogadores vivos suficientes
if (rankings[0]) payout[0] = pool * 0.50;
if (rankings[1]) payout[1] = pool * 0.30;
if (rankings[2]) payout[2] = pool * 0.20;
// Todos os outros (mortos ou fora do top-3): payout = 0
```

### 2.7 Grid Espacial (Otimização de Performance)

```typescript
GRID_CELL_SIZE = 120 // unidades de jogo

class PelletGrid {
  cells: Map<string, Set<Pellet>>;
  key(x, y) { return `${Math.floor(x / 120)},${Math.floor(y / 120)}`; }
  insert(p: Pellet): void   { /* O(1) */ }
  remove(p: Pellet): void   { /* O(1) */ }
  queryRect(x, y, r): Pellet[] { /* O(~4-9 células) */ }
}
```

**Alvo de performance:** 1.600 pellets simultâneos @ 60 fps (frontend) e @ 20 ticks/seg (game-server).

### 2.8 Camera e Renderer

#### Zoom Dinâmico por Massa

```typescript
function zoomForMass(mass: number): number {
  return 1 / (0.82 + Math.log1p(mass) * 0.095);
}
```

#### Pipeline de Renderização (Ordem Mandatória)

```
1. Background (transform identidade)
2. Transform de câmera (cameraX, cameraY, zoom)
3. Grid de pontos (120u spacing, sutil)
4. Boundary do mundo (círculo + anel de aviso)
5. Pellets (agrupados por cor — ≤6 trocas de fillStyle para 1.600 pellets)
6. Corpos das cobras (trilha → cabeça)
7. HUD de pools (overlay screen-space com seta direcional)
8. Minimapa (canto inferior esquerdo)
```

---

## 3. Engenharia Financeira

### 3.1 Esquema de Dados Financeiros (Prisma)

```prisma
model Wallet {
  id               String    @id @default(uuid())
  userId           String    @unique
  balanceAvailable Decimal   @db.Decimal(18, 8)
  balanceLocked    Decimal   @db.Decimal(18, 8)
  version          Int       @default(0)   // optimistic locking
  user             User      @relation(fields: [userId], references: [id])
  createdAt        DateTime  @default(now())
}

model Transaction {
  id              String            @id @default(uuid())
  userId          String
  type            TransactionType
  amount          Decimal           @db.Decimal(18, 8)
  status          TransactionStatus
  matchId         String?
  idempotencyKey  String?           @unique
  referenceId     String?
  createdAt       DateTime          @default(now())
  user            User              @relation(...)
}

enum TransactionType {
  DEPOSIT | WITHDRAW | BET | WIN | FEE | ITEM_PURCHASE | ITEM_SALE
}

enum TransactionStatus {
  PENDING | COMPLETED | FAILED
}
```

### 3.2 Regras de Integridade Financeira (ABSOLUTAS)

| # | Regra | Implementação |
|---|-------|--------------|
| R1 | `balanceAvailable` nunca negativo | Check + `SELECT FOR UPDATE` antes de débito |
| R2 | `balanceLocked` nunca negativo | Idem |
| R3 | Toda movimentação gera uma `Transaction` | Sem exceções — incluindo rake |
| R4 | `idempotencyKey` único por operação cliente | UUID gerado no cliente, constraint `@unique` |
| R5 | `matchId` único por settlement por usuário | Constraint composta `(userId, matchId)` na tabela de settlements |
| R6 | Payout máximo = 100× a aposta | Cap server-side em `settleMatchForUser` |
| R7 | Rake mínimo = 10% sobre kills e pools | Nunca bypassar |
| R8 | Saque só com email verificado + CPF | `emailVerified` + `cpf === user.cpf` |
| R9 | Game-server nunca acessa Wallet diretamente | Só via `/internal/*` no backend |
| R10 | Operações de saldo usam `optimistic locking` | Campo `version` incrementado em cada update |

### 3.3 Fluxo de Transações: Diagrama de Estados

```
DEPOSIT:
  PENDING → COMPLETED  [webhook payment.confirmed]
         → FAILED      [webhook payment.failed ou timeout]

WITHDRAW:
  PENDING → COMPLETED  [ops confirma pagamento Pix]
         → FAILED      [ops rejeita → estorno automático de locked]

MATCH — BET:
  COMPLETED  [startMatchForUser → trava imediato]

MATCH — SETTLEMENT:
  FEE: COMPLETED  [rake debitado de locked]
  WIN: COMPLETED  [payout creditado em available]
  Invariante: balanceLocked -= betAmount ao total (FEE + WIN consomem o lock)
```

### 3.4 Rake (Retenção da Casa)

| Evento | Rake | Base de Cálculo |
|--------|------|----------------|
| Kill em Hunt-Hunt | 10% | Pote da vítima no momento do kill |
| Cash-out antecipado HH | 30% | `accumulatedValue` no momento do cash-out |
| Pool do Big Fish | 10% | Σ entradas do match |
| Empate cabeça-cabeça | 100% | Pote de ambos vai para a casa |
| Venda no Marketplace | 5% (futuro) | Valor de venda |

### 3.5 Gatilho de Kill: Sequência Exata de 9 Passos

Esta sequência é mandatória e não pode ser reordenada:

```
1. Game-server detecta colisão fatal (cabeça de A no corpo/cabeça de B)
2. [memória] Marcar B como morto: B.alive = false
3. [memória] Dispersar 70% da massa de B como pellets ao longo da trilha
4. [memória] A.pendingKillPot += B.currentMatchPot
5. [memória] B.currentMatchPot = 0   ← DEVE ocorrer antes de qualquer retry
6. [memória] Enfileirar evento kill para log de auditoria
--- SETTLEMENT (ao fim do match ou cash-out de A) ---
7. Calcular: rake = B.entryAmount × 0.10; net = B.entryAmount - rake
8. POST /internal/match/result { userId: B.id, matchId, betAmount: B.entry, payout: 0 }
9. POST /internal/match/result { userId: A.id, matchId, betAmount: A.entry, payout: A.entry + A.pendingKillPot }
```

> **CRÍTICO:** Passos 8 e 9 devem usar `idempotencyKey` derivado de `matchId + userId` para serem retry-safe. Se o game-server cair entre os passos 6 e 8, o job de reconciliação (ver §5 da Auditoria) detecta o match aberto e liquida com payout = 0 para todos.

### 3.6 Gateway de Pagamento (Pix)

#### Depósito

```
POST /wallet/deposit
  → initiateDeposit(userId, amount, idempotencyKey)
  → Cria PENDING Transaction
  → Chama Gateway API → QR Code Pix (válido 15 min)
  → Retorna { transactionId, pixCode, pixCopyPaste, expiresAt }

Webhook POST /payments/webhook:
  → Verifica HMAC-SHA256 (timing-safe)
  → payment.confirmed → /internal/deposit/confirm → COMPLETED
  → payment.failed    → log (futuro: FAILED + notificação)
```

#### Saque

```
POST /wallet/withdraw
  → emailVerified + cpf === user.cpf
  → balanceAvailable >= amount
  → available -= amount, locked += amount
  → PENDING Transaction

Processamento (ops ou automação futura):
  → Gateway Pix API com CPF + amount
  → sucesso: locked -= amount, COMPLETED
  → falha:   locked -= amount, available += amount, FAILED
```

---

## 4. Sistema de Itens

### 4.1 Modelo de Dados

```prisma
model Item {
  id          String    @id @default(uuid())
  name        String
  description String?
  type        ItemType
  rarity      Rarity
  imageUrl    String
  gameId      String?   // null = cross-platform
  userItems   UserItem[]
}

model UserItem {
  id           String    @id @default(uuid())
  userId       String
  itemId       String
  serialNumber Int       @default(autoincrement())
  floatValue   Float     // [0.0, 1.0)
  obtainedAt   DateTime  @default(now())
  usageCount   Int       @default(0)
  user         User      @relation(...)
  item         Item      @relation(...)
  listing      MarketplaceListing?
}

model MarketplaceListing {
  id          String           @id @default(uuid())
  userItemId  String           @unique
  sellerId    String
  price       Decimal          @db.Decimal(18, 8)
  status      ListingStatus    // ACTIVE | SOLD | CANCELLED
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt
}

// A IMPLEMENTAR antes de produção
model ItemTransactionLog {
  id         String     @id @default(uuid())
  userItemId String
  fromUserId String?    // null = mint do sistema
  toUserId   String
  price      Decimal?   @db.Decimal(18, 8)
  source     ItemSource // MINT_BATTLEPASS | MINT_REWARD | MARKETPLACE | GIFT
  createdAt  DateTime   @default(now())
}
```

### 4.2 Tabela de Raridades

| Raridade | Cor | Drop Rate (BP) | Multiplicador de Preço | Float Visual |
|----------|-----|---------------|----------------------|-------------|
| COMMON | `#9CA3AF` | 60% | 1× | Qualquer |
| RARE | `#3B82F6` | 25% | 3× | < 0.7 aparência melhor |
| EPIC | `#8B5CF6` | 12% | 10× | < 0.4 aparência muito melhor |
| LEGENDARY | `#F59E0B` | 3% | 50× | < 0.1 = "Factory New" |

### 4.3 Float Value

| Range | Categoria | Efeito visual futuro |
|-------|-----------|---------------------|
| 0.00 – 0.07 | Factory New | Skin perfeita |
| 0.07 – 0.15 | Minimal Wear | Desgaste quase imperceptível |
| 0.15 – 0.38 | Field-Tested | Desgaste moderado |
| 0.38 – 0.45 | Well-Worn | Desgaste visível |
| 0.45 – 1.00 | Battle-Scarred | Muito desgastado |

```typescript
// Geração no backend (CosmeticsService)
const floatValue = crypto.randomInt(0, 2 ** 32) / 2 ** 32; // [0, 1)
```

### 4.4 Fluxo de Compra no Marketplace

```typescript
// Transação atômica — falha ou passa completo
await prisma.$transaction(async (tx) => {
  const listing = await tx.marketplaceListing.findUniqueOrThrow({
    where: { id: listingId, status: 'ACTIVE' },
    include: { userItem: true },
  });
  // Validações de negócio
  if (listing.sellerId === buyerId) throw new ForbiddenException();
  if (buyer.balanceAvailable < listing.price) throw new PaymentRequiredException();
  // Movimentações atômicas
  await tx.wallet.update({ where: { userId: buyerId },   data: { balanceAvailable: { decrement: listing.price } } });
  await tx.wallet.update({ where: { userId: sellerId },  data: { balanceAvailable: { increment: listing.price } } });
  await tx.userItem.update({ where: { id: listing.userItemId }, data: { userId: buyerId } });
  await tx.marketplaceListing.update({ where: { id: listingId }, data: { status: 'SOLD' } });
  await tx.transaction.createMany({ data: [/* ITEM_PURCHASE + ITEM_SALE */] });
  await tx.itemTransactionLog.create({ data: { /* ... */ source: 'MARKETPLACE' } });
});
```

---

## 5. Segurança e Anti-Cheat

### 5.1 Princípio Fundamental

> **O servidor é a única fonte de verdade.** O cliente é apenas renderização e entrada. Qualquer valor financeiro gerado apenas no cliente é uma afirmação não-confiável.

### 5.2 Validações Server-Side Mandatórias

| Dado Recebido | Validação | Rejeição |
|--------------|-----------|----------|
| `payout` de match | `payout <= betAmount × 100` | HTTP 400 + audit log |
| `amount` de depósito/saque | Positive, `maxDecimalPlaces(8)` | HTTP 400 |
| `amount` de saque | `amount <= balanceAvailable` (com `SELECT FOR UPDATE`) | HTTP 422 |
| `cpf` no saque | `cpf === user.cpf` | HTTP 403 |
| `idempotencyKey` | UUID único (constraint DB) | HTTP 409 |
| `matchId` no settlement | Não foi previamente settled para este usuário | HTTP 409 |
| Webhook payload | HMAC-SHA256 timing-safe | HTTP 401 silencioso |
| `direction` (game-server) | `|vector| ≤ 1.0 + ε` | Ignorar |
| `mass` reportada pelo cliente | **Nunca confiar** | Calcular no servidor |
| Cash-out durante ghost | `world.now > ghostUntil` (server-side) | HTTP 403 |

### 5.3 Validação de Física (a implementar no game-server)

```typescript
// Por tick (50ms)
function validatePlayerPhysics(player: ServerPlayer, inputDir: Vec2): void {
  const maxMovePerTick = (BASE_SPEED * SPRINT_MULTIPLIER) * (50 / 1000) * 1.05; // +5% tolerância
  const reportedDelta = Vec2.distance(player.lastValidatedPos, player.claimedPos);

  if (reportedDelta > maxMovePerTick) {
    player.violationCount++;
    player.claimedPos = player.lastValidatedPos; // corrigir para posição válida
    auditLog(AuditEvent.ANTI_CHEAT_VIOLATION, { userId: player.id, delta: reportedDelta });
  } else {
    player.lastValidatedPos = player.claimedPos;
    player.violationCount = Math.max(0, player.violationCount - 1); // decay
  }

  if (player.violationCount > KICK_THRESHOLD) kickPlayer(player, 'speed_hack');
}
```

### 5.4 Auditoria de Logs (Estrutura Mandatória)

```typescript
interface AuditLog {
  timestamp: string;     // ISO 8601
  event:     AuditEvent;
  userId:    string;
  matchId?:  string;
  amount?:   string;     // Decimal como string (evita perda de precisão)
  ip?:       string;
  meta:      Record<string, unknown>;
}

enum AuditEvent {
  DEPOSIT_INITIATED, DEPOSIT_CONFIRMED,
  WITHDRAW_REQUESTED, WITHDRAW_CONFIRMED, WITHDRAW_REJECTED,
  MATCH_BET_LOCKED, MATCH_KILL_EVENT, MATCH_CASHOUT, MATCH_SETTLEMENT,
  ITEM_MINTED, ITEM_LISTED, ITEM_SOLD,
  ANTI_CHEAT_VIOLATION, AUTH_LOGIN, AUTH_LOGOUT, AUTH_REGISTER,
}

// Retenção: financeiro = 5 anos, gameplay = 90 dias, anti-cheat = 1 ano
```

### 5.5 Rate Limiting

| Endpoint | Limite | Janela |
|----------|--------|--------|
| Global | 100 req | 60 seg |
| POST /auth/login | 5 req | 60 seg |
| POST /auth/register | 3 req | 300 seg |
| POST /wallet/deposit | 10 req | 60 seg |
| POST /wallet/withdraw | 3 req | 300 seg |
| /internal/* | Sem limite | — (API Key) |

---

## 6. Infraestrutura e Deploy

### 6.1 Variáveis de Ambiente

```env
# Backend (obrigatórias)
DATABASE_URL=postgresql://user:pass@host:5432/snakeys
JWT_SECRET=<≥64 chars aleatórios>
INTERNAL_API_KEY=<≥32 chars aleatórios>
WEBHOOK_SECRET=<fornecido pelo gateway Pix>
NODE_ENV=production
ALLOWED_ORIGINS=https://snakeys.com
PORT=3001

# Frontend
VITE_API_URL=https://api.snakeys.com/api
VITE_GAME_SERVER_URL=wss://game.snakeys.com

# Game Server
BACKEND_URL=http://backend:3001
INTERNAL_API_KEY=<mesmo do backend>
PORT=3000
```

### 6.2 Endpoints de API (Referência Completa)

| Método | Path | Auth | Finalidade |
|--------|------|------|-----------|
| POST | `/auth/register` | — | Criar conta |
| POST | `/auth/login` | — | Login |
| GET | `/auth/verify-email?token=` | — | Confirmar email |
| POST | `/auth/logout` | JWT | Logout |
| GET | `/wallet` | JWT | Saldo completo |
| GET | `/wallet/balance` | JWT | `{balance, locked}` |
| GET | `/wallet/transactions` | JWT | Histórico paginado |
| POST | `/wallet/deposit` | JWT | Iniciar Pix |
| POST | `/wallet/withdraw` | JWT | Solicitar saque |
| POST | `/wallet/match/entry` | JWT | Travar aposta |
| POST | `/wallet/match/settle` | JWT | Settlement + XP |
| GET | `/inventory` | JWT | Skins do usuário |
| POST | `/cosmetics/equip` | JWT | Equipar skin |
| POST | `/cosmetics/unequip` | JWT | Remover skin |
| GET | `/marketplace` | — | Listar listings |
| POST | `/marketplace/listings` | JWT | Criar listing |
| DELETE | `/marketplace/listings/:id` | JWT | Cancelar listing |
| POST | `/marketplace/buy` | JWT | Comprar item |
| GET | `/progression/me` | JWT | Info de level |
| GET | `/battle-pass/me` | JWT | Rewards + claims |
| POST | `/battle-pass/claim` | JWT | Reivindicar reward |
| POST | `/internal/match/entry` | KEY | Game-server → backend |
| POST | `/internal/match/result` | KEY | Game-server → backend |
| POST | `/internal/deposit/confirm` | KEY | Gateway → backend |

### 6.3 Curva de XP

```
Level N → N+1 XP necessário: 500 + 50N
XP acumulado para nível N: 25N² + 475N

Nível 1:   500 XP
Nível 10:  5.200 XP total
Nível 50:  86.250 XP total
Nível 100: 297.500 XP total

Por match: floor(massIngested / 10) + kills × 50
```

---

## 7. Roadmap e Migração PrimeHub

### 7.1 Interface IWalletProvider (Preparar Agora)

```typescript
interface IWalletProvider {
  getBalance(userId: string): Promise<WalletBalance>;
  lockFunds(userId: string, amount: Decimal, ref: string): Promise<string>; // → lockId
  releaseLock(lockId: string, payout: Decimal): Promise<void>;
  charge(userId: string, amount: Decimal, description: string): Promise<string>; // → txId
}

// Implementação atual
class LocalWalletProvider implements IWalletProvider { /* PostgreSQL */ }

// Implementação futura
class PrimeHubWalletProvider implements IWalletProvider { /* PrimeHub API */ }
```

### 7.2 Checklist de Migração PrimeHub

- [ ] `IWalletProvider` injetado via DI (NestJS)
- [ ] `User.primehubId String? @unique` no schema
- [ ] `UserItem.primehubTokenId String? @unique` no schema
- [ ] Feature flag `USE_PRIMEHUB_WALLET=false`
- [ ] Job de dual-write durante migração

### 7.3 Checklist de Segurança Antes de Produção

- [ ] Gateway Pix real integrado
- [ ] HTTPS obrigatório (TLS 1.2+)
- [ ] CSP headers no frontend
- [ ] Redis para JTI blacklist
- [ ] Validação de física server-side ativa
- [ ] Job de reconciliação de matches abandonados
- [ ] Auditoria de logs com retenção de 5 anos
- [ ] Backup automático PostgreSQL (diário)
- [ ] KYC/AML: limites por CPF verificado
- [ ] Compliance LGPD: endpoint de exclusão de dados
- [ ] `ItemTransactionLog` no schema antes de marketplace em produção

---

## Apêndice A: Glossário

| Termo | Definição |
|-------|-----------|
| **Massa** | Tamanho da cobra em gameplay. Sem valor monetário direto. |
| **Pote** | R$ apostado e acumulado durante o match. Dinheiro real. |
| **Rake** | Percentual retido pela casa em transações financeiras de match. |
| **Settlement** | Registro dos pagamentos no banco ao fim de um match. |
| **Ghost** | Invulnerabilidade pós-spawn (60s no HH). Sem kills de pote. |
| **Float** | Valor [0,1) representando desgaste visual de um item. |
| **Serial Number** | Número único de mint global. Quanto menor, mais antigo. |
| **idempotencyKey** | UUID cliente-gerado que garante processamento único. |
| **balanceLocked** | R$ em apostas ativas ou saques em processamento. |
| **balanceAvailable** | R$ disponível para apostar, sacar ou comprar. |
| **BET** | Transaction que move `available → locked` ao iniciar match. |
| **WIN** | Transaction que credita payout em `available` após settlement. |
| **FEE** | Transaction que registra rake retido pela casa. |
| **Tick** | Iteração do game loop. Game-server: 20 ticks/seg (50ms/tick). |
| **PrimeHub** | Plataforma unificada futura para identidade e wallet cross-game. |

---

## Apêndice B: Invariantes para Verificação de IA

Antes de gerar qualquer código financeiro ou de gameplay, verifique:

1. **Massa não é dinheiro.** Nunca some massa com pote.
2. **Settlement só via `WalletService`.** Nenhum outro serviço movimenta saldo.
3. **Payout cap = 100× a aposta.** Acima disso é bug ou exploit.
4. **`idempotencyKey` único.** Duplicata → 409, nunca 200.
5. **`matchId` único por settlement por usuário.** Segunda chamada com mesmo matchId → 409.
6. **Ghost não acumula pote.** Kills durante ghost não transferem R$.
7. **Empate de cabeça = pote para a casa.** Ambos morrem, nenhum ganha.
8. **Saque requer email verificado + CPF.** Sem exceções.
9. **Webhook sem HMAC = 401 silencioso.** Nunca processar payload não verificado.
10. **XP nunca decresce.** `accountXp` é lifetime monotônico crescente.
11. **Item equipado não pode ser listado.** Verificar antes de criar listing.
12. **Cash-out só após fim do ghost.** Validar `world.now > ghostUntil` no servidor.

---

*Fim do documento — Versão 1.1.0*
