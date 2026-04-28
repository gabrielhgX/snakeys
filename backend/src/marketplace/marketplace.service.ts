import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ListingStatus, TransactionStatus, TransactionType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MarketplaceService {
  constructor(private prisma: PrismaService) {}

  async getListings(limit = 20, offset = 0) {
    return this.prisma.marketplaceListing.findMany({
      where: { status: ListingStatus.ACTIVE },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        price: true,
        createdAt: true,
        userItem: {
          select: {
            id: true,
            item: { select: { id: true, name: true, type: true, rarity: true, imageUrl: true } },
          },
        },
        seller: { select: { id: true, email: true } },
      },
    });
  }

  async createListing(sellerId: string, userItemId: string, price: number) {
    const userItem = await this.prisma.userItem.findFirst({
      where: { id: userItemId, userId: sellerId },
    });
    if (!userItem) throw new NotFoundException('Item not found in your inventory');

    const existing = await this.prisma.marketplaceListing.findFirst({
      where: { userItemId, status: ListingStatus.ACTIVE },
    });
    if (existing) throw new ConflictException('Item is already listed on the marketplace');

    return this.prisma.marketplaceListing.create({
      data: { userItemId, sellerId, price },
      select: {
        id: true,
        price: true,
        status: true,
        createdAt: true,
        userItem: { select: { item: { select: { name: true, type: true, rarity: true } } } },
      },
    });
  }

  async cancelListing(sellerId: string, listingId: string) {
    const listing = await this.prisma.marketplaceListing.findFirst({
      where: { id: listingId, sellerId },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.status !== ListingStatus.ACTIVE) {
      throw new BadRequestException('Listing is no longer active');
    }

    return this.prisma.marketplaceListing.update({
      where: { id: listingId },
      data: { status: ListingStatus.CANCELLED },
      select: { id: true, status: true },
    });
  }

  async buyListing(buyerId: string, listingId: string) {
    return this.prisma.$transaction(async (tx) => {
      const listing = await tx.marketplaceListing.findUnique({
        where: { id: listingId },
        include: { userItem: true },
      });

      if (!listing) throw new NotFoundException('Listing not found');
      if (listing.status !== ListingStatus.ACTIVE) {
        throw new BadRequestException('Listing is no longer active');
      }
      if (listing.sellerId === buyerId) {
        throw new BadRequestException('Cannot buy your own listing');
      }

      const price = new Decimal(listing.price);

      const buyerWallet = await tx.wallet.findUnique({ where: { userId: buyerId } });
      if (!buyerWallet) throw new NotFoundException('Buyer wallet not found');
      if (new Decimal(buyerWallet.balanceAvailable).lessThan(price)) {
        throw new BadRequestException('Insufficient balance');
      }

      const sellerWallet = await tx.wallet.findUnique({ where: { userId: listing.sellerId } });
      if (!sellerWallet) throw new NotFoundException('Seller wallet not found');

      // Deduct from buyer
      await tx.wallet.update({
        where: { userId: buyerId },
        data: { balanceAvailable: new Decimal(buyerWallet.balanceAvailable).minus(price) },
      });

      // Credit to seller
      await tx.wallet.update({
        where: { userId: listing.sellerId },
        data: { balanceAvailable: new Decimal(sellerWallet.balanceAvailable).plus(price) },
      });

      // Transfer item ownership
      await tx.userItem.update({
        where: { id: listing.userItemId },
        data: { userId: buyerId },
      });

      // Close listing
      await tx.marketplaceListing.update({
        where: { id: listingId },
        data: { status: ListingStatus.SOLD },
      });

      // Financial records
      await tx.transaction.createMany({
        data: [
          {
            userId: buyerId,
            type: TransactionType.ITEM_PURCHASE,
            amount: price,
            status: TransactionStatus.COMPLETED,
            referenceId: listingId,
          },
          {
            userId: listing.sellerId,
            type: TransactionType.ITEM_SALE,
            amount: price,
            status: TransactionStatus.COMPLETED,
            referenceId: listingId,
          },
        ],
      });

      return { purchased: true, price: price.toNumber() };
    });
  }
}
