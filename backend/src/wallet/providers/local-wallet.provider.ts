import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { WalletService } from '../wallet.service';
import {
  IWalletProvider,
  LockFundsResult,
  ProviderContext,
  TransferResult,
  WalletBalance,
} from '../wallet-provider.interface';

/**
 * SPRINT 6 — Concrete implementation of {@link IWalletProvider} backed by
 * the in-house PostgreSQL schema.  This is a thin adapter over
 * {@link WalletService}: all ACID / idempotency semantics live in the
 * service, and this class only translates the abstract verbs into the
 * corresponding service methods.
 *
 * When the team migrates to PrimeHub, a sibling
 * `PrimeHubWalletProvider` will implement the same interface by calling
 * the external HTTP API — game code will not need to change because it
 * already depends on {@link IWalletProvider}.
 */
@Injectable()
export class LocalWalletProvider implements IWalletProvider {
  private readonly logger = new Logger(LocalWalletProvider.name);

  constructor(private readonly wallet: WalletService) {}

  async getBalance(userId: string): Promise<WalletBalance> {
    const bal = await this.wallet.getBalance(userId);
    return {
      available: new Decimal(bal.balance),
      locked:    new Decimal(bal.locked),
    };
  }

  async lockFunds(
    userId:    string,
    amount:    Decimal,
    reference: string,
    ctx?:      ProviderContext,
  ): Promise<LockFundsResult> {
    // `reference` == matchId in the current schema.  processBetEntry()
    // derives its own idempotency key (`bet:<matchId>:<userId>`) so a
    // retried call is a no-op.  Passing ipAddress enables the Sprint 6
    // collusion detector to record the client IP alongside the Match row.
    const bet = await this.wallet.processBetEntry(
      userId,
      Number(amount),
      reference,
      ctx?.mode,
      ctx?.ipAddress,
    );
    return { lockId: bet.id };
  }

  async releaseLock(
    userId:    string,
    reference: string,
    payout:    Decimal,
    rake:      Decimal,
  ): Promise<void> {
    const betAmount = payout.plus(rake);
    await this.wallet.processMatchResult(
      userId,
      reference,
      Number(betAmount),
      Number(payout),
    );
  }

  async transfer(
    fromUserId: string,
    toUserId:   string,
    amount:     Decimal,
    reason:     string,
  ): Promise<TransferResult> {
    // The local schema does not yet have a generic transfer primitive — this
    // is only used today by the marketplace flow, which has its own ACID
    // path.  Keeping the method here so provider signatures stay stable for
    // the PrimeHub migration; throwing until a first consumer materialises.
    this.logger.warn(
      `transfer() is not yet implemented in LocalWalletProvider ` +
      `(from=${fromUserId} to=${toUserId} amount=${amount} reason=${reason})`,
    );
    throw new Error('LocalWalletProvider.transfer() not implemented');
  }
}
