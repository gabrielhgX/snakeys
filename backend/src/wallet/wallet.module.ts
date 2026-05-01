import { Module } from '@nestjs/common';
import { ProgressionModule } from '../progression/progression.module';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

/**
 * Imports `ProgressionModule` so `WalletService.settleMatchForUser` can
 * credit XP inline with the wallet settlement. Keeps both operations
 * reachable via the same controller endpoint with a single caller round-
 * trip.
 */
@Module({
  imports: [ProgressionModule],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
