import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { REVIEW_TAGS, type ReviewTag } from '../domain/review.js';

export class SubmitReviewDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  /** "What stood out?" */
  @ApiProperty({ enum: REVIEW_TAGS, isArray: true })
  @IsArray()
  @ArrayMaxSize(REVIEW_TAGS.length)
  @IsIn(REVIEW_TAGS, { each: true })
  tags: ReviewTag[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class ReviewView {
  id: string;
  rating: number;
  @ApiProperty({ enum: REVIEW_TAGS, isArray: true })
  tags: ReviewTag[];
  comment: string | null;
  createdAt: Date;
}

export class AdminReviewView extends ReviewView {
  serviceRequestId: string;
  /** e.g. SR-2048 */
  serviceRequestReference: string;
  workerId: string;
  workerName: string;
  clientName: string;
}

export class AdminReviewPage {
  items: AdminReviewView[];
  total: number;
}

export class AdminListReviewsQuery {
  @IsOptional()
  @IsUUID()
  workerId?: string;

  /** Only ratings at or below this */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  maxRating?: number;

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
