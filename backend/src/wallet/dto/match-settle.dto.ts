import { IsNumber, IsString, IsUUID, Min } from 'class-validator';

/**
 * Body for `POST /wallet/match/settle`.
 *
 * `matchId` references the BET transaction created by `match/entry`.
 * `payout` is the client-claimed winnings; the server caps it against
 * the original bet × MAX_PAYOUT_MULT to bound damage from a compromised
 * client. Real production needs an authoritative game server replacing
 * this client-driven flow.
 */
export class MatchSettleDto {
  @IsString()
  @IsUUID('4', { message: 'matchId must be a UUID v4' })
  matchId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'payout cannot be negative' })
  payout!: number;
}
