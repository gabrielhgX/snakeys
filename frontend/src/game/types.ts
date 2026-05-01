// Shared types used by the engine, renderer and mode controllers.
// Kept in one file so a single import pulls everything UI code needs.

export type GameModeKey = 'hunt-hunt' | 'big-fish' | 'private';

/** Single food pellet — position + mass yield + render metadata. */
export interface Pellet {
  x: number;
  y: number;
  mass: number;
  color: string;
  /** Render radius in world units. Derived from mass + type. */
  size: number;
  /** Alive flag — reused slots in the pellet array. */
  alive: boolean;
  /** Marks pool-cluster pellets so renderer can give them a subtle ring. */
  pool: boolean;
}

/**
 * Snake entity. Self and bots share the same struct — only the `isBot`
 * flag toggles AI-driven vs input-driven movement.
 *
 * `trail` is the breadcrumb history: index 0 is the head, last index is
 * the tail. Crumbs are emitted every `BREADCRUMB_SPACING` units of head
 * travel and the array is trimmed to the length demanded by `mass`.
 */
export interface Snake {
  id: string;
  name: string;
  color: string;
  outlineColor: string;
  isBot: boolean;

  // ── Wallet exposure ────────────────────────────────────────────────────
  /**
   * Real-money pot the snake committed on entry. Used by Hunt-Hunt's
   * kill-steal logic (winner pockets the victim's pot) and by Big Fish's
   * end-of-round settlement (pool = sum of all pots). All snakes in a
   * given match carry the same pot — segregation is enforced upstream
   * by the matchmaking layer in the lobby.
   */
  pot: number;

  // ── Kinematics ─────────────────────────────────────────────────────────
  headX: number;
  headY: number;
  angle: number;        // current heading in radians
  targetAngle: number;  // desired heading (from input / AI)
  speed: number;        // base units/sec
  turnSpeed: number;    // max rad/sec of angular change
  sprinting: boolean;
  mass: number;
  /**
   * Internal counter that meters out trail-pellet drops while sprinting.
   * Each frame the per-second drain rate is added; when it crosses one
   * pellet's worth of mass, a colored pellet is emitted at the tail and
   * the same mass is debited from `mass`. Resets implicitly when sprint
   * stops because no further drain accumulates.
   */
  sprintDropAccum: number;

  /**
   * Cumulative mass absorbed over the snake's lifetime in this match.
   * Increments on every pellet consumed — does NOT decrease when mass
   * is lost (sprint drain, Big Fish drain). Drives the account/season
   * XP award at end-of-match (1 XP per 10 units).
   */
  massIngested: number;

  /**
   * Number of rival snakes this snake has killed in the match. Engine
   * increments on every `KillEvent` where this snake is the killer.
   * Surfaced via the snapshot so the HUD (Hunt-Hunt kill counter) and
   * the wallet settlement (50 XP per kill) can read the same number.
   */
  killCount: number;

  /**
   * Cosmetic float in [0, 1] — lower is better (CS:GO wear convention).
   * The renderer modulates the snake's opacity / visual weathering from
   * this. All snakes carry one so future visual effects can apply to
   * bots too, but right now only the player's float is surfaced in the
   * snapshot (`selfFloatValue`).
   */
  floatValue: number;

  // ── Body ───────────────────────────────────────────────────────────────
  /** Breadcrumb trail, head at [0]. */
  trail: { x: number; y: number }[];

  // ── Lifecycle ──────────────────────────────────────────────────────────
  alive: boolean;
  /** `world.now` ms while < this value: snake is ghost (alpha + no hit). */
  ghostUntil: number;
  /** Killer's snake id, if the snake was killed by another snake. */
  killedBy?: string | null;
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  mass: number;
  color: string;
  isSelf: boolean;
}

/**
 * Directional warning that precedes a Big Fish pool spawn. The UI reads
 * `x/y` in world coords and projects an arrow from the player's viewport
 * edge toward the target.
 */
export interface PoolWarning {
  x: number;
  y: number;
  /** `world.now` ms when the cluster spawns. */
  spawnsAt: number;
}

/**
 * Discriminated event union pushed onto `World.events` during a tick so
 * mode controllers can react to engine-level happenings (kills today,
 * potentially eat / pool-pickup later).
 *
 * The engine clears the array at the start of every `updateWorld` call,
 * so consumers must read it inside their own per-frame `update` hook.
 */
export interface KillEvent {
  type: 'kill';
  /** Snake id of the killer, or `null` if the snake died to wall/self. */
  killerId: string | null;
  victimId: string;
  /** R$ value the victim brought to the match. Stolen on kill in HH. */
  victimPot: number;
  victimMass: number;
  /** True if the player (self) was the victim — used by HH end-screen. */
  victimWasSelf: boolean;
}

export type GameEvent = KillEvent;

/**
 * Per-frame read-only snapshot surfaced to React. Engine mutates in place
 * for perf; the snapshot is what the HUD renders from.
 */
export interface WorldSnapshot {
  mode: GameModeKey;
  elapsedMs: number;

  selfAlive: boolean;
  selfMass: number;
  selfX: number;
  selfY: number;
  /** ms remaining under ghost protection (0 if over). */
  selfGhostMsLeft: number;
  /**
   * Lifetime pellet mass consumed by the player in this match. Passed
   * to `walletApi.matchSettle` so the backend can compute XP (1 per 10).
   * Distinct from `selfMass` (the live body mass) — `selfMass` drops
   * during drain while this counter only grows.
   */
  selfMassIngested: number;
  /**
   * Kills attributed to the player. Mirrors `huntHunt.killCount` for HH
   * mode but is also populated in Big Fish / private modes so the
   * settlement XP award has a single source of truth.
   */
  selfKillCount: number;
  /** Float value of the player's equipped skin in [0, 1]. */
  selfFloatValue: number;

  leaderboard: LeaderboardEntry[];

  huntHunt?: {
    /**
     * Live R$ accumulated from kills (sum of victims' pots). The 50% cash-out
     * cut is NOT applied here — the HUD shows the raw accumulated value and
     * the cash-out CTA renders "você recebe X (50%)" separately.
     */
    accumulatedValue: number;
    /** Number of snakes the player has killed in this match. */
    killCount: number;
    /** `world.now` ms when the user clicked cash-out, or null. */
    cashoutStartedAt: number | null;
    /** ms remaining in the 2-min cash-out drift (null if not started). */
    cashoutMsLeft: number | null;
    /** true if the final cash-out timer completed successfully. */
    cashedOut: boolean;
    /** Final R$ value after penalties, only set when session ends. */
    settledValue: number | null;
  };

  bigFish?: {
    /** ms remaining in the 16-minute round. */
    timeLeftMs: number;
    /** Current mass drain in mass-units/sec. */
    drainRate: number;
    /** Upcoming pool (warning visible); null when no pool is pending. */
    poolWarning: PoolWarning | null;
    /** Total room pool = sum of all participants' pots (R$). */
    poolValue: number;
    /** Self's live ranking by mass (1-based). null while dead. */
    selfRank: number | null;
    /** Final settlement R$ at time-up (null until match ends). */
    settledValue: number | null;
  };

  /** true once the match has ended from the engine's POV. */
  ended: boolean;
  endReason: 'died' | 'cashed-out' | 'time-up' | 'quit' | null;
}
