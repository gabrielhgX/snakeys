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
    return this.walletService.processBetEntry(dto.userId, dto.amount, dto.matchId);
  }

  @Post('match/result')
  @HttpCode(HttpStatus.OK)
  processMatchResult(@Body() dto: MatchResultDto) {
    return this.walletService.processMatchResult(
      dto.userId,
      dto.matchId,
      dto.betAmount,
      dto.payout,
    );
  }

  @Post('deposit/confirm')
  @HttpCode(HttpStatus.OK)
  confirmDeposit(@Body() dto: ConfirmDepositDto) {
    return this.walletService.confirmDeposit(dto.transactionId);
  }
}
