import { Decimal } from '@prisma/client/runtime/library';

/**
 * SPRINT 6 — Wallet abstraction layer.
 *
 * Game / match code MUST depend on this interface (injected via the
 * {@link WALLET_PROVIDER} token), never on WalletService directly.  This lets
 * us swap the concrete implementation between:
 *
 *   • LocalWalletProvider    — current PostgreSQL-backed Wallet module
 *                              (delegates to WalletService under the hood).
 *   • PrimeHubWalletProvider — future gateway-backed implementation that
 *                              will be introduced when we migrate to the
 *                              PrimeHub cassino platform.
 *
 * The boundary intentionally exposes only the high-level financial verbs
 * that every provider must support (balance, lock, release, transfer) and
 * hides the per-backend ACID / idempotency machinery.
 */

export interface WalletBalance {
  /** Funds immediately available to spend. */
  available: Decimal;
  /** Funds reserved in active bets or pending withdrawals. */
  locked:    Decimal;
}

export interface LockFundsResult {
  /** Opaque handle the caller uses to release the lock later. */
  lockId: string;
}

export interface TransferResult {
  /** Provider-scoped transaction id for audit/support traceability. */
  txId: string;
}

/**
 * Optional context forwarded by callers that want to enrich the provider
 * with anti-fraud / audit metadata (e.g. the client IP at bet time).
 *
 * Providers that don't consume it should simply ignore the extra fields.
 */
export interface ProviderContext {
  ipAddress?: string;
  mode?:      string;
}

export interface IWalletProvider {
  /** Current balance snapshot for a user. */
  getBalance(userId: string): Promise<WalletBalance>;

  /**
   * Atomically moves `amount` from `available` → `locked` for `userId`.
   * `reference` is the business-level key (matchId, withdrawal id, …) and
   * also serves as the idempotency key for retries of the same operation.
   */
  lockFunds(
    userId:    string,
    amount:    Decimal,
    reference: string,
    ctx?:      ProviderContext,
  ): Promise<LockFundsResult>;

  /**
   * Releases a previously-locked amount, paying `payout` back to
   * `available` and booking `rake` as house fee.  (payout + rake) must
   * equal the original lock amount.  Idempotent on the derived
   * (userId, reference) pair — safe to call twice after a retry.
   */
  releaseLock(
    userId:    string,
    reference: string,
    payout:    Decimal,
    rake:      Decimal,
  ): Promise<void>;

  /** Direct user-to-user transfer (marketplace, gifting, admin tools). */
  transfer(
    fromUserId: string,
    toUserId:   string,
    amount:     Decimal,
    reason:     string,
  ): Promise<TransferResult>;
}

/**
 * Nest DI token for the wallet provider.  Do NOT inject
 * {@link IWalletProvider} directly — TypeScript interfaces are erased at
 * runtime, so use `@Inject(WALLET_PROVIDER)` instead.
 */
export const WALLET_PROVIDER = Symbol('WALLET_PROVIDER');
