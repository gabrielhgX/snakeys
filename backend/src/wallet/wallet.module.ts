import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ProgressionModule } from '../progression/progression.module';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { MatchSettlementWorker } from './queues/match-settlement.worker';
import { MATCH_SETTLEMENT_QUEUE } from './queues/match-settlement.types';
import { KillProcessorWorker } from './queues/kill-processor.worker';
import { KILL_PROCESSOR_QUEUE } from './queues/kill-processor.types';

/**
 * WalletModule owns the full settlement and kill-event stack:
 *   • WalletService           — core financial logic (lockWallet, ACID)
 *   • MatchSettlementWorker   — async final settlement (Sprint 4)
 *   • KillProcessorWorker     — async kill audit recorder (Sprint 5)
 *
 * Both queues use the shared Redis connection from BullModule.forRoot
 * registered in AppModule.
 */
@Module({
  imports: [
    ProgressionModule,
    BullModule.registerQueue(
      { name: MATCH_SETTLEMENT_QUEUE },
      { name: KILL_PROCESSOR_QUEUE },
    ),
  ],
  controllers: [WalletController],
  providers: [WalletService, MatchSettlementWorker, KillProcessorWorker],
  exports: [WalletService],
})
export class WalletModule {}
