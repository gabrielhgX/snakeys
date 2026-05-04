# 00_CONTRATO_MESTRE.md
## Snakeys — Documento de Referência Absoluta

> **AVISO AOS MODELOS DE LINGUAGEM:** Este documento é a única fonte de verdade para o desenvolvimento do Snakeys. Em caso de conflito entre este documento e o código, o código **implementado e testado** tem precedência; atualize este documento para refletir a realidade. Em caso de dúvida sobre mecânicas novas, consulte as invariantes das Seções 2 e 3 antes de gerar código.

---

**Versão:** 1.0.0  
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

Massa **influencia** o Pote apenas em um ponto controlado: o **gatilho de kill** no Hunt-Hunt e o **ranking de massa** no Big Fish. Fora desses pontos, as duas variáveis são mutuamente invisíveis.

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
  // snake morre ao tentar escapar — implementar kill aqui
}
```

#### Gerenciamento da Trilha (Breadcrumbs)

```typescript
// A cada frame, inserir ponto na frente da trilha
// Remover pontos em excesso para manter BODY_LENGTH
const maxCrumbs = Math.ceil(BODY_LENGTH(snake.mass) / BREADCRUMB_SPACING);
snake.trail.unshift({ x: snake.headX, y: snake.headY });
if (snake.trail.length > maxCrumbs) snake.trail.length = maxCrumbs;
```

### 2.3 Colisão: Fórmulas e Regras de Desempate

#### 2.3.1 Cabeça-Corpo (Head-Body)

Amostrar a trilha do alvo a cada 3 breadcrumbs para performance:

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

**Resultado:** Attacker mata victim. Sem exceções — não há desempate neste tipo.

#### 2.3.2 Cabeça-Cabeça (Head-Head)

```typescript
function resolveHeadHead(a: Snake, b: Snake): 'a_wins' | 'b_wins' | 'mutual' {
  const ADVANTAGE_THRESHOLD = 0.10; // 10% de vantagem de massa

  const massA = a.mass;
  const massB = b.mass;
  const ratio = massA / massB;

  if (ratio > 1 + ADVANTAGE_THRESHOLD) return 'a_wins';  // A tem ≥10% a mais
  if (ratio < 1 - ADVANTAGE_THRESHOLD) return 'b_wins';  // B tem ≥10% a mais
  return 'mutual';                                         // empate → ambos morrem
}
```

**Tabela de desempate:**

| Situação | Resultado | Pote do Vencedor |
|----------|-----------|-----------------|
| Massa A ≥ 10% > Massa B | A vence, B morre | Transfere pote de B para A |
| Massa B ≥ 10% > Massa A | B vence, A morre | Transfere pote de A para B |
| Diferença < 10% | Empate — ambos morrem | Pote de ambos é descartado (House Edge adicional) |

> **IMPORTANTE:** O empate de cabeça-cabeça resulta em perda do pote de ambos. Isso é uma mecânica intencional de risco e deve ser documentado no client para o usuário.

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
| Entrada mínima | Configurável (ex: R$ 5,00) |

#### Fluxo de Kill (Transferência de Pote)

```
Jogador A (pote = R$50) mata Jogador B (pote = R$70)
  → kill_pot_gross = R$70
  → rake = R$70 × 0.10 = R$7.00
  → kill_pot_net = R$70 - R$7.00 = R$63.00
  → A.accumulatedValue += R$63.00
  → Transaction(type=FEE, amount=R$7.00, userId=B)    [casa retem]
  → Transaction(type=WIN, amount=R$63.00, userId=A)   [pendente até settlement]
```

> **INVARIANTE:** O settlement financeiro (`Transaction`) só ocorre via `WalletService`. O game-server nunca escreve diretamente no banco financeiro — ele chama `/internal/match/result` no backend.

#### Cash-Out Antecipado

```
Estado do jogador durante match:
  accumulatedValue: R$ 120.00
  lastCashOut: null | timestamp

Jogador solicita cash-out:
  1. Verificar cooldown: now - lastCashOut ≥ 3 min
  2. Calcular gross: R$120.00
  3. Taxa: R$120.00 × 0.30 = R$36.00
  4. Payout: R$120.00 - R$36.00 = R$84.00
  5. Transaction(FEE=R$36, WIN=R$84)
  6. accumulatedValue = 0; lastCashOut = now
  7. Jogador permanece vivo no match com pote zerado
```

#### Estado de Ghost

```
ghostUntil = spawnTime + 60_000ms

Durante ghost:
  - snake.ghostUntil > world.now → ignorar colisões de entrada
  - Renderizar translúcido (alpha ~0.4)
  - NÃO pode acumular kills de pote (pode comer pellets normalmente)
  - Pode ser visto por todos
