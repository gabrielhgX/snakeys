import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ProgressionModule } from '../progression/progression.module';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { MatchSettlementWorker } from './queues/match-settlement.worker';
import { MATCH_SETTLEMENT_QUEUE } from './queues/match-settlement.types';
import { KillProcessorWorker } from './queues/kill-processor.worker';
import { KILL_PROCESSOR_QUEUE } from './queues/kill-processor.types';
import { PixGatewayService } from './pix/pix-gateway.service';
import { PixVerificationService } from './pix/pix-verification.service';
import { LocalWalletProvider } from './providers/local-wallet.provider';
import { PrimeHubWalletProvider } from './providers/primehub-wallet.provider';
import { WALLET_PROVIDER } from './wallet-provider.interface';

/**
 * WalletModule owns the full settlement and kill-event stack:
 *   • WalletService            — core financial logic (lockWallet, ACID)
 *   • MatchSettlementWorker    — async final settlement (Sprint 4)
 *   • KillProcessorWorker      — async kill audit recorder (Sprint 5)
 *   • PixVerificationService   — SPRINT 6, verifyPixOwnership()
 *   • LocalWalletProvider      — SPRINT 6, IWalletProvider adapter
 *
 * Both queues use the shared Redis connection from BullModule.forRoot
 * registered in AppModule.
 *
 * The {@link WALLET_PROVIDER} token is bound at module boot time based on
 * the `USE_PRIMEHUB_WALLET` feature flag.  Consumers that want the
 * migration-ready abstraction inject by token; WalletService itself is
 * still exported so the internal controllers and workers can keep using
 * the richer, backend-specific API during the transition.
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
  providers: [
    WalletService,
    MatchSettlementWorker,
    KillProcessorWorker,
    PixGatewayService,
    PixVerificationService,
    LocalWalletProvider,
    PrimeHubWalletProvider,
    {
      provide: WALLET_PROVIDER,
      useFactory: (local: LocalWalletProvider, primehub: PrimeHubWalletProvider) =>
        process.env.USE_PRIMEHUB_WALLET === 'true' ? primehub : local,
      inject: [LocalWalletProvider, PrimeHubWalletProvider],
    },
  ],
  exports: [WalletService, WALLET_PROVIDER, PixVerificationService],
})
export class WalletModule {}
