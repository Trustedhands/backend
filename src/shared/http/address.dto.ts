import {
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class AddressDto {
  /** e.g. Gasabo */
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  district: string;

  /** e.g. Kacyiru */
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  sector: string;

  /** Street, house number or landmark */
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  street: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;
}

export class AddressView {
  district: string;
  sector: string;
  street: string;
  latitude: number | null;
  longitude: number | null;
}
