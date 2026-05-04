import { IsIn, IsNumber, IsOptional, IsPositive, IsString, IsUUID } from 'class-validator';

export class MatchEntryDto {
  @IsUUID()
  userId!: string;

  @IsNumber({ maxDecimalPlaces: 8 })
  @IsPositive()
  amount!: number;

  @IsString()
  matchId!: string;

  // SPRINT 3: game-server passes the mode so processBetEntry() stores it in the
  // Match lifecycle record (used later for ghost validation and mass audit).
  @IsOptional()
  @IsIn(['hunt-hunt', 'big-fish', 'private'])
  mode?: string;
}
