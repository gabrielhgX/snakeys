// ─── Physics constants ────────────────────────────────────────────────────────

// Server-authoritative speed values (units per tick at 20 ticks/sec = 50ms/tick)
export const NORMAL_SPEED   = 5;
export const SPRINT_SPEED   = 8;

// Maximum position delta the server accepts per tick (sprint speed + 10% margin).
// Because the server computes position itself from direction+speed, a delta
// larger than this signals a clock-skew bug or future client-position attack.
export const MAX_DELTA_PER_TICK = SPRINT_SPEED * 1.10; // 8.8 units

// Sprint drains this many units of serverMass per tick
export const SPRINT_MASS_COST = 0.5;

// Fraction of current mass drained by hunger each interval
export const HUNGER_DRAIN_RATE = 0.02;

// Head-to-head collision: attacker needs ≥10% more serverMass to win outright.
// Below this threshold both snakes die (mutual kill) — pot goes to house.
export const HEAD_TO_HEAD_ADVANTAGE = 0.10;

// Eat radius formula constants (from Contrato Mestre §2.1)
export const RADIUS_BASE    = 4;
export const RADIUS_FACTOR  = 0.7;
export const EAT_MAGNETISM  = 6;

// ─── Anti-cheat sliding window ────────────────────────────────────────────────

// 5 seconds at 20 ticks/sec
export const ANTICHEAT_WINDOW_TICKS = 100;

// More than this fraction of ticks in the window being speed violations
// triggers a kick.
export const VIOLATION_RATE_THRESHOLD = 0.30;

export interface AntiCheatState {
  // Circular buffer: each slot is `true` if that tick was a speed violation.
  speedSamples: boolean[];
  sampleHead:   number;   // next write position in the circular buffer
  totalSamples: number;   // how many samples have been written (caps at WINDOW)
  violations:   number;   // running count of `true` slots currently in window
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface Vec2 {
  x: number;
  y: number;
}

export interface PlayerState {
  id:        string;   // userId from backend
  socketId:  string;
  email:     string;

  // `mass` is the client-visible value broadcast to all players (for rendering).
  // `serverMass` is the authoritative value used for collision resolution,
  // XP calculation, and anti-cheat comparisons.  They are kept in sync for
  // normal gameplay; they diverge only when the client reports a spoofed value.
  mass:       number;
  serverMass: number;

  position:  Vec2;
  lastPos:   Vec2;    // position at the previous tick — used for speed validation
  direction: Vec2;    // unit vector (normalised by server on receipt)
  speed:     number;
  alive:     boolean;
  sprinting: boolean;

  anticheat: AntiCheatState;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createPlayer(userId: string, socketId: string, email: string): PlayerState {
  const startX = Math.random() * 4000;
  const startY = Math.random() * 4000;

  return {
    id:         userId,
    socketId,
    email,
    mass:       100,
    serverMass: 100,
    position:  { x: startX, y: startY },
    lastPos:   { x: startX, y: startY },
    direction: { x: 1, y: 0 },
    speed:     NORMAL_SPEED,
    alive:     true,
    sprinting: false,
    anticheat: {
      speedSamples: new Array(ANTICHEAT_WINDOW_TICKS).fill(false),
      sampleHead:   0,
      totalSamples: 0,
      violations:   0,
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Radius of a snake's body circle as a function of serverMass. */
export function radiusOf(serverMass: number): number {
  return RADIUS_BASE + Math.sqrt(serverMass) * RADIUS_FACTOR;
}

/** Combined eat-detection radius (body radius + magnetism). */
export function eatRadius(serverMass: number): number {
  return radiusOf(serverMass) + EAT_MAGNETISM;
}

/**
 * Records one speed sample in the player's circular buffer.
 * Returns `true` if the player should be kicked (violation rate exceeded).
 */
export function recordSpeedSample(ac: AntiCheatState, isViolation: boolean): boolean {
  // Remove the sample being evicted from the window
  const evicted = ac.speedSamples[ac.sampleHead];
  if (evicted) ac.violations--;

  // Write the new sample
  ac.speedSamples[ac.sampleHead] = isViolation;
  if (isViolation) ac.violations++;

  // Advance the write head (circular)
  ac.sampleHead = (ac.sampleHead + 1) % ANTICHEAT_WINDOW_TICKS;
  if (ac.totalSamples < ANTICHEAT_WINDOW_TICKS) ac.totalSamples++;

  // Only evaluate once the window is full (avoid false positives at start)
  if (ac.totalSamples < ANTICHEAT_WINDOW_TICKS) return false;

  const violationRate = ac.violations / ANTICHEAT_WINDOW_TICKS;
  return violationRate > VIOLATION_RATE_THRESHOLD;
}
