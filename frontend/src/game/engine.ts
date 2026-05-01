// Core simulation — pure TS, no DOM. Designed so a future server-side
// authoritative copy could reuse the same update functions.
//
// Coordinate system: world units are pixels at zoom = 1. World is a disc
// centered on (0,0) with radius WORLD_RADIUS.

import { angleDelta, clamp, darkenHex, dist2, mulberry32, TAU } from './math';
import type { GameEvent, GameModeKey, Pellet, Snake } from './types';

// ─── Tuning constants ─────────────────────────────────────────────────────────
// Exported so modes and renderer can read the same numbers.

export const WORLD_RADIUS = 2600;

/**
 * Per-mode capacity. The matchmaking copy in the lobby advertises these
 * numbers, and the engine spawns `players - 1` bots since the local
 * player counts as one participant.
 *
 * NOTE: the runtime defaults below balance gameplay vs single-machine
 * frame budget. If the user's box can sustain more, raise these.
 */
export interface ModeRuntimeConfig {
  /** Total participants advertised in matchmaking (player + bots). */
  players: number;
  /** Pellet population on the field. Higher = more food for more snakes. */
  pellets: number;
}

export const MODE_RUNTIME: Record<GameModeKey, ModeRuntimeConfig> = {
  // 100 players — 50 actually simulated locally to keep 60fps. The
  // remaining slots will be other real players in the multiplayer build.
  'hunt-hunt': { players: 100, pellets: 2400 },
  // 30 players — simulated 1:1.
  'big-fish':  { players: 30,  pellets: 1800 },
  // Private rooms: small, friend-only.
  'private':   { players: 12,  pellets: 1200 },
};

/**
 * Cap on bots actually instantiated locally even if the mode declares a
 * higher player count. Tuned for ~60fps on mid-range laptops; raise once
 * collision broad-phase moves to a spatial grid.
 */
const LOCAL_BOT_CAP = 49;

export const BASE_SPEED = 170;            // units/sec
export const SPRINT_MULTIPLIER = 1.7;
export const SPRINT_MIN_MASS = 15;        // below this: sprint disabled
export const SPRINT_DRAIN_PER_SEC = 4.2;  // mass lost per second while sprinting

export const BASE_TURN_SPEED = 3.4;       // rad/sec — 180° in ~0.92s

/** Head render radius curve: log1p so growth stays subtle past 100 mass. */
export const BASE_RADIUS = 9;
export const RADIUS_LOG_SCALE = 4.2;

/** Breadcrumb trail spacing — finer = smoother body, higher cost. */
export const BREADCRUMB_SPACING = 4;

/** Trail length: 60u base + 0.55u per mass. 10 pellets ≈ +4.4u length. */
export const BODY_LENGTH_BASE = 60;
export const BODY_LENGTH_PER_MASS = 0.55;

export const EAT_MAGNETISM = 4;

export const PELLET_SMALL_MASS = 0.8;
export const PELLET_LARGE_MASS = 2.4;
export const PELLET_POOL_MASS = 4.5;

// Palette — solid, matte, no neon glow tones.
export const PELLET_COLORS = [
  '#ef6a6a', '#e6b04a', '#4ea888', '#4e90c8', '#8b78c9', '#c07aa8',
];

// ─── Spatial grid ─────────────────────────────────────────────────────────────
/**
 * Uniform cell hash for pellets — O(1) insert/remove by world position and
 * O(cells_in_rect) range queries. Chosen over a quadtree because the
 * object population (~1600 pellets) is flat and even — grid wins on both
 * rebuild cost and cache locality.
 */
const GRID_CELL = 120;
const GRID_CELLS_PER_AXIS = Math.ceil((WORLD_RADIUS * 2) / GRID_CELL) + 2;

export class PelletGrid {
  private cells = new Map<number, number[]>();

  private key(cx: number, cy: number): number {
    return cy * GRID_CELLS_PER_AXIS + cx;
  }

