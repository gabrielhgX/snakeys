import { IsNumber, IsPositive, IsString, IsUUID, Min } from 'class-validator';

export class MatchResultDto {
  @IsUUID()
  userId: string;

  @IsString()
  matchId: string;

  @IsNumber({ maxDecimalPlaces: 8 })
  @IsPositive()
  betAmount: number;

  // 0 = full loss; >0 = total payout (bet returned + profit)
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(0)
  payout: number;
}
