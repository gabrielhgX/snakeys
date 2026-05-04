-- CreateTable
CREATE TABLE "KillEvent" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "killerId" TEXT NOT NULL,
    "victimId" TEXT NOT NULL,
    "victimGrossPot" DECIMAL(18,8) NOT NULL,
    "rake" DECIMAL(18,8) NOT NULL,
    "netTransferred" DECIMAL(18,8) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KillEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KillEvent_idempotencyKey_key" ON "KillEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "KillEvent_matchId_idx" ON "KillEvent"("matchId");

-- CreateIndex
CREATE INDEX "KillEvent_killerId_idx" ON "KillEvent"("killerId");
