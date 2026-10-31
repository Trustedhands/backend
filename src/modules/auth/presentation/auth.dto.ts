import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { AccountType } from '../../../generated/prisma/enums.js';

export class RegisterDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  /** At least 8 characters, with a number */
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  /** Rwandan mobile number, e.g. 078 123 4567 or +250781234567 */
  @IsString()
  @MaxLength(20)
  phone: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName: string;

  @ApiProperty({ enum: AccountType })
  @IsEnum(AccountType)
  accountType: AccountType;

  @ValidateIf((o: RegisterDto) => o.accountType === 'COMPANY')
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  companyName?: string;
}

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(128)
  password: string;
}

export class ChangePasswordDto {
  @IsString()
  @MaxLength(128)
  currentPassword: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @IsEmail()
  email: string;

  @Matches(/^\d{6}$/)
  code: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword: string;
}

export class VerifyCodeDto {
  /** The 6-digit code */
  @Matches(/^\d{6}$/)
  code: string;
}

export class SendPhoneCodeDto {
  /** Number to verify; defaults to the one given at sign-up */
  @IsOptional()
  @IsString()
  @Length(9, 20)
  phone?: string;
}

/** The refresh token is set as an httpOnly cookie, never returned in the body. */
export class AuthSessionView {
  accessToken: string;
  /** Seconds until the access token expires */
  expiresIn: number;
}