  private cellOf(x: number, y: number): { cx: number; cy: number } {
    const cx = Math.floor((x + WORLD_RADIUS) / GRID_CELL);
    const cy = Math.floor((y + WORLD_RADIUS) / GRID_CELL);
    return { cx, cy };
  }

  insert(idx: number, x: number, y: number): void {
    const { cx, cy } = this.cellOf(x, y);
    const k = this.key(cx, cy);
    let arr = this.cells.get(k);
    if (!arr) {
      arr = [];
      this.cells.set(k, arr);
    }
    arr.push(idx);
  }

  remove(idx: number, x: number, y: number): void {
    const { cx, cy } = this.cellOf(x, y);
    const arr = this.cells.get(this.key(cx, cy));
    if (!arr) return;
    const i = arr.indexOf(idx);
    if (i >= 0) arr.splice(i, 1);
  }

  /** Visit every pellet index in cells overlapping the AABB. */
  forEachInRect(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    cb: (idx: number) => void,
  ): void {
    const c0 = this.cellOf(minX, minY);
    const c1 = this.cellOf(maxX, maxY);
    for (let cy = c0.cy; cy <= c1.cy; cy++) {
      for (let cx = c0.cx; cx <= c1.cx; cx++) {
        const arr = this.cells.get(this.key(cx, cy));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) cb(arr[i]);
      }
    }
  }
}

// ─── Derived stats ────────────────────────────────────────────────────────────

export function radiusOf(mass: number): number {
  return BASE_RADIUS + RADIUS_LOG_SCALE * Math.log1p(mass);
}

export function bodyLengthOf(mass: number): number {
  return BODY_LENGTH_BASE + BODY_LENGTH_PER_MASS * mass;
}

// ─── World ────────────────────────────────────────────────────────────────────

export interface WorldInput {
  /** Desired heading in radians, or null to keep current target. */
  targetAngle: number | null;
  sprinting: boolean;
}

export interface World {
  /** ms since world creation (not wall-clock). Drives mode timers. */
  now: number;
  /** Monotonic frame counter — used for cheap round-robin scheduling
   *  (e.g. bot AI ticks 1/3 of the population per frame). */
  frame: number;
  /** Pot value (R$) every participant in this world brought to the table.
   *  Big Fish settlement reads this directly; Hunt-Hunt reads each snake's
   *  own `.pot` since the steal mechanic could be extended to mixed pots
   *  later. */
  pot: number;
  /** Mode key the world was instantiated with. Cached so renderers /
   *  modes don't have to be passed it explicitly. */
  mode: GameModeKey;
  self: Snake;
  bots: Snake[];
  pellets: Pellet[];
  grid: PelletGrid;
  rng: () => number;
  /**
   * Per-frame event queue. Cleared at the top of every `updateWorld`,
   * appended to as the engine processes collisions, then read by
   * `mode.update` (which runs immediately after `updateWorld` in the
   * canvas loop).
   */
  events: GameEvent[];
}

export interface CreateWorldParams {
  playerName: string;
  playerColor?: string;
  mode: GameModeKey;
  /** R$ pot the player committed (debited upstream by the lobby). All
   *  bots in this world receive the same pot — segregation by value. */
  pot: number;
  seed?: number;
}

