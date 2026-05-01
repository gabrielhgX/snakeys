import { Renderer, segRadius } from './renderer';
import { updateBotAngle } from './bots';
import type {
  GameModeKey, Snake, Food, PoolEvent, Vector2,
  UIState, InputState, EngineCallbacks, LeaderboardEntry,
} from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

const PLAYER_SPEED = 130;
const BOT_SPEED_BASE = 78;
const BOT_SPEED_VAR = 28;
const SPRINT_MULT = 2.0;
const SPRINT_DRAIN = 2.5;
const MIN_SPRINT_MASS = 15;
const INITIAL_MASS = 10;
const INITIAL_SEGMENTS = 10;
const GHOST_DURATION = 120;

const FOOD_TARGET = 600;
const FOOD_MIN_MASS = 1;
const FOOD_MAX_MASS = 3;

const BOT_TARGET_HH = 25;
const BOT_TARGET_BF = 15;

const HUNT_SESSION = 3600;
const HUNT_CLEAN_THRESHOLD = 120;

const BIG_FISH_DURATION = 960;
const BIG_FISH_POOL_RADIUS = 280;
const BIG_FISH_POOL_MASS = 260;
const BIG_FISH_POOL_LIFE = 120;     // seconds pool stays active
const BIG_FISH_POOL_ABSORB = 18;    // mass/s gained inside pool
const BIG_FISH_POOL_WARNING = 30;

const MAP_RADIUS: Record<GameModeKey, number> = {
  'hunt-hunt': 8000,
  'big-fish':  4000,
};

// BigFish drain schedule: [startSecond, massPerSecond]
const DRAIN_SCHEDULE: [number, number][] = [
  [0, 0], [120, 1], [240, 2], [360, 4],
  [480, 7], [600, 10], [720, 13], [840, 16],
];

// BigFish pool spawn times (seconds)
const POOL_TIMES = [240, 480, 720] as const;

const SNAKE_COLORS = [
  '#c0392b', '#e74c3c', '#d35400', '#e67e22',
  '#16a085', '#2980b9', '#8e44ad', '#2c3e50',
  '#7f8c8d', '#1abc9c', '#e91e63', '#673ab7',
  '#ff5722', '#607d8b', '#f39c12', '#27ae60',
];

const FOOD_COLORS = [
  '#ff6b6b', '#ff8c42', '#ffd93d', '#6bcb77',
  '#4ecdc4', '#45b7d1', '#a29bfe', '#fd79a8',
  '#74b9ff', '#00cec9', '#e17055', '#81ecec',
];

const BOT_NAMES = [
  'Shadow', 'Viper', 'Cobra', 'Python', 'Mamba',
  'Anaconda', 'Rattler', 'Copperhead', 'Asp', 'Adder',
  'Boa', 'Gecko', 'Basilisk', 'Hydra', 'Naga',
  'Quetzal', 'Wyvern', 'Komodo', 'Iguana', 'Slithers',
  'Scales', 'Fang', 'Venom', 'Strike', 'Crusher',
];

const PLAYER_ID = 'player';
const PLAYER_COLOR = '#4ade80';

// ─── Internal mode state ──────────────────────────────────────────────────────

interface HuntHuntState {
  playerJoinGameTime: number;
}

interface BigFishState {
  poolPositions: Vector2[];
  nextPoolIndex: number;
  matchEnded: boolean;
  finalLeaderboard: LeaderboardEntry[] | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function segGap(mass: number): number {
  return segRadius(mass) * 1.38;
}

function targetSegCount(mass: number): number {
  return Math.max(8, Math.floor(mass * 1.3));
}

function randomInCircle(r: number): Vector2 {
  const angle = Math.random() * Math.PI * 2;
  const dist = r * Math.sqrt(Math.random());
  return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist };
}

function pickColor(arr: string[], index: number): string {
  return arr[index % arr.length];
}

function getDrainRate(t: number): number {
  let rate = 0;
  for (const [start, r] of DRAIN_SCHEDULE) {
    if (t >= start) rate = r;
  }
  return rate;
}

// ─── GameEngine ───────────────────────────────────────────────────────────────

