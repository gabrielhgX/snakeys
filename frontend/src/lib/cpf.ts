/**
 * CPF helpers — mask, strip and validation using the official algorithm.
 * Must stay in sync with `backend/src/auth/validators/is-cpf.validator.ts`.
 */

/** Returns digits only (max 11). */
export function stripCPF(value: string): string {
  return value.replace(/\D/g, '').slice(0, 11);
}

/** Formats as `000.000.000-00`, progressively (safe for use in onChange). */
export function formatCPF(value: string): string {
  const d = stripCPF(value);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** Full CPF validation: 11 digits, not all-same, valid check digits. */
export function isValidCPF(value: string): boolean {
  const cpf = stripCPF(value);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf[i], 10) * (10 - i);
  let d1 = (sum * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== parseInt(cpf[9], 10)) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf[i], 10) * (11 - i);
  let d2 = (sum * 10) % 11;
  if (d2 === 10) d2 = 0;
  if (d2 !== parseInt(cpf[10], 10)) return false;

  return true;
}
