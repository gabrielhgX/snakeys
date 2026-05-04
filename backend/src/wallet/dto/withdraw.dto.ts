import { Transform } from 'class-transformer';
import { IsNumber, IsPositive, IsString, IsUUID, Length, Min } from 'class-validator';
import { IsCPF } from '../../auth/validators/is-cpf.validator';

export class WithdrawDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Min(1, { message: 'Valor mínimo de saque é R$ 1,00' })
  amount: number;

  /**
   * Pix key the user wants to receive the payout on.  The backend calls
   * {@link PixVerificationService.verifyPixOwnership} before locking any
   * funds: the resolved CPF of the key MUST match the CPF on file
   * (Sprint 6, Audit item 5).  Client may send CPF / email / phone /
   * random — all go through the gateway resolver.
   */
  @IsString()
  @Length(1, 128)
  pixKey: string;

  /**
   * CPF is required on every withdraw as a re-confirmation of identity. The
   * service layer compares this value against the CPF on file — a mismatch
   * aborts the withdrawal (anti-fraud guard).
   *
   * Client may send either masked or digits-only; we normalize before
   * validation so both `123.456.789-09` and `12345678909` are accepted.
   */
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/\D/g, '') : value,
  )
  @IsCPF()
  cpf: string;

  /** Client-generated UUID for idempotent retries of the same withdraw. */
  @IsString()
  @IsUUID()
  idempotencyKey: string;
}
