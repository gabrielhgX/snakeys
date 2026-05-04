import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { WalletService } from '../wallet/wallet.service';
import { ConfirmDepositDto } from './dto/confirm-deposit.dto';
import { KillEventDto } from './dto/kill-event.dto';
import { MatchEntryDto } from './dto/match-entry.dto';
import { MatchResultDto } from './dto/match-result.dto';
import { InternalApiKeyGuard } from './guards/internal-api-key.guard';

@SkipThrottle()
@Controller('internal')
@UseGuards(InternalApiKeyGuard)
export class InternalController {
  constructor(private walletService: WalletService) {}

  @Post('match/entry')
  @HttpCode(HttpStatus.OK)
  processBetEntry(@Body() dto: MatchEntryDto) {
    // Pass dto.mode so processBetEntry() stores it in the Match lifecycle record.
    return this.walletService.processBetEntry(dto.userId, dto.amount, dto.matchId, dto.mode);
  }

  /**
   * SPRINT 4 — async settlement via BullMQ.
   *
   * Previously this called processMatchResult() synchronously, blocking the
   * game-server until the Postgres transaction committed.  Now it enqueues a
   * BullMQ job and returns { queued, jobId } immediately (~1 ms vs ~20 ms).
   *
   * The MatchSettlementWorker picks up the job and executes the full ACID
   * settlement (lockWallet + MatchSettlement guard + FEE/WIN transactions).
   * Job deduplication via deterministic jobId (`settle:<matchId>:<userId>`)
   * means a game-server retry cannot create a duplicate settlement job.
   */
  @Post('match/result')
  @HttpCode(HttpStatus.ACCEPTED)   // 202 — job accepted, will be processed async
  enqueueMatchResult(@Body() dto: MatchResultDto) {
    return this.walletService.enqueueMatchResult(
      dto.userId,
      dto.matchId,
      dto.betAmount,
      dto.payout,
      dto.finalMass,
    );
  }

  /**
   * SPRINT 5 — async kill-event recorder via BullMQ.
   *
   * The game-server calls this fire-and-forget on every kill (head-to-head
   * or head-body collision).  The KillProcessorWorker writes a KillEvent
   * audit row with 3-attempt exponential-backoff retry.
   *
   * Deterministic jobId `kill:<matchId>:<victimId>` ensures a game-server
   * retry cannot create a duplicate kill record.
   */
  @Post('kill')
  @HttpCode(HttpStatus.ACCEPTED)
  enqueueKillEvent(@Body() dto: KillEventDto) {
    return this.walletService.enqueueKillEvent(
      dto.matchId,
      dto.killerId,
      dto.victimId,
      dto.victimGrossPot,
      dto.rakeRate,
    );
  }

  @Post('deposit/confirm')
  @HttpCode(HttpStatus.OK)
  confirmDeposit(@Body() dto: ConfirmDepositDto) {
    return this.walletService.confirmDeposit(dto.transactionId);
  }
}
