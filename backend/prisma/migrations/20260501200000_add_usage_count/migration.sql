-- Add usageCount to UserItem
ALTER TABLE "UserItem" ADD COLUMN "usageCount" INTEGER NOT NULL DEFAULT 0;