```

### 2.6 Modo Big Fish (BF)

| Parâmetro | Valor |
|-----------|-------|
| Capacidade | 30 jogadores |
| Duração | 16 minutos (960 segundos) |
| Entrada mínima | Configurável (ex: R$ 10,00) |
| Pool de prêmio | Σ(entradas) × 0.90 (10% rake) |
| Distribuição Top 3 | 50% / 30% / 20% do pool |
| Jogadores mortos | R$ 0.00 (forfeit total) |

#### Sistema de Fome Progressiva

```typescript
// Drenagem cresce linearmente do início ao fim do match
// t em segundos [0, 960]
function hungerDrainPerSec(t: number): number {
  const MAX_DRAIN = 16; // massa/segundo no minuto 16
  return (t / 960) * MAX_DRAIN;
}

// Aplicar por frame (dt em segundos)
snake.mass -= hungerDrainPerSec(world.now / 1000) * dt;
if (snake.mass < SPRINT_MIN_MASS) snake.sprinting = false;
if (snake.mass <= 0) killSnake(snake, 'starvation');
```

#### Pools de Massa (a cada 4 minutos)

```
Evento em t=240s, t=480s, t=720s:
  1. Aviso na tela: "POOL EM 15 SEGUNDOS" (t-15s)
  2. Spawnar cluster de 80 pellets PELLET_POOL_MASS=4.5 em posição aleatória do mundo
  3. Posição visível no minimapa como marcador especial
  4. Pellets desaparecem após 60 segundos se não coletados
```

#### Settlement do Big Fish

```
Ao fim dos 16 minutos:
  rankings = snakesAlive.sort((a, b) => b.mass - a.mass)

  pool = Σ(all_entry_amounts) × 0.90

  if (rankings.length >= 1) payout[0] = pool × 0.50
  if (rankings.length >= 2) payout[1] = pool × 0.30
  if (rankings.length >= 3) payout[2] = pool × 0.20

  // Jogadores mortos e fora do top-3 → payout = 0
```

### 2.7 Grid Espacial (Otimização de Performance)

```typescript
// Divisão do mundo em células de 120 unidades
GRID_CELL_SIZE = 120

// Estrutura
class PelletGrid {
  cells: Map<string, Set<Pellet>>;  // key = "cx,cy"

  key(x, y) = `${Math.floor(x / CELL_SIZE)},${Math.floor(y / CELL_SIZE)}`

  insert(pellet): O(1)
  remove(pellet): O(1)
  queryRect(x, y, r): O(células dentro de r)  // ~4-9 células típico
}
```

**Alvo de performance:** 1.600 pellets simultâneos @ 60 fps no frontend e @ 20 ticks/seg no game-server.

### 2.8 Camera e Renderer

#### Zoom Dinâmico por Massa

```typescript
function zoomForMass(mass: number): number {
  // zoom = unidades de mundo por pixel CSS
  // cobra maior → câmera afasta
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
  balanceAvailable Decimal   @db.Decimal(18, 8)  // R$ disponível para saque/aposta
  balanceLocked    Decimal   @db.Decimal(18, 8)  // R$ em apostas ativas ou saques pendentes
  user             User      @relation(fields: [userId], references: [id])
  createdAt        DateTime  @default(now())
}

model Transaction {
  id              String            @id @default(uuid())
  userId          String
  type            TransactionType   // enum abaixo
  amount          Decimal           @db.Decimal(18, 8)
  status          TransactionStatus // enum abaixo
  matchId         String?
  idempotencyKey  String?           @unique
  referenceId     String?           // ref externa (gateway, pix)
  createdAt       DateTime          @default(now())
  user            User              @relation(...)
}

enum TransactionType {
  DEPOSIT        // entrada via Pix
  WITHDRAW       // saída via Pix
  BET            // aposta travada no início do match
  WIN            // ganho creditado no settlement
  FEE            // rake da casa
  ITEM_PURCHASE  // compra no marketplace
  ITEM_SALE      // venda no marketplace
}

