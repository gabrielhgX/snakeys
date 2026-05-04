import { Injectable, Logger } from '@nestjs/common';

/**
 * Owner information returned by a Pix gateway "resolve key" call.
 * Mirrors the minimum subset that every Brazilian provider
 * (Celcoin / Juno / Gerencianet / BancoCentral DICT) exposes.
 */
export interface PixOwnerInfo {
  /** The Pix key that was queried (echoed back, normalized). */
  pixKey:      string;
  /** CPF (individual) or CNPJ (entity) of the key holder — digits only. */
  ownerTaxId:  string;
  /** Masked legal name as returned by DICT ("João da S*** S***"). */
  ownerName:   string;
  /** Institution ISPB code — useful for audit logs. */
  bankIspb?:   string;
}

/**
 * SPRINT 6 — Mock Pix key resolver.
 *
 * Plays the role of the real DICT / gateway integration until we sign a
 * contract with Celcoin (or similar).  The mock is deterministic so that
 * automated tests can verify both the "match" and "mismatch" branches of
 * {@link PixVerificationService.verifyPixOwnership} without any network
 * flake.
 *
 * Deterministic rules:
 *   • If the key is an 11-digit CPF string, the resolver reports that
 *     exact CPF as the owner's tax id (simulates "CPF key = own CPF").
 *   • If the key starts with `other:` (e.g. `other:12345678909`), the
 *     resolver reports the CPF after the colon as the owner.  This lets
 *     tests model the dangerous "Pix key belongs to a third party" case.
 *   • If the key is `unknown`, the resolver returns `null` so the caller
 *     surfaces `PIX_KEY_NOT_FOUND`.
 *   • Anything else is treated as a legitimate key owned by the caller
 *     (the service layer still enforces CPF equality).
 */
@Injectable()
export class PixGatewayService {
  private readonly logger = new Logger(PixGatewayService.name);

  async resolveKey(pixKey: string): Promise<PixOwnerInfo | null> {
    const normalized = pixKey.trim();
    this.logger.debug(`Resolving Pix key (mock): ${normalized}`);

    if (normalized === 'unknown') return null;

    if (normalized.startsWith('other:')) {
      const foreignCpf = normalized.slice('other:'.length).replace(/\D/g, '');
      return {
        pixKey:     normalized,
        ownerTaxId: foreignCpf,
        ownerName:  'Terceiro Desconhecido',
        bankIspb:   '00000000',
      };
    }

    const digits = normalized.replace(/\D/g, '');
    if (digits.length === 11) {
      // CPF key: the gateway reports the CPF itself as the owner.
      return {
        pixKey:     normalized,
        ownerTaxId: digits,
        ownerName:  'Titular da Chave',
        bankIspb:   '60701190',
      };
    }

    // Catch-all: email/phone/random — in the mock we treat the caller as
    // the owner.  Production code will receive a real ownerTaxId from the
    // gateway and the CPF comparison in PixVerificationService is the
    // actual security guard.
    return {
      pixKey:     normalized,
      ownerTaxId: digits,
      ownerName:  'Titular da Chave',
      bankIspb:   '60701190',
    };
  }
}
