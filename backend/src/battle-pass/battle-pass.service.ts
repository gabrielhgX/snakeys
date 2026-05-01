import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RewardType, TransactionStatus, TransactionType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { CosmeticsService } from '../cosmetics/cosmetics.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProgressionService } from '../progression/progression.service';
import {
  cumulativeXpForLevel,
  levelInfo,
  MAX_LEVEL,
} from '../progression/progression.constants';

/**
 * Orchestrates the Battle Pass: exposes the reward table, derives what
 * the user is allowed to claim from their `seasonXp`, and enforces
 * idempotent claims with one DB transaction per call.
 *
 * Design notes:
 *  - The reward table is 100 rows, seeded once. Fetching the whole
 *    table on every `/me` hit is fine — it's under 100 rows and caches
 *    naturally at the ORM layer.
 *  - Claims are gated by `UserBattlePassClaim` having `@@unique([userId,
 *    level])`, so two concurrent requests for the same level can't both
 *    win: the loser hits a P2002 and we translate to 409.
 *  - We never re-validate the reward body from client input; only the
 *    `level` is trusted and the reward definition is looked up server-
 *    side. Prevents "claim level 3 but give me the level 50 skin".
 */
@Injectable()
export class BattlePassService {
  constructor(
    private prisma: PrismaService,
    private progression: ProgressionService,
    private cosmetics: CosmeticsService,
  ) {}

  /**
   * Static reward definitions — what level N grants. Returned shape is
   * stable whether or not the caller has claimed anything. 100 rows,
   * one per level.
   */
  async getRewards() {
    return this.prisma.battlePassReward.findMany({
      orderBy: { level: 'asc' },
      select: {
        level: true,
        rewardType: true,
        balanceAmount: true,
        xpAmount: true,
        skinGameId: true,
        skinRarity: true,
        description: true,
      },
    });
  }

