/*
  Warnings:

  - A unique constraint covering the columns `[equippedSkinId]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[serialNumber]` on the table `UserItem` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "RewardType" AS ENUM ('BALANCE', 'XP_BONUS', 'SKIN');

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "gameId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accountXp" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "equippedSkinId" TEXT,
ADD COLUMN     "seasonXp" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "UserItem" ADD COLUMN     "floatValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "serialNumber" SERIAL NOT NULL;

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BattlePassReward" (
    "id" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "rewardType" "RewardType" NOT NULL,
    "balanceAmount" DECIMAL(18,8),
    "xpAmount" INTEGER,
    "skinGameId" TEXT,
    "skinRarity" "Rarity",
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BattlePassReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBattlePassClaim" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedRef" TEXT,

    CONSTRAINT "UserBattlePassClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BattlePassReward_level_key" ON "BattlePassReward"("level");

-- CreateIndex
CREATE INDEX "UserBattlePassClaim_userId_idx" ON "UserBattlePassClaim"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserBattlePassClaim_userId_level_key" ON "UserBattlePassClaim"("userId", "level");

-- CreateIndex
CREATE INDEX "Item_gameId_idx" ON "Item"("gameId");

-- CreateIndex
CREATE INDEX "Item_type_rarity_idx" ON "Item"("type", "rarity");

-- CreateIndex
CREATE UNIQUE INDEX "User_equippedSkinId_key" ON "User"("equippedSkinId");

-- CreateIndex
CREATE UNIQUE INDEX "UserItem_serialNumber_key" ON "UserItem"("serialNumber");

-- CreateIndex
CREATE INDEX "UserItem_serialNumber_idx" ON "UserItem"("serialNumber");

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBattlePassClaim" ADD CONSTRAINT "UserBattlePassClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBattlePassClaim" ADD CONSTRAINT "UserBattlePassClaim_level_fkey" FOREIGN KEY ("level") REFERENCES "BattlePassReward"("level") ON DELETE RESTRICT ON UPDATE CASCADE;
