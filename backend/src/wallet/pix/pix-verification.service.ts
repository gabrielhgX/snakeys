import { Injectable, Logger } from '@nestjs/common';
import { PixGatewayService } from './pix-gateway.service';

export type PixOwnershipFailureReason =
  | 'PIX_KEY_NOT_FOUND'
  | 'CPF_MISMATCH';

export type PixOwnershipResult =
  | { verified: true;  ownerName: string; ownerTaxId: string }
  | { verified: false; reason: PixOwnershipFailureReason };

/**
 * SPRINT 6 — Cross-validates that the Pix key supplied on a withdraw
 * belongs to the CPF on file for the requesting user.
 *
 * This is item 5 of the Auditoria de Segurança: without this guard, any
 * authenticated user could request a withdrawal to a third-party Pix key
 * (e.g. a money-mule account) and drain funds out of the platform.
 *
 * The service is intentionally provider-agnostic — it talks to the
 * abstract {@link PixGatewayService}, which will be swapped for the real
 * DICT/Celcoin adapter when that contract ships.  The comparison is done
 * on digits-only CPF strings to tolerate masked inputs (`123.456.789-09`).
 */
@Injectable()
export class PixVerificationService {
  private readonly logger = new Logger(PixVerificationService.name);

  constructor(private readonly gateway: PixGatewayService) {}

  async verifyPixOwnership(
    pixKey:      string,
    expectedCpf: string,
  ): Promise<PixOwnershipResult> {
    const ownerInfo = await this.gateway.resolveKey(pixKey);

    if (!ownerInfo) {
      this.logger.warn(
        `[AUDIT] PIX_KEY_NOT_FOUND pixKey=${this.redact(pixKey)} ` +
        `expectedCpf=${this.redact(expectedCpf)}`,
      );
      return { verified: false, reason: 'PIX_KEY_NOT_FOUND' };
    }

    const normalizedExpected = expectedCpf.replace(/\D/g, '');
    const normalizedActual   = ownerInfo.ownerTaxId.replace(/\D/g, '');

    if (normalizedExpected !== normalizedActual) {
      this.logger.warn(
        `[AUDIT] PIX_CPF_MISMATCH pixKey=${this.redact(pixKey)} ` +
        `expectedCpf=${this.redact(normalizedExpected)} ` +
        `actualCpf=${this.redact(normalizedActual)}`,
      );
      return { verified: false, reason: 'CPF_MISMATCH' };
    }

    return {
      verified:   true,
      ownerName:  ownerInfo.ownerName,
      ownerTaxId: normalizedActual,
    };
  }

  /** Masks CPF / Pix key values for structured logs (LGPD). */
  private redact(value: string): string {
    if (!value) return '';
    if (value.length <= 4) return '***';
    return `${value.slice(0, 3)}***${value.slice(-2)}`;
  }
}
