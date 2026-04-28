-- Add indexes on Transaction for getTransactions and match settlement queries
CREATE INDEX "Transaction_userId_idx" ON "Transaction"("userId");
CREATE INDEX "Transaction_matchId_idx" ON "Transaction"("matchId");

-- Add expiry timestamp for email verification tokens (24h TTL)
ALTER TABLE "User" ADD COLUMN "emailVerificationTokenExpiresAt" TIMESTAMP(3);
