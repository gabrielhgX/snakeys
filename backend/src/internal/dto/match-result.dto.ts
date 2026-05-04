import { IsNumber, IsOptional, IsPositive, IsString, IsUUID, Min } from 'class-validator';

export class MatchResultDto {
  @IsUUID()
  userId!: string;

  @IsString()
  matchId!: string;

  @IsNumber({ maxDecimalPlaces: 8 })
  @IsPositive()
  betAmount!: number;

  // 0 = full loss; >0 = total payout (bet returned + profit)
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(0)
  payout!: number;

  // SPRINT 3: server-authoritative final mass sent by the game-server.
  // Stored in Match.finalMass and compared against client-reported
  // stats.massIngested in settleMatchForUser() to detect spoofing.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  finalMass?: number;
}
