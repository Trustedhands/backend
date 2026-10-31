import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  Gender,
  Language,
  ServiceCategory,
} from '../../../generated/prisma/enums.js';
import { QueryBoolean } from '../../../shared/http/query-boolean.js';

export class CreateWorkerDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName: string;

  /** International format, e.g. +250781234567 */
  @Matches(/^\+?\d{9,15}$/)
  phone: string;

  @ApiProperty({ enum: Gender })
  @IsEnum(Gender)
  gender: Gender;

  @ApiProperty({ enum: Language, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsEnum(Language, { each: true })
  languages: Language[];

  @ApiProperty({ enum: ServiceCategory, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsEnum(ServiceCategory, { each: true })
  categories: ServiceCategory[];

  @IsOptional()
  @IsBoolean()
  idVerified?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateWorkerDto extends PartialType(CreateWorkerDto) {
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ListWorkersQuery {
  @ApiProperty({ enum: ServiceCategory, required: false })
  @IsOptional()
  @IsEnum(ServiceCategory)
  category?: ServiceCategory;

  /** Include deactivated workers */
  @IsOptional()
  @QueryBoolean()
  @IsBoolean()
  includeInactive?: boolean;
}

export class WorkerView {
  id: string;
  fullName: string;
  phone: string;
  @ApiProperty({ enum: Gender })
  gender: Gender;
  @ApiProperty({ enum: Language, isArray: true })
  languages: Language[];
  @ApiProperty({ enum: ServiceCategory, isArray: true })
  categories: ServiceCategory[];
  idVerified: boolean;
  active: boolean;
  notes: string | null;
  ratingAverage: number | null;
  completedJobs: number;
  createdAt: Date;
}