enum TransactionStatus {
  PENDING    // aguardando confirmação
  COMPLETED  // finalizado
  FAILED     // falhou / estornado
}
```

### 3.2 Regras de Integridade Financeira

Estas regras são ABSOLUTAS. Qualquer código que as viole é um bug de segurança financeira:

| # | Regra | Implementação |
|---|-------|--------------|
| R1 | `balanceAvailable` nunca negativo | Check antes de qualquer débito |
| R2 | `balanceLocked` nunca negativo | Idem |
| R3 | Toda operação é uma `Transaction` | Sem movimentação sem registro |
| R4 | `idempotencyKey` único por operação | UUID gerado no cliente, constraint `@unique` |
| R5 | Payout máximo = 100× a aposta | Cap server-side em `settleMatchForUser` |
| R6 | Rake mínimo = 10% sobre kills e pools | Nunca bypassar em desenvolvimento |
| R7 | Saque só com email verificado + CPF | `emailVerified` + `cpf === user.cpf` |
| R8 | Saldo locked só é liberado pelo backend | Game-server não acessa Wallet diretamente |

### 3.3 Fluxo de Transações: Diagrama de Estados

```
DEPOSIT:
  [user solicita] → PENDING(DEPOSIT)
  [webhook payment.confirmed] → COMPLETED(DEPOSIT)
    └─ balanceAvailable += amount
  [webhook payment.failed] → FAILED(DEPOSIT)

WITHDRAW:
  [user solicita] → PENDING(WITHDRAW)
    └─ balanceAvailable -= amount, balanceLocked += amount
  [ops confirma] → COMPLETED(WITHDRAW)
    └─ balanceLocked -= amount
  [ops rejeita] → FAILED(WITHDRAW)
    └─ balanceLocked -= amount, balanceAvailable += amount  [estorno]

MATCH — BET:
  [startMatchForUser] → COMPLETED(BET)
    └─ balanceAvailable -= betAmount, balanceLocked += betAmount

MATCH — SETTLEMENT:
  [processMatchResult] → COMPLETED(FEE)
    └─ balanceLocked -= rake
  [processMatchResult] → COMPLETED(WIN)
    └─ balanceLocked -= (betAmount - rake), balanceAvailable += payout
  Invariante: balanceLocked -= betAmount ao total
```

### 3.4 Rake (Retenção da Casa)

| Evento | Rake | Base de Cálculo |
|--------|------|----------------|
| Kill em Hunt-Hunt | 10% | Sobre o pote da vítima no momento do kill |
| Cash-out antecipado HH | 30% | Sobre o `accumulatedValue` no momento do cash-out |
| Pool do Big Fish | 10% | Sobre a soma das entradas do match |
| Venda no Marketplace | 0% atual | Futuro: 5% do valor de venda (a implementar) |
| Empate cabeça-cabeça | 100% | Pote de ambos vai para a casa |

### 3.5 Gateway de Pagamento (Pix)

#### Fluxo de Depósito

```
POST /wallet/deposit
  └─ WalletService.initiateDeposit(userId, amount, idempotencyKey)
      ├─ Cria PENDING Transaction com idempotencyKey
      ├─ Chama Gateway API → gera QR Code Pix (válido 15 min)
      └─ Retorna { transactionId, pixCode, pixCopyPaste, expiresAt }

Webhook (POST /payments/webhook):
  ├─ Verifica HMAC-SHA256: X-Webhook-Signature vs WEBHOOK_SECRET
  ├─ Extrai referenceId (= transactionId interno)
  ├─ Se payment.confirmed → /internal/deposit/confirm
  └─ Se payment.failed   → log (futuro: marcar FAILED)
```

#### Fluxo de Saque

```
POST /wallet/withdraw
  └─ WalletService.requestWithdraw(userId, amount, cpf, idempotencyKey)
      ├─ Verifica emailVerified === true
      ├─ Verifica cpf === user.cpf
      ├─ Verifica balanceAvailable >= amount
      ├─ available -= amount, locked += amount
      ├─ Cria PENDING Transaction
      └─ Retorna { transactionId, status: 'pending' }

Processamento (manual/ops ou futuro automation):
  ├─ Chama Gateway API Pix com CPF + amount
  ├─ Se sucesso → confirmWithdraw() [locked -= amount, COMPLETED]
  └─ Se falha  → rejectWithdraw()  [refund available, FAILED]
```

### 3.6 Gatilho de Kill: Sequência Exata de Eventos

Esta é a sequência mandatória quando jogador A mata jogador B em Hunt-Hunt:

```
1. Game-server detecta colisão fatal (cabeça de A no corpo de B, ou HH a favor de A)
2. Game-server marca B como morto em memória (alive = false)
3. Game-server dispersa 70% da massa de B como pellets
4. Game-server acumula: A.pendingKillPot += B.currentMatchPot
5. Game-server enfileira: { event: 'kill', killer: A.id, victim: B.id, pot: B.currentMatchPot }
6. B.currentMatchPot = 0

NO SETTLEMENT (ao fim do match ou cash-out de A):
7. Para cada pot acumulado por A:
   rake = pot × 0.10
   net  = pot - rake
8. POST /internal/match/result { userId: B.id, matchId, betAmount: entrada_B, payout: 0 }
   → FEE transaction (rake) + WIN transaction (0) para B
