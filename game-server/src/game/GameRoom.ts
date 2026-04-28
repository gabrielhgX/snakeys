import { v4 as uuidv4 } from 'uuid';
import { BackendClient } from '../api/BackendClient';
import { config } from '../config';
import {
  HUNGER_DRAIN_RATE,
  PlayerState,
  SPRINT_MASS_COST,
  Vec2,
  createPlayer,
} from './Player';

export type RoomStatus = 'waiting' | 'active' | 'finished';

const TICK_MS = 50;           // 20 ticks/second
const HUNGER_INTERVAL_MS = 150_000; // 2m30s — hunger kicks in every interval

export class GameRoom {
  readonly id: string;
  readonly buyIn: number;
  status: RoomStatus = 'waiting';

  private players = new Map<string, PlayerState>();
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private matchEndTimer: ReturnType<typeof setTimeout> | null = null;
  private hungerTimer: ReturnType<typeof setInterval> | null = null;
  private hungerLevel = 0;
  private startedAt: number | null = null;

  constructor(
    private readonly backend: BackendClient,
    buyIn: number,
  ) {
    this.id = uuidv4();
    this.buyIn = buyIn;
  }

  get playerCount() {
    return this.players.size;
  }

  addPlayer(userId: string, socketId: string, email: string): PlayerState {
    const player = createPlayer(userId, socketId, email);
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
    if (player) player.sprinting = sprinting;
  }

  async start(): Promise<void> {
    if (this.status !== 'waiting') return;
    this.status = 'active';
    this.startedAt = Date.now();

    // Lock buy-in from each player's wallet
    await Promise.all(
      Array.from(this.players.keys()).map((userId) =>
        this.backend.processBetEntry(userId, this.buyIn, this.id),
      ),
    );

    this.tickInterval = setInterval(() => this.tick(), TICK_MS);

    // Hunger mechanic: every 2m30s increase drain
    this.hungerTimer = setInterval(() => {
      this.hungerLevel++;
      this.applyHunger();
    }, HUNGER_INTERVAL_MS);

    // Match ends after fixed duration (Big Fish mode)
    this.matchEndTimer = setTimeout(
      () => this.end(),
      config.matchDurationMs,
    );
  }

  private tick(): void {
    for (const player of this.players.values()) {
      if (!player.alive) continue;

      if (player.sprinting) {
        player.mass = Math.max(10, player.mass - SPRINT_MASS_COST);
        player.speed = 8;
      } else {
        player.speed = 5;
      }

      player.position.x += player.direction.x * player.speed;
      player.position.y += player.direction.y * player.speed;

      // Clamp to world bounds
      player.position.x = Math.max(0, Math.min(4000, player.position.x));
      player.position.y = Math.max(0, Math.min(4000, player.position.y));
    }

    this.checkCollisions();
  }

  private checkCollisions(): void {
    const alive = Array.from(this.players.values()).filter((p) => p.alive);
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i];
        const b = alive[j];
        const dx = a.position.x - b.position.x;
        const dy = a.position.y - b.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const combined = Math.sqrt(a.mass) + Math.sqrt(b.mass);

        if (dist < combined) {
          // Larger snake absorbs smaller
          if (a.mass >= b.mass) {
            a.mass += b.mass * 0.5;
            b.alive = false;
          } else {
            b.mass += a.mass * 0.5;
            a.alive = false;
          }
        }
      }
    }
  }

  private applyHunger(): void {
    for (const player of this.players.values()) {
      if (!player.alive) continue;
      const drain = player.mass * HUNGER_DRAIN_RATE * this.hungerLevel;
      player.mass = Math.max(10, player.mass - drain);
    }
  }

  getSnapshot() {
    return Array.from(this.players.values()).map((p) => ({
      id: p.id,
      email: p.email,
      mass: p.mass,
      position: p.position,
      alive: p.alive,
    }));
  }

  async end(): Promise<void> {
    if (this.status === 'finished') return;
    this.status = 'finished';

    if (this.tickInterval) clearInterval(this.tickInterval);
    if (this.hungerTimer) clearInterval(this.hungerTimer);
    if (this.matchEndTimer) clearTimeout(this.matchEndTimer);

    // Calculate payouts — Big Fish: prize pool split among top 3 by mass
    const ranked = Array.from(this.players.values()).sort((a, b) => b.mass - a.mass);
    const totalPool = this.players.size * this.buyIn;
    const payoutRatios = [0.6, 0.25, 0.15]; // 1st, 2nd, 3rd

    await Promise.all(
      ranked.map((player, index) => {
        const payout = index < 3 ? totalPool * payoutRatios[index] : 0;
        return this.backend.processMatchResult(
          player.id,
          this.id,
          this.buyIn,
          payout,
        );
      }),
    );
  }
}
