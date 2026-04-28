import { IsNumber, IsPositive, IsUUID, Max } from 'class-validator';

export class CreateListingDto {
  @IsUUID()
  userItemId: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(99_999)
  price: number;
}