export class GameEngine {
  private canvas: HTMLCanvasElement;
  private renderer: Renderer;
  private mode: GameModeKey;
  private callbacks: EngineCallbacks;
  private playerName: string;

  private snakes = new Map<string, Snake>();
  private foods = new Map<string, Food>();
  private pools = new Map<string, PoolEvent>();

  private mapRadius: number;
  private gameTime = 0;

  private huntState: HuntHuntState | null = null;
  private bigFishState: BigFishState | null = null;

  private input: InputState = { mouseCanvas: { x: 0, y: 0 }, sprint: false };

  private rafId = 0;
  private lastTs = 0;
  private fpsAccum = 0;
  private fpsCount = 0;
  private fpsDisplay = 60;
  private idSeq = 0;

  constructor(
    canvas: HTMLCanvasElement,
    mode: GameModeKey,
    callbacks: EngineCallbacks,
    playerName = 'Você',
  ) {
    this.canvas = canvas;
    this.mode = mode;
    this.callbacks = callbacks;
    this.playerName = playerName;
    this.mapRadius = MAP_RADIUS[mode];

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D context');
    this.renderer = new Renderer(ctx);

    this.init();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  start(): void {
    this.lastTs = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
  }

  setInput(input: InputState): void {
    this.input = input;
  }

  /** Debug: immediately spawn a pool (BigFish only) */
  debugForcePool(): void {
    if (this.mode !== 'big-fish') return;
    const pos = this.safeSpawn(500);
    this.addPool(pos, this.gameTime + BIG_FISH_POOL_LIFE);
  }

  /** Debug: override game time */
  debugSetGameTime(seconds: number): void {
    this.gameTime = Math.max(0, seconds);
  }

  isMatchEnded(): boolean {
    return this.bigFishState?.matchEnded ?? false;
  }

  getFinalLeaderboard(): LeaderboardEntry[] {
    return this.bigFishState?.finalLeaderboard ?? [];
  }

  /** Returns exit information for the HuntHunt exit modal */
  getExitInfo(): { canExitClean: boolean; playerMass: number; penaltyMass: number } {
    const player = this.snakes.get(PLAYER_ID);
    const mass = player?.alive ? player.mass : 0;
    let canExit = false;
    if (this.huntState) {
      canExit = (this.gameTime - this.huntState.playerJoinGameTime) >= HUNT_CLEAN_THRESHOLD;
    }
    return {
      canExitClean: canExit,
      playerMass: Math.floor(mass),
      penaltyMass: canExit ? Math.floor(mass) : Math.floor(mass * 0.7),
    };
  }

  // ─── Initialization ─────────────────────────────────────────────────────────

  private init(): void {
    this.spawnFoodBatch(FOOD_TARGET);
    this.spawnPlayer();

    const botCount = this.mode === 'hunt-hunt' ? BOT_TARGET_HH : BOT_TARGET_BF;
    for (let i = 0; i < botCount; i++) this.spawnBot();

    if (this.mode === 'hunt-hunt') {
      this.huntState = { playerJoinGameTime: 0 };
    } else {
      this.bigFishState = {
        poolPositions: Array.from({ length: 3 }, () => this.safeSpawn(600)),
        nextPoolIndex: 0,
        matchEnded: false,
        finalLeaderboard: null,
      };
    }
  }

  private spawnPlayer(): void {
    const pos = this.safeSpawn(300);
    const angle = Math.random() * Math.PI * 2;
    const snake = this.makeSnake(PLAYER_ID, this.playerName, pos, angle, PLAYER_COLOR, true);
    snake.isGhost = true;
    snake.ghostTimer = GHOST_DURATION;
    this.snakes.set(PLAYER_ID, snake);
  }

  private respawnPlayer(): void {
    const pos = this.safeSpawn(300);
    const angle = Math.random() * Math.PI * 2;
    const snake = this.makeSnake(PLAYER_ID, this.playerName, pos, angle, PLAYER_COLOR, true);
    snake.isGhost = true;
    snake.ghostTimer = GHOST_DURATION;
    this.snakes.set(PLAYER_ID, snake);
  }

  private spawnBot(): void {
    const id = `bot-${this.idSeq++}`;
    const pos = this.safeSpawn(180);
    const angle = Math.random() * Math.PI * 2;
    const color = pickColor(SNAKE_COLORS, this.idSeq);
    const name = BOT_NAMES[this.idSeq % BOT_NAMES.length];
    const speed = BOT_SPEED_BASE + Math.random() * BOT_SPEED_VAR;
    const snake = this.makeSnake(id, name, pos, angle, color, false);
    snake.speed = speed;
    this.snakes.set(id, snake);
  }

  private makeSnake(
    id: string, name: string, pos: Vector2, angle: number,
    color: string, isPlayer: boolean,
  ): Snake {
    const gap = segGap(INITIAL_MASS);
    const segments: Vector2[] = [];
    for (let i = 0; i < INITIAL_SEGMENTS; i++) {
      segments.push({
        x: pos.x - Math.cos(angle) * i * gap,
        y: pos.y - Math.sin(angle) * i * gap,
      });
    }
    return {
      id, name, segments, angle,
      speed: isPlayer ? PLAYER_SPEED : BOT_SPEED_BASE,
      mass: INITIAL_MASS,
      color, isPlayer,
      isGhost: false, ghostTimer: 0,
      isSprinting: false, alive: true,
    };
  }

  private spawnFoodBatch(count: number): void {
    for (let i = 0; i < count; i++) {
      const id = `food-${this.idSeq++}`;
      const pos = randomInCircle(this.mapRadius * 0.95);
      const mass = FOOD_MIN_MASS + Math.random() * (FOOD_MAX_MASS - FOOD_MIN_MASS);
      this.foods.set(id, {
        id, x: pos.x, y: pos.y, mass,
        color: pickColor(FOOD_COLORS, this.idSeq),
      });
    }
  }

  private addPool(pos: Vector2, removeAt: number): void {
    const id = `pool-${this.idSeq++}`;
    this.pools.set(id, {
      id, x: pos.x, y: pos.y,
      radius: BIG_FISH_POOL_RADIUS,
      remainingMass: BIG_FISH_POOL_MASS,
      active: true,
      spawnAt: this.gameTime,
      removeAt,
    });
  }

  private safeSpawn(minClear: number): Vector2 {
    const minD2 = minClear * minClear;
    for (let attempt = 0; attempt < 40; attempt++) {
      const pos = randomInCircle(this.mapRadius * 0.82);
      let safe = true;
      for (const s of this.snakes.values()) {
        if (!s.alive || !s.segments.length) continue;
        const h = s.segments[0];
        if ((h.x - pos.x) ** 2 + (h.y - pos.y) ** 2 < minD2) { safe = false; break; }
      }
      if (safe) return pos;
    }
    return randomInCircle(this.mapRadius * 0.82);
  }

  // ─── Main loop ──────────────────────────────────────────────────────────────

  private loop = (ts: number): void => {
    const dt = Math.min((ts - this.lastTs) / 1000, 0.05);
    this.lastTs = ts;
    this.gameTime += dt;

    this.fpsAccum += dt;
    this.fpsCount++;
    if (this.fpsAccum >= 0.5) {
      this.fpsDisplay = Math.round(this.fpsCount / this.fpsAccum);
      this.fpsAccum = 0;
      this.fpsCount = 0;
    }

    this.update(dt);
    this.renderFrame();
    this.callbacks.onUIUpdate(this.buildUIState());
    this.rafId = requestAnimationFrame(this.loop);
  };

  // ─── Update ─────────────────────────────────────────────────────────────────

  private update(dt: number): void {
    this.updatePlayer(dt);
    this.updateBots(dt);
    this.collectFood();
    this.collectPoolMass(dt);
    this.checkCollisions();
    this.maintainFood();
    this.maintainBots();
    if (this.mode === 'hunt-hunt') this.tickHuntHunt();
    if (this.mode === 'big-fish') this.tickBigFish(dt);
  }

  private updatePlayer(dt: number): void {
    const player = this.snakes.get(PLAYER_ID);
    if (!player?.alive) return;

    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    const dx = this.input.mouseCanvas.x - cx;
    const dy = this.input.mouseCanvas.y - cy;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      player.angle = Math.atan2(dy, dx);
    }

    const canSprint = this.input.sprint && player.mass > MIN_SPRINT_MASS;
    player.isSprinting = canSprint;
    const speed = canSprint ? player.speed * SPRINT_MULT : player.speed;
    if (canSprint) {
      player.mass = Math.max(MIN_SPRINT_MASS, player.mass - SPRINT_DRAIN * dt);
    }

    this.moveSnake(player, speed, dt);

    if (player.isGhost) {
      player.ghostTimer -= dt;
      if (player.ghostTimer <= 0) { player.isGhost = false; player.ghostTimer = 0; }
    }
  }

