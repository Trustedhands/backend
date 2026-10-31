import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ServiceFeeType } from '../../../generated/prisma/enums.js';

export const MATCHING_CRITERIA = [
  'AVAILABILITY',
  'LANGUAGE',
  'GENDER',
  'RATING',
  'DISTANCE',
] as const;
export type MatchingCriterion = (typeof MATCHING_CRITERIA)[number];

export class SettingsView {
  /** Added to the client price for one-time visits */
  serviceFeeRwf: number;
  /** One-off fee for long-term placements */
  matchFeeRwf: number;
  /** Worker share is released this long after the visit if the client hasn't confirmed */
  releaseAfterHours: number;
  @ApiProperty({ enum: MATCHING_CRITERIA, isArray: true })
  matchingPriority: MatchingCriterion[];
  /** MTN MoMo is the only payment method; turning it off pauses new payments */
  momoEnabled: boolean;
  clientWalletEnabled: boolean;
  vouchersEnabled: boolean;
  updatedAt: Date;
}

export class UpdateSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  serviceFeeRwf?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  matchFeeRwf?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  releaseAfterHours?: number;

  /** All five criteria, most important first */
  @ApiProperty({ enum: MATCHING_CRITERIA, isArray: true, required: false })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(MATCHING_CRITERIA, { each: true })
  matchingPriority?: MatchingCriterion[];

  @IsOptional()
  @IsBoolean()
  momoEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  clientWalletEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  vouchersEnabled?: boolean;
}

export class ServiceTypeView {
  key: string;
  label: string;
  pricingGuide: string | null;
  @ApiProperty({ enum: ServiceFeeType })
  feeType: ServiceFeeType;
  visible: boolean;
  sortOrder: number;
}

/** What the client app needs to offer a service. */
export class PublicServiceTypeView {
  key: string;
  label: string;
  @ApiProperty({ enum: ServiceFeeType })
  feeType: ServiceFeeType;
}

export class CreateServiceTypeDto {
  /** Stable identifier, e.g. GARDENING */
  @Matches(/^[A-Z][A-Z0-9_]{1,39}$/, {
    message: 'key must be UPPER_SNAKE_CASE',
  })
  key: string;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  label: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  pricingGuide?: string;

  @ApiProperty({ enum: ServiceFeeType })
  @IsEnum(ServiceFeeType)
  feeType: ServiceFeeType;

  @IsOptional()
  @IsBoolean()
  visible?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;
}

export class UpdateServiceTypeDto extends PartialType(CreateServiceTypeDto) {}
