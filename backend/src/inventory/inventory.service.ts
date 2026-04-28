import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  async getInventory(userId: string) {
    return this.prisma.userItem.findMany({
      where: { userId },
      orderBy: { obtainedAt: 'desc' },
      select: {
        id: true,
        obtainedAt: true,
        item: {
          select: { id: true, name: true, description: true, type: true, rarity: true, imageUrl: true },
        },
        listing: {
          select: { id: true, price: true, status: true },
        },
      },
    });
  }

  // Called by InternalController when a reward is granted (e.g. kill milestone)
  async grantItem(userId: string, itemId: string) {
    return this.prisma.userItem.create({
      data: { userId, itemId },
      select: {
        id: true,
        obtainedAt: true,
        item: { select: { id: true, name: true, type: true, rarity: true } },
      },
    });
  }
}