export function createWorld(params: CreateWorldParams): World {
  const {
    playerName,
    playerColor = '#4ea888',
    mode,
    pot,
    seed,
  } = params;

  const cfg = MODE_RUNTIME[mode] ?? MODE_RUNTIME['private'];
  const pelletCount = cfg.pellets;
  // Bots = participants − 1 (player), capped so we don't drown in
  // collision pairs. The cap is conservative; profiled budget tweaks
  // can lift it later.
  const botCount = Math.min(LOCAL_BOT_CAP, Math.max(0, cfg.players - 1));

  const rng = mulberry32(seed ?? Math.floor(Math.random() * 2 ** 30));
  const grid = new PelletGrid();
  const pellets: Pellet[] = [];
  for (let i = 0; i < pelletCount; i++) {
    const p = spawnFieldPellet(rng);
    pellets.push(p);
    grid.insert(i, p.x, p.y);
  }

  // Self spawns near the origin but not exactly on it (small offset so the
  // starting heading isn't visually ambiguous).
  const selfHeading = rng() * TAU;
  const self: Snake = {
    id: 'self',
    name: playerName || 'Você',
    color: playerColor,
    outlineColor: darkenHex(playerColor, 0.55),
    isBot: false,
    pot,
    headX: 0,
    headY: 0,
    angle: selfHeading,
    targetAngle: selfHeading,
    speed: BASE_SPEED,
    turnSpeed: BASE_TURN_SPEED,
    sprinting: false,
    mass: 10,
    sprintDropAccum: 0,
    trail: seedTrail(0, 0, selfHeading, bodyLengthOf(10)),
    alive: true,
    ghostUntil: 0,
    killedBy: null,
  };

  const bots: Snake[] = [];
  for (let i = 0; i < botCount; i++) {
    bots.push(createBot(rng, i, pot));
  }

  return {
    now: 0,
    frame: 0,
    pot,
    mode,
    self,
    bots,
    pellets,
    grid,
    rng,
    events: [],
  };
}

function seedTrail(
  headX: number,
  headY: number,
  angle: number,
  bodyLen: number,
): { x: number; y: number }[] {
  const trail: { x: number; y: number }[] = [];
  const steps = Math.max(2, Math.ceil(bodyLen / BREADCRUMB_SPACING));
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  for (let i = 0; i < steps; i++) {
    const d = i * BREADCRUMB_SPACING;
    trail.push({ x: headX - cos * d, y: headY - sin * d });
  }
  return trail;
}

function spawnFieldPellet(rng: () => number): Pellet {
  // Uniform distribution over the disc: r ∝ sqrt(U).
  const r = Math.sqrt(rng()) * (WORLD_RADIUS - 50);
  const a = rng() * TAU;
  const large = rng() < 0.1;
  const mass = large ? PELLET_LARGE_MASS : PELLET_SMALL_MASS;
  return {
    x: Math.cos(a) * r,
    y: Math.sin(a) * r,
    mass,
    size: large ? 5.5 : 3.8,
    color: PELLET_COLORS[Math.floor(rng() * PELLET_COLORS.length)],
    alive: true,
    pool: false,
  };
}

function createBot(rng: () => number, i: number, pot: number): Snake {
  const a = rng() * TAU;
  const r = WORLD_RADIUS * (0.3 + rng() * 0.55);
  const headX = Math.cos(a) * r;
  const headY = Math.sin(a) * r;
  const heading = rng() * TAU;
  const mass = 15 + rng() * 90;
  const color = PELLET_COLORS[i % PELLET_COLORS.length];
  return {
    id: `bot_${i}`,
    name: BOT_NAMES[i % BOT_NAMES.length],
    color,
    outlineColor: darkenHex(color, 0.5),
    isBot: true,
    pot,
    headX,
    headY,
    angle: heading,
    targetAngle: heading,
    speed: BASE_SPEED * (0.82 + rng() * 0.18),
    turnSpeed: BASE_TURN_SPEED * (0.65 + rng() * 0.4),
    sprinting: false,
    mass,
    sprintDropAccum: 0,
    trail: seedTrail(headX, headY, heading, bodyLengthOf(mass)),
    alive: true,
    ghostUntil: 0,
    killedBy: null,
  };
}

const BOT_NAMES = [
  'Mamba', 'Pitão', 'Naja', 'Jibóia', 'Víbora', 'Cobrão',
  'Surucucu', 'Coral', 'Cascavel', 'Sucuri', 'Taipan',
  'Anaconda', 'Krait', 'Boomslang', 'Cipinha', 'Salamandra',
  'Caninana', 'Falsa-coral', 'Bocaina', 'Cobra-d’água', 'Caissaca',
  'Pico-de-Jaca', 'Dormideira', 'Fer-de-Lance', 'Bushmaster', 'Garter',
  'Adder', 'Sidewinder', 'Asp', 'Cottonmouth', 'Copperhead',
  'Habu', 'Rinkhals', 'Mocassão', 'Boomerang', 'Diamond',
  'Reticul', 'Verdejante', 'Ucaiama', 'Bicuda', 'Corredeira',
  'Salinha', 'Brejo', 'Cipoia', 'Garranchuda', 'Cobra-Cega',
  'Tigrina', 'Veneno', 'Caboclo', 'Tatuapé', 'Saracura',
];