9. POST /internal/match/result { userId: A.id, matchId, betAmount: entrada_A, payout: entrada_A + net }
   → FEE transaction + WIN transaction para A
```

> **CRÍTICO:** Passos 8 e 9 devem ser atômicos por usuário. Se o game-server cair antes do settlement, o backend deve ter um job de reconciliação que liquida matches em aberto com payout = 0.

---

## 4. Sistema de Itens

### 4.1 Modelo de Dados

```prisma
model Item {
  id          String    @id @default(uuid())
  name        String
  description String?
  type        ItemType  // enum
  rarity      Rarity    // enum
  imageUrl    String
  gameId      String?   // null = cross-platform; "snakeys" = exclusivo
  userItems   UserItem[]
}

model UserItem {
  id           String    @id @default(uuid())
  userId       String
  itemId       String
  serialNumber Int       @default(autoincrement())  // global — quanto menor, mais antigo
  floatValue   Float     // [0.0, 1.0) — gerado por crypto.randomInt / 2^32
  obtainedAt   DateTime  @default(now())
  usageCount   Int       @default(0)                // incrementa a cada match com item equipado
  user         User      @relation(...)
  item         Item      @relation(...)
  listing      MarketplaceListing?  // se ACTIVE, não pode ser equipado em outro
}

model MarketplaceListing {
  id          String           @id @default(uuid())
  userItemId  String           @unique
  sellerId    String
  price       Decimal          @db.Decimal(18, 8)
  status      ListingStatus    // ACTIVE | SOLD | CANCELLED
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt
  userItem    UserItem         @relation(...)
  seller      User             @relation(...)
}
```

### 4.2 Tabela de Raridades

| Raridade | Cor | Drop Rate (Battle Pass) | Multiplicador de Preço Base | Float Visual |
|----------|-----|------------------------|-----------------------------|-------------|
| COMMON | Cinza `#9CA3AF` | 60% | 1× | Qualquer |
| RARE | Azul `#3B82F6` | 25% | 3× | < 0.7 aparência melhor |
| EPIC | Roxo `#8B5CF6` | 12% | 10× | < 0.4 aparência muito melhor |
| LEGENDARY | Dourado `#F59E0B` | 3% | 50× | < 0.1 = "Factory New" |

### 4.3 Float Value

O float segue a convenção CS:GO de desgaste (quanto menor = melhor estado):

| Range | Categoria Visual | Efeito (futuro) |
|-------|-----------------|----------------|
| 0.00 – 0.07 | Factory New | Skin perfeita, sem desgaste |
| 0.07 – 0.15 | Minimal Wear | Desgaste leve, quase imperceptível |
| 0.15 – 0.38 | Field-Tested | Desgaste moderado |
| 0.38 – 0.45 | Well-Worn | Desgaste visível |
| 0.45 – 1.00 | Battle-Scarred | Muito desgastado |

```typescript
// Geração de float (backend — CosmeticsService)
const floatValue = crypto.randomInt(0, 2 ** 32) / 2 ** 32; // [0, 1)
```

### 4.4 Serial Number

- Global autoincrement no banco de dados
- Menor serial = item mais antigo = maior valor cultural/colecionável
- Exibir no card do item: `#000042`
- Imutável após mint

### 4.5 Histórico de Transações de Item

Cada transferência de item deve registrar:

```prisma
model ItemTransactionLog {
  id           String   @id @default(uuid())
  userItemId   String
  fromUserId   String?  // null = mint (origem: sistema)
  toUserId     String
  price        Decimal? @db.Decimal(18,8)  // null = não foi venda
  source       ItemSource  // MINT_BATTLEPASS | MINT_REWARD | MARKETPLACE | GIFT
  createdAt    DateTime @default(now())
}

enum ItemSource {
  MINT_BATTLEPASS
  MINT_REWARD
  MARKETPLACE
  GIFT
}
```

> **Nota de implementação:** `ItemTransactionLog` ainda não existe no schema. Deve ser adicionado antes de habilitar o marketplace em produção para rastreabilidade e compliance.

### 4.6 Tipos de Itens

| Tipo | Descrição | Afeta Gameplay |
|------|-----------|---------------|
| SKIN | Aparência da cobra (cor, textura) | Não — apenas visual |
| HAT | Acessório na cabeça | Não |
| EMOTE | Animação ao matar | Não |
| PROFILE_BACKGROUND | Fundo do perfil no lobby | Não |
| PROFILE_FRAME | Moldura do avatar | Não |

> **Invariante:** Nenhum item cosmético pode conferir vantagem de gameplay. Skins afetam `floatValue` para efeitos visuais futuros (desgaste, partículas) mas não alteram colisão, velocidade ou massa.

