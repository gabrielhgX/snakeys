import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ProgressionModule } from '../progression/progression.module';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { MatchSettlementWorker } from './queues/match-settlement.worker';
import { MATCH_SETTLEMENT_QUEUE } from './queues/match-settlement.types';

/**
 * WalletModule owns the full settlement stack:
 *   • WalletService  — core financial logic (lockWallet, ACID transactions)
 *   • MatchSettlementWorker — BullMQ processor; calls processMatchResult async
 *   • BullModule.registerQueue — creates the 'match-settlement' queue backed
 *     by the Redis connection wired in AppModule BullModule.forRoot
 *
 * ProgressionModule is imported so WalletService.settleMatchForUser() can
 * credit XP inline on the synchronous (client-driven) settlement path.
 */
@Module({
  imports: [
    ProgressionModule,
    BullModule.registerQueue({ name: MATCH_SETTLEMENT_QUEUE }),
  ],
  controllers: [WalletController],
  providers: [WalletService, MatchSettlementWorker],
  exports: [WalletService],
})
export class WalletModule {}