// ─── Update ──────────────────────────────────────────────────────────────────

/**
 * Advance the simulation by `dt` seconds. Call once per frame from the
 * render loop with a clamped dt (e.g. `Math.min(dt, 1/30)`) to keep
 * physics stable after tab-switches.
 */
export function updateWorld(
  world: World,
  dt: number,
  input: WorldInput,
): void {
  // Reset per-frame event queue (in place — keeps the same array
  // reference, no GC churn). Modes consume these on `mode.update()`.
  world.events.length = 0;
  world.now += dt * 1000;
  world.frame++;

  if (world.self.alive) {
    updateSnake(world, world.self, dt, input);
  }

  // Bot AI runs at ~20Hz (every 3rd frame per bot, round-robin), but
  // movement integrates every frame using the cached `targetAngle`.
  // This keeps motion smooth while keeping the AI cost flat regardless
  // of bot count.
  const phase = world.frame % BOT_AI_TICK_INTERVAL;
  for (let i = 0; i < world.bots.length; i++) {
    const bot = world.bots[i];
    if (!bot.alive) continue;
    const ai =
      i % BOT_AI_TICK_INTERVAL === phase
        ? computeBotInput(world, bot)
        : { targetAngle: bot.targetAngle, sprinting: bot.sprinting };
    updateSnake(world, bot, dt, ai);
  }

  resolveSnakeSnakeCollisions(world);
}

/**
 * Round-robin AI scheduling. With 50 bots and a stride of 3, ~17 bots
 * recompute their target each frame — well below the budget for any
 * realistic search radius.
 */
const BOT_AI_TICK_INTERVAL = 3;

