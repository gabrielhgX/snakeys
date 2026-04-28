import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { WalletService } from '../wallet/wallet.service';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(private walletService: WalletService) {}

  verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    const secret = process.env.WEBHOOK_SECRET;
    if (!secret) return false;
    if (!signatureHeader) return false;

    // Format: "sha256=<hex_digest>"
    const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');

    try {
      const a = Buffer.from(signatureHeader);
      const b = Buffer.from(expected);
      if (a.length !== b.length) return false;
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  async processEvent(dto: PaymentWebhookDto): Promise<void> {
    if (dto.event === 'payment.confirmed') {
      await this.walletService.confirmDeposit(dto.transactionId);
      this.logger.log(
        `Deposit confirmed | txId=${dto.transactionId} | externalId=${dto.externalId} | amount=${dto.amount}`,
      );
    } else if (dto.event === 'payment.failed') {
      this.logger.warn(
        `Deposit failed | txId=${dto.transactionId} | externalId=${dto.externalId}`,
      );
      // Future: mark transaction as FAILED in DB
    }
  }

  assertValidSignature(rawBody: Buffer, signatureHeader: string | undefined): void {
    if (!this.verifySignature(rawBody, signatureHeader)) {
      throw new ForbiddenException('Invalid webhook signature');
    }
  }
}
