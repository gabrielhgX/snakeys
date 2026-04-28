import { IsEmail, IsStrongPassword, MaxLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  // bcrypt silently truncates at 72 bytes — MaxLength prevents the misleading
  // "password accepted" on strings that won't be fully hashed.
  @MaxLength(72)
  @IsStrongPassword({ minLength: 8, minLowercase: 1, minUppercase: 1, minNumbers: 1, minSymbols: 0 })
  password: string;
}
