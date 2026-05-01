import { Injectable } from '@nestjs/common';
import { randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  /**
   * Lists every UserItem owned by the caller, with the unique-instance
   * attributes (`serialNumber`, `floatValue`) and current marketplace
   * listing status if any. Also surfaces the user's `equippedSkinId`
   * so the UI can mark exactly one row as the "wearing" entry without
   * a second round-trip.
   */
  async getInventory(userId: string) {
    const [user, items] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { equippedSkinId: true },
      }),
      this.prisma.userItem.findMany({
        where: { userId },
        orderBy: { obtainedAt: 'desc' },
        select: {
          id: true,
          serialNumber: true,
          floatValue: true,
          obtainedAt: true,
          item: {
            select: {
              id: true,
              name: true,
              description: true,
              type: true,
              rarity: true,
              imageUrl: true,
              gameId: true,
            },
          },
          listing: {
            select: { id: true, price: true, status: true },
          },
        },
      }),
    ]);

    return {
      equippedSkinId: user?.equippedSkinId ?? null,
      items,
    };
  }

  /**
   * Internal-grant path used by milestone hooks (e.g. "first 10 kills"
   * cosmetic). Mints a new UserItem with the same random-attribute
   * generation as the cosmetics module's mint so every mint route
   * yields consistent rows. Kept here (instead of delegating) to avoid
   * a circular module dependency between `inventory` and `cosmetics`.
   */
  async grantItem(userId: string, itemId: string) {
    return this.prisma.userItem.create({
      data: {
        userId,
        itemId,
        floatValue: randomFloat01(),
      },
      select: {
        id: true,
        serialNumber: true,
        floatValue: true,
        obtainedAt: true,
        item: { select: { id: true, name: true, type: true, rarity: true } },
      },
    });
  }
}

/**
 * Local copy of the float helper so this module doesn't import from
 * `cosmetics`. The two implementations are identical — keeping them
 * in sync is a one-line concern, and avoids a circular dep that would
 * trigger if `inventory` ever needed to consume something else from
 * `cosmetics`.
 */
function randomFloat01(): number {
  const bits = randomInt(0, 2 ** 32);
  return bits / 2 ** 32;
}
