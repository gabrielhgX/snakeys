import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { InternalApiKeyGuard } from '../internal/guards/internal-api-key.guard';
import { ProgressionService } from './progression.service';

/**
 * Player-facing progression endpoints. The XP _award_ side lives in the
 * wallet settlement path (single source of truth for end-of-match
 * effects) — this controller only exposes read APIs and the admin
 * season-reset action.
 */
@Controller('progression')
export class ProgressionController {
  constructor(private progression: ProgressionService) {}

  /**
   * Snapshot of both counters for the authenticated user. Cheap call —
   * the lobby invokes this on mount to render the XP bar in the header.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@Req() req: any) {
    return this.progression.getProgression(req.user.id);
  }

  /**
   * Admin: zero every user's `seasonXp` and clear all Battle Pass
   * claims. Guarded by the same internal-API-key as service-to-service
   * traffic for now; ops can rotate it independently or split into a
   * dedicated `ADMIN_API_KEY` later.
   *
   * `SkipThrottle` because this is a one-off ops action, not a hot path.
   */
  @Post('season/reset')
  @UseGuards(InternalApiKeyGuard)
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  resetSeason() {
    return this.progression.resetSeason();
  }
}
