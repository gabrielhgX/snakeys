import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DepositDto } from './dto/deposit.dto';
import { GetTransactionsQueryDto } from './dto/get-transactions.dto';
import { MatchEntryDto } from './dto/match-entry.dto';
import { MatchSettleDto } from './dto/match-settle.dto';
import { SimulateDepositDto } from './dto/simulate-deposit.dto';
import { WithdrawDto } from './dto/withdraw.dto';
import { WalletService } from './wallet.service';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private walletService: WalletService) {}

  @Get()
  getWallet(@Req() req: any) {
    return this.walletService.getWallet(req.user.id);
  }

  @Get('balance')
  getBalance(@Req() req: any) {
    return this.walletService.getBalance(req.user.id);
  }

  @Get('transactions')
  getTransactions(@Req() req: any, @Query() query: GetTransactionsQueryDto) {
    return this.walletService.getTransactions(req.user.id, query.limit, query.offset);
  }

  @Post('deposit')
  @HttpCode(HttpStatus.OK)
  initiateDeposit(@Req() req: any, @Body() dto: DepositDto) {
    return this.walletService.initiateDeposit(
      req.user.id,
      dto.amount,
      dto.idempotencyKey,
    );
  }

  @Post('withdraw')
  @HttpCode(HttpStatus.OK)
  requestWithdraw(@Req() req: any, @Body() dto: WithdrawDto) {
    return this.walletService.requestWithdraw(
      req.user.id,
      dto.amount,
      dto.cpf,
      dto.idempotencyKey,
    );
  }

  /**
   * **Dev-only** — simulates the payment gateway webhook confirming a
   * PENDING deposit. Disabled in production (returns 404) so the endpoint
   * is invisible to consumers and scanners.
   *
   * Returns the fresh `{ balance, locked }` so the UI can update the
   * header without a second round-trip to `GET /wallet`.
   */
  @Post('deposit/simulate')
  @HttpCode(HttpStatus.OK)
  simulateDeposit(@Req() req: any, @Body() dto: SimulateDepositDto) {
    if (process.env.NODE_ENV === 'production') {
      throw new NotFoundException();
    }
    return this.walletService.simulateDepositConfirmationForUser(
      req.user.id,
      dto.transactionId,
    );
  }

  /**
   * Locks the entry fee for a new match and returns the freshly
   * generated `matchId`. The Lobby calls this immediately on the user's
   * "Play" click — the user is only navigated to the game canvas after
   * a successful response (insufficient balance is surfaced as a 4xx).
   */
  @Post('match/entry')
  @HttpCode(HttpStatus.OK)
  startMatch(@Req() req: any, @Body() dto: MatchEntryDto) {
    return this.walletService.startMatchForUser(
      req.user.id,
      dto.mode,
      dto.amount,
    );
  }

  /**
   * Settles the match. The client computes `payout` from the engine's
   * end-of-match snapshot (HuntHunt cash-out × 0.5, BigFish top-3 split,
   * etc.). The service caps the payout server-side as a safety net.
   *
   * Idempotent on `matchId` — a second call after the first settlement
   * returns the same balance without re-crediting.
   */
  @Post('match/settle')
  @HttpCode(HttpStatus.OK)
  settleMatch(@Req() req: any, @Body() dto: MatchSettleDto) {
    return this.walletService.settleMatchForUser(
      req.user.id,
      dto.matchId,
      dto.payout,
      { massIngested: dto.massIngested, kills: dto.kills },
    );
  }
}
