import { v4 as uuidv4 } from 'uuid';
import { BackendClient } from '../api/BackendClient';
import { config } from '../config';
import {
  ANTICHEAT_WINDOW_TICKS,
  HEAD_TO_HEAD_ADVANTAGE,
  HUNGER_DRAIN_RATE,
  MAX_DELTA_PER_TICK,
  NORMAL_SPEED,
  PlayerState,
  SPRINT_MASS_COST,
  SPRINT_SPEED,
  Vec2,
  createPlayer,
  eatRadius,
  recordSpeedSample,
} from './Player';

// ─── Pellet constants ─────────────────────────────────────────────────────────

const PELLET_COUNT_INITIAL = 200;  // pellets present at game start
const PELLET_MASS_SMALL    = 0.8;
const PELLET_MASS_LARGE    = 2.4;
const PELLET_LARGE_CHANCE  = 0.20; // 20% of spawned pellets are large
const WORLD_SIZE           = 4000; // matches client world bounds

interface Pellet {
  id:   string;
  x:    number;
  y:    number;
  mass: number;
}

// ─── Room constants ───────────────────────────────────────────────────────────

const TICK_MS            = 50;      // 20 ticks/second
const HUNGER_INTERVAL_MS = 150_000; // 2m30s between hunger escalations

export type RoomStatus = 'waiting' | 'active' | 'finished';

// ─── GameRoom ─────────────────────────────────────────────────────────────────

export class GameRoom {
  readonly id:    string;
  readonly buyIn: number;
  status: RoomStatus = 'waiting';

  // Registered by index.ts — lets the room kick a socket from outside the game loop.
  onKickPlayer?: (socketId: string, reason: string) => void;

  private players      = new Map<string, PlayerState>();
  private pellets      = new Map<string, Pellet>();
  private tickInterval:  ReturnType<typeof setInterval> | null = null;
  private matchEndTimer: ReturnType<typeof setTimeout>  | null = null;
  private hungerTimer:   ReturnType<typeof setInterval> | null = null;
  private hungerLevel = 0;

  constructor(
    private readonly backend: BackendClient,
    buyIn: number,
  ) {
    this.id    = uuidv4();
    this.buyIn = buyIn;
  }

  get playerCount() {
    return this.players.size;
  }

  // ── Player management ────────────────────────────────────────────────────

  addPlayer(userId: string, socketId: string, email: string): PlayerState {
    const player = createPlayer(userId, socketId, email);
    // SPRINT 5: initialise accumulated pot to the room buy-in so kill transfers
    // are accurate from the very first kill.
    player.accumulatedPot = this.buyIn;
    this.players.set(userId, player);
    return player;
  }

  removePlayer(userId: string): void {
    this.players.delete(userId);
  }

  getPlayer(userId: string): PlayerState | undefined {
    return this.players.get(userId);
  }