function updateSnake(
  world: World,
  snake: Snake,
  dt: number,
  input: WorldInput,
): void {
  // ── Turn with inertia ────────────────────────────────────────────────
  // The clamped angleDelta is what makes mouse-behind-you produce a
  // visible arc instead of a snap flip. `maxTurn` caps change per frame.
  if (input.targetAngle !== null) {
    snake.targetAngle = input.targetAngle;
  }
  const diff = angleDelta(snake.angle, snake.targetAngle);
  const maxTurn = snake.turnSpeed * dt;
  snake.angle += clamp(diff, -maxTurn, maxTurn);

  // ── Sprint ───────────────────────────────────────────────────────
  // Sprint costs mass, but instead of evaporating it we *drop* it as
  // colored pellets behind the tail. Visually rich (other snakes can
  // farm a sprinter) and economically conservative (mass conservation).
  const canSprint = input.sprinting && snake.mass > SPRINT_MIN_MASS;
  snake.sprinting = canSprint;
  const speed = canSprint ? snake.speed * SPRINT_MULTIPLIER : snake.speed;
  if (canSprint) {
    snake.sprintDropAccum += SPRINT_DRAIN_PER_SEC * dt;
    // Emit one pellet at a time — multi-pellet emission per frame keeps
    // visuals stable when frames are long (post tab-resume etc.).
    while (
      snake.sprintDropAccum >= PELLET_LARGE_MASS &&
      snake.mass > SPRINT_MIN_MASS + PELLET_LARGE_MASS
    ) {
      snake.sprintDropAccum -= PELLET_LARGE_MASS;
      snake.mass -= PELLET_LARGE_MASS;
      spawnTrailPellet(world, snake);
    }
  } else if (snake.sprintDropAccum > 0) {
    // Decay the accumulator slowly when sprint stops, so a stuttery
    // input (sprint on/off rapidly) doesn't bank free drops.
    snake.sprintDropAccum = Math.max(0, snake.sprintDropAccum - dt);
  }

  // ── Move ──────────────────────────────────────────────────────────────
  snake.headX += Math.cos(snake.angle) * speed * dt;
  snake.headY += Math.sin(snake.angle) * speed * dt;

  // ── World boundary ───────────────────────────────────────────────────
  // Soft-clamp with nudge so the player never walks out. Bots pick a new
  // target pointing inward to avoid stuttering on the wall.
  const distFromCenter = Math.hypot(snake.headX, snake.headY);
  const maxR = WORLD_RADIUS - radiusOf(snake.mass);
  if (distFromCenter > maxR) {
    const ang = Math.atan2(snake.headY, snake.headX);
    snake.headX = Math.cos(ang) * maxR;
    snake.headY = Math.sin(ang) * maxR;
    if (snake.isBot) {
      // Point inward + small jitter so bots don't lock on the wall.
      snake.targetAngle = ang + Math.PI + (world.rng() - 0.5) * 0.4;
    }
  }

  // ── Breadcrumb trail ─────────────────────────────────────────────────
  const head = snake.trail[0];
  const spacing2 = BREADCRUMB_SPACING * BREADCRUMB_SPACING;
  if (!head || dist2(snake.headX, snake.headY, head.x, head.y) >= spacing2) {
    snake.trail.unshift({ x: snake.headX, y: snake.headY });
  }
  const targetLen = bodyLengthOf(snake.mass);
  const maxCrumbs = Math.max(2, Math.ceil(targetLen / BREADCRUMB_SPACING));
  if (snake.trail.length > maxCrumbs) {
    snake.trail.length = maxCrumbs;
  }

  // ── Eat pellets in range ─────────────────────────────────────────────
  const eatR = radiusOf(snake.mass) + EAT_MAGNETISM;
  const eatR2 = eatR * eatR;
  const minX = snake.headX - eatR;
  const minY = snake.headY - eatR;
  const maxX = snake.headX + eatR;
  const maxY = snake.headY + eatR;

  // Collect indices first, mutate after — forEachInRect iterates live
  // cell arrays and mutating during iteration would skip entries.
  const eaten: number[] = [];
  world.grid.forEachInRect(minX, minY, maxX, maxY, (idx) => {
    const p = world.pellets[idx];
    if (!p.alive) return;
    if (dist2(snake.headX, snake.headY, p.x, p.y) <= eatR2) {
      eaten.push(idx);
    }
  });
  for (let k = 0; k < eaten.length; k++) {
    const idx = eaten[k];
    const p = world.pellets[idx];
    p.alive = false;
    world.grid.remove(idx, p.x, p.y);
    snake.mass += p.mass;
    // Respawn uniform pellet in the same slot to keep density stable.
    const np = spawnFieldPellet(world.rng);
    world.pellets[idx] = np;
    world.grid.insert(idx, np.x, np.y);
  }
}

// ─── Bot AI ──────────────────────────────────────────────────────────────────
/**
 * Lightweight seek behavior: aim for the nearest pellet in a limited
 * perception radius, steer inward near the wall. No pathfinding, no
 * player-tracking — intentional: bots exist to populate the world, not
 * to challenge competitively.
 */
function computeBotInput(world: World, bot: Snake): WorldInput {
  const r = Math.hypot(bot.headX, bot.headY);
  if (r > WORLD_RADIUS * 0.82) {
    return {
      targetAngle: Math.atan2(-bot.headY, -bot.headX),
      sprinting: false,
    };
  }

  const viewR = 380;
  let bestD2 = Infinity;
  let bestX = 0;
  let bestY = 0;
  let found = false;
  world.grid.forEachInRect(
    bot.headX - viewR,
    bot.headY - viewR,
    bot.headX + viewR,
    bot.headY + viewR,
    (idx) => {
      const p = world.pellets[idx];
      if (!p.alive) return;
      const d2 = dist2(bot.headX, bot.headY, p.x, p.y);
      if (d2 < bestD2) {
        bestD2 = d2;
        bestX = p.x;
        bestY = p.y;
        found = true;
      }
    },
  );

  const target = found
    ? Math.atan2(bestY - bot.headY, bestX - bot.headX)
    : bot.angle + (world.rng() - 0.5) * 0.25;

  return { targetAngle: target, sprinting: false };
}

