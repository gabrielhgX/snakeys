// Mode controllers — thin objects that drive mode-specific rules on top
// of the shared `World`. Each controller mutates `world` directly in its
// `update()` and exports a read-only `snapshot()` that the UI layer reads.

import {
  SPRINT_MIN_MASS,
  pickPoolLocation,
  spawnPoolCluster,
  type World,
} from './engine';
import type {
  GameModeKey,
  LeaderboardEntry,
  PoolWarning,
  WorldSnapshot,
} from './types';

// ─── Tunables ─────────────────────────────────────────────────────────────────
const GHOST_DURATION_MS = 60_000;
const CASHOUT_DURATION_MS = 2 * 60_000;
/**
 * Cash-out fraction: a successful cash-out credits 50% of the accumulated
 * stolen pots. The 50% house-edge funds the matchmaking pool / future
 * platform economics — in this build it just rounds out the 30 ⇒ 70 grow
 * curve so 1–2 kills don't pay back the entry fee on their own.
 */
const HUNT_HUNT_CASHOUT_FRACTION = 0.5;
/**
 * Penalty applied to the cash-out fraction when the player dies or quits
 * mid-drift. With FRACTION=0.5 and PENALTY=0.3 the effective payout in
 * that branch is 0.5 × 0.7 = 35% of accumulated.
 */
const CASHOUT_EARLY_PENALTY = 0.3;

const BIG_FISH_DURATION_MS = 16 * 60_000;
const BIG_FISH_POOL_INTERVAL_MS = 4 * 60_000;
const BIG_FISH_POOL_WARN_MS = 15_000;
/**
 * Drain ramps from 0 → 16 mass/sec across the round (quadratic). Early
 * minutes feel generous, the last 2–3 minutes melt everyone into a
 * scrum. Quadratic preferred over linear so the ramp accelerates near
 * the end — forces resolution rather than a slow grind.
 */
const BIG_FISH_MAX_DRAIN = 16;
/** Settlement split for top 3 alive at time-up. Sums to 1 — 100% payout. */
const BIG_FISH_PAYOUTS = [0.5, 0.3, 0.2] as const;

// ─── Controller interface ─────────────────────────────────────────────────────
export interface ModeController {
  readonly kind: GameModeKey;
  /** Called once per frame with the already-advanced `world.now`. */
  update(world: World, dt: number): void;
  /** Build the React-friendly snapshot. */
  snapshot(world: World): WorldSnapshot;

  // UI-driven actions. `true` return means the request was accepted.
  // `world` is passed in so the controller can anchor timers to the
  // simulation clock rather than wall-clock.
  tryCashOut?(world: World): boolean;
  tryQuit(world: World): void;
}

export function createMode(kind: GameModeKey, world: World): ModeController {
  if (kind === 'hunt-hunt') return new HuntHuntMode(world);
  if (kind === 'big-fish') return new BigFishMode(world);
  return new CasualMode(world); // 'private' falls back to no mode-rules
}

// ─── HUNT-HUNT ────────────────────────────────────────────────────────────────
/**
 *  Lifecycle:
 *   - Ghost mode for 60s on spawn (translucent + collision-immune).
 *   - Each kill credits the victim's pot to `accumulatedValue`. Bots and
 *     players carry the same pot in a given match (segregation by value).
 *   - Cash-out: 2-minute drift; if it completes, player banks 50% of
 *     accumulated. If the player dies or quits mid-drift, the 50% is
 *     further reduced by 30% (⇒ 35% of accumulated). Outside cash-out
 *     the death/quit branch pays 0.
 */
class HuntHuntMode implements ModeController {
  readonly kind: GameModeKey = 'hunt-hunt';

  private accumulatedValue = 0;
  private killCount = 0;
  private cashoutStartedAt: number | null = null;
  private cashedOut = false;
  private settledValue: number | null = null;
  private ended = false;
  private endReason: WorldSnapshot['endReason'] = null;

  constructor(world: World) {
    // Ghost protection from t=0. Renderer uses alpha; engine skips collisions.
    world.self.ghostUntil = world.now + GHOST_DURATION_MS;
  }