  private updateBots(dt: number): void {
    const playerSnake = this.snakes.get(PLAYER_ID) ?? null;
    const foodArr = [...this.foods.values()];

    for (const bot of this.snakes.values()) {
      if (bot.isPlayer || !bot.alive) continue;
      updateBotAngle(bot, foodArr, playerSnake, dt, this.mapRadius);
      this.moveSnake(bot, bot.speed, dt);
    }
  }

  private moveSnake(snake: Snake, speed: number, dt: number): void {
    const head = snake.segments[0];
    const moved = speed * dt;
    const newHead: Vector2 = {
      x: head.x + Math.cos(snake.angle) * moved,
      y: head.y + Math.sin(snake.angle) * moved,
    };

    // Clamp to map and bounce
    const fromCenter = Math.sqrt(newHead.x ** 2 + newHead.y ** 2);
    if (fromCenter > this.mapRadius) {
      const s = this.mapRadius / fromCenter;
      newHead.x *= s;
      newHead.y *= s;
      snake.angle = Math.atan2(-newHead.y, -newHead.x) + (Math.random() - 0.5) * 0.5;
    }

    snake.segments[0] = newHead;

    // Spring-chain body following
    const gap = segGap(snake.mass);
    for (let i = 1; i < snake.segments.length; i++) {
      const prev = snake.segments[i - 1];
      const cur = snake.segments[i];
      const ddx = prev.x - cur.x;
      const ddy = prev.y - cur.y;
      const d = Math.sqrt(ddx * ddx + ddy * ddy);
      if (d > gap) {
        const excess = d - gap;
        cur.x += (ddx / d) * excess;
        cur.y += (ddy / d) * excess;
      }
    }

    // Grow / shrink segment count to match mass
    const target = targetSegCount(snake.mass);
    while (snake.segments.length < target) {
      snake.segments.push({ ...snake.segments[snake.segments.length - 1] });
    }
    if (snake.segments.length > target + 6) {
      snake.segments.splice(target);
    }
  }