### 4.7 Fluxo de Compra no Marketplace

```
1. Comprador chama POST /marketplace/buy { listingId }
2. MarketplaceService.buyListing():
   a. Busca listing (status=ACTIVE, lock row com SELECT FOR UPDATE)
   b. Verifica: comprador ≠ vendedor
   c. Verifica: buyer.balanceAvailable >= listing.price
   d. Transação atômica (Prisma.$transaction):
      i.   buyer.balanceAvailable  -= price
      ii.  seller.balanceAvailable += price
      iii. userItem.userId          = buyerId
      iv.  listing.status           = SOLD
      v.   Transaction(ITEM_PURCHASE, buyer, price)
      vi.  Transaction(ITEM_SALE,     seller, price)
      vii. ItemTransactionLog(fromSeller, toBuyer, price, MARKETPLACE)
3. Retorna: { userItem, newBalance }
```

---

## 5. Segurança e Anti-Cheat

### 5.1 Princípio Fundamental

> **O servidor é a única fonte de verdade.** O cliente (frontend e game canvas) é apenas uma interface de renderização e entrada. Qualquer valor financeiro ou de estado de match gerado apenas no cliente é uma afirmação não-confiável.

### 5.2 Validações Server-Side Mandatórias

| Dado Recebido | Validação | Rejeição |
|--------------|-----------|----------|
| `payout` de match | `payout <= betAmount × 100` | HTTP 400, log de alerta |
| `amount` de depósito/saque | Positive, `maxDecimalPlaces(8)` | HTTP 400 |
| `amount` de saque | `amount <= balanceAvailable` | HTTP 422 |
| `cpf` no saque | `cpf === user.cpf` | HTTP 403 |
| `idempotencyKey` | UUID único (constraint DB) | HTTP 409 se duplicado |
| `matchId` no settlement | Pertence a este usuário | HTTP 403 |
| Webhook payload | HMAC-SHA256 timing-safe | HTTP 401, log |
| `direction` (game-server) | Vetor normalizado `|v| ≤ 1.0 + ε` | Ignorar silenciosamente |
| `mass` reportada pelo cliente | **Nunca confiar** — calcular no server | N/A |

### 5.3 Validação de Física no Game-Server (a implementar)

O game-server atual aceita a física calculada pelo cliente offline. Para o modo real, implementar:

```
A CADA TICK (50ms):
  1. Aplicar input de direção do cliente (direction, sprint)
  2. Calcular nova posição no servidor (mesmo algoritmo do cliente)
  3. Comparar posição servidor vs. posição reportada pelo cliente:
     - Tolerância: ≤ BASE_SPEED × 0.1 × dt (10% de desvio por tick)
     - Excedeu: corrigir para posição do servidor, incrementar violation_count
  4. Se violation_count > THRESHOLD_PER_MINUTE:
     - Log de suspeita
     - Kick após KICK_THRESHOLD violações
```

### 5.4 Sistema de Auditoria de Logs

Cada evento financeiro e de gameplay de alto valor deve ser registrado:

```typescript
// Estrutura de log de auditoria (para implementar com Winston ou Pino)
interface AuditLog {
  timestamp:  string;    // ISO 8601
  event:      AuditEvent;
  userId:     string;
  matchId?:   string;
  amount?:    string;    // Decimal serializado como string
  ip?:        string;
  meta:       Record<string, unknown>;
}

enum AuditEvent {
  DEPOSIT_INITIATED,
  DEPOSIT_CONFIRMED,
  WITHDRAW_REQUESTED,
  WITHDRAW_CONFIRMED,
  WITHDRAW_REJECTED,
  MATCH_BET_LOCKED,
  MATCH_KILL_EVENT,
  MATCH_CASHOUT,
  MATCH_SETTLEMENT,
  ITEM_MINTED,
  ITEM_LISTED,
  ITEM_SOLD,
  ANTI_CHEAT_VIOLATION,
  AUTH_LOGIN,
  AUTH_LOGOUT,
  AUTH_REGISTER,
}
```

**Retenção de logs:**
- Eventos financeiros: mínimo 5 anos (compliance fiscal Brasil)
- Eventos de gameplay: mínimo 90 dias (disputa de resultados)
- Eventos de anti-cheat: mínimo 1 ano

### 5.5 Rate Limiting

