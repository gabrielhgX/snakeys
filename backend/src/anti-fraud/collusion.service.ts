import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { MatchStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface KillCollusionInput {
  matchId:  string;
  killerId: string;
  victimId: string;
}

export interface KillCollusionVerdict {
  score:       number;      // [0, 1]
  reasons:     string[];    // human-readable breakdown
  flagged:     boolean;     // score exceeded REVIEW_THRESHOLD
  sharedIp:    boolean;
  priorKills:  number;
}

// Risk aggregation knobs — tuned against the audit §3.5 reference model.
const WEIGHT_SHARED_IP        = 0.5;
const WEIGHT_REPEAT_KILL      = 0.4;   // cap across priorKills
const REPEAT_KILL_PER_EVENT   = 0.10;
const REVIEW_THRESHOLD        = 0.7;

/**
 * SPRINT 6 — Collusion Detection.
 *
 * Two-stage defence against pot-farming between alt accounts:
 *
 *   1. {@link assertNoIpCollision} — run at BET time to block the obvious
 *      case of two different userIds joining the SAME matchId from the
 *      SAME ipAddress.  This is a hard block (ForbiddenException) because
 *      a legitimate pair of users sharing a household NAT can play
 *      different matches without issue; entering the same room from a
 *      shared IP is the attack we want to kill outright.
 *
 *   2. {@link scoreKillCollusion} — run AFTER a kill is recorded.  Looks
 *      at historical signals (shared IP across matches, repeated
 *      killer→victim pattern) and emits a structured WARN audit log when
 *      the aggregated score crosses {@link REVIEW_THRESHOLD}.  No
 *      automatic payout retention yet — that's a business-policy decision
 *      for the ops team once the review pipeline lands.
 *
 * Both stages are side-effect-free on wallet balances: the detector only
 * OBSERVES and either rejects the entry (stage 1) or flags for manual
 * review (stage 2).  This keeps the module safely composable with the
 * ACID/idempotency machinery in WalletService.
 */
@Injectable()
export class CollusionService {
  private readonly logger = new Logger(CollusionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Rejects a bet entry if another ACTIVE participant in `matchId` is
   * already joined from the same IP address under a different userId.
   *
   * NOTE: local loopbacks and LAN ranges are intentionally NOT excluded —
   * dev environments should set `ipAddress` to a per-user fake value or
   * leave the parameter undefined (WalletService only runs the check when
   * ipAddress is truthy).
   */
  async assertNoIpCollision(
    userId:    string,
    matchId:   string,
    ipAddress: string,
  ): Promise<void> {
    const collision = await (this.prisma as any).match.findFirst({
      where: {
        matchId,
        ipAddress,
        userId: { not: userId },
        status: MatchStatus.ACTIVE,
      },
      select: { userId: true },
    });

    if (collision) {
      this.logger.warn(
        `[AUDIT] COLLUSION_IP_BLOCK matchId=${matchId} ` +
        `userA=${collision.userId} userB=${userId} ip=${ipAddress}`,
      );
      throw new ForbiddenException(
        'Outro jogador da mesma rede já está nesta partida. ' +
        'Por segurança, não é permitido que duas contas compartilhem ' +
        'IP na mesma mesa.',
      );
    }
  }

  /**
   * Post-kill risk score.  Combines:
   *   • Shared IP at BET time (weight 0.5)
   *   • Repeated killer→victim pattern across prior matches (up to 0.4)
   *
   * The audit log entry includes every contributing signal so a reviewer
   * can trace the decision without re-running the query.
   */
  async scoreKillCollusion(input: KillCollusionInput): Promise<KillCollusionVerdict> {
    const { matchId, killerId, victimId } = input;

    const participants: Array<{ userId: string; ipAddress: string | null }> =
      await (this.prisma as any).match.findMany({
        where:  { matchId, userId: { in: [killerId, victimId] } },
        select: { userId: true, ipAddress: true },
      });

    const killerIp = participants.find((p) => p.userId === killerId)?.ipAddress ?? null;
    const victimIp = participants.find((p) => p.userId === victimId)?.ipAddress ?? null;

    const sharedIp = !!killerIp && killerIp === victimIp;

    const priorKills = await (this.prisma as any).killEvent.count({
      where: {
        killerId,
        victimId,
        matchId: { not: matchId },
      },
    });

    const reasons: string[] = [];
    let score = 0;

    if (sharedIp) {
      score += WEIGHT_SHARED_IP;
      reasons.push(`shared_ip(${killerIp})`);
    }

    if (priorKills > 0) {
      const contribution = Math.min(
        WEIGHT_REPEAT_KILL,
        priorKills * REPEAT_KILL_PER_EVENT,
      );
      score += contribution;
      reasons.push(`prior_kills=${priorKills}(+${contribution.toFixed(2)})`);
    }

    score = Math.min(1, score);
    const flagged = score >= REVIEW_THRESHOLD;

    if (flagged) {
      this.logger.warn(
        `[AUDIT] COLLUSION_FLAG matchId=${matchId} ` +
        `killer=${killerId} victim=${victimId} ` +
        `score=${score.toFixed(2)} reasons=[${reasons.join(',')}]`,
      );
    } else if (reasons.length > 0) {
      this.logger.debug(
        `Collusion score below threshold for kill in match ${matchId}: ` +
        `score=${score.toFixed(2)} reasons=[${reasons.join(',')}]`,
      );
    }

    return {
      score,
      reasons,
      flagged,
      sharedIp,
      priorKills,
    };
  }
}
