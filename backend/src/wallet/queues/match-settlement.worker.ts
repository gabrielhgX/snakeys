import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { WalletService } from '../wallet.service';
import {
  MATCH_SETTLEMENT_JOB,
  MATCH_SETTLEMENT_QUEUE,
  MatchSettlementJobData,
} from './match-settlement.types';

/**
 * Async settlement worker for online matches.
 *
 * Flow:
 *   1. Game-server calls POST /internal/match/result
 *   2. InternalController calls walletService.enqueueMatchResult()
 *   3. enqueueMatchResult() persists a BullMQ job in Redis and returns { queued, jobId }
 *   4. THIS WORKER picks up the job and calls walletService.processMatchResult()
 *      which executes the full ACID settlement (lockWallet, MatchSettlement guard,
 *      FEE + WIN transactions, Match.status → SETTLED).
 *
 * Resilience:
 *   - Jobs are stored in Redis; survive game-server and backend restarts.
 *   - processMatchResult() is idempotent via the MatchSettlement unique index
 *     (Sprint 1): a retry after a partial failure will hit P2002 and return
 *     { alreadySettled: true } without re-crediting the wallet.
 *   - If Redis crashes after the job was persisted but before processing,
 *     BullMQ replays it on reconnect.
 *   - If the worker fails after 5 attempts, the Sprint 2 reconciler will
 *     refund the bet after ABANDON_AFTER_MS (120 min).
 */
@Processor(MATCH_SETTLEMENT_QUEUE)
export class MatchSettlementWorker extends WorkerHost {
  private readonly logger = new Logger(MatchSettlementWorker.name);

  constructor(private readonly walletService: WalletService) {
    super();
  }

  async process(job: Job<MatchSettlementJobData>): Promise<void> {
    const { userId, matchId, betAmount, payout, finalMass } = job.data;

    this.logger.debug(
      `Processing settlement job=${job.id} userId=${userId} matchId=${matchId} ` +
      `betAmount=${betAmount} payout=${payout}`,
    );

    const result = await this.walletService.processMatchResult(
      userId,
      matchId,
      betAmount,
      payout,
      finalMass,
    );

    if ('alreadySettled' in result && result.alreadySettled) {
      // Idempotent replay — not an error, just a no-op.
      this.logger.warn(
        `Settlement job=${job.id} for matchId=${matchId} userId=${userId} ` +
        `was already settled (idempotency guard hit) — skipping.`,
      );
      return;
    }

    this.logger.log(
      `Settlement complete job=${job.id} userId=${userId} matchId=${matchId} ` +
      `payout=${payout}`,
    );
  }
}
