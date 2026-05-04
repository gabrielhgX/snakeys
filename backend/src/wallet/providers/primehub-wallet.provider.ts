import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import {
  IWalletProvider,
  LockFundsResult,
  ProviderContext,
  TransferResult,
  WalletBalance,
} from '../wallet-provider.interface';

/**
 * SPRINT 6 — Stub implementation for the future PrimeHub wallet gateway.
 *
 * This class exists only to validate that the abstraction compiles and
 * can be wired via the `USE_PRIMEHUB_WALLET=true` feature flag.  All
 * methods throw `ServiceUnavailableException` until the real HTTP
 * integration is specified — that contract will arrive with the PrimeHub
 * SDK and is out of scope for Sprint 6.
 */
@Injectable()
export class PrimeHubWalletProvider implements IWalletProvider {
  private readonly logger = new Logger(PrimeHubWalletProvider.name);

  private notImplemented(op: string): never {
    this.logger.error(`PrimeHub provider called for ${op}, but no SDK bound yet.`);
    throw new ServiceUnavailableException(
      `PrimeHub wallet provider is not yet available (op=${op}). ` +
      `Set USE_PRIMEHUB_WALLET=false until the integration ships.`,
    );
  }

  getBalance(_userId: string): Promise<WalletBalance> {
    return this.notImplemented('getBalance');
  }

  lockFunds(
    _userId:    string,
    _amount:    Decimal,
    _reference: string,
    _ctx?:      ProviderContext,
  ): Promise<LockFundsResult> {
    return this.notImplemented('lockFunds');
  }

  releaseLock(
    _userId:    string,
    _reference: string,
    _payout:    Decimal,
    _rake:      Decimal,
  ): Promise<void> {
    return this.notImplemented('releaseLock');
  }

  transfer(
    _fromUserId: string,
    _toUserId:   string,
    _amount:     Decimal,
    _reason:     string,
  ): Promise<TransferResult> {
    return this.notImplemented('transfer');
  }
}
