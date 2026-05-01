import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BattlePassService } from './battle-pass.service';
import { ClaimRewardDto } from './dto/claim-reward.dto';

/**
 * Battle Pass read + claim endpoints. All require JWT — there's no
 * public view because rewards may contain unreleased content we don't
 * want scraped.
 */
@Controller('battle-pass')
@UseGuards(JwtAuthGuard)
export class BattlePassController {
  constructor(private battlePass: BattlePassService) {}

  /**
   * Static reward definitions. The `/me` endpoint returns essentially
   * the same rows enriched with claim state, so most UIs should prefer
   * that. We keep `/rewards` separate for the (unauthenticated-ish)
   * "what's in this season" marketing page should it come later.
   */
  @Get('rewards')
  getRewards() {
    return this.battlePass.getRewards();
  }

  /**
   * Single composite response with user's season progression + every
   * reward row annotated with `unlocked` / `claimed` / `claimable`.
   * One call is all the UI needs.
   */
  @Get('me')
  getMe(@Req() req: any) {
    return this.battlePass.getStatus(req.user.id);
  }

  /**
   * Claim one specific level. Idempotent on `(userId, level)` — a
   * second call returns 409 ConflictException. The response's `grant`
   * is a discriminated union: inspect `grant.type` to decide which
   * celebration to play in the UI.
   */
  @Post('claim')
  @HttpCode(HttpStatus.OK)
  claim(@Req() req: any, @Body() dto: ClaimRewardDto) {
    return this.battlePass.claim(req.user.id, dto.level);
  }
}
