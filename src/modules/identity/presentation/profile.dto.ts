import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  AccountType,
  Gender,
  KycStatus,
  Language,
  UserRole,
} from '../../../generated/prisma/enums.js';
import { AddressView } from '../../../shared/http/address.dto.js';

/** Sign-up step 1, after the Supabase account exists. */
export class CreateProfileDto {
  @ApiProperty({ enum: AccountType })
  @IsEnum(AccountType)
  accountType: AccountType;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName: string;

  @ValidateIf((o: CreateProfileDto) => o.accountType === 'COMPANY')
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  companyName?: string;
}

/** Sign-up step 2 ("About you") and later profile edits. */
export class UpdateProfileDto extends PartialType(CreateProfileDto) {
  @ApiProperty({ enum: Gender, required: false })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  /** Day and month only; the design deliberately doesn't ask for the year. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  birthDay?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  birthMonth?: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  nationality?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  countryOfResidence?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  occupation?: string;

  @ApiProperty({ enum: Language, isArray: true, required: false })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(Language, { each: true })
  preferredLanguages?: Language[];

  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;
}

export class ProfileView {
  @ApiProperty({ enum: UserRole })
  role: UserRole;
  @ApiProperty({ enum: AccountType })
  accountType: AccountType;
  fullName: string;
  companyName: string | null;
  @ApiProperty({ enum: Gender, nullable: true })
  gender: Gender | null;
  birthDay: number | null;
  birthMonth: number | null;
  nationality: string | null;
  countryOfResidence: string | null;
  occupation: string | null;
  @ApiProperty({ enum: Language, isArray: true })
  preferredLanguages: Language[];
  @ApiProperty({ enum: KycStatus })
  kycStatus: KycStatus;
  pushEnabled: boolean;
}

export class MeView {
  id: string;
  email: string | null;
  phone: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  /** False until the client has created their profile (sign-up step 1). */
  onboarded: boolean;
  profile: ProfileView | null;
  homeAddress: AddressView | null;
}
