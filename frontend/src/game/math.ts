// Minimal math primitives for the snake engine. Kept hot-path friendly
// (no allocations in critical loops, no classes — just plain numbers).

export const TAU = Math.PI * 2;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Signed shortest angular delta from `from` to `to`, normalized to (-π, π].
 * Positive result means counter-clockwise rotation from `from` to `to`.
 *
 * This is what gives the snake its "arc back" feel when the mouse flips
 * behind: the clamped delta per frame ≤ `turnSpeed * dt`, so a 180° target
 * can't be reached instantly.
 */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d <= -Math.PI) d += TAU;
  return d;
}

/** Squared distance — avoid sqrt in tight loops. */
export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

/**
 * Fast deterministic PRNG. Each `World` carries one so game seeds are
 * reproducible for debugging. Not cryptographic — don't reuse for auth.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Multiply an `#rrggbb` hex color by a scalar (clamped 0..1). */
export function darkenHex(hex: string, factor: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const f = clamp(factor, 0, 1);
  const to2 = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${to2(r * f)}${to2(g * f)}${to2(b * f)}`;
}
