import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class KillEventDto {
  @IsString()
  matchId!: string;

  @IsUUID()
  killerId!: string;

  @IsUUID()
  victimId!: string;

  /** Victim's accumulated pot at time of death (original bet + absorbed kills). */
  @IsNumber({ maxDecimalPlaces: 8 })
  @Min(0)
  victimGrossPot!: number;

  /** House rake fraction.  Defaults to 0.10 (10%) if omitted. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  rakeRate?: number;
}
