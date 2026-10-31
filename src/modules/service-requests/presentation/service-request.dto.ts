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
  Language,
  ServiceCategory,
  ServiceRequestStatus,
} from '../domain/service-request.js';

export class CreateServiceRequestDto {
  @ApiProperty({ enum: ServiceCategory })
  @IsEnum(ServiceCategory)
  category: ServiceCategory;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description: string;

  /** Start date and time (ISO 8601, with offset) */
  @Type(() => Date)
  @IsDate()
  scheduledAt: Date;

  /** Hours, in half-hour steps */
  @IsNumber()
  durationHours: number;

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
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  workerFeeRwf: number;

  @IsInt()
  @Min(0)
  @Max(10_000_000)
  serviceFeeRwf: number;

  /** Shown to the client, e.g. "Groceries paid separately on receipt" */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class AssignWorkerDto {
  @IsUUID()
  workerId: string;
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
