import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { BattlePassModule } from './battle-pass/battle-pass.module';
import { CosmeticsModule } from './cosmetics/cosmetics.module';
import { InternalModule } from './internal/internal.module';
import { InventoryModule } from './inventory/inventory.module';
import { MarketplaceModule } from './marketplace/marketplace.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProgressionModule } from './progression/progression.module';
import { UserModule } from './user/user.module';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
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
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
