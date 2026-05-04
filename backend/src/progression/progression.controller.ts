import {
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  Post,
  Query,
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
   * SPRINT 4 — Global leaderboard, cached in Redis for 5 minutes.
   *
   * Public endpoint (no JWT required) so the lobby landing page and
   * anonymous visitors can display the ranking without logging in.
   * Cache prevents the ORDER BY accountXp DESC from hammering Postgres on
   * every page load at peak traffic.
   *
   * Query param `limit` (1-200, default 100) controls page size.
   * Responses for different `limit` values are cached independently.
   */
  @Get('ranking')
  @SkipThrottle()
  getGlobalRanking(
    @Query('limit', new DefaultValuePipe(100), new ParseIntPipe({ optional: true }))
    limit: number,
  ) {
    const safeLimit = Math.min(Math.max(1, limit), 200);
    return this.progression.getGlobalRanking(safeLimit);
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
