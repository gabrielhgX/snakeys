import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { WalletService } from '../wallet/wallet.service';
import { MatchEntryDto } from './dto/match-entry.dto';
import { MatchResultDto } from './dto/match-result.dto';
import { InternalApiKeyGuard } from './guards/internal-api-key.guard';

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
}
