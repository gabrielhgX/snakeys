import { IsInt, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

/**
 * Body for `POST /wallet/match/settle`.
 *
 * `matchId` references the BET transaction created by `match/entry`.
 * `payout` is the client-claimed winnings; the server caps it against
 * the original bet × MAX_PAYOUT_MULT to bound damage from a compromised
 * client. Real production needs an authoritative game server replacing
 * this client-driven flow.
 *
 * `massIngested` + `kills` drive progression XP (1 XP / 10 mass, 50 XP /
 * kill). Both are optional so older clients without the progression
 * wiring still get their wallets settled — they just don't receive XP.
 * Server caps both to prevent a compromised client from dumping huge
 * XP values (`progression.constants.ts` MAX_*_PER_MATCH).
 */
export class MatchSettleDto {
  @IsString()
  @IsUUID('4', { message: 'matchId must be a UUID v4' })
  matchId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'payout cannot be negative' })
  payout!: number;

  @IsOptional()
  @IsInt({ message: 'massIngested must be an integer' })
  @Min(0)
  massIngested?: number;

  @IsOptional()
  @IsInt({ message: 'kills must be an integer' })
  @Min(0)
  kills?: number;
}
