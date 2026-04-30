import { Transform } from 'class-transformer';
import { IsEmail, IsStrongPassword, MaxLength } from 'class-validator';
import { IsCPF } from '../validators/is-cpf.validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  // bcrypt silently truncates at 72 bytes — MaxLength prevents the misleading
  // "password accepted" on strings that won't be fully hashed.
  @MaxLength(72)
  @IsStrongPassword({ minLength: 8, minLowercase: 1, minUppercase: 1, minNumbers: 1, minSymbols: 0 })
  password: string;

  // Compliance: Brazilian CPF. We normalize to digits-only BEFORE validation,
  // so `@IsCPF` always sees an 11-char string and the stored form matches the
  // `@db.VarChar(11)` column defined in Prisma.
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/\D/g, '') : value,
  )
  @IsCPF()
  cpf: string;
}
