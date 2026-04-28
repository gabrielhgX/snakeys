import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TransactionStatus, TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from './wallet.service';

// ─── Prisma mock helpers ───────────────────────────────────────────────────────

const mockTx = {
  wallet: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  transaction: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};

const mockPrisma = {
  user: { findUnique: jest.fn() },
  wallet: { findUnique: jest.fn() },
  transaction: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
  },
  $transaction: jest.fn().mockImplementation((fn: any) => fn(mockTx)),
};

// ─── Factory helpers ───────────────────────────────────────────────────────────

function makeWallet(overrides: Record<string, unknown> = {}) {
  return {
    balanceAvailable: '100',
    balanceLocked: '0',
    createdAt: new Date(),
    ...overrides,
  };
}

function makeTxRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx-1',
    userId: 'user-1',
    type: TransactionType.DEPOSIT,
    amount: '10',
    status: TransactionStatus.PENDING,
    matchId: null,
    idempotencyKey: 'key-1',
    createdAt: new Date(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WalletService', () => {
  let service: WalletService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(mockTx));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<WalletService>(WalletService);
  });

  // ── getWallet ──────────────────────────────────────────────────────────────

  describe('getWallet', () => {
    it('returns projected wallet fields', async () => {
      const wallet = makeWallet();
      mockPrisma.wallet.findUnique.mockResolvedValue(wallet);

      const result = await service.getWallet('user-1');

      expect(result).toEqual(wallet);
    });

    it('throws NotFoundException when wallet is missing', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue(null);

      await expect(service.getWallet('user-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ── initiateDeposit ────────────────────────────────────────────────────────

  describe('initiateDeposit', () => {
    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue({ emailVerified: true });
      mockPrisma.wallet.findUnique.mockResolvedValue(makeWallet());
      mockPrisma.transaction.findUnique.mockResolvedValue(null);
    });

    it('creates a PENDING deposit transaction', async () => {
      const tx = makeTxRecord();
      mockPrisma.transaction.create.mockResolvedValue(tx);

      const result = await service.initiateDeposit('user-1', 10, 'key-1');

      expect(result.status).toBe('PENDING');
      expect(result.transactionId).toBe('tx-1');
      expect(result.amount).toBe(10);
      expect(mockPrisma.transaction.create).toHaveBeenCalledTimes(1);
    });

    it('returns existing record on duplicate idempotency key (same user)', async () => {
      mockPrisma.transaction.findUnique.mockResolvedValue(makeTxRecord());

      const result = await service.initiateDeposit('user-1', 10, 'key-1');

      expect(result.transactionId).toBe('tx-1');
      expect(result.message).toContain('already initiated');
      expect(mockPrisma.transaction.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when idempotency key belongs to another user', async () => {
      mockPrisma.transaction.findUnique.mockResolvedValue(
        makeTxRecord({ userId: 'other-user' }),
      );

      await expect(
        service.initiateDeposit('user-1', 10, 'key-1'),
      ).rejects.toThrow('Idempotency key already used');
    });

    it('throws BadRequestException for non-positive amount', async () => {
      await expect(
        service.initiateDeposit('user-1', 0, 'key-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ForbiddenException when email is not verified', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ emailVerified: false });

      await expect(
        service.initiateDeposit('user-1', 10, 'key-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when user record is missing', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.initiateDeposit('user-1', 10, 'key-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── confirmDeposit ─────────────────────────────────────────────────────────

  describe('confirmDeposit', () => {
    it('credits balance for a PENDING deposit', async () => {
      mockTx.transaction.findUnique.mockResolvedValue(
        makeTxRecord({ status: TransactionStatus.PENDING }),
      );
      mockTx.wallet.findUnique.mockResolvedValue(makeWallet());
      mockTx.wallet.update.mockResolvedValue({});
      mockTx.transaction.update.mockResolvedValue({});

      await service.confirmDeposit('tx-1');

      expect(mockTx.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ balanceAvailable: expect.anything() }),
        }),
      );
    });

    it('is idempotent — skips update if deposit is already COMPLETED', async () => {
      mockTx.transaction.findUnique.mockResolvedValue(
        makeTxRecord({ status: TransactionStatus.COMPLETED }),
      );

      await service.confirmDeposit('tx-1');

      expect(mockTx.wallet.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for non-existent transaction', async () => {
      mockTx.transaction.findUnique.mockResolvedValue(null);

      await expect(service.confirmDeposit('tx-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ── processBetEntry ────────────────────────────────────────────────────────

  describe('processBetEntry', () => {
    it('locks balance and creates BET transaction', async () => {
      mockTx.transaction.findUnique.mockResolvedValue(null);
      mockTx.wallet.findUnique.mockResolvedValue(
        makeWallet({ balanceAvailable: '50', balanceLocked: '0' }),
      );
      mockTx.wallet.update.mockResolvedValue({});
      const bet = makeTxRecord({ type: TransactionType.BET, status: TransactionStatus.COMPLETED });
      mockTx.transaction.create.mockResolvedValue(bet);

      const result = await service.processBetEntry('user-1', 10, 'match-1');

      expect(mockTx.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            balanceLocked: expect.anything(),
            balanceAvailable: expect.anything(),
          }),
        }),
      );
      expect(result).toEqual(bet);
    });

    it('throws BadRequestException when balance is insufficient', async () => {
      mockTx.transaction.findUnique.mockResolvedValue(null);
      mockTx.wallet.findUnique.mockResolvedValue(
        makeWallet({ balanceAvailable: '5', balanceLocked: '0' }),
      );

      await expect(
        service.processBetEntry('user-1', 10, 'match-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns existing BET record on idempotent retry', async () => {
      const existing = makeTxRecord({ type: TransactionType.BET });
      mockTx.transaction.findUnique.mockResolvedValue(existing);

      const result = await service.processBetEntry('user-1', 10, 'match-1');

      expect(result).toEqual(existing);
      expect(mockTx.wallet.update).not.toHaveBeenCalled();
    });
  });

  // ── processMatchResult ─────────────────────────────────────────────────────

  describe('processMatchResult', () => {
    const betRecord = makeTxRecord({
      type: TransactionType.BET,
      amount: '10',
      status: TransactionStatus.COMPLETED,
    });

    beforeEach(() => {
      mockTx.transaction.findUnique.mockResolvedValue(null); // no fee record = not settled yet
      mockTx.transaction.findFirst.mockResolvedValue(betRecord);
      mockTx.wallet.findUnique.mockResolvedValue(
        makeWallet({ balanceAvailable: '40', balanceLocked: '10' }),
      );
      mockTx.wallet.update.mockResolvedValue({});
      mockTx.transaction.create.mockResolvedValue({});
    });

    it('settles a loss (payout=0): releases locked balance, records FEE only', async () => {
      const result = await service.processMatchResult('user-1', 'match-1', 10, 0);

      expect(result).toEqual({ settled: true, payout: 0 });
      expect(mockTx.transaction.create).toHaveBeenCalledTimes(1); // FEE only
    });

    it('settles a win: credits payout to available, records FEE + WIN', async () => {
      const result = await service.processMatchResult('user-1', 'match-1', 10, 15);

      expect(result).toEqual({ settled: true, payout: 15 });
      expect(mockTx.transaction.create).toHaveBeenCalledTimes(2); // FEE + WIN
    });

    it('throws BadRequestException when betAmount mismatches recorded bet', async () => {
      await expect(
        service.processMatchResult('user-1', 'match-1', 999, 0),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when user did not enter the match', async () => {
      mockTx.transaction.findFirst.mockResolvedValue(null);

      await expect(
        service.processMatchResult('user-1', 'match-1', 10, 0),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns alreadySettled on idempotent retry', async () => {
      mockTx.transaction.findUnique.mockResolvedValue(makeTxRecord()); // fee record exists

      const result = await service.processMatchResult('user-1', 'match-1', 10, 0);

      expect(result).toEqual({ alreadySettled: true });
      expect(mockTx.wallet.update).not.toHaveBeenCalled();
    });
  });
});
