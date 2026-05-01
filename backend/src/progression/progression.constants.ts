/**
 * Progression / Battle-Pass tunables.
 *
 * Centralized so service code, controllers, and (later) the frontend
 * preview UI all read the same numbers. The XP curve lives here as a
 * small set of pure functions — they have no DB dependency, so they're
 * trivially unit-testable and reusable from migrations or seed scripts.
 */

// ── XP gain rates ───────────────────────────────────────────────────────────
//
// Both `accountXp` and `seasonXp` increment by the SAME formula at the
// end of a match:
//   • 1 XP per 10 mass ingested over the lifetime of the snake
//   • 50 XP per kill credited to the player
//
// Anti-cheat note: massIngested is sourced from the engine snapshot,
// which is client-driven in this build. Server should re-cap it when an
// authoritative game server is introduced. Until then we apply a
// paranoid cap (`MAX_MASS_PER_MATCH`) so a single replayed match can't
// dump millions of XP into an account.
export const XP_PER_MASS_DIVISOR = 10; // 10 mass → 1 XP
export const XP_PER_KILL = 50;
export const MAX_MASS_PER_MATCH = 50_000; // ~500 XP from mass alone
export const MAX_KILLS_PER_MATCH = 200; // way above legitimate ceilings

// ── Battle Pass curve ───────────────────────────────────────────────────────
//
// Hybrid curve: cost of leveling N → N+1 is (500 + 50·N).
// • Level 0 → 1: 550 XP
// • Level 99 → 100: 5_450 XP (since N=99 here)
// Cumulative XP to *reach* level N = sum_{k=0..N-1}(500 + 50k)
//                                  = 500·N + 25·N·(N-1)
//                                  = 25·N² + 475·N
//
// At MAX_LEVEL (100) cumulative is 25·10000 + 475·100 = 297_500 XP.

export const MAX_LEVEL = 100;
export const LEVEL_BASE_COST = 500;
export const LEVEL_LINEAR_COST = 50;

/** XP cost of leveling from `level` → `level + 1`. */
export function xpCostOfLevel(level: number): number {
  if (level < 0) return 0;
  if (level >= MAX_LEVEL) return 0;
  return LEVEL_BASE_COST + LEVEL_LINEAR_COST * level;
}

/** Cumulative XP required to *reach* `level`. Level 0 = 0 XP. */
export function cumulativeXpForLevel(level: number): number {
  const n = Math.max(0, Math.min(level, MAX_LEVEL));
  // Closed form: 25·n² + 475·n. Avoids loop allocation.
  return 25 * n * n + 475 * n;
}

/**
 * Inverse of `cumulativeXpForLevel`. Given a total XP, returns the
 * highest level fully reached.
 *
 * Solves 25·n² + 475·n - xp = 0 → n = (-475 + √(475² + 100·xp)) / 50.
 * Floored, clamped to [0, MAX_LEVEL].
 */
export function levelFromXp(xp: number): number {
  if (xp <= 0) return 0;
  const disc = 475 * 475 + 100 * xp;
  const n = (-475 + Math.sqrt(disc)) / 50;
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_LEVEL, Math.max(0, Math.floor(n)));
}

/**
 * Detailed breakdown of a player's current standing in the curve. Used
 * by `/progression/me` to drive a progress bar and "X XP to next level"
 * labels in the UI.
 */
export interface LevelInfo {
  level: number;
  xp: number;
  xpForCurrentLevel: number; // cumulative XP at start of this level
  xpForNextLevel: number; // cumulative XP at start of next level
  xpIntoLevel: number; // xp - xpForCurrentLevel
  xpToNextLevel: number; // xpForNextLevel - xp
  isMaxLevel: boolean;
}

export function levelInfo(xp: number): LevelInfo {
  const safeXp = Math.max(0, Math.floor(xp));
  const level = levelFromXp(safeXp);
  const xpForCurrentLevel = cumulativeXpForLevel(level);
  const isMaxLevel = level >= MAX_LEVEL;
  const xpForNextLevel = isMaxLevel
    ? xpForCurrentLevel
    : cumulativeXpForLevel(level + 1);
  return {
    level,
    xp: safeXp,
    xpForCurrentLevel,
    xpForNextLevel,
    xpIntoLevel: safeXp - xpForCurrentLevel,
    xpToNextLevel: isMaxLevel ? 0 : xpForNextLevel - safeXp,
    isMaxLevel,
  };
}

/**
 * Computes XP earned for a single match. Pure function — exported so
 * tests can verify the rate without touching the DB, and the frontend
 * (next turn) can show a live preview during the round.
 */
export function xpForMatch(massIngested: number, kills: number): number {
  const safeMass = Math.max(0, Math.min(massIngested, MAX_MASS_PER_MATCH));
  const safeKills = Math.max(0, Math.min(kills, MAX_KILLS_PER_MATCH));
  return Math.floor(safeMass / XP_PER_MASS_DIVISOR) + safeKills * XP_PER_KILL;
}
