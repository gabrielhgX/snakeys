import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MatchStatus, TransactionStatus, TransactionType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { lockWallet } from '../wallet/wallet.util';

// A match that stays ACTIVE beyond this threshold without a MatchSettlement
// record is treated as orphaned (game-server crash / network partition).
// 120 minutes is long enough to cover the longest legitimate match (Hunt-Hunt
// = 60 min) plus a generous grace buffer for slow settlement calls.
const ABANDON_AFTER_MS = 120 * 60 * 1000;

@Injectable()
export class MatchReconciliationService {
  private readonly logger = new Logger(MatchReconciliationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs every 5 minutes.  Finds all Match rows that have been ACTIVE for
   * longer than ABANDON_AFTER_MS and have no corresponding MatchSettlement
   * record (proof that processMatchResult() never completed).
   *
   * For each such match it either:
   *   a) Finds a MatchSettlement that appeared since the outer query ran
   *      → marks the Match SETTLED (cleanup only, no wallet change).
   *   b) Finds no MatchSettlement
   *      → ABANDONS the match: refunds the locked bet to balanceAvailable,
   *         creates a MatchSettlement to block any late settlement from the
   *         game-server, and writes a WIN transaction for auditability.
   *
   * Every per-match operation runs inside its own PostgreSQL transaction so
   * a failure on one match does not block the others.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcileAbandonedMatches(): Promise<void> {
    const cutoff = new Date(Date.now() - ABANDON_AFTER_MS);

    const staleMatches = await this.prisma.match.findMany({
      where: {
        status:    MatchStatus.ACTIVE,
        createdAt: { lt: cutoff },
      },
      select: { id: true, matchId: true, userId: true, betAmount: true, mode: true },
    });

    if (staleMatches.length === 0) return;

    this.logger.log(
      `Reconciliation run: found ${staleMatches.length} stale ACTIVE match(es).`,
    );

    let settled = 0;
    let abandoned = 0;
    let errors = 0;

    for (const match of staleMatches) {
      const result = await this.reconcileOne(match);
      if (result === 'settled')       settled++;
      else if (result === 'abandoned') abandoned++;
      else if (result === 'error')     errors++;
      // 'skipped' = already processed between outer query and transaction
    }

    this.logger.log(
      `Reconciliation complete — settled: ${settled}, abandoned: ${abandoned}, errors: ${errors}.`,
    );
  }

  // ── Core per-match logic ────────────────────────────────────────────────────

  private async reconcileOne(match: {
    id: string;
    matchId: string;
    userId: string;
    betAmount: Decimal;
    mode: string;
  }): Promise<'settled' | 'abandoned' | 'skipped' | 'error'> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // ── Re-read the Match row inside the transaction ──────────────────
        // The outer findMany() ran outside a transaction.  Between that read
        // and now the game-server may have called processMatchResult() and
        // flipped the status to SETTLED.  Re-reading avoids acting on stale
        // data and prevents a double-refund.
        const live = await (tx as any).match.findUnique({
          where: { id: match.id },
          select: { status: true },
        });

        if (!live || live.status !== MatchStatus.ACTIVE) {
          // Already SETTLED or ABANDONED since the outer query — nothing to do.
          return 'skipped';
        }

        // ── Check for a MatchSettlement (Sprint 1 idempotency record) ─────
        // If one exists, processMatchResult() completed successfully even
        // though the Match row was never updated to SETTLED (e.g. the server
        // crashed between the two writes).  We only need to clean up the
        // Match status — no wallet change.
        const settlement = await (tx as any).matchSettlement.findUnique({
          where: {
            userId_matchId: { userId: match.userId, matchId: match.matchId },
          },
          select: { id: true },
        });

        if (settlement) {
          // Settlement exists → match was paid; just mark SETTLED.
          await (tx as any).match.update({
            where: { id: match.id },
            data:  { status: MatchStatus.SETTLED },
          });
          this.logger.debug(
            `Match ${match.matchId} (user ${match.userId}): MatchSettlement found — marked SETTLED.`,
          );
          return 'settled';
        }

        // ── No MatchSettlement → orphaned match, perform storno ───────────

        const betAmount = new Decimal(match.betAmount);

        // Lock the wallet row (SELECT FOR UPDATE) before reading balances to
        // prevent a race with a concurrent processMatchResult() call that
        // might arrive just as we are processing the storno.
        const wallet = await lockWallet(tx, match.userId);

        // Safety check: locked balance should cover the bet.  If not
        // (e.g. a partial settlement already occurred via a separate path),
        // refund only what is available in locked rather than going negative.
        const refundAmount = wallet.balanceLocked.greaterThanOrEqualTo(betAmount)
          ? betAmount
          : wallet.balanceLocked;

        const hasDiscrepancy = refundAmount.lessThan(betAmount);
        if (hasDiscrepancy) {
          this.logger.warn(
            `Match ${match.matchId} (user ${match.userId}): ` +
            `locked balance (${wallet.balanceLocked}) < betAmount (${betAmount}). ` +
            `Refunding only ${refundAmount}.`,
          );
        }

        // 1. Move locked → available (the refund itself).
        await tx.wallet.update({
          where: { userId: match.userId },
          data: {
            balanceLocked:    wallet.balanceLocked.minus(refundAmount),
            balanceAvailable: wallet.balanceAvailable.plus(refundAmount),
          },
        });

        // 2. Create a MatchSettlement to block any late settlement from the
        //    game-server.  If processMatchResult() arrives after this commit,
        //    its matchSettlement.create() will fail with P2002 and return
        //    { alreadySettled: true } — the wallet is not touched again.
        await (tx as any).matchSettlement.create({
          data: {
            userId:  match.userId,
            matchId: match.matchId,
            payout:  refundAmount,
          },
        });

        // 3. Write an audit transaction record so the refund is visible in
        //    the user's transaction history.
        //    idempotencyKey is deterministic so a second reconciler run
        //    (after a crash mid-transaction) cannot insert a duplicate row.
        await tx.transaction.create({
          data: {
            userId:         match.userId,
            type:           TransactionType.WIN,
            amount:         refundAmount,
            matchId:        match.matchId,
            idempotencyKey: `reconcile:refund:${match.matchId}:${match.userId}`,
            status:         TransactionStatus.COMPLETED,
          },
        });

        // 4. Mark the Match as ABANDONED — the final state for this lifecycle.
        await (tx as any).match.update({
          where: { id: match.id },
          data:  { status: MatchStatus.ABANDONED },
        });

        this.logger.log(
          `Match ${match.matchId} (user ${match.userId}): ABANDONED — ` +
          `refunded ${refundAmount} BRL from locked to available.`,
        );

        return 'abandoned';
      });
    } catch (err) {
      // Log and continue — a failure on one match must not block the others.
      this.logger.error(
        `Failed to reconcile match ${match.matchId} (user ${match.userId}): ` +
        `${(err as Error).message}`,
        (err as Error).stack,
      );
      return 'error';
    }
  }
}
