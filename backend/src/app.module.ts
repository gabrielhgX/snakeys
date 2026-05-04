import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JtiBlacklistMiddleware } from './auth/middleware/jti-blacklist.middleware';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { BattlePassModule } from './battle-pass/battle-pass.module';
import { CosmeticsModule } from './cosmetics/cosmetics.module';
import { InternalModule } from './internal/internal.module';
import { InventoryModule } from './inventory/inventory.module';
import { MarketplaceModule } from './marketplace/marketplace.module';
import { MatchReconciliationModule } from './match-reconciliation/match-reconciliation.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProgressionModule } from './progression/progression.module';
import { RedisModule } from './redis/redis.module';
import { UserModule } from './user/user.module';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    // ── Infrastructure ───────────────────────────────────────────────────
    // RedisModule must come before any module that injects RedisService
    // (it is @Global so no need to re-import in child modules).
    RedisModule,
    // BullModule.forRoot wires the shared Redis connection used by every
    // registerQueue() call throughout the app.
    BullModule.forRoot({
      connection: {
        host:     process.env.REDIS_HOST     ?? 'localhost',
        port:     parseInt(process.env.REDIS_PORT ?? '6379', 10),
        password: process.env.REDIS_PASSWORD ?? undefined,
        db:       parseInt(process.env.REDIS_DB   ?? '0',   10),
      },
    }),
    PrismaModule,
    AuthModule,
    UserModule,
    WalletModule,
    InternalModule,
    PaymentsModule,
    InventoryModule,
    MarketplaceModule,
    // ── Progression stack ────────────────────────────────────────────────
    // Order: Progression first (exports XP award service), then Cosmetics
    // (exports mint factory), then BattlePass (depends on both). NestJS
    // resolves dependencies regardless of import order here, but this
    // reads top-down in dependency order.
    ProgressionModule,
    CosmeticsModule,
    BattlePassModule,
    MatchReconciliationModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  /**
   * SPRINT 5 — JTI Blacklist Middleware applied to every route.
   *
   * Runs before all guards (including JwtAuthGuard / JwtStrategy).
   * Checks the Redis blacklist for the token's jti, short-circuiting
   * the Passport pipeline for revoked tokens.  Falls-open if Redis is
   * unavailable — JwtStrategy's PostgreSQL fallback acts as the safety net.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(JtiBlacklistMiddleware).forRoutes('*');
  }
}