  updateDirection(userId: string, dir: Vec2): void {
    const player = this.players.get(userId);
    if (!player || !player.alive) return;
    const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y);
    if (len === 0) return;
    player.direction = { x: dir.x / len, y: dir.y / len };
  }

  setSprinting(userId: string, sprinting: boolean): void {
    const player = this.players.get(userId);
    if (!player) return;
    // Server enforces: can only sprint when serverMass ≥ minimum
    player.sprinting = sprinting && player.serverMass >= 15;
  }

  // ── Pellet management ────────────────────────────────────────────────────

  private spawnPellet(): Pellet {
    const isLarge = Math.random() < PELLET_LARGE_CHANCE;
    const pellet: Pellet = {
      id:   uuidv4(),
      x:    Math.random() * WORLD_SIZE,
      y:    Math.random() * WORLD_SIZE,
      mass: isLarge ? PELLET_MASS_LARGE : PELLET_MASS_SMALL,
    };
    this.pellets.set(pellet.id, pellet);
    return pellet;
  }

  /**
   * Validates a client's claim that it ate pellet `pelletId` at position
   * (`headX`, `headY`) and — if valid — credits `serverMass`.
   *
   * Validation:
   *   1. Pellet must still exist on the server (not already consumed).
   *   2. Distance from head to pellet ≤ server-computed eatRadius(serverMass).
   *
   * On success the pellet is consumed and an identical-count replacement is
   * spawned so overall pellet density stays constant.
   *
   * Returns the consumed Pellet on success, or null on rejection.
   */
  validateAndEatPellet(
    userId:   string,
    pelletId: string,
    headX:    number,
    headY:    number,
  ): Pellet | null {
    const player = this.players.get(userId);
    if (!player || !player.alive) return null;

    const pellet = this.pellets.get(pelletId);
    if (!pellet) return null; // already consumed by someone else

    const dx   = headX - pellet.x;
    const dy   = headY - pellet.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > eatRadius(player.serverMass)) {
      console.warn(
        `[ANTICHEAT] pellet_eat rejected userId=${userId} ` +
        `pelletId=${pelletId} dist=${dist.toFixed(1)} ` +
        `maxAllowed=${eatRadius(player.serverMass).toFixed(1)}`,
      );
      return null;
    }

    // Valid: update server-authoritative mass and replenish pellet pool
    player.serverMass += pellet.mass;
    player.mass        = player.serverMass;
    this.pellets.delete(pelletId);
    this.spawnPellet();

    return pellet;
  }

  // ── Match lifecycle ──────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.status !== 'waiting') return;
    this.status = 'active';

    // Seed the server-side pellet field
    for (let i = 0; i < PELLET_COUNT_INITIAL; i++) {
      this.spawnPellet();
    }

    // Lock buy-in for each player; pass 'big-fish' so the Match lifecycle
    // record created in processBetEntry() carries the correct mode.
    await Promise.all(
      Array.from(this.players.keys()).map((userId) =>
        this.backend.processBetEntry(userId, this.buyIn, this.id, 'big-fish'),
      ),
    );

    this.tickInterval  = setInterval(() => this.tick(), TICK_MS);
    this.hungerTimer   = setInterval(() => { this.hungerLevel++; this.applyHunger(); }, HUNGER_INTERVAL_MS);
    this.matchEndTimer = setTimeout(() => this.end(), config.matchDurationMs);
  }

  private tick(): void {
    for (const player of this.players.values()) {
      if (!player.alive) continue;

      // ── Sprint: drain serverMass, adjust speed ───────────────────────────
      if (player.sprinting) {
        player.serverMass = Math.max(10, player.serverMass - SPRINT_MASS_COST);
        player.mass       = player.serverMass;
        player.speed      = SPRINT_SPEED;
      } else {
        player.speed = NORMAL_SPEED;
      }

      // ── Position update (server-authoritative) ───────────────────────────
      player.lastPos = { x: player.position.x, y: player.position.y };

      player.position.x += player.direction.x * player.speed;
      player.position.y += player.direction.y * player.speed;
      player.position.x  = Math.max(0, Math.min(WORLD_SIZE, player.position.x));
      player.position.y  = Math.max(0, Math.min(WORLD_SIZE, player.position.y));

      // ── SPRINT 3 — Sliding window speed validation ───────────────────────
      // The server computes position so the delta should always equal `speed`.
      // Any delta > MAX_DELTA_PER_TICK indicates a physics anomaly (clock skew,
      // future client-position injection, etc.).
      const dx          = player.position.x - player.lastPos.x;
      const dy          = player.position.y - player.lastPos.y;
      const delta       = Math.sqrt(dx * dx + dy * dy);
      const isViolation = delta > MAX_DELTA_PER_TICK;
      const shouldKick  = recordSpeedSample(player.anticheat, isViolation);

      if (shouldKick && this.onKickPlayer) {
        const rate = (player.anticheat.violations / ANTICHEAT_WINDOW_TICKS * 100).toFixed(1);
        console.warn(
          `[ANTICHEAT] speed_hack_sustained userId=${player.id} ` +
          `violation_rate=${rate}% threshold=${(ANTICHEAT_WINDOW_TICKS * 0.30)} — kicking`,
        );
        player.alive = false;
        this.onKickPlayer(player.socketId, 'speed_hack');
      }
    }

    this.checkCollisions();
  }

  /**
   * Head-to-head collision resolution using server-authoritative mass and the
   * 10% advantage threshold from Contrato Mestre §2.3.2.
   *
   * Outcome table:
   *   ratio > 1.10  → the heavier snake wins, absorbs 50% of victim's serverMass
   *   ratio < 0.90  → the lighter snake loses
   *   ratio ≈ 1.00  → mutual kill; both die, pots go to house
   */
  private checkCollisions(): void {
    const alive = Array.from(this.players.values()).filter((p) => p.alive);

    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i];
        const b = alive[j];

        const dx   = a.position.x - b.position.x;
        const dy   = a.position.y - b.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Use serverMass for radius computation — spoof-proof
        const combinedRadius =
          Math.sqrt(a.serverMass) + Math.sqrt(b.serverMass);

        if (dist >= combinedRadius) continue;

        // 10% advantage threshold (Contrato Mestre §2.3.2)
        const ratio = a.serverMass / b.serverMass;

        if (ratio > 1 + HEAD_TO_HEAD_ADVANTAGE) {
          // A wins: absorb mass, transfer pot, report kill (fire-and-forget)
          a.serverMass += b.serverMass * 0.5;
          a.mass        = a.serverMass;
          b.alive       = false;
          this.reportKill(a, b);
        } else if (ratio < 1 - HEAD_TO_HEAD_ADVANTAGE) {
          // B wins: symmetric
          b.serverMass += a.serverMass * 0.5;
          b.mass        = b.serverMass;
          a.alive       = false;
          this.reportKill(b, a);
        } else {
          // Mutual kill — both die, pots go to house (logged for audit)
          console.log(
            `[COLLISION] mutual_kill ` +
            `a=${a.id}(mass=${a.serverMass.toFixed(1)}) ` +
            `b=${b.id}(mass=${b.serverMass.toFixed(1)}) ` +
            `ratio=${ratio.toFixed(3)}`,
          );
          a.alive = false;
          b.alive = false;
          // Mutual kills: both pots go to the house; no reportKill needed.
        }
      }
    }
  }

  /**
   * Records a kill and transfers the victim's accumulated pot to the killer.
   * Called synchronously inside checkCollisions — the backend HTTP call is
   * fire-and-forget so it never blocks the game loop.
   *
   * Pot accounting (in-memory, Sprint 5):
   *   killer.accumulatedPot += victim.accumulatedPot * (1 - rakeRate)
   *   victim.accumulatedPot  = 0
   *
   * The backend (KillProcessorWorker) writes the KillEvent audit row.
   * Final financial settlement (FEE + WIN transactions) still happens via
   * processMatchResult at match end.
   */
  private reportKill(killer: PlayerState, victim: PlayerState): void {
    const RAKE_RATE  = 0.10;
    const grossPot   = victim.accumulatedPot;
    const netPot     = grossPot * (1 - RAKE_RATE);

    // Update in-memory pot accounting
    killer.accumulatedPot += netPot;
    victim.accumulatedPot  = 0;

    // Fire-and-forget backend call — errors are logged, never thrown
    this.backend
      .reportKill(this.id, killer.id, victim.id, grossPot)
      .catch((err: Error) =>
        console.error(
          `[kill-report] failed matchId=${this.id} killer=${killer.id} ` +
          `victim=${victim.id}: ${err.message}`,
        ),
      );
  }

  private applyHunger(): void {
    for (const player of this.players.values()) {
      if (!player.alive) continue;
      const drain       = player.serverMass * HUNGER_DRAIN_RATE * this.hungerLevel;
      player.serverMass = Math.max(10, player.serverMass - drain);
      player.mass       = player.serverMass;
    }
  }

  // ── Snapshot (broadcast every 100ms) ─────────────────────────────────────

  getSnapshot() {
    return {
      players: Array.from(this.players.values()).map((p) => ({
        id:       p.id,
        email:    p.email,
        mass:     p.mass,
        position: p.position,
        alive:    p.alive,
      })),
      // Send pellet list so the client can render what the server has
      pellets: Array.from(this.pellets.values()).map((p) => ({
        id:   p.id,
        x:    p.x,
        y:    p.y,
        mass: p.mass,
      })),
    };
  }

  // ── Settlement ───────────────────────────────────────────────────────────

  async end(): Promise<void> {
    if (this.status === 'finished') return;
    this.status = 'finished';

    if (this.tickInterval)  clearInterval(this.tickInterval);
    if (this.hungerTimer)   clearInterval(this.hungerTimer);
    if (this.matchEndTimer) clearTimeout(this.matchEndTimer);

    // Rank by serverMass — only alive players are eligible for prizes
    const ranked = Array.from(this.players.values())
      .sort((a, b) => b.serverMass - a.serverMass);

    const totalPool    = this.players.size * this.buyIn;
    const payoutRatios = [0.50, 0.30, 0.20];

    await Promise.all(
      ranked.map((player, index) => {
        const payout = player.alive && index < 3
          ? totalPool * payoutRatios[index]
          : 0;

        // SPRINT 3: pass serverMass so the backend can store it in the Match
        // record and detect client-reported mass discrepancies on settle.
        return this.backend.processMatchResult(
          player.id,
          this.id,
          this.buyIn,
          payout,
          player.serverMass,
        );
      }),
    );
  }
}
