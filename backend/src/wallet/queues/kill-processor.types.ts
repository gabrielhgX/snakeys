export const KILL_PROCESSOR_QUEUE = 'kill-processor';
export const KILL_PROCESSOR_JOB   = 'process-kill-event';

/**
 * Payload persisted in Redis for each kill job.
 * `victimGrossPot` is the victim's accumulated pot at the moment of death,
 * as tracked by the game-server's in-memory `PlayerState.accumulatedPot`.
 */
export interface KillProcessorJobData {
  matchId:        string;
  killerId:       string;
  victimId:       string;
  victimGrossPot: number;
  rakeRate:       number;  // house cut fraction (canonical: 0.10)
}
