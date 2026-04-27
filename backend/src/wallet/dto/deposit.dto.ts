import { IsNumber, IsPositive, IsString, IsUUID } from 'class-validator';

export class DepositDto {
  @IsNumber({ maxDecimalPlaces: 8 })
  @IsPositive()
  amount: number;

  // Client-generated UUID so the same request can be retried safely
  @IsString()
  @IsUUID()
  idempotencyKey: string;
}