  // ─── Food collection ─────────────────────────────────────────────────────────

  private collectFood(): void {
    for (const snake of this.snakes.values()) {
      if (!snake.alive || !snake.segments.length) continue;
      const head = snake.segments[0];
      const eatR = segRadius(snake.mass) + 4;

      for (const food of this.foods.values()) {
        const dx = food.x - head.x;
        const dy = food.y - head.y;
        const threshold = eatR + food.mass * 0.8;
        if (dx * dx + dy * dy < threshold * threshold) {
          snake.mass += food.mass;
          this.foods.delete(food.id);
        }
      }
    }
  }

  private collectPoolMass(dt: number): void {
    for (const pool of this.pools.values()) {
      if (!pool.active || pool.remainingMass <= 0) continue;

      for (const snake of this.snakes.values()) {
        if (!snake.alive || !snake.segments.length) continue;
        const h = snake.segments[0];
        const dx = h.x - pool.x;
        const dy = h.y - pool.y;
        if (dx * dx + dy * dy < pool.radius * pool.radius) {
          const gain = Math.min(BIG_FISH_POOL_ABSORB * dt, pool.remainingMass);
          snake.mass += gain;
          pool.remainingMass -= gain;
        }
      }

      if (pool.remainingMass <= 0 || this.gameTime >= pool.removeAt) {
        this.pools.delete(pool.id);
      }
    }
  }

  // ─── Collision detection ──────────────────────────────────────────────────────

