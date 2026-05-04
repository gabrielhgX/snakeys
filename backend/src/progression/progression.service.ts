import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  LevelInfo,
  cumulativeXpForLevel,
  levelInfo,
  xpForMatch,
} from './progression.constants';

// ─── Ranking types ────────────────────────────────────────────────────────────

export interface RankingEntry {
  rank:      number;
  userId:    string;
  email:     string;
  accountXp: number;
  level:     number;
}

// Cache TTL for the global ranking query — 5 minutes balances freshness vs DB load.
const RANKING_CACHE_TTL_SECONDS = 300;

/**
 * Result of `awardMatchXp`. The deltas let the client show a "+N XP"
 * popup at end-of-match, while the snapshots let it animate the level
 * bar from old → new without an extra round-trip to `/progression/me`.
 */
export interface MatchXpAward {
  awarded: number; // amount added to BOTH counters
  account: {
    before: LevelInfo;
    after: LevelInfo;
  };
  season: {
    before: LevelInfo;
    after: LevelInfo;
  };
}

@Injectable()
export class ProgressionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Atomically credits XP for a finished match. Called by the wallet
   * settlement path and (in the future) by an authoritative game server.
   *
   * The same XP value lands in both counters because the spec says they
   * follow identical rules — only their reset semantics differ. We use
   * a single update so an admin reset that races with a match credit
   * can't double-count.
   *
   * Idempotency: NOT idempotent on its own. The caller (wallet settle)
   * must guarantee a single invocation per match by gating on the
   * existing `WIN`/`FEE` transaction record.
   */
  async awardMatchXp(
    userId: string,
    massIngested: number,
    kills: number,
    tx?: Prisma.TransactionClient,
  ): Promise<MatchXpAward> {
    const awarded = xpForMatch(massIngested, kills);
    return this.applyXpDelta(userId, awarded, tx);
  }

  /**
   * Credits a flat XP amount to both counters. Used by the Battle Pass
   * `XP_BONUS` reward. Allowed to drive the user past a level threshold,
   * which means the very next call to `getStatus` will surface the new
   * level as claimable — a small "compounding" feature that we treat as
   * intentional (it's a fun loop, and the BP claim is gated on idempotent
   * `(userId, level)` rows so it can't loop infinitely).
   */
  async addBonusXp(
    userId: string,
    amount: number,
    tx?: Prisma.TransactionClient,
  ): Promise<MatchXpAward> {
    const safe = Math.max(0, Math.floor(amount));
    return this.applyXpDelta(userId, safe, tx);
  }

  /**
   * Returns a snapshot of the user's progression state for the
   * `/progression/me` endpoint and (next turn) the lobby header.
   */
  async getProgression(userId: string): Promise<{
    account: LevelInfo;
    season: LevelInfo;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { accountXp: true, seasonXp: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return {
      account: levelInfo(user.accountXp),
      season: levelInfo(user.seasonXp),
    };
  }

  /**
   * Returns the global leaderboard sorted by lifetime XP (accountXp).
   *
   * SPRINT 4 — Redis cache with 5-minute TTL.
   * Every call first checks Redis.  On a cache miss, it queries PostgreSQL,
   * serialises the result, and writes it back with EX=300.  Subsequent calls
   * within the 5-minute window skip the DB entirely — O(1) vs O(n log n).
   *
   * Cache invalidation: TTL-based only.  A user's rank may lag by up to
   * 5 minutes after a match ends, which is acceptable for a leaderboard.
   *
   * @param limit  Maximum number of entries to return (default 100).
   */
  async getGlobalRanking(limit = 100): Promise<RankingEntry[]> {
    const cacheKey = `ranking:global:${limit}`;

    // ── Cache read ────────────────────────────────────────────────────────
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as RankingEntry[];
    }

    // ── Cache miss: query PostgreSQL ──────────────────────────────────────
    const users = await this.prisma.user.findMany({
      orderBy: { accountXp: 'desc' },
      take:    limit,
      select:  { id: true, email: true, accountXp: true },
    });

    const ranking: RankingEntry[] = users.map((u, i) => ({
      rank:      i + 1,
      userId:    u.id,
      email:     u.email,
      accountXp: u.accountXp,
      level:     levelInfo(u.accountXp).level,
    }));

    // ── Cache write ───────────────────────────────────────────────────────
    await this.redis.set(cacheKey, JSON.stringify(ranking), RANKING_CACHE_TTL_SECONDS);

    return ranking;
  }

  /**
   * Admin season rollover. Zeroes the per-user `seasonXp` and wipes
   * every Battle Pass claim so the new season's level table is fresh.
   * `accountXp` is intentionally untouched — it's a lifetime stat.
   *
   * Returns row counts so the caller can log how big the reset was.
   * Wrapped in a single transaction; if either step fails the whole
   * rollover aborts and we'll retry safely.
   */
  async resetSeason(): Promise<{
    usersReset: number;
    claimsCleared: number;
  }> {
    return this.prisma.$transaction(async (tx) => {
      const usersReset = await tx.user.updateMany({
        data: { seasonXp: 0 },
        // Touch every row; updateMany without `where` is fine here.
      });
      const claimsCleared = await tx.userBattlePassClaim.deleteMany({});
      return {
        usersReset: usersReset.count,
        claimsCleared: claimsCleared.count,
      };
    });
  }

  // ── private ────────────────────────────────────────────────────────────────

  private async applyXpDelta(
    userId: string,
    delta: number,
    tx?: Prisma.TransactionClient,
  ): Promise<MatchXpAward> {
    if (delta < 0) delta = 0;
    const client = tx ?? this.prisma;

    // Read-then-write inside the same transactional client. We can't
    // use a single atomic increment because the caller wants to render
    // a "before vs after" animation in the UI, and Prisma's `update`
    // returns only the post-state. The alternative — fetching pre-state
    // outside the tx — opens a tiny race window where another XP grant
    // could slip in between. With the wallet settlement guarding this,
    // that race is acceptable for MVP; an authoritative game server
    // would obviate it entirely.
    const before = await client.user.findUnique({
      where: { id: userId },
      select: { accountXp: true, seasonXp: true },
    });
    if (!before) throw new NotFoundException('User not found');

    const after = await client.user.update({
      where: { id: userId },
      data: {
        accountXp: { increment: delta },
        seasonXp: { increment: delta },
      },
      select: { accountXp: true, seasonXp: true },
    });

    return {
      awarded: delta,
      account: {
        before: levelInfo(before.accountXp),
        after: levelInfo(after.accountXp),
      },
      season: {
        before: levelInfo(before.seasonXp),
        after: levelInfo(after.seasonXp),
      },
    };
  }
}

// Re-export the curve helpers so consumers don't need a separate import.
export {
  cumulativeXpForLevel,
  levelInfo,
  xpForMatch,
} from './progression.constants';
export type { LevelInfo } from './progression.constants';
