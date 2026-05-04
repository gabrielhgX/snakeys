import { NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

export interface LockedWallet {
  balanceAvailable: Decimal;
  balanceLocked: Decimal;
}

/**
 * Acquires a PostgreSQL row-level write lock on the Wallet row for `userId`
 * and returns its current balances as Decimal instances.
 *
 * MUST be called as the first operation inside a `prisma.$transaction()` block
 * whenever the caller intends to read-then-update wallet balances.
 *
 * WHY SELECT FOR UPDATE:
 *   PostgreSQL's default isolation is READ COMMITTED.  Without a row lock,
 *   two concurrent transactions can both read the same stale balance, both
 *   pass the `available >= amount` check, and both commit — leaving the
 *   balance in a negative state (TOCTOU race, Audit Issue 1.2).
 *
 *   SELECT FOR UPDATE forces the second transaction to block at this line
 *   until the first commits, guaranteeing a fresh read of the post-commit
 *   balance before any subsequent check or update.
 *
 * NOTE ON DECIMAL PRECISION:
 *   The pg driver returns NUMERIC/DECIMAL columns as strings in raw queries.
 *   Wrapping in `new Decimal(string)` preserves the full Decimal(18,8)
 *   precision that would be lost if cast to a JS number first.
 *
 * @param tx     The Prisma interactive-transaction client (the `tx` argument
 *               inside `prisma.$transaction(async (tx) => { ... })`).
 * @param userId The user whose Wallet row should be locked.
 */
export async function lockWallet(tx: any, userId: string): Promise<LockedWallet> {
  const rows = await tx.$queryRaw<
    Array<{ balanceAvailable: string; balanceLocked: string }>
  >`
    SELECT "balanceAvailable", "balanceLocked"
    FROM   "Wallet"
    WHERE  "userId" = ${userId}
    FOR UPDATE
  `;

  if (rows.length === 0) {
    throw new NotFoundException(`Wallet not found for user ${userId}`);
  }

  return {
    balanceAvailable: new Decimal(rows[0].balanceAvailable),
    balanceLocked:    new Decimal(rows[0].balanceLocked),
  };
}