  private checkCollisions(): void {
    const player = this.snakes.get(PLAYER_ID);

    // Player head vs all non-player snake bodies
    if (player?.alive && !player.isGhost) {
      const head = player.segments[0];
      const pr = segRadius(player.mass);

      for (const other of this.snakes.values()) {
        if (other.isPlayer || !other.alive || other.isGhost) continue;
        for (let i = 1; i < other.segments.length; i++) {
          const seg = other.segments[i];
          const dx = head.x - seg.x;
          const dy = head.y - seg.y;
          const killD = pr + segRadius(other.mass) * 0.88;
          if (dx * dx + dy * dy < killD * killD) {
            const deadMass = player.mass;
            this.dropFood(player);
            player.alive = false;
            this.respawnPlayer();
            this.callbacks.onPlayerDeath(deadMass);
            return;
          }
        }
      }
    }

    // Bot heads vs player body (bots die when they hit the player)
    if (player?.alive) {
      for (const bot of this.snakes.values()) {
        if (bot.isPlayer || !bot.alive || bot.isGhost) continue;
        const bh = bot.segments[0];
        const br = segRadius(bot.mass);

        for (let i = 1; i < player.segments.length; i++) {
          const seg = player.segments[i];
          const dx = bh.x - seg.x;
          const dy = bh.y - seg.y;
          const killD = br + segRadius(player.mass) * 0.88;
          if (dx * dx + dy * dy < killD * killD) {
            this.dropFood(bot);
            bot.alive = false;
            break;
          }
        }
      }
    }

    // Bot vs bot (check a limited set per frame for performance)
    const bots = [...this.snakes.values()].filter(s => !s.isPlayer && s.alive && !s.isGhost);
    for (let i = 0; i < bots.length; i++) {
      const a = bots[i];
      if (!a.alive) continue;
      const ah = a.segments[0];
      const ar = segRadius(a.mass);
      for (let j = 0; j < bots.length; j++) {
        if (i === j) continue;
        const b = bots[j];
        if (!b.alive) continue;
        const segLimit = Math.min(b.segments.length, 25);
        for (let k = 1; k < segLimit; k++) {
          const seg = b.segments[k];
          const dx = ah.x - seg.x;
          const dy = ah.y - seg.y;
          const kd = ar + segRadius(b.mass) * 0.88;
          if (dx * dx + dy * dy < kd * kd) {
            this.dropFood(a);
            a.alive = false;
            break;
          }
        }
        if (!a.alive) break;
      }
    }
  }

  private dropFood(snake: Snake): void {
    const step = Math.max(3, Math.floor(snake.segments.length / 20));
    const numDrops = Math.floor(snake.segments.length / step);
    const massEach = snake.mass / Math.max(1, numDrops);
    for (let i = 0; i < snake.segments.length; i += step) {
      const seg = snake.segments[i];
      const id = `df-${this.idSeq++}`;
      this.foods.set(id, {
        id,
        x: seg.x + (Math.random() - 0.5) * 28,
        y: seg.y + (Math.random() - 0.5) * 28,
        mass: Math.max(1, massEach),
        color: snake.color,
      });
    }
  }

  // ─── Maintenance ────────────────────────────────────────────────────────────

  private maintainFood(): void {
    const deficit = FOOD_TARGET - this.foods.size;
    if (deficit > 0) this.spawnFoodBatch(Math.min(deficit, 25));
  }

  private maintainBots(): void {
    const target = this.mode === 'hunt-hunt' ? BOT_TARGET_HH : BOT_TARGET_BF;
    let alive = 0;
    for (const [id, s] of this.snakes) {
      if (!s.isPlayer && !s.alive) this.snakes.delete(id);
      else if (!s.isPlayer && s.alive) alive++;
    }
    if (alive < target) this.spawnBot();
  }

  // ─── HuntHunt tick ─────────────────────────────────────────────────────────

  private tickHuntHunt(): void {
    if (!this.huntState) return;
    // Wrap session at 1h (for display; player keeps playing)
    if (this.gameTime >= HUNT_SESSION) {
      this.gameTime -= HUNT_SESSION;
      this.huntState.playerJoinGameTime = Math.max(0, this.huntState.playerJoinGameTime - HUNT_SESSION);
    }
  }

  // ─── BigFish tick ──────────────────────────────────────────────────────────

