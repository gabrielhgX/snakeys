import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TransactionStatus, TransactionType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DepositIntent {
  transactionId: string;
  amount: number;
  status: 'PENDING';
  message: string;
  // Future: paymentUrl from real gateway
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class WalletService {
  constructor(private prisma: PrismaService) {}

  // ── Public read endpoints ──────────────────────────────────────────────────

  async getWallet(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });

    if (!wallet) throw new NotFoundException('Wallet not found');

    return wallet;
  }

  async getTransactions(userId: string) {
    return this.prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Public deposit (mock payment gateway) ─────────────────────────────────

  /**
   * Creates a PENDING deposit request. Does NOT touch balances.
   * A real payment gateway webhook would later call confirmDeposit().
   * Idempotent: same idempotencyKey always returns the same record.
   */
  async initiateDeposit(
    userId: string,
    amount: number,
    idempotencyKey: string,
  ): Promise<DepositIntent> {
    this.assertPositive(amount);

    await this.requireWalletDirect(userId);

    const existing = await this.prisma.transaction.findUnique({
      where: { idempotencyKey },
    });

    if (existing) {
      if (existing.userId !== userId) {
        // Idempotency key belongs to another user — hard rejection
        throw new ConflictException('Idempotency key already used');
      }

      return {
        transactionId: existing.id,
        amount: Number(existing.amount),
        status: 'PENDING',
        message: 'Deposit already initiated. Awaiting payment confirmation.',
      };
    }

    const transaction = await this.prisma.transaction.create({
      data: {
        userId,
        type: TransactionType.DEPOSIT,
        amount,
        status: TransactionStatus.PENDING,
        idempotencyKey,
      },
    });

    return {
      transactionId: transaction.id,
      amount,
      status: 'PENDING',
      message: 'Deposit initiated. Awaiting payment confirmation.',
    };
  }

  // ── Internal: called by payment gateway webhook (not in controller) ────────

  /**
   * Confirms a pending deposit and credits the balance.
   * Must only be called from a verified payment gateway webhook handler.
   */
  async confirmDeposit(transactionId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const deposit = await tx.transaction.findUnique({
        where: { id: transactionId },
      });

      if (!deposit) throw new NotFoundException('Deposit not found');
      if (deposit.type !== TransactionType.DEPOSIT) {
        throw new BadRequestException('Transaction is not a deposit');
      }
      if (deposit.status === TransactionStatus.COMPLETED) return; // idempotent
      if (deposit.status === TransactionStatus.FAILED) {
        throw new BadRequestException('Cannot confirm a failed deposit');
      }

      const wallet = await this.requireWallet(tx, deposit.userId);

      await tx.wallet.update({
        where: { userId: deposit.userId },
        data: {
          balanceAvailable: new Decimal(wallet.balanceAvailable).plus(
            deposit.amount,
          ),
        },
      });

      await tx.transaction.update({
        where: { id: transactionId },
        data: { status: TransactionStatus.COMPLETED },
      });
    });
  }

  // ── Internal: called by game server (not in controller) ───────────────────

  /**
   * Locks the bet amount for a match entry.
   * Idempotent: repeated calls for the same match/user are safe.
   */
  async processBetEntry(
    userId: string,
    amount: number,
    matchId: string,
  ) {
    this.assertPositive(amount);

    const idempotencyKey = `bet:${matchId}:${userId}`;

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.transaction.findUnique({
        where: { idempotencyKey },
      });
      if (existing) return existing;

      const wallet = await this.requireWallet(tx, userId);
      const available = new Decimal(wallet.balanceAvailable);

      if (available.lessThan(amount)) {
        throw new BadRequestException('Insufficient available balance');
      }

      await tx.wallet.update({
        where: { userId },
        data: {
          balanceAvailable: available.minus(amount),
          balanceLocked: new Decimal(wallet.balanceLocked).plus(amount),
        },
      });

      return tx.transaction.create({
        data: {
          userId,
          type: TransactionType.BET,
          amount,
          matchId,
          idempotencyKey,
          status: TransactionStatus.COMPLETED,
        },
      });
    });
  }

  /**
   * Settles a match result for a user.
   *
   * @param betAmount  The amount that was locked by processBetEntry.
   * @param payout     The amount to credit to available balance.
   *                   Pass 0 for a full loss; pass betAmount + profit for a win.
   *
   * Idempotent: repeated calls for the same match/user are safe.
   */
  async processMatchResult(
    userId: string,
    matchId: string,
    betAmount: number,
    payout: number,
  ) {
    this.assertPositive(betAmount);
    if (payout < 0) throw new BadRequestException('Payout cannot be negative');

    const feeKey = `fee:${matchId}:${userId}`;
    const winKey = `win:${matchId}:${userId}`;

    return this.prisma.$transaction(async (tx) => {
      // Idempotency guard: if the fee record exists the full settlement already ran
      const existing = await tx.transaction.findUnique({
        where: { idempotencyKey: feeKey },
      });
      if (existing) return { alreadySettled: true };

      // Verify user actually entered this match before allowing settlement
      const betRecord = await tx.transaction.findFirst({
        where: {
          userId,
          matchId,
          type: TransactionType.BET,
          status: TransactionStatus.COMPLETED,
        },
      });

      if (!betRecord) {
        throw new BadRequestException(
          'User did not participate in this match',
        );
      }

      const wallet = await this.requireWallet(tx, userId);
      const locked = new Decimal(wallet.balanceLocked);

      if (locked.lessThan(betAmount)) {
        throw new BadRequestException(
          'Insufficient locked balance to settle match',
        );
      }

      // Consume the locked bet (always — win or loss)
      const newLocked = locked.minus(betAmount);
      const newAvailable = new Decimal(wallet.balanceAvailable).plus(payout);

      await tx.wallet.update({
        where: { userId },
        data: {
          balanceLocked: newLocked,
          balanceAvailable: newAvailable,
        },
      });

      // Record the fee (consumed from locked)
      await tx.transaction.create({
        data: {
          userId,
          type: TransactionType.FEE,
          amount: betAmount,
          matchId,
          idempotencyKey: feeKey,
          status: TransactionStatus.COMPLETED,
        },
      });

      // Record the payout (credited to available) only if non-zero
      if (payout > 0) {
        await tx.transaction.create({
          data: {
            userId,
            type: TransactionType.WIN,
            amount: payout,
            matchId,
            idempotencyKey: winKey,
            status: TransactionStatus.COMPLETED,
          },
        });
      }

      return { settled: true, payout };
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async requireWallet(tx: any, userId: string) {
    const wallet = await tx.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');
    return wallet;
  }

  private async requireWalletDirect(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');
    return wallet;
  }

  private assertPositive(amount: number) {
    if (amount <= 0) throw new BadRequestException('Amount must be positive');
  }
}
