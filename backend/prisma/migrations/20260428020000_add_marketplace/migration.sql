-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('SKIN', 'HAT', 'EMOTE', 'PROFILE_BACKGROUND', 'PROFILE_FRAME');
CREATE TYPE "Rarity" AS ENUM ('COMMON', 'RARE', 'EPIC', 'LEGENDARY');
CREATE TYPE "ListingStatus" AS ENUM ('ACTIVE', 'SOLD', 'CANCELLED');

-- AlterEnum: add new transaction types
ALTER TYPE "TransactionType" ADD VALUE 'ITEM_PURCHASE';
ALTER TYPE "TransactionType" ADD VALUE 'ITEM_SALE';

-- CreateTable Item
CREATE TABLE "Item" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "type" "ItemType" NOT NULL,
  "rarity" "Rarity" NOT NULL,
  "imageUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable UserItem
CREATE TABLE "UserItem" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "obtainedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UserItem_userId_idx" ON "UserItem"("userId");

-- CreateTable MarketplaceListing
CREATE TABLE "MarketplaceListing" (
  "id" TEXT NOT NULL,
  "userItemId" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "price" DECIMAL(18,8) NOT NULL,
  "status" "ListingStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketplaceListing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketplaceListing_userItemId_key" ON "MarketplaceListing"("userItemId");
CREATE INDEX "MarketplaceListing_sellerId_idx" ON "MarketplaceListing"("sellerId");
CREATE INDEX "MarketplaceListing_status_idx" ON "MarketplaceListing"("status");

-- AddForeignKey UserItem
ALTER TABLE "UserItem" ADD CONSTRAINT "UserItem_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserItem" ADD CONSTRAINT "UserItem_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey MarketplaceListing
ALTER TABLE "MarketplaceListing" ADD CONSTRAINT "MarketplaceListing_userItemId_fkey"
  FOREIGN KEY ("userItemId") REFERENCES "UserItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketplaceListing" ADD CONSTRAINT "MarketplaceListing_sellerId_fkey"
  FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
