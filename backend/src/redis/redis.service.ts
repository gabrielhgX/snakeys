import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  // Exposed so BullModule.forRootAsync can optionally re-use the same TCP
  // connection config (but BullMQ creates its own internal connections).
  readonly client: Redis;

  constructor() {
    this.client = new Redis({
      host:         process.env.REDIS_HOST     ?? 'localhost',
      port:         parseInt(process.env.REDIS_PORT ?? '6379', 10),
      password:     process.env.REDIS_PASSWORD ?? undefined,
      db:           parseInt(process.env.REDIS_DB   ?? '0',   10),
      lazyConnect:  true,
      // Reconnect automatically — keeps the service alive if Redis restarts.
      retryStrategy: (times) => Math.min(times * 100, 3000),
    });

    this.client.on('error', (err: Error) =>
      this.logger.error(`Redis client error: ${err.message}`),
    );
  }

  async onModuleInit() {
    await this.client.connect();
    this.logger.log('Redis connected');
  }

  async onModuleDestroy() {
    await this.client.quit();
    this.logger.log('Redis disconnected');
  }

  // ── JTI Blacklist ────────────────────────────────────────────────────────

  /**
   * Adds a JWT's JTI to the blacklist with a TTL equal to the token's
   * remaining lifetime.  After the TTL expires the key is automatically
   * removed by Redis — no cleanup job needed.
   *
   * Key format: `jti:<jti>`
   */
  async revokeJti(jti: string, expiresAt: Date): Promise<void> {
    const ttlSeconds = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000));
    await this.client.set(`jti:${jti}`, '1', 'EX', ttlSeconds);
  }

  /** Returns true if the JTI is present in the blacklist. O(1). */
  async isJtiRevoked(jti: string): Promise<boolean> {
    return (await this.client.exists(`jti:${jti}`)) === 1;
  }

  // ── Generic cache helpers ────────────────────────────────────────────────

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }
}