| Endpoint | Limite | Janela |
|----------|--------|--------|
| Global | 100 req | 60 seg |
| POST /auth/login | 5 req | 60 seg |
| POST /auth/register | 3 req | 300 seg |
| POST /wallet/deposit | 10 req | 60 seg |
| POST /wallet/withdraw | 3 req | 300 seg |
| /internal/* | Sem limite | — (protegido por API Key) |

### 5.6 Proteções de Autenticação

```
JWT:
  - Payload: { sub: userId, email, jti (UUID único por sessão) }
  - Expiração: configurável (padrão: 7 dias)
  - Logout: adiciona jti a RevokedToken com expiresAt
  - Verificação: checar jti em RevokedToken a cada request (implementar cache Redis)

CPF:
  - Validado no registro (algoritmo de dígito verificador)
  - Armazenado como string de 11 dígitos (sem pontuação)
  - Re-confirmado no saque (anti-fraude)
  - NUNCA exposto em respostas de API

Senha:
  - bcrypt com salt rounds = 10
  - maxLength = 72 chars (limite seguro do bcrypt)
  - @IsStrongPassword: 8+ chars, upper, lower, número
```

### 5.7 Proteção de Webhook

```typescript
// Verificação HMAC-SHA256 (timing-safe)
import { timingSafeEqual, createHmac } from 'crypto';

function verifyWebhookSignature(payload: Buffer, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  const expectedBuf = Buffer.from(`sha256=${expected}`);
  const sigBuf      = Buffer.from(signature);
  if (expectedBuf.length !== sigBuf.length) return false;
  return timingSafeEqual(expectedBuf, sigBuf);
}
```

### 5.8 Checklist de Segurança Antes de Produção

- [ ] Gateway Pix real integrado (remover sandbox)
- [ ] Variáveis de ambiente fora do repositório (secrets manager)
- [ ] HTTPS obrigatório (TLS 1.2+)
- [ ] CSP headers no frontend
- [ ] CORS restrito a domínios de produção
- [ ] Pino/Winston com redação de dados sensíveis (CPF, senha)
- [ ] Redis para blacklist de JTI (atual: só PostgreSQL)
- [ ] Validação de física server-side ativa no game-server
- [ ] Job de reconciliação de matches em aberto (timeout 2h)
- [ ] Backup automático do PostgreSQL (mínimo diário)
- [ ] Monitoramento de anomalias financeiras (alerts)
- [ ] Compliance LGPD: endpoint de exclusão de dados
- [ ] KYC/AML: limites de depósito/saque por CPF verificado

---

## 6. Infraestrutura e Deploy

### 6.1 Variáveis de Ambiente

#### Backend

```env
# Obrigatórias
DATABASE_URL=postgresql://user:pass@host:5432/snakeys
JWT_SECRET=<string aleatória ≥ 64 chars>
INTERNAL_API_KEY=<string aleatória ≥ 32 chars>
WEBHOOK_SECRET=<fornecido pelo gateway Pix>

# Opcionais (com defaults)
PORT=3001
NODE_ENV=production
ALLOWED_ORIGINS=https://snakeys.com
```

#### Frontend

```env
VITE_API_URL=https://api.snakeys.com/api
VITE_GAME_SERVER_URL=wss://game.snakeys.com
```

#### Game Server

```env
BACKEND_URL=http://backend:3001
PORT=3000
ALLOWED_ORIGINS=https://snakeys.com
INTERNAL_API_KEY=<mesmo do backend>
```

### 6.2 Endpoints de API (Referência Completa)

#### Auth

| Método | Path | Auth | Body | Resposta |
|--------|------|------|------|---------|
| POST | `/auth/register` | — | `{email, password, cpf}` | `{token}` |
| POST | `/auth/login` | — | `{email, password}` | `{token}` |
| GET | `/auth/verify-email?token=` | — | — | `{message}` |
| POST | `/auth/logout` | JWT | — | `{message}` |

#### Wallet

| Método | Path | Auth | Body/Query | Resposta |
|--------|------|------|-----------|---------|
| GET | `/wallet` | JWT | — | `WalletDto` |
| GET | `/wallet/balance` | JWT | — | `{balance, locked}` |
| GET | `/wallet/transactions` | JWT | `?limit&offset` | `Transaction[]` |
| POST | `/wallet/deposit` | JWT | `{amount, idempotencyKey}` | `DepositIntentDto` |
| POST | `/wallet/withdraw` | JWT | `{amount, cpf, idempotencyKey}` | `WithdrawIntentDto` |
| POST | `/wallet/match/entry` | JWT | `{mode, amount}` | `{matchId, balance, locked}` |
| POST | `/wallet/match/settle` | JWT | `{matchId, payout, massIngested?, kills?}` | `SettleResultDto` |

#### Inventário / Cosméticos

| Método | Path | Auth | Body | Resposta |
|--------|------|------|------|---------|
| GET | `/inventory` | JWT | — | `{equippedSkinId, items[]}` |
| GET | `/cosmetics/equipped` | JWT | — | `CosmeticInstanceDto \| null` |
| POST | `/cosmetics/equip` | JWT | `{userItemId}` | `UserItem` |
| POST | `/cosmetics/unequip` | JWT | — | `{message}` |

#### Marketplace

| Método | Path | Auth | Body/Query | Resposta |
|--------|------|------|-----------|---------|
| GET | `/marketplace` | — | `?page&limit` | `ListingDto[]` |
| POST | `/marketplace/listings` | JWT | `{userItemId, price}` | `ListingDto` |
| DELETE | `/marketplace/listings/:id` | JWT | — | `{message}` |
| POST | `/marketplace/buy` | JWT | `{listingId}` | `{userItem, newBalance}` |

#### Progressão / Battle Pass

| Método | Path | Auth | Resposta |
|--------|------|------|---------|
| GET | `/progression/me` | JWT | `{account: LevelInfo, season: LevelInfo}` |
| GET | `/battle-pass/me` | JWT | `{season, rewards[], claimableCount, claims}` |
| POST | `/battle-pass/claim` | JWT | `{level, grant}` |

#### Internal (API Key)

| Método | Path | Header | Body | Resposta |
|--------|------|--------|------|---------|
| POST | `/internal/match/entry` | `X-Internal-Key` | `{userId, amount, matchId}` | `{ok}` |
| POST | `/internal/match/result` | `X-Internal-Key` | `{userId, matchId, betAmount, payout}` | `{ok}` |
| POST | `/internal/deposit/confirm` | `X-Internal-Key` | `{transactionId}` | `{ok}` |

### 6.3 Eventos Socket.io

#### Cliente → Game Server

| Evento | Payload | Descrição |
|--------|---------|-----------|
| `join_queue` | `{token, matchId}` | Entrar na fila com JWT + matchId pré-reservado |
| `direction` | `{x: number, y: number}` | Vetor de direção normalizado |
| `sprint` | `{active: boolean}` | Toggle de sprint |
| `cashout_request` | — | Solicitar cash-out antecipado (Hunt-Hunt) |
| `disconnect` | — | Cleanup automático do Socket.io |

#### Game Server → Cliente

| Evento | Payload | Descrição |
|--------|---------|-----------|
| `authenticated` | `{userId}` | Handshake OK |
| `queued` | `{roomId, playersWaiting}` | Aguardando outros jogadores |
| `match_start` | `{matchDurationMs, mode}` | Match iniciado |
| `state` | `GameSnapshot` | Broadcast a cada 100ms |
| `kill_event` | `{killerId, victimId, potTransferred}` | Notificação de kill |
| `cashout_result` | `{payout, fee}` | Resultado do cash-out |
| `match_end` | `{rankings, payouts}` | Match encerrado |
| `error` | `{code, message}` | Erro genérico |

### 6.4 Curva de XP (Referência)

```
Level N → N+1 XP necessário: 500 + 50N
XP acumulado para nível N: 25N² + 475N

Nível 1:   500 XP
Nível 10:  5.200 XP total
Nível 50:  86.250 XP total
Nível 100: 297.500 XP total

Por match: floor(massIngested / 10) + kills × 50
Máximo teórico por match: ~10.500 XP (massa=50k + kills=200)
```

---

## 7. Roadmap e Migração PrimeHub

### 7.1 Fases de Desenvolvimento

| Fase | Descrição | Pré-requisitos |
|------|-----------|---------------|
| **Alpha** (atual) | Motor offline + backend financeiro + marketplace | — |
| **Beta** | Game-server autoritativo + gateway Pix real | Validação de física server-side |
| **Launch** | Anti-cheat completo + KYC/AML + auditoria | Compliance financeiro BR |
| **Scale** | Separação de serviços + Redis + CDN | Load test 1k+ concurrent |
| **PrimeHub** | Migração de identidade e wallet para PrimeHub | API PrimeHub disponível |

### 7.2 Preparação para PrimeHub

A migração para a PrimeHub (futura plataforma unificada) exige:

#### Contratos de Interface (preparar agora)

```typescript
// Abstração da Wallet — implementar interface hoje para trocar a implementação depois
interface IWalletProvider {
  getBalance(userId: string): Promise<WalletBalance>;
  lockFunds(userId: string, amount: Decimal, ref: string): Promise<string>; // → lockId
  releaseLock(lockId: string, payout: Decimal): Promise<void>;
  charge(userId: string, amount: Decimal, description: string): Promise<string>; // → txId
}

// Implementação atual: PostgreSQL direto
class LocalWalletProvider implements IWalletProvider { ... }

// Implementação futura: PrimeHub API
class PrimeHubWalletProvider implements IWalletProvider { ... }
```

#### Campos de Identidade Compatíveis

Manter no `User`:

```prisma
primehubId   String? @unique  // ID externo PrimeHub (null até migração)
primehubSync Boolean @default(false)
```

#### Itens Portáveis

O schema de `UserItem` já é adequado. Adicionar:

```prisma
primehubTokenId String? @unique  // NFT/token ID no ecossistema PrimeHub
```

#### Checklist de Migração PrimeHub

- [ ] `IWalletProvider` implementado e injetado via DI (NestJS)
- [ ] `LocalWalletProvider` em uso em staging
- [ ] `PrimeHubWalletProvider` em testes unitários com mock
- [ ] `User.primehubId` nullable no schema
- [ ] Job de migração de usuários com dual-write (local + PrimeHub)
- [ ] Rollback plan: feature flag `USE_PRIMEHUB_WALLET=false`

### 7.3 Débito Técnico Prioritário

| Item | Impacto | Complexidade | Prioridade |
|------|---------|-------------|-----------|
| Gateway Pix real | 🔴 Bloqueante para produção | Média | P0 |
| Validação de física server-side | 🔴 Anti-cheat crítico | Alta | P0 |
| `ItemTransactionLog` no schema | 🔴 Compliance | Baixa | P0 |
| Redis para JTI blacklist | 🟡 Performance em escala | Média | P1 |
| Job de reconciliação de matches | 🟡 Integridade financeira | Média | P1 |
| Auditoria de logs estruturados | 🟡 Compliance e debug | Média | P1 |
| Marketplace rake (5%) | 🟢 Revenue | Baixa | P2 |
| KYC/AML com limite de CPF | 🟡 Regulatório | Alta | P1 |
| Interface `IWalletProvider` | 🟢 Preparação PrimeHub | Baixa | P2 |

---

## Apêndice A: Glossário

| Termo | Definição |
|-------|-----------|
| **Massa** | Unidade de gameplay que representa o tamanho e poder da cobra. Não tem valor monetário direto. |
| **Pote** | Valor em R$ apostado e/ou acumulado por kills durante o match. É dinheiro real. |
| **Rake** | Percentual retido pela casa em transações financeiras de match. |
| **Settlement** | Processo de calcular e registrar no banco de dados os pagamentos ao fim de um match. |
| **Ghost** | Estado de invulnerabilidade pós-spawn (60s no HH). Cobra translúcida, sem kills de pote. |
| **Float** | Valor [0,1) que representa o desgaste visual de um item cosmético. |
| **Serial Number** | Número único e global de mint de um item. Quanto menor, mais antigo. |
| **idempotencyKey** | UUID gerado pelo cliente que garante que uma operação financeira não seja processada duas vezes. |
| **balanceLocked** | Saldo em trânsito — em apostas ativas ou saques em processamento. |
| **balanceAvailable** | Saldo disponível para apostar, sacar ou comprar no marketplace. |
| **BET** | Transaction que move `available → locked` ao iniciar um match. |
| **WIN** | Transaction que credita o payout em `available` após settlement. |
| **FEE** | Transaction que registra o rake retido pela casa. |
| **Tick** | Uma iteração do game loop. O game-server roda a 20 ticks/seg (50ms/tick). |
| **PrimeHub** | Plataforma unificada futura para identidade, wallet e itens cross-game. |

---

## Apêndice B: Invariantes para Verificação de IA

Se você é um modelo de linguagem gerando código para este projeto, verifique mentalmente estas invariantes antes de submeter qualquer código que envolva finanças ou gameplay:

1. **Massa não é dinheiro.** Nunca some massa com pote, nunca converta diretamente.
2. **Settlement só via `WalletService`.** Nenhum outro serviço movimenta `balanceAvailable` ou `balanceLocked`.
3. **Payout cap = 100× a aposta.** Qualquer valor acima disso é bug ou exploit.
4. **`idempotencyKey` único.** Gere no cliente, salve no banco com `@unique`. Duplicata → 409, não 500.
5. **Ghost não accumula pote.** Kills durante `ghostUntil > world.now` não transferem pote.
6. **Empate de cabeça = pote para a casa.** Ambos morrem, nenhum ganha.
7. **Saque requer email verificado + CPF confirmado.** Sem exceções.
8. **Webhook sem HMAC válido = 401 silencioso.** Nunca processar payload não verificado.
9. **Item equipado não pode ser listado no marketplace.** Verificar antes de criar listing.
10. **XP nunca decresce.** `accountXp` é lifetime monotonicamente crescente.

---

*Fim do documento — Versão 1.0.0*