// ─── Snake ↔ snake collisions ───────────────────────────────────────
/**
 * Pairwise collision pass over every alive snake (player + bots).
 * Bot↔bot kills are resolved here too so the world has full carnage,
 * not just player-vs-bot.
 *
 * Broad-phase: a coarse head-distance cull rejects pairs that can't
 * possibly intersect because their bodies are out of reach. Without
 * this, 50 snakes would pay (50*49/2)=1225 full body scans per frame.
 *
 * Narrow-phase: head-head + cross head-vs-body, sampled every Nth crumb.
 * Crumbs are only 4u apart while head radii are 10u+, so stride 3 is
 * conservative.
 */
const BODY_CHECK_STRIDE = 3;

function resolveSnakeSnakeCollisions(world: World): void {
  // Snapshot the alive set once. Killing a snake during the loop sets
  // `alive=false`; we re-check `.alive` inside the loop to skip those.
  const all: Snake[] = [];
  if (world.self.alive) all.push(world.self);
  for (let i = 0; i < world.bots.length; i++) {
    if (world.bots[i].alive) all.push(world.bots[i]);
  }

  for (let i = 0; i < all.length; i++) {
    const a = all[i];
    if (!a.alive) continue;
    const aGhost = world.now < a.ghostUntil;
    const aR = radiusOf(a.mass);
    const aBody = bodyLengthOf(a.mass);

    for (let j = i + 1; j < all.length; j++) {
      const b = all[j];
      if (!b.alive) continue;
      if (!a.alive) break; // a was killed in a previous j-iteration
      const bGhost = world.now < b.ghostUntil;
      if (aGhost && bGhost) continue;

      const bR = radiusOf(b.mass);
      const bBody = bodyLengthOf(b.mass);

      // Broad-phase: head-to-head squared distance vs maximum reach.
      const dx = a.headX - b.headX;
      const dy = a.headY - b.headY;
      const headD2 = dx * dx + dy * dy;
      const maxReach = Math.max(aBody + bR, bBody + aR) + aR + bR;
      if (headD2 > maxReach * maxReach) continue;

      // Head-head: bigger snake (>10% mass advantage) consumes the other.
      if (!aGhost && !bGhost) {
        const rhh = aR + bR;
        if (headD2 < rhh * rhh) {
          if (a.mass > b.mass * 1.1) {
            killSnake(world, b, a.id);
          } else if (b.mass > a.mass * 1.1) {
            killSnake(world, a, b.id);
          }
          // Whether or not anyone died, the head-head case excludes
          // the body checks for this pair (heads are too close to be
          // a meaningful body hit).
          continue;
        }
      }

      // a head vs b body
      if (!aGhost && !bGhost) {
        const checkR = aR + bR * 0.75;
        const checkR2 = checkR * checkR;
        const trail = b.trail;
        for (
          let t = BODY_CHECK_STRIDE;
          t < trail.length;
          t += BODY_CHECK_STRIDE
        ) {
          const p = trail[t];
          if (dist2(a.headX, a.headY, p.x, p.y) < checkR2) {
            killSnake(world, a, b.id);
            break;
          }
        }
        if (!a.alive) continue; // a is gone; nothing else to check
      }

      // b head vs a body
      if (!aGhost && !bGhost) {
        const checkR = bR + aR * 0.75;
        const checkR2 = checkR * checkR;
        const trail = a.trail;
        for (
          let t = BODY_CHECK_STRIDE;
          t < trail.length;
          t += BODY_CHECK_STRIDE
        ) {
          const p = trail[t];
          if (dist2(b.headX, b.headY, p.x, p.y) < checkR2) {
            killSnake(world, b, a.id);
            break;
          }
        }
      }
    }
  }
}

