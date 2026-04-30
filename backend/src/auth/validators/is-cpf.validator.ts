import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * Validates a Brazilian CPF number.
 *
 * Accepts either the masked form (`123.456.789-09`) or digits only
 * (`12345678909`). The value is stripped of non-digits before the check,
 * then the standard two-check-digit algorithm is applied.
 *
 * NOTE: when used together with a `@Transform` that normalizes the value
 * to digits only, the stored form will already be 11 numeric characters.
 */
@ValidatorConstraint({ name: 'isCPF', async: false })
export class IsCPFConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;

    const cpf = value.replace(/\D/g, '');
    if (cpf.length !== 11) return false;

    // Reject well-known invalid sequences (all same digit).
    if (/^(\d)\1{10}$/.test(cpf)) return false;

    // First check digit.
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += parseInt(cpf[i], 10) * (10 - i);
    let digit1 = (sum * 10) % 11;
    if (digit1 === 10) digit1 = 0;
    if (digit1 !== parseInt(cpf[9], 10)) return false;

    // Second check digit.
    sum = 0;
    for (let i = 0; i < 10; i++) sum += parseInt(cpf[i], 10) * (11 - i);
    let digit2 = (sum * 10) % 11;
    if (digit2 === 10) digit2 = 0;
    if (digit2 !== parseInt(cpf[10], 10)) return false;

    return true;
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'CPF inválido';
  }
}

export function IsCPF(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsCPFConstraint,
    });
  };
}
