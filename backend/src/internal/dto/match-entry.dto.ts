import { IsNumber, IsPositive, IsString, IsUUID } from 'class-validator';

export class MatchEntryDto {
  @IsUUID()
  userId: string;

  @IsNumber({ maxDecimalPlaces: 8 })
  @IsPositive()
  amount: number;

  @IsString()
  matchId: string;
}