  update(world: World, _dt: number): void {
    if (this.ended) return;

    // ── Consume kill events from this frame ──────────────────────
    // The engine cleared `events` at the start of this tick, so anything
    // still here is from kills resolved during this frame's collision
    // pass. We credit the player's accumulator only when *they* are the
    // killer — bot↔bot kills are observed but worthless economically.
    const events = world.events;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.type !== 'kill') continue;
      if (ev.killerId === world.self.id) {
        this.accumulatedValue += ev.victimPot;
        this.killCount++;
      }
    }

    // ── Detected death ────────────────────────────────────────────
    if (!world.self.alive) {
      this.ended = true;
      this.endReason = 'died';
      this.settledValue = this.computeSettlement('died');
      return;
    }

    // ── Cash-out timer ────────────────────────────────────────────
    if (this.cashoutStartedAt !== null && !this.cashedOut) {
      const elapsed = world.now - this.cashoutStartedAt;
      if (elapsed >= CASHOUT_DURATION_MS) {
        this.cashedOut = true;
        this.ended = true;
        this.endReason = 'cashed-out';
        this.settledValue = this.computeSettlement('cashed-out');
      }
    }
  }

  snapshot(world: World): WorldSnapshot {
    const cashoutMsLeft =
      this.cashoutStartedAt === null
        ? null
        : Math.max(
            0,
            CASHOUT_DURATION_MS - (world.now - this.cashoutStartedAt),
          );

    return {
      mode: 'hunt-hunt',
      elapsedMs: world.now,
      selfAlive: world.self.alive,
      selfMass: world.self.mass,
      selfX: world.self.headX,
      selfY: world.self.headY,
      selfGhostMsLeft: Math.max(0, world.self.ghostUntil - world.now),
      leaderboard: buildLeaderboard(world),
      huntHunt: {
        accumulatedValue: this.accumulatedValue,
        killCount: this.killCount,
        cashoutStartedAt: this.cashoutStartedAt,
        cashoutMsLeft,
        cashedOut: this.cashedOut,
        settledValue: this.settledValue,
      },
      ended: this.ended,
      endReason: this.endReason,
    };
  }

  tryCashOut(world: World): boolean {
    if (this.cashoutStartedAt !== null || this.ended) return false;
    // Refuse cash-out while still ghost — the spawn-protection grace
    // period would let players bank with zero risk otherwise.
    if (world.now < world.self.ghostUntil) return false;
    this.cashoutStartedAt = world.now;
    return true;
  }

  tryQuit(_world: World): void {
    if (this.ended) return;
    this.ended = true;
    this.endReason = 'quit';
    this.settledValue = this.computeSettlement('quit');
  }

  /**
   * Settlement formula:
   *   - cashed-out (timer completed): 50% of accumulated
   *   - died/quit during cash-out:    50% × 0.7 = 35% of accumulated
   *   - died/quit outside cash-out:   0
   */
  private computeSettlement(
    reason: 'died' | 'quit' | 'cashed-out',
  ): number {
    if (reason === 'cashed-out') {
      return this.accumulatedValue * HUNT_HUNT_CASHOUT_FRACTION;
    }
    if (this.cashoutStartedAt !== null) {
      return (
        this.accumulatedValue *
        HUNT_HUNT_CASHOUT_FRACTION *
        (1 - CASHOUT_EARLY_PENALTY)
      );
    }
    return 0;
  }
}

// ─── BIG FISH ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * 16-minute round with accelerating mass drain (0 → 16 mass/sec, quadratic).
 * Pool clusters spawn every 4 min, telegraphed 15s ahead with a directional
 * arrow so players can race to them.
 *
 * Settlement runs at time-up: total pool = sum of every participant's
 * pot; payouts are 50% / 30% / 20% to top 1 / 2 / 3 alive snakes by mass.
 * Dead players (and walked-out players) settle at 0 — forfeit.
 */
class BigFishMode implements ModeController {
  readonly kind: GameModeKey = 'big-fish';

  private startedAt: number;
  private nextPoolAt: number;
  private activeWarning: PoolWarning | null = null;
  private ended = false;
  private endReason: WorldSnapshot['endReason'] = null;
  private readonly poolValue: number;
  private settledValue: number | null = null;

  constructor(world: World) {
    this.startedAt = world.now;
    this.nextPoolAt = world.now + BIG_FISH_POOL_INTERVAL_MS;
    // Pool size is fixed at construction — sums every participant's pot,
    // including bots. We freeze it here so the displayed total doesn't
    // shift if a snake dies (their entry stays in the pool either way).
    this.poolValue =
      world.self.pot +
      world.bots.reduce((acc, b) => acc + b.pot, 0);
  }

  update(world: World, dt: number): void {
    if (this.ended) return;

    const elapsed = world.now - this.startedAt;

    // Natural end by clock — settle.
    if (elapsed >= BIG_FISH_DURATION_MS) {
      this.ended = true;
      this.endReason = 'time-up';
      this.settledValue = this.computeSettlement(world);
      return;
    }

    if (!world.self.alive) {
      this.ended = true;
      this.endReason = 'died';
      this.settledValue = 0;
      return;
    }

    // ── Drain (player + bots, symmetrically) ─────────────────────────
    // Both sides feel the squeeze — otherwise the player would just sit
    // still while bots eat each other and win by attrition.
    const t = elapsed / BIG_FISH_DURATION_MS;
    const drain = BIG_FISH_MAX_DRAIN * t * t;
    const massDelta = drain * dt;
    if (world.self.mass > SPRINT_MIN_MASS) {
      world.self.mass = Math.max(
        SPRINT_MIN_MASS,
        world.self.mass - massDelta,
      );
    }
    for (let i = 0; i < world.bots.length; i++) {
      const bot = world.bots[i];
      if (!bot.alive) continue;
      if (bot.mass > SPRINT_MIN_MASS) {
        bot.mass = Math.max(SPRINT_MIN_MASS, bot.mass - massDelta);
      }
    }

    // ── Pool lifecycle ────────────────────────────────────────────
    const timeToNext = this.nextPoolAt - world.now;
    if (this.activeWarning === null && timeToNext <= BIG_FISH_POOL_WARN_MS) {
      const loc = pickPoolLocation(world);
      this.activeWarning = {
        x: loc.x,
        y: loc.y,
        spawnsAt: this.nextPoolAt,
      };
    }
    if (this.activeWarning && world.now >= this.activeWarning.spawnsAt) {
      spawnPoolCluster(world, this.activeWarning.x, this.activeWarning.y);
      this.activeWarning = null;
      this.nextPoolAt += BIG_FISH_POOL_INTERVAL_MS;
    }
  }

