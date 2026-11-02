import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AddressDto } from '../../../shared/http/address.dto.js';
import {
  GenderPreference,
  HOME_AREAS,
  HOME_TYPES,
  type HomeArea,
  type HomeType,
  Language,
  ServiceRequestStatus,
} from '../domain/service-request.js';

/** Only for services with asksHomeSize / asksAreas (GET /v1/service-types). */
export class HouseholdDto {
  @ApiProperty({ enum: HOME_TYPES, required: false })
  @IsOptional()
  @IsIn(HOME_TYPES)
  homeType?: HomeType;

  /** 0 for a studio */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  bedrooms?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  bathrooms?: number;

  /** Parts of the home to service */
  @ApiProperty({ enum: HOME_AREAS, isArray: true, required: false })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(HOME_AREAS, { each: true })
  areas?: HomeArea[];
}

export class PlacementTermsDto {
  @ApiProperty({ enum: ['LIVE_IN', 'LIVE_OUT'] })
  @IsIn(['LIVE_IN', 'LIVE_OUT'])
  arrangement: 'LIVE_IN' | 'LIVE_OUT';

  @IsInt()
  @Min(1)
  @Max(7)
  daysPerWeek: number;

  /** Monthly salary the client has in mind (RWF); agreed directly with the worker */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  salaryRwf?: number;
}

export class CreateServiceRequestDto {
  /** Service type key from GET /v1/service-types */
  @IsString()
  @MaxLength(40)
  category: string;

  /** For services offered both ways (feeType EITHER); otherwise implied by the service */
  @ApiProperty({ enum: ['VISIT', 'PLACEMENT'], required: false })
  @IsOptional()
  @IsIn(['VISIT', 'PLACEMENT'])
  kind?: 'VISIT' | 'PLACEMENT';

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description: string;

  /** Visit start, or placement start date (ISO 8601, with offset) */
  @Type(() => Date)
  @IsDate()
  scheduledAt: Date;

  /** Visits: hours, in half-hour steps */
  @IsOptional()
  @IsNumber()
  durationHours?: number;

  /** Placements: live-in or live-out, days per week, optional salary */
  @IsOptional()
  @ValidateNested()
  @Type(() => PlacementTermsDto)
  placement?: PlacementTermsDto;

  /** The home to service, where the service asks for it */
  @IsOptional()
  @ValidateNested()
  @Type(() => HouseholdDto)
  household?: HouseholdDto;

  @ApiProperty({ enum: GenderPreference, default: GenderPreference.ANY })
  @IsOptional()
  @IsEnum(GenderPreference)
  preferredGender: GenderPreference = 'ANY';

  @ApiProperty({ enum: Language, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsEnum(Language, { each: true })
  preferredLanguages: Language[];

  @ValidateNested()
  @Type(() => AddressDto)
  address: AddressDto;
}

export class ListServiceRequestsQuery {
  @ApiProperty({ enum: ['active', 'past'], default: 'active' })
  @IsOptional()
  @IsIn(['active', 'past'])
  scope: 'active' | 'past' = 'active';
}

export class AdjustmentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  note: string;
}

export class CancelDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason: string;
}

export class PriceDto {
  /** Worker's share; ignored for placements (match fee only) */
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  workerFeeRwf: number;

  /** The worker to hold for this job */
  @IsUUID()
  workerId: string;

  /** Shown to the client, e.g. "Groceries paid separately on receipt" */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class AssignWorkerDto {
  /** Defaults to the held worker */
  @IsOptional()
  @IsUUID()
  workerId?: string;
}

export class PipelineQuery {
  /** Service type key */
  @IsOptional()
  @IsString()
  category?: string;

  /** Only requests scheduled within this many days (past and future) of today */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}

export class SuggestedWorkersQuery {
  @ApiProperty({ enum: ['best', 'rating', 'distance'], required: false })
  @IsOptional()
  @IsIn(['best', 'rating', 'distance'])
  sort: 'best' | 'rating' | 'distance' = 'best';
}

export class AdminListServiceRequestsQuery {
  @ApiProperty({ enum: ServiceRequestStatus, required: false })
  @IsOptional()
  @IsEnum(ServiceRequestStatus)
  status?: ServiceRequestStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 25;
}
