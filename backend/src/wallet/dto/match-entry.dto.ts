import { IsIn, IsNumber, IsPositive, Max, Min } from 'class-validator';

/**
 * Body for `POST /wallet/match/entry`.
 *
 * `mode` is validated against the public mode keys so an attacker can't
 * register a match against an unknown game mode and then dispute it.
 *
 * `amount` is the entry fee — capped server-side to defend against
 * accidentally posting an absurd value (e.g. UI bug). The minimum keeps
 * the table clean of zero-value rooms.
 */
export class MatchEntryDto {
  @IsIn(['hunt-hunt', 'big-fish', 'private'], {
    message: 'mode must be one of: hunt-hunt, big-fish, private',
  })
  mode!: 'hunt-hunt' | 'big-fish' | 'private';

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Min(1, { message: 'amount must be at least R$ 1.00' })
  @Max(1000, { message: 'amount cannot exceed R$ 1000.00' })
  amount!: number;
}
