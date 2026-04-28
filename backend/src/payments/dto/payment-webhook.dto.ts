import { IsIn, IsNumber, IsPositive, IsString, IsUUID } from 'class-validator';

export class PaymentWebhookDto {
  @IsIn(['payment.confirmed', 'payment.failed'])
  event: 'payment.confirmed' | 'payment.failed';

  // Our internal transactionId created by initiateDeposit
  @IsUUID()
  transactionId: string;

  // Gateway's own reference for the payment
  @IsString()
  externalId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @IsIn(['BRL'])
  currency: string;
}
