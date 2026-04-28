import { IsUUID } from 'class-validator';

export class ConfirmDepositDto {
  @IsUUID()
  transactionId: string;
}