  snapshot(world: World): WorldSnapshot {
    const elapsed = world.now - this.startedAt;
    const t = Math.min(1, elapsed / BIG_FISH_DURATION_MS);
    const drainRate = BIG_FISH_MAX_DRAIN * t * t;
    const selfRank = world.self.alive ? this.computeSelfRank(world) : null;
    return {
      mode: 'big-fish',
      elapsedMs: elapsed,
      selfAlive: world.self.alive,
      selfMass: world.self.mass,
      selfX: world.self.headX,
      selfY: world.self.headY,
      selfGhostMsLeft: Math.max(0, world.self.ghostUntil - world.now),
      leaderboard: buildLeaderboard(world),
      bigFish: {
        timeLeftMs: Math.max(0, BIG_FISH_DURATION_MS - elapsed),
        drainRate,
        poolWarning: this.activeWarning,
        poolValue: this.poolValue,
        selfRank,
        settledValue: this.settledValue,
      },
      ended: this.ended,
      endReason: this.endReason,
    };
  }

  tryQuit(): void {
    if (this.ended) return;
    this.ended = true;
    this.endReason = 'quit';
    // Walk-away forfeits — you don't get the time-up payout.
    this.settledValue = 0;
  }

  /**
   * Computes the self-payout at time-up. Only the player's payout is
   * tracked — bots aren't real wallets, so their winnings are conceptually
   * "already credited to their NPC house account".
   */
  private computeSettlement(world: World): number {
    if (!world.self.alive) return 0;
    const rank = this.computeSelfRank(world);
    if (rank === null) return 0;
    if (rank >= 1 && rank <= BIG_FISH_PAYOUTS.length) {
      return this.poolValue * BIG_FISH_PAYOUTS[rank - 1];
    }
    return 0;
  }

  /**
   * Live rank by mass among alive snakes (1-based). O(N) since we just
   * count snakes that out-mass self. */
  private computeSelfRank(world: World): number | null {
    if (!world.self.alive) return null;
    let rank = 1;
    const selfMass = world.self.mass;
    for (let i = 0; i < world.bots.length; i++) {
      const bot = world.bots[i];
      if (!bot.alive) continue;
      if (bot.mass > selfMass) rank++;
    }
    return rank;
  }
}

// ─── Casual (private room fallback) ──────────────────────────────────────────
class CasualMode implements ModeController {
  readonly kind: GameModeKey = 'private';
  private ended = false;
  private endReason: WorldSnapshot['endReason'] = null;

  constructor(world: World) {
    // Brief ghost grace period so the player orients themselves.
    world.self.ghostUntil = world.now + 8_000;
  }

  update(world: World): void {
    if (!this.ended && !world.self.alive) {
      this.ended = true;
      this.endReason = 'died';
    }
  }

  snapshot(world: World): WorldSnapshot {
    return {
      mode: 'private',
      elapsedMs: world.now,
      selfAlive: world.self.alive,
      selfMass: world.self.mass,
      selfX: world.self.headX,
      selfY: world.self.headY,
      selfGhostMsLeft: Math.max(0, world.self.ghostUntil - world.now),
      leaderboard: buildLeaderboard(world),
      ended: this.ended,
      endReason: this.endReason,
    };
  }

  tryQuit(): void {
    if (this.ended) return;
    this.ended = true;
    this.endReason = 'quit';
  }
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────
function buildLeaderboard(world: World): LeaderboardEntry[] {
  const rows: LeaderboardEntry[] = [];
  if (world.self.alive) {
    rows.push({
      id: world.self.id,
      name: world.self.name,
      mass: world.self.mass,
      color: world.self.color,
      isSelf: true,
    });
  }
  for (let i = 0; i < world.bots.length; i++) {
    const b = world.bots[i];
    if (!b.alive) continue;
    rows.push({
      id: b.id,
      name: b.name,
      mass: b.mass,
      color: b.color,
      isSelf: false,
    });
  }
  rows.sort((a, b) => b.mass - a.mass);
  return rows.slice(0, 6);
}