  /**
   * Composite response for `GET /battle-pass/me`. Combines reward
   * definitions with the user's current progress and claim state so
   * the UI can render the whole pass with a single request.
   *
   * `claimable` is the subset of rewards the user has both reached
   * AND not yet claimed — letting the UI show a count in a notification
   * badge without client-side derivation.
   */
  async getStatus(userId: string) {
    const [user, rewards, claims] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { seasonXp: true },
      }),
      this.getRewards(),
      this.prisma.userBattlePassClaim.findMany({
        where: { userId },
        select: { level: true, claimedAt: true, grantedRef: true },
      }),
    ]);

    if (!user) throw new NotFoundException('User not found');

    const claimedLevels = new Set(claims.map((c) => c.level));
    const seasonLevel = levelInfo(user.seasonXp);

    // Merge claim state into each reward row so the UI gets one array
    // with every state it needs — `unlocked` means the user has leveled
    // past this row; `claimed` means they've already received it.
    const merged = rewards.map((r) => {
      const unlocked = seasonLevel.level >= r.level;
      const claimed = claimedLevels.has(r.level);
      return {
        level: r.level,
        rewardType: r.rewardType,
        balanceAmount: r.balanceAmount ? Number(r.balanceAmount) : null,
        xpAmount: r.xpAmount,
        skinGameId: r.skinGameId,
        skinRarity: r.skinRarity,
        description: r.description,
        unlocked,
        claimed,
        claimable: unlocked && !claimed,
      };
    });

    return {
      season: seasonLevel,
      rewards: merged,
      claimableCount: merged.filter((r) => r.claimable).length,
      claims,
    };
  }

  /**
   * Idempotent claim. On success, returns a union-type payload that
   * tells the UI exactly what was granted so it can play the right
   * animation (balance-up / XP-up / card-reveal for skins).
   *
   * Races are handled two ways:
   *   1. The unique `(userId, level)` index catches two concurrent
   *      requests; the loser gets a P2002 Prisma error → 409 here.
   *   2. Inside the transaction we re-read `seasonXp` so a user that
   *      only _just_ unlocked the level via a concurrent XP grant can
   *      still succeed without reading stale state.
   */
  async claim(userId: string, level: number) {
    if (level < 1 || level > MAX_LEVEL) {
      throw new BadRequestException(`Level must be between 1 and ${MAX_LEVEL}`);
    }

    return this.prisma.$transaction(async (tx) => {
      // Re-read seasonXp inside the tx so we lock against a stale
      // unlock check.
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { seasonXp: true },
      });
      if (!user) throw new NotFoundException('User not found');

      const required = cumulativeXpForLevel(level);
      if (user.seasonXp < required) {
        throw new BadRequestException(
          `Level ${level} requires ${required} seasonXp, user has ${user.seasonXp}`,
        );
      }

      const reward = await tx.battlePassReward.findUnique({
        where: { level },
      });
      if (!reward) {
        throw new NotFoundException(`No reward configured for level ${level}`);
      }

      // Create the claim row FIRST. If it throws P2002 (unique
      // violation on (userId, level)), the user already claimed this
      // level and we abort before crediting anything a second time.
      // `grantedRef` is filled below once we know what was minted.
      let claim;
      try {
        claim = await tx.userBattlePassClaim.create({
          data: { userId, level },
          select: { id: true },
        });
      } catch (err: any) {
        if (err?.code === 'P2002') {
          throw new ConflictException(`Level ${level} already claimed`);
        }
        throw err;
      }

      // Dispatch on reward type. Each branch returns a typed payload
      // that we flatten into the response. All DB writes in these
      // branches go through `tx` so a failure after claim-row insert
      // rolls the claim back too — no orphaned "claimed but not
      // granted" rows.
      let grant:
        | { type: 'BALANCE'; amount: number; newBalance: number }
        | { type: 'XP_BONUS'; amount: number; newAccountXp: number; newSeasonXp: number }
        | { type: 'SKIN'; userItemId: string; serialNumber: number; floatValue: number; itemName: string };
      let grantedRef: string | null = null;

      switch (reward.rewardType) {
        case RewardType.BALANCE: {
          if (!reward.balanceAmount) {
            throw new BadRequestException(
              `Reward ${level} is BALANCE but has no balanceAmount`,
            );
          }
          const wallet = await tx.wallet.findUnique({
            where: { userId },
          });
          if (!wallet) throw new NotFoundException('Wallet missing');
          const amount = new Decimal(reward.balanceAmount);
          const newAvailable = new Decimal(wallet.balanceAvailable).plus(amount);
          await tx.wallet.update({
            where: { userId },
            data: { balanceAvailable: newAvailable },
          });
          const txnRow = await tx.transaction.create({
            data: {
              userId,
              type: TransactionType.WIN,
              amount,
              status: TransactionStatus.COMPLETED,
              referenceId: `bp-${level}`,
            },
            select: { id: true },
          });
          grantedRef = txnRow.id;
          grant = {
            type: 'BALANCE',
            amount: amount.toNumber(),
            newBalance: newAvailable.toNumber(),
          };
          break;
        }

        case RewardType.XP_BONUS: {
          if (!reward.xpAmount) {
            throw new BadRequestException(
              `Reward ${level} is XP_BONUS but has no xpAmount`,
            );
          }
          const awarded = await this.progression.addBonusXp(
            userId,
            reward.xpAmount,
            tx,
          );
          grant = {
            type: 'XP_BONUS',
            amount: reward.xpAmount,
            newAccountXp: awarded.account.after.xp,
            newSeasonXp: awarded.season.after.xp,
          };
          break;
        }

        case RewardType.SKIN: {
          if (!reward.skinRarity) {
            throw new BadRequestException(
              `Reward ${level} is SKIN but has no skinRarity`,
            );
          }
          const minted = await this.cosmetics.mintRandomFromPool(
            userId,
            { gameId: reward.skinGameId, rarity: reward.skinRarity },
            tx,
          );
          grantedRef = minted.id;
          grant = {
            type: 'SKIN',
            userItemId: minted.id,
            serialNumber: minted.serialNumber,
            floatValue: minted.floatValue,
            itemName: minted.item.name,
          };
          break;
        }

        default: {
          // Should be unreachable — enum is exhaustive — but we keep
          // this to trip the TS exhaustiveness check on future changes.
          const _exhaustive: never = reward.rewardType;
          throw new BadRequestException(
            `Unknown reward type: ${reward.rewardType}`,
          );
        }
      }

      if (grantedRef) {
        await tx.userBattlePassClaim.update({
          where: { id: claim.id },
          data: { grantedRef },
        });
      }

      return { level, grant };
    });
  }
}
