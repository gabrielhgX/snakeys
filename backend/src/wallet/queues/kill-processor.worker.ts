import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { WalletService } from '../wallet.service';
import {
  KILL_PROCESSOR_JOB,
  KILL_PROCESSOR_QUEUE,
  KillProcessorJobData,
} from './kill-processor.types';

/**
 * Async kill-event recorder.
 *
 * Flow:
 *   1. Game-server detects a kill (checkCollisions)
 *   2. Game-server calls POST /internal/kill  (fire-and-forget via BackendClient)
 *   3. InternalController calls walletService.enqueueKillEvent()
 *   4. THIS WORKER calls walletService.processKillEvent() which:
 *      – Creates a KillEvent audit record (idempotent via unique idempotencyKey)
 *      – Does NOT touch wallet balances (that happens in processMatchResult at match end)
 *
 * Why not process balances here?
 *   Kill pot accumulation is tracked in game-server memory during the match.
 *   The final payout (sum of all kills + original bet – rake) is computed by
 *   the game-server and sent in processMatchResult at match end.  Doing
 *   real-time balance transfers per kill would require distributed state
 *   across the game-server and DB, introducing a new race class.  The audit
 *   record is sufficient for reconciliation if a match is abandoned.
 *
 * Retry policy: 3 attempts, exponential backoff (2 s → 4 s → 8 s).
 * Idempotency: `kill:<matchId>:<victimId>` unique constraint means a retry
 * after a partial failure hits P2002 and exits gracefully.
 */
@Processor(KILL_PROCESSOR_QUEUE)
export class KillProcessorWorker extends WorkerHost {
  private readonly logger = new Logger(KillProcessorWorker.name);

  constructor(private readonly walletService: WalletService) {
    super();
  }

  async process(job: Job<KillProcessorJobData>): Promise<void> {
    const { matchId, killerId, victimId, victimGrossPot, rakeRate } = job.data;

    this.logger.debug(
      `Processing kill job=${job.id} matchId=${matchId} ` +
      `killer=${killerId} victim=${victimId} grossPot=${victimGrossPot}`,
    );

    const result = await this.walletService.processKillEvent(
      matchId,
      killerId,
      victimId,
      victimGrossPot,
      rakeRate,
    );

    if (result.alreadyRecorded) {
      this.logger.warn(
        `Kill job=${job.id} matchId=${matchId} victim=${victimId} ` +
        `was already recorded — idempotency guard hit, skipping.`,
      );
      return;
    }

    this.logger.log(
      `Kill recorded job=${job.id} killer=${killerId} victim=${victimId} ` +
      `grossPot=${victimGrossPot} rake=${result.rake} net=${result.netTransferred}`,
    );
  }

  // BullMQ calls onFailed when all retries are exhausted.
  async onFailed(
    job: Job<KillProcessorJobData> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) return;
    this.logger.error(
      `Kill job=${job.id} matchId=${job.data.matchId} victim=${job.data.victimId} ` +
      `failed after ${job.attemptsMade} attempts: ${error.message}`,
    );
  }
}
