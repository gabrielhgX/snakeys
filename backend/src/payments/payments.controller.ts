import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';
import { PaymentsService } from './payments.service';

@SkipThrottle()
@Controller('payments')
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Req() req: any, @Body() dto: PaymentWebhookDto) {
    // Signature must be verified before trusting the body
    this.paymentsService.assertValidSignature(
      req.rawBody as Buffer,
      req.headers['x-webhook-signature'] as string | undefined,
    );

    await this.paymentsService.processEvent(dto);

    return { received: true };
  }
}
