// ─── Queue constants ──────────────────────────────────────────────────────────

export const MATCH_SETTLEMENT_QUEUE = 'match-settlement';
export const MATCH_SETTLEMENT_JOB   = 'process-match-result';

// ─── Job payload ──────────────────────────────────────────────────────────────

/**
 * Data persisted in Redis for each settlement job.
 * All fields are serialisable scalars — no Decimal or Date objects.
 */
export interface MatchSettlementJobData {
  userId:     string;
  matchId:    string;
  betAmount:  number;
  payout:     number;
  finalMass?: number;
}