  private tickBigFish(dt: number): void {
    const bf = this.bigFishState;
    if (!bf || bf.matchEnded) return;

    // Mass drain for all alive snakes
    const drain = getDrainRate(this.gameTime);
    if (drain > 0) {
      for (const s of this.snakes.values()) {
        if (s.alive) s.mass = Math.max(INITIAL_MASS, s.mass - drain * dt);
      }
    }

    // Pool scheduling: 4min, 8min, 12min
    if (bf.nextPoolIndex < POOL_TIMES.length && this.pools.size === 0) {
      const spawnAt = POOL_TIMES[bf.nextPoolIndex];
      if (this.gameTime >= spawnAt) {
        const pos = bf.poolPositions[bf.nextPoolIndex];
        this.addPool(pos, this.gameTime + BIG_FISH_POOL_LIFE);
        bf.nextPoolIndex++;
      }
    }

    // Match end at 16 min
    if (this.gameTime >= BIG_FISH_DURATION) {
      bf.matchEnded = true;
      bf.finalLeaderboard = this.computeLeaderboard();
      this.callbacks.onMatchEnd?.(bf.finalLeaderboard);
    }
  }

  // ─── Rendering ──────────────────────────────────────────────────────────────

  private renderFrame(): void {
    const player = this.snakes.get(PLAYER_ID);
    this.renderer.render({
      snakes: [...this.snakes.values()],
      foods: [...this.foods.values()],
      pools: [...this.pools.values()],
      mapRadius: this.mapRadius,
      playerHead: player?.alive ? (player.segments[0] ?? null) : null,
      gameTime: this.gameTime,
    });
  }

  // ─── UI state ───────────────────────────────────────────────────────────────

  private buildUIState(): UIState {
    const player = this.snakes.get(PLAYER_ID);
    const base: UIState = {
      playerMass: Math.floor(player?.mass ?? 0),
      playerAlive: player?.alive ?? false,
      mapRadius: this.mapRadius,
      gameTime: this.gameTime,
      fps: this.fpsDisplay,
      entityCount: this.snakes.size + this.foods.size,
    };

    if (this.mode === 'hunt-hunt' && this.huntState) {
      const timeIn = this.gameTime - this.huntState.playerJoinGameTime;
      base.huntHunt = {
        sessionTimeLeft: Math.max(0, HUNT_SESSION - this.gameTime),
        playerTimeInSession: timeIn,
        canExitClean: timeIn >= HUNT_CLEAN_THRESHOLD,
        ghostTimer: player?.isGhost ? (player.ghostTimer ?? 0) : 0,
      };
    }

    if (this.mode === 'big-fish' && this.bigFishState) {
      const bf = this.bigFishState;
      const nextPoolTime = bf.nextPoolIndex < POOL_TIMES.length
        ? POOL_TIMES[bf.nextPoolIndex]
        : Infinity;
      const nextPoolIn = nextPoolTime - this.gameTime;
      const poolWarning = this.pools.size === 0 && nextPoolIn > 0 && nextPoolIn <= BIG_FISH_POOL_WARNING;

      let poolAngle: number | null = null;
      const head = player?.alive ? (player.segments[0] ?? null) : null;
      if (head) {
        if (this.pools.size > 0) {
          const pool = [...this.pools.values()][0];
          poolAngle = Math.atan2(pool.y - head.y, pool.x - head.x);
        } else if ((poolWarning || nextPoolIn <= BIG_FISH_POOL_WARNING) && bf.nextPoolIndex < POOL_TIMES.length) {
          const pending = bf.poolPositions[bf.nextPoolIndex];
          poolAngle = Math.atan2(pending.y - head.y, pending.x - head.x);
        }
      }

      base.bigFish = {
        matchTimeLeft: Math.max(0, BIG_FISH_DURATION - this.gameTime),
        nextPoolIn: Math.max(0, nextPoolIn),
        poolWarning: poolWarning || this.pools.size > 0,
        poolAngle,
        matchEnded: bf.matchEnded,
        drainRate: getDrainRate(this.gameTime),
        leaderboard: this.computeLeaderboard().slice(0, 10),
      };
    }

    return base;
  }

  private computeLeaderboard(): LeaderboardEntry[] {
    return [...this.snakes.values()]
      .filter(s => s.alive)
      .sort((a, b) => b.mass - a.mass)
      .map((s, i) => ({ rank: i + 1, id: s.id, name: s.name, mass: Math.floor(s.mass) }));
  }
}
