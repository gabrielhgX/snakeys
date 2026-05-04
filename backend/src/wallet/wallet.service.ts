import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { TransactionStatus, TransactionType } from '@prisma/client';
import { Decimal, PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../prisma/prisma.service';
import {
  MatchXpAward,
  ProgressionService,
} from '../progression/progression.service';
import { generatePixCode } from './pix-code.util';

// ─── Constants ───────────────────────────────────────────────────────────────

// Ghost-protection duration in Hunt-Hunt: 60 s from match start.
// A settlement with payout > 0 before this threshold is physically impossible
// (the snake can't accumulate kills during ghost), so we reject it server-side
// to close the client-bypass exploit documented in 01_AUDITORIA_SEGURANCA §1.3.
const HUNT_HUNT_GHOST_MS = 60_000;

// Hard floor on match duration regardless of mode.  Settling a match that
// lasted fewer than 10 seconds is a strong signal of a forged request.
const MIN_MATCH_DURATION_MS = 10_000;

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
  locked: number;  // balanceLocked (in active bets / pending withdraws)
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private prisma: PrismaService,
    private progression: ProgressionService,
  ) {}

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
      if (e instanceof PrismaClientKnownRequestError && e.code === 'P2002') {
        const raced = await this.prisma.transaction.findUnique({
          where: { idempotencyKey },
        });
        if (raced) return this.buildDepositIntent(raced, true);
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
   * SECURITY (Sprint 1 — Issue 1.2):
   * The wallet row is locked with SELECT FOR UPDATE at the start of the
   * transaction.  This serializes concurrent withdraw requests for the same
   * user: the second request blocks on the lock, then re-reads the balance
   * after the first commits — preventing the TOCTOU race where two threads
   * both pass the `available >= amount` check on a stale read.
   */
  async requestWithdraw(
    userId: string,
    amount: number,
    cpf: string,
    idempotencyKey: string,
  ): Promise<WithdrawIntent> {
    this.assertPositive(amount);

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
      throw new UnauthorizedException('CPF does not match the account on file');
    }

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
      // ── SPRINT 1 FIX (Issue 1.2): Lock wallet row before read ──────────
      // SELECT FOR UPDATE acquires a row-level write lock.  Any concurrent
      // transaction attempting to lock the same row will block here until
      // this transaction commits or rolls back, eliminating the TOCTOU race.
      const wallet = await this.lockWallet(tx, userId);

      if (wallet.balanceAvailable.lessThan(amount)) {
        throw new BadRequestException('Insufficient available balance');
      }

      await tx.wallet.update({
        where: { userId },
        data: {
          balanceAvailable: wallet.balanceAvailable.minus(amount),
          balanceLocked:    wallet.balanceLocked.plus(amount),
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
          const raced = await tx.transaction.findUnique({ where: { idempotencyKey } });
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

  // ── Dev-only: simulate payment gateway callback ───────────────────────────

  async simulateDepositConfirmationForUser(
    userId: string,
    transactionId: string,
  ): Promise<BalanceDto> {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      select: { userId: true, type: true, status: true },
    });

    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.userId !== userId) throw new NotFoundException('Transaction not found');
    if (tx.type !== TransactionType.DEPOSIT) {
      throw new BadRequestException('Transaction is not a deposit');
    }
    if (tx.status === TransactionStatus.FAILED) {
      throw new BadRequestException('Cannot simulate confirmation on a FAILED deposit');
    }

    await this.confirmDeposit(transactionId);
    return this.getBalance(userId);
  }

  // ── Internal: called by payment gateway webhook ────────────────────────────

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

      // Lock before crediting to prevent concurrent double-confirm races.
      const wallet = await this.lockWallet(tx, deposit.userId);

      await tx.wallet.update({
        where: { userId: deposit.userId },
        data: {
          balanceAvailable: wallet.balanceAvailable.plus(deposit.amount),
        },
      });

      await tx.transaction.update({
        where: { id: transactionId },
        data: { status: TransactionStatus.COMPLETED },
      });
    });
  }

  // ── Internal: called by game server ──────────────────────────────────────

  /**
   * Locks the bet amount for a match entry.
   *
   * SECURITY (Sprint 1 — Issue 1.2):
   * Uses lockWallet() (SELECT FOR UPDATE) to serialize concurrent bet
   * attempts for the same user, preventing double-lock of the same slot.
   *
   * @param mode  Stored in referenceId on the BET transaction so that
   *              settleMatchForUser() can enforce ghost-period rules without
   *              an extra lookup or a client-supplied (untrusted) parameter.
   */
  async processBetEntry(
    userId: string,
    amount: number,
    matchId: string,
    mode?: string,
  ) {
    this.assertPositive(amount);

    const idempotencyKey = `bet:${matchId}:${userId}`;

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.transaction.findUnique({
        where: { idempotencyKey },
      });
      if (existing) return existing;

      // ── SPRINT 1 FIX (Issue 1.2): Lock wallet before balance check ──────
      const wallet = await this.lockWallet(tx, userId);

      if (wallet.balanceAvailable.lessThan(amount)) {
        throw new BadRequestException('Insufficient available balance');
      }

      await tx.wallet.update({
        where: { userId },
        data: {
          balanceAvailable: wallet.balanceAvailable.minus(amount),
          balanceLocked:    wallet.balanceLocked.plus(amount),
        },
      });

      return tx.transaction.create({
        data: {
          userId,
          type:           TransactionType.BET,
          amount,
          matchId,
          idempotencyKey,
          referenceId:    mode ?? null,
          status:         TransactionStatus.COMPLETED,
        },
      });
    });
  }

  /**
   * Settles a match result for a user.
   *
   * SECURITY (Sprint 1 — Issue 1.1 — Double Settlement):
   * The PRIMARY idempotency guard is a MatchSettlement row inserted at the
   * top of the transaction BEFORE any wallet mutation.  PostgreSQL holds a
   * write-intent lock on the unique index (userId, matchId) from the moment
   * of INSERT.  A concurrent transaction attempting the same pair will:
   *   1. Block waiting for the lock
   *   2. After commit, fail with P2002 (unique violation)
   *   3. Return { alreadySettled: true } without touching the wallet
   *
   * The old feeKey uniqueness check on the Transaction table is kept as a
   * secondary belt-and-suspenders guard.
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
      // ── SPRINT 1 FIX (Issue 1.1): MatchSettlement atomic guard ──────────
      // First write in the transaction — acquires a lock on the unique index
      // entry so concurrent calls cannot race through to the wallet update.
      try {
        await (tx as any).matchSettlement.create({
          data: { userId, matchId, payout: new Decimal(payout) },
        });
      } catch (e) {
        if (e instanceof PrismaClientKnownRequestError && e.code === 'P2002') {
          return { alreadySettled: true };
        }
        throw e;
      }

      // Secondary guard on Transaction table.
      const existingFee = await tx.transaction.findUnique({
        where: { idempotencyKey: feeKey },
      });
      if (existingFee) return { alreadySettled: true };

      // Verify the user actually entered this match.
      const betRecord = await tx.transaction.findFirst({
        where: {
          userId,
          matchId,
          type:   TransactionType.BET,
          status: TransactionStatus.COMPLETED,
        },
      });

      if (!betRecord) {
        throw new BadRequestException('User did not participate in this match');
      }

      // Use the DB-recorded amount — never trust the caller for financial math.
      const recordedBet = new Decimal(betRecord.amount);
      if (!recordedBet.equals(new Decimal(betAmount))) {
        throw new BadRequestException(
          `betAmount mismatch: recorded ${recordedBet}, received ${betAmount}`,
        );
      }

      // ── SPRINT 1 FIX (Issue 1.2): Lock wallet before mutation ───────────
      const wallet = await this.lockWallet(tx, userId);

      if (wallet.balanceLocked.lessThan(recordedBet)) {
        throw new BadRequestException('Insufficient locked balance to settle match');
      }

      await tx.wallet.update({
        where: { userId },
        data: {
          balanceLocked:    wallet.balanceLocked.minus(recordedBet),
          balanceAvailable: wallet.balanceAvailable.plus(payout),
        },
      });

      await tx.transaction.create({
        data: {
          userId,
          type:           TransactionType.FEE,
          amount:         recordedBet,
          matchId,
          idempotencyKey: feeKey,
          status:         TransactionStatus.COMPLETED,
        },
      });

      if (payout > 0) {
        await tx.transaction.create({
          data: {
            userId,
            type:           TransactionType.WIN,
            amount:         payout,
            matchId,
            idempotencyKey: winKey,
            status:         TransactionStatus.COMPLETED,
          },
        });
      }

      return { settled: true, payout };
    });
  }

  // ── Public match flow (called by Lobby + game UI) ─────────────────────────

  /**
   * Allocates a new `matchId` and locks the entry fee for the user.
   * The matchId is always server-generated — clients cannot reuse old IDs.
   * The game mode is forwarded to processBetEntry() where it is stored in
   * the BET transaction's referenceId for later ghost-period validation.
   */
  async startMatchForUser(
    userId: string,
    mode: string,
    amount: number,
  ): Promise<{ matchId: string; balance: number; locked: number }> {
    this.assertPositive(amount);
    if (!['hunt-hunt', 'big-fish', 'private'].includes(mode)) {
      throw new BadRequestException(`Unknown match mode: ${mode}`);
    }

    const matchId = randomUUID();
    await this.processBetEntry(userId, amount, matchId, mode);
    const bal = await this.getBalance(userId);

    return { matchId, balance: bal.balance, locked: bal.locked };
  }

  /**
   * Settles a match for the user (client-driven path).
   *
   * SECURITY (Sprint 1 — Issue 1.3 — Ghost Period Validation):
   * The game mode is read from the BET transaction's referenceId (written
   * by startMatchForUser → processBetEntry at match start).  For hunt-hunt,
   * any settlement that claims payout > 0 within the first 60 seconds is
   * rejected: during ghost the snake cannot accumulate kills or pot, making
   * a positive payout physically impossible in a legitimate client.
   *
   * A hard floor of MIN_MATCH_DURATION_MS (10 s) blocks instant-settle
   * forgeries regardless of mode or payout value.
   */
  async settleMatchForUser(
    userId: string,
    matchId: string,
    payout: number,
    stats?: { massIngested?: number; kills?: number },
  ): Promise<{
    balance: number;
    locked: number;
    payout: number;
    xp: MatchXpAward | null;
  }> {
    if (payout < 0) throw new BadRequestException('payout cannot be negative');

    const bet = await this.prisma.transaction.findFirst({
      where: {
        userId,
        matchId,
        type:   TransactionType.BET,
        status: TransactionStatus.COMPLETED,
      },
      select: { amount: true, createdAt: true, referenceId: true },
    });
    if (!bet) {
      throw new BadRequestException('No active bet for this match');
    }

    const betAmount = Number(bet.amount);
    const elapsedMs = Date.now() - bet.createdAt.getTime();
    const matchMode = bet.referenceId; // 'hunt-hunt' | 'big-fish' | 'private' | null

    // ── SPRINT 1 FIX (Issue 1.3): Ghost-period and min-duration guards ───
    if (elapsedMs < MIN_MATCH_DURATION_MS) {
      throw new ForbiddenException(
        `Match ended too quickly — settlement rejected. ` +
        `Elapsed: ${elapsedMs}ms, minimum: ${MIN_MATCH_DURATION_MS}ms.`,
      );
    }

    if (matchMode === 'hunt-hunt' && elapsedMs < HUNT_HUNT_GHOST_MS && payout > 0) {
      // Ghost protection: snake is invulnerable AND cannot accumulate kills.
      // A positive payout within this window signals a tampered request.
      throw new ForbiddenException(
        `Cannot claim payout during Hunt-Hunt ghost protection ` +
        `(${HUNT_HUNT_GHOST_MS / 1000}s). ` +
        `Elapsed: ${Math.floor(elapsedMs / 1000)}s.`,
      );
    }
    // ─────────────────────────────────────────────────────────────────────

    const MAX_PAYOUT_MULT = 100;
    if (payout > betAmount * MAX_PAYOUT_MULT) {
      throw new BadRequestException(
        `Payout exceeds the maximum allowed (${MAX_PAYOUT_MULT}x bet)`,
      );
    }

    const settleResult = await this.processMatchResult(
      userId,
      matchId,
      betAmount,
      payout,
    );

    let xp: MatchXpAward | null = null;
    if ('settled' in settleResult && settleResult.settled) {
      try {
        xp = await this.progression.awardMatchXp(
          userId,
          stats?.massIngested ?? 0,
          stats?.kills ?? 0,
        );
      } catch (err) {
        this.logger.error(
          `XP award failed for user ${userId} match ${matchId}: ${(err as Error).message}`,
          (err as Error).stack,
        );
      }

      // Increment usageCount on equipped skin — fire-and-forget, non-critical.
      this.prisma.user
        .findUnique({ where: { id: userId }, select: { equippedSkinId: true } })
        .then((u) => {
          if (u?.equippedSkinId) {
            return this.prisma.userItem.update({
              where: { id: u.equippedSkinId },
              data: { usageCount: { increment: 1 } },
            });
          }
        })
        .catch((err) => {
          this.logger.warn(
            `usageCount increment failed for user ${userId}: ${(err as Error).message}`,
          );
        });
    }

    const bal = await this.getBalance(userId);
    return { balance: bal.balance, locked: bal.locked, payout, xp };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Acquires a PostgreSQL row-level write lock on the Wallet row and
   * returns the current balances as Decimal instances.
   *
   * USAGE: Call this as the FIRST operation inside a prisma.$transaction()
   * block whenever the subsequent code will read-then-update balances.
   *
   * WHY FOR UPDATE:
   *   At the default READ COMMITTED isolation, two concurrent transactions
   *   can both read the same stale balance before either writes.  SELECT
   *   FOR UPDATE forces the second transaction to wait at this line until
   *   the first commits, guaranteeing it reads the post-commit balance.
   *
   * The pg driver returns NUMERIC columns as strings; we wrap in Decimal to
   * preserve the full 18,8 precision without floating-point drift.
   */
  private async lockWallet(
    tx: any,
    userId: string,
  ): Promise<{ balanceAvailable: Decimal; balanceLocked: Decimal }> {
    const rows = await tx.$queryRaw<
      Array<{ balanceAvailable: string; balanceLocked: string }>
    >`
      SELECT "balanceAvailable", "balanceLocked"
      FROM   "Wallet"
      WHERE  "userId" = ${userId}
      FOR UPDATE
    `;

    if (rows.length === 0) throw new NotFoundException('Wallet not found');

    return {
      balanceAvailable: new Decimal(rows[0].balanceAvailable),
      balanceLocked:    new Decimal(rows[0].balanceLocked),
    };
  }

  /** Read-only wallet fetch — use only for non-mutating checks. */
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
