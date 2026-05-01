import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { TransactionStatus, TransactionType } from '@prisma/client';
import { Decimal, PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import { generatePixCode } from './pix-code.util';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DepositIntent {
  transactionId: string;
  amount: number;
  status: 'PENDING';
  message: string;
  /** Pix BRCode (EMV) — paste into any bank app (fictitious sandbox key). */
  pixCode: string;
  /** Expiry of the Pix code (15 minutes from creation). */
  expiresAt: string;
}

export interface WithdrawIntent {
  transactionId: string;
  amount: number;
  status: 'PENDING';
  message: string;
}

export interface BalanceDto {
  balance: number; // balanceAvailable, ready to spend
  locked: number; // balanceLocked (in active bets / pending withdraws)
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class WalletService {
  constructor(private prisma: PrismaService) {}

  // ── Public read endpoints ──────────────────────────────────────────────────

  async getWallet(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: { balanceAvailable: true, balanceLocked: true, createdAt: true },
    });

    if (!wallet) throw new NotFoundException('Wallet not found');

    return wallet;
  }

  /**
   * Thin balance-only endpoint for the UI. Returns numbers (not Decimal
   * strings) since the client renders currency from JS numbers.
   *
   * Only `balance` (= available) is the spend-now amount. `locked` covers
   * funds tied up in active matches or pending withdrawals.
   */
  async getBalance(userId: string): Promise<BalanceDto> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: { balanceAvailable: true, balanceLocked: true },
    });

    if (!wallet) throw new NotFoundException('Wallet not found');

    return {
      balance: Number(wallet.balanceAvailable),
      locked: Number(wallet.balanceLocked),
    };
  }

  async getTransactions(userId: string, limit: number, offset: number) {
    return this.prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        type: true,
        amount: true,
        status: true,
        createdAt: true,
        matchId: true,
      },
    });
  }

  // ── Public deposit (mock payment gateway) ─────────────────────────────────

  /**
   * Creates a PENDING deposit request. Does NOT touch balances.
   * A real payment gateway webhook would later call confirmDeposit().
   * Idempotent: same idempotencyKey always returns the same record.
   *
   * Returns a Pix BRCode (Copia-e-Cola) so the UI can display it for the
   * user to scan/paste. The code is fictitious sandbox data — no funds
   * will settle until a real gateway is wired to `confirmDeposit`.
   */
  async initiateDeposit(
    userId: string,
    amount: number,
    idempotencyKey: string,
  ): Promise<DepositIntent> {
    this.assertPositive(amount);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerified: true },
    });
    if (!user?.emailVerified) {
      throw new ForbiddenException('Email not verified. Verify your email before making deposits.');
    }

    await this.requireWalletDirect(userId);

    const existing = await this.prisma.transaction.findUnique({
      where: { idempotencyKey },
    });

    if (existing) {
      if (existing.userId !== userId) {
        // Idempotency key belongs to another user — hard rejection
        throw new ConflictException('Idempotency key already used');
      }

      return this.buildDepositIntent(existing, true);
    }

    try {
      const transaction = await this.prisma.transaction.create({
        data: {
          userId,
          type: TransactionType.DEPOSIT,
          amount,
          status: TransactionStatus.PENDING,
          idempotencyKey,
        },
      });

      return this.buildDepositIntent(transaction, false);
    } catch (e) {
      // Two concurrent requests with the same idempotencyKey both passed the
      // pre-check. The unique constraint caught the second one — return the
      // record created by the first request instead of propagating a 500.
      if (e instanceof PrismaClientKnownRequestError && e.code === 'P2002') {
        const raced = await this.prisma.transaction.findUnique({
          where: { idempotencyKey },
        });
        if (raced) {
          return this.buildDepositIntent(raced, true);
        }
      }
      throw e;
    }
  }

  private buildDepositIntent(
    tx: { id: string; amount: Decimal | number; createdAt: Date },
    alreadyExisted: boolean,
  ): DepositIntent {
    const amount = Number(tx.amount);
    const pixCode = generatePixCode({ amount, transactionId: tx.id });
    // Pix codes in Brazil typically expire after ~15 minutes. We base expiry
    // off the transaction's createdAt so repeated calls return the same
    // deadline, not a sliding window.
    const expiresAt = new Date(tx.createdAt.getTime() + 15 * 60 * 1000);

    return {
      transactionId: tx.id,
      amount,
      status: 'PENDING',
      message: alreadyExisted
        ? 'Deposit already initiated. Awaiting payment confirmation.'
        : 'Deposit initiated. Awaiting payment confirmation.',
      pixCode,
      expiresAt: expiresAt.toISOString(),
    };
  }

  // ── Public withdraw ───────────────────────────────────────────────────────

  /**
   * Requests a withdrawal.
   *
   * Flow (atomic):
   *   1. Verify the submitted CPF matches the one on file (anti-fraud).
   *   2. Verify available balance covers the requested amount.
   *   3. Move `amount` from `balanceAvailable` → `balanceLocked` so the
   *      user can't spend it elsewhere while the ops team processes.
   *   4. Create a PENDING `WITHDRAW` transaction.
   *
   * A real payment-ops worker would later call `confirmWithdraw()` (debit
   * locked + mark COMPLETED) or `rejectWithdraw()` (unlock + mark FAILED).
   * Both are left as follow-ups — this endpoint only creates the request.
   *
   * Idempotent on `idempotencyKey`.
   */
  async requestWithdraw(
    userId: string,
    amount: number,
    cpf: string,
    idempotencyKey: string,
  ): Promise<WithdrawIntent> {
    this.assertPositive(amount);

    // CPF comparison must be on normalized digits. The DTO already strips
    // non-digits, but we re-normalize defensively in case the service is
    // called from a context that bypassed validation (tests, internal code).
    const normalizedCpf = cpf.replace(/\D/g, '');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { cpf: true, emailVerified: true },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.emailVerified) {
      throw new ForbiddenException(
        'Email not verified. Verify your email before requesting withdrawals.',
      );
    }
    if (user.cpf !== normalizedCpf) {
      // Deliberately vague message so an attacker learns nothing from a
      // mismatch — but we use 401 (auth/identity failure) not 400.
      throw new UnauthorizedException('CPF does not match the account on file');
    }

    // Fast path for idempotent retry.
    const existing = await this.prisma.transaction.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      if (existing.userId !== userId) {
        throw new ConflictException('Idempotency key already used');
      }
      return {
        transactionId: existing.id,
        amount: Number(existing.amount),
        status: 'PENDING',
        message: 'Withdrawal already requested. Awaiting processing.',
      };
    }

    return this.prisma.$transaction(async (tx) => {
      const wallet = await this.requireWallet(tx, userId);
      const available = new Decimal(wallet.balanceAvailable);

      if (available.lessThan(amount)) {
        throw new BadRequestException('Insufficient available balance');
      }

      // Lock the funds so they can't be spent by a concurrent bet / another
      // withdraw request while ops processes this one.
      await tx.wallet.update({
        where: { userId },
        data: {
          balanceAvailable: available.minus(amount),
          balanceLocked: new Decimal(wallet.balanceLocked).plus(amount),
        },
      });

      try {
        const transaction = await tx.transaction.create({
          data: {
            userId,
            type: TransactionType.WITHDRAW,
            amount,
            status: TransactionStatus.PENDING,
            idempotencyKey,
          },
        });

        return {
          transactionId: transaction.id,
          amount,
          status: 'PENDING' as const,
          message: 'Withdrawal requested. Awaiting processing (up to 1 business day).',
        };
      } catch (e) {
        if (e instanceof PrismaClientKnownRequestError && e.code === 'P2002') {
          // Concurrent duplicate: someone else inside this Prisma $transaction
          // couldn't have raced (they'd block on the row lock), so this must
          // have been created between our pre-check and the lock — fetch it.
          const raced = await tx.transaction.findUnique({
            where: { idempotencyKey },
          });
          if (raced) {
            return {
              transactionId: raced.id,
              amount: Number(raced.amount),
              status: 'PENDING' as const,
              message: 'Withdrawal already requested. Awaiting processing.',
            };
          }
        }
        throw e;
      }
    });
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

      // Use the amount recorded in the DB — never trust the caller's value for
      // financial math. The caller's betAmount is validated only as a sanity check.
      const recordedBet = new Decimal(betRecord.amount);
      if (!recordedBet.equals(new Decimal(betAmount))) {
        throw new BadRequestException(
          `betAmount mismatch: recorded ${recordedBet}, received ${betAmount}`,
        );
      }

      const wallet = await this.requireWallet(tx, userId);
      const locked = new Decimal(wallet.balanceLocked);

      if (locked.lessThan(recordedBet)) {
        throw new BadRequestException(
          'Insufficient locked balance to settle match',
        );
      }

      // Consume the locked bet (always — win or loss)
      const newLocked = locked.minus(recordedBet);
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
          amount: recordedBet,
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
