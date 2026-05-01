import { randomInt } from 'crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Rarity } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Pure mint factory. The Battle Pass and (future) gacha / loot box
 * features all funnel through this so the random-attribute generation
 * lives in exactly one place.
 *
 * Concurrency: each mint is a single Prisma create, so global serial
 * uniqueness is enforced by the DB sequence on `UserItem.serialNumber`.
 * Even under contention there's no need to lock or retry from app code.
 */
@Injectable()
export class CosmeticsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Picks a random Item from the catalog matching the (gameId, rarity)
   * filter and creates a `UserItem` for the recipient with random
   * `floatValue` and an autoincrementing `serialNumber`.
   *
   * Throws if the pool is empty. Callers (e.g. `BattlePassService`)
   * should ensure the seed data covers every rarity they reference, or
   * fall back to a different reward type.
   *
   * @param recipientUserId  user that will own the minted instance
   * @param filters.gameId   `null` matches platform-wide cosmetics only;
   *                         pass an explicit string to restrict to that
   *                         game's pool
   * @param filters.rarity   filter on `Item.rarity`
   * @param tx               optional transaction client; lets the BP
   *                         claim flow keep the mint + claim-row write
   *                         in a single transaction
   */
  async mintRandomFromPool(
    recipientUserId: string,
    filters: { gameId: string | null; rarity: Rarity },
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;

    // Find candidate item ids. We pull only the id to keep the working
    // set small (a typical catalog will have dozens to hundreds of items
    // per rarity tier; pulling rows is wasteful when we just need a
    // random pick). Pagination on a random index avoids ORDER BY RANDOM
    // which doesn't scale.
    const candidateIds = await client.item.findMany({
      where: {
        rarity: filters.rarity,
        // Prisma quirk: `gameId: null` becomes `IS NULL`, while passing
        // a string compares for equality. Both branches work as written.
        gameId: filters.gameId,
      },
      select: { id: true },
    });

    if (candidateIds.length === 0) {
      throw new NotFoundException(
        `No items in pool (gameId=${filters.gameId ?? 'ANY'}, rarity=${filters.rarity})`,
      );
    }

    // crypto.randomInt is uniform and good enough for cosmetic loot;
    // not security-critical but better than Math.random for fairness
    // perception.
    const pickIndex = randomInt(0, candidateIds.length);
    const pickedItemId = candidateIds[pickIndex].id;

    return this.mintSpecific(recipientUserId, pickedItemId, tx);
  }

  /**
   * Mints a known item id directly. Useful for admin grants, code
   * redemptions, and tests. The float / serial generation is identical
   * to the random pool path.
   */
  async mintSpecific(
    recipientUserId: string,
    itemId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    return client.userItem.create({
      data: {
        userId: recipientUserId,
        itemId,
        floatValue: randomFloat01(),
        // serialNumber is auto-assigned by the DB sequence.
      },
      select: {
        id: true,
        serialNumber: true,
        floatValue: true,
        obtainedAt: true,
        item: {
          select: {
            id: true,
            name: true,
            type: true,
            rarity: true,
            imageUrl: true,
            gameId: true,
          },
        },
      },
    });
  }

  /**
   * Sets the user's currently-equipped skin. Validates ownership and
   * type before writing — passing a UserItem that belongs to someone
   * else, or a non-skin item (hat/emote), is a 4xx.
   *
   * Returns the freshly-equipped instance so the lobby can mirror it
   * in state without a second round-trip.
   */
  async equipSkin(userId: string, userItemId: string) {
    const owned = await this.prisma.userItem.findFirst({
      where: { id: userItemId, userId },
      select: {
        id: true,
        serialNumber: true,
        floatValue: true,
        obtainedAt: true,
        item: {
          select: {
            id: true,
            name: true,
            type: true,
            rarity: true,
            imageUrl: true,
            gameId: true,
          },
        },
      },
    });
    if (!owned) {
      throw new NotFoundException(
        'Item not found in your inventory or does not belong to you',
      );
    }
    if (owned.item.type !== 'SKIN') {
      throw new BadRequestException(
        'Only items of type SKIN can be equipped via this endpoint',
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { equippedSkinId: userItemId },
    });

    return owned;
  }

  /**
   * Returns the currently equipped skin (or `null`). The frontend
   * reads this to decide what `floatValue` to thread into `GameCanvas`
   * before a match starts.
   */
  async getEquippedSkin(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { equippedSkinId: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.equippedSkinId) return null;
    // Defensive lookup with the `userId` filter — protects against the
    // case where the equipped item was transferred via marketplace and
    // the equip pointer wasn't cleared (a bug we shouldn't have, but
    // refusing to render someone else's skin is the safe default).
    return this.prisma.userItem.findFirst({
      where: { id: user.equippedSkinId, userId },
      select: {
        id: true,
        serialNumber: true,
        floatValue: true,
        obtainedAt: true,
        item: {
          select: {
            id: true,
            name: true,
            type: true,
            rarity: true,
            imageUrl: true,
            gameId: true,
          },
        },
      },
    });
  }

  /**
   * Clears the equipped pointer. Called by marketplace listing flow
   * (you can't sell what you're wearing) and by the user's manual
   * "remove skin" action.
   */
  async unequipSkin(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { equippedSkinId: null },
    });
    return { equippedSkinId: null };
  }
}

/** Random float in [0, 1). Uses crypto for uniformity perception. */
function randomFloat01(): number {
  // Pull 32 random bits, normalize to [0, 1). Math.random would be
  // fine here but we already imported `randomInt` from crypto, so we
  // stay consistent with the rest of the file.
  const bits = randomInt(0, 2 ** 32);
  return bits / 2 ** 32;
}
