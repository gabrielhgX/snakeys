-- SPRINT 6 — Add Match.ipAddress for collusion detection.
-- Nullable column + index on (matchId, ipAddress) supports the fast
-- `findFirst` lookup performed by CollusionService.assertNoIpCollision().

ALTER TABLE "Match" ADD COLUMN "ipAddress" TEXT;

-- CreateIndex
CREATE INDEX "Match_matchId_ipAddress_idx" ON "Match"("matchId", "ipAddress");