/**
 * Kills a snake and scatters ~70% of its mass as pellets along its trail.
 * Idempotent — a snake can be reported as the victim of multiple checks
 * in the same frame and we'll only process it once.
 *
 * Pushes a `KillEvent` onto `world.events` so mode controllers (notably
 * Hunt-Hunt) can credit the killer's accumulated pot.
 */
function killSnake(
  world: World,
  snake: Snake,
  killerId: string | null = null,
): void {
  if (!snake.alive) return;
  snake.alive = false;
  snake.killedBy = killerId;

  world.events.push({
    type: 'kill',
    killerId,
    victimId: snake.id,
    victimPot: snake.pot,
    victimMass: snake.mass,
    victimWasSelf: snake === world.self,
  });

  const scatter = Math.min(90, Math.max(6, Math.floor(snake.mass / 1.6)));
  const perPellet = (snake.mass * 0.7) / scatter;
  for (let i = 0; i < scatter; i++) {
    const ti = Math.floor((i / scatter) * snake.trail.length);
    const tp = snake.trail[Math.min(ti, snake.trail.length - 1)] ?? {
      x: snake.headX,
      y: snake.headY,
    };
    const jitter = 22;
    const p: Pellet = {
      x: tp.x + (world.rng() - 0.5) * jitter,
      y: tp.y + (world.rng() - 0.5) * jitter,
      mass: perPellet,
      color: snake.color,
      size: 4.5,
      alive: true,
      pool: false,
    };
    const idx = world.pellets.length;
    world.pellets.push(p);
    world.grid.insert(idx, p.x, p.y);
  }
}

/**
 * Drops one sprint trail pellet just behind the snake's tail in its own
 * color. Other snakes can eat these — sprint becomes a real economic
 * decision (bait or burn).
 */
function spawnTrailPellet(world: World, snake: Snake): void {
  const tail = snake.trail[snake.trail.length - 1] ?? {
    x: snake.headX,
    y: snake.headY,
  };
  const jitterX = (world.rng() - 0.5) * 6;
  const jitterY = (world.rng() - 0.5) * 6;
  const p: Pellet = {
    x: tail.x + jitterX,
    y: tail.y + jitterY,
    mass: PELLET_LARGE_MASS,
    color: snake.color,
    size: 4.6,
    alive: true,
    pool: false,
  };
  const idx = world.pellets.length;
  world.pellets.push(p);
  world.grid.insert(idx, p.x, p.y);
}

// ─── Pool spawning (Big Fish mode) ───────────────────────────────────────────
/**
 * Drops a dense cluster of high-value pellets at (x, y). Called by
 * BigFishMode every 4 minutes after a 15s telegraphed warning.
 */
export function spawnPoolCluster(
  world: World,
  x: number,
  y: number,
  count = 80,
  radius = 140,
): void {
  for (let i = 0; i < count; i++) {
    const a = world.rng() * TAU;
    const r = Math.sqrt(world.rng()) * radius;
    const p: Pellet = {
      x: x + Math.cos(a) * r,
      y: y + Math.sin(a) * r,
      mass: PELLET_POOL_MASS,
      color: PELLET_COLORS[i % PELLET_COLORS.length],
      size: 6.5,
      alive: true,
      pool: true,
    };
    const idx = world.pellets.length;
    world.pellets.push(p);
    world.grid.insert(idx, p.x, p.y);
  }
}

/** Pick a random-ish pool center, biased away from the self snake. */
export function pickPoolLocation(world: World): { x: number; y: number } {
  for (let tries = 0; tries < 8; tries++) {
    const a = world.rng() * TAU;
    const r = Math.sqrt(world.rng()) * (WORLD_RADIUS - 300);
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    const d = Math.hypot(x - world.self.headX, y - world.self.headY);
    if (d > 500) return { x, y };
  }
  // Fallback — somewhere 600+u from self in a random direction.
  const a = world.rng() * TAU;
  return {
    x: world.self.headX + Math.cos(a) * 700,
    y: world.self.headY + Math.sin(a) * 700,
  };
}
