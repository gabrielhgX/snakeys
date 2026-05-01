/**
 * Pix BRCode (Copia-e-Cola) generator — EMVCo QR Code format.
 *
 * Spec: https://www.bcb.gov.br/estabilidadefinanceira/spb_pix
 *
 * NOTE: this produces a **structurally valid** Pix payload (correct field
 * layout + CRC16). It is *fictitious* for dev/sandbox — the Pix key belongs
 * to no real merchant, so no funds can actually move until a real gateway
 * (Efí, Pagar.me, Mercado Pago, etc.) is integrated in `confirmDeposit`.
 */

// ── Config (dev sandbox) ─────────────────────────────────────────────────────
const MERCHANT_NAME = 'SNAKEYS PRIME ASSETS'; // max 25
const MERCHANT_CITY = 'SAO PAULO'; // max 15
const PIX_KEY = 'pay-sandbox@snakeys.gg'; // fictitious email-type Pix key

// ── Helpers ──────────────────────────────────────────────────────────────────

/** EMV TLV: `IDLLValue` where LL is length zero-padded to 2. */
function tlv(id: string, value: string): string {
  const length = value.length.toString().padStart(2, '0');
  return `${id}${length}${value}`;
}

/**
 * CRC16-CCITT/FALSE — polynomial 0x1021, initial 0xFFFF, no reflect, no xorout.
 * Returns a 4-char uppercase hex string.
 */
function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** ASCII-only, uppercase, alphanumeric, max 25 chars. EMV txid subfield. */
function sanitizeTxid(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 25)
    .padEnd(3, 'X'); // EMV requires at least 1 char; pad defensively
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface GeneratePixCodeParams {
  amount: number; // BRL
  transactionId: string; // used as txid (sanitized)
}

/**
 * Generates the Pix Copia-e-Cola string. The output can be pasted into any
 * Pix-enabled bank app; it will show the merchant/amount but — being a
 * sandbox key — the payment will not settle.
 */
export function generatePixCode({
  amount,
  transactionId,
}: GeneratePixCodeParams): string {
  if (!(amount > 0)) {
    throw new Error('Pix amount must be > 0');
  }

  // Merchant Account Information (ID 26) — Pix
  const merchantAccountInfo =
    tlv('00', 'BR.GOV.BCB.PIX') + tlv('01', PIX_KEY);

  // Additional Data Field Template (ID 62) — txid
  const additionalData = tlv('05', sanitizeTxid(transactionId));

  // Build the payload up to (but not including) the CRC field.
  const payloadNoCrc =
    tlv('00', '01') + // Payload Format Indicator
    tlv('26', merchantAccountInfo) + // Merchant Account Info (Pix)
    tlv('52', '0000') + // Merchant Category Code (generic)
    tlv('53', '986') + // Transaction Currency: BRL
    tlv('54', amount.toFixed(2)) + // Transaction Amount
    tlv('58', 'BR') + // Country
    tlv('59', MERCHANT_NAME.slice(0, 25)) +
    tlv('60', MERCHANT_CITY.slice(0, 15)) +
    tlv('62', additionalData) +
    '6304'; // CRC placeholder: ID 63, length 04

  const checksum = crc16(payloadNoCrc);
  return payloadNoCrc + checksum;
}
