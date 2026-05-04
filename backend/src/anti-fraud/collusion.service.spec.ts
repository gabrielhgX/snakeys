import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { MatchStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CollusionService } from './collusion.service';

/**
 * Tests the two collusion detection stages:
 *   1. assertNoIpCollision — hard block at BET time
 *   2. scoreKillCollusion  — post-kill risk score + audit flag
 */
describe('CollusionService', () => {
  let service: CollusionService;

  const mockPrisma = {
    match: {
      findFirst: jest.fn(),
      findMany:  jest.fn(),
    },
    killEvent: {
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CollusionService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get(CollusionService);
  });

  // ── assertNoIpCollision ────────────────────────────────────────────────────

  describe('assertNoIpCollision', () => {
    it('passes when no other participant shares the IP', async () => {
      mockPrisma.match.findFirst.mockResolvedValue(null);

      await expect(
        service.assertNoIpCollision('user-1', 'match-1', '1.2.3.4'),
      ).resolves.toBeUndefined();

      expect(mockPrisma.match.findFirst).toHaveBeenCalledWith({
        where: {
          matchId:   'match-1',
          ipAddress: '1.2.3.4',
          userId:    { not: 'user-1' },
          status:    MatchStatus.ACTIVE,
        },
        select: { userId: true },
      });
    });

    it('throws ForbiddenException when another user on the same IP is already in the match', async () => {
      mockPrisma.match.findFirst.mockResolvedValue({ userId: 'alt-user' });

      await expect(
        service.assertNoIpCollision('user-1', 'match-1', '1.2.3.4'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── scoreKillCollusion ─────────────────────────────────────────────────────

  describe('scoreKillCollusion', () => {
    it('scores 0 and does not flag when IPs differ and there is no prior kill history', async () => {
      mockPrisma.match.findMany.mockResolvedValue([
        { userId: 'killer-1', ipAddress: '1.1.1.1' },
        { userId: 'victim-1', ipAddress: '2.2.2.2' },
      ]);
      mockPrisma.killEvent.count.mockResolvedValue(0);

      const verdict = await service.scoreKillCollusion({
        matchId: 'match-1', killerId: 'killer-1', victimId: 'victim-1',
      });

      expect(verdict.flagged).toBe(false);
      expect(verdict.score).toBe(0);
      expect(verdict.sharedIp).toBe(false);
    });

    it('flags when IPs match AND prior kills exist (score >= 0.7)', async () => {
      mockPrisma.match.findMany.mockResolvedValue([
        { userId: 'killer-1', ipAddress: '9.9.9.9' },
        { userId: 'victim-1', ipAddress: '9.9.9.9' },
      ]);
      mockPrisma.killEvent.count.mockResolvedValue(3); // +0.30

      const verdict = await service.scoreKillCollusion({
        matchId: 'match-1', killerId: 'killer-1', victimId: 'victim-1',
      });

      // 0.5 (shared IP) + 0.3 (3 * 0.1) = 0.8 → flagged
      expect(verdict.sharedIp).toBe(true);
      expect(verdict.priorKills).toBe(3);
      expect(verdict.score).toBeCloseTo(0.8, 2);
      expect(verdict.flagged).toBe(true);
    });

    it('caps the prior-kill contribution at 0.4', async () => {
      mockPrisma.match.findMany.mockResolvedValue([
        { userId: 'killer-1', ipAddress: null },
        { userId: 'victim-1', ipAddress: null },
      ]);
      mockPrisma.killEvent.count.mockResolvedValue(20); // would be 2.0 without cap

      const verdict = await service.scoreKillCollusion({
        matchId: 'match-1', killerId: 'killer-1', victimId: 'victim-1',
      });

      expect(verdict.score).toBeCloseTo(0.4, 2); // capped at WEIGHT_REPEAT_KILL
      expect(verdict.flagged).toBe(false);       // below 0.7 threshold
    });
  });
});
