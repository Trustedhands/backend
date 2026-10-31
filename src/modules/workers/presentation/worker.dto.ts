import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  Gender,
  IdDocumentType,
  Language,
  WorkerStatus,
} from '../../../generated/prisma/enums.js';
import { QueryBoolean } from '../../../shared/http/query-boolean.js';
import { VERIFICATION_CHECKS } from '../domain/worker-profile.js';

/** Everything on "Add a worker". Only name, gender and phone are needed for a draft. */
export class CreateWorkerDto {
  @IsString() @MinLength(2) @MaxLength(120) fullName: string;
  @ApiProperty({ enum: Gender }) @IsEnum(Gender) gender: Gender;
  /** YYYY-MM-DD */
  @IsOptional() @Type(() => Date) @IsDate() dateOfBirth?: Date;
  @IsOptional() @IsString() @MaxLength(60) nationality?: string;
  @IsOptional() @IsString() @MaxLength(60) countryOfResidence?: string;
  @ApiProperty({ enum: Language, isArray: true, required: false })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(Language, { each: true })
  languages?: Language[];
  /** Service type keys, e.g. CLEANING */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  categories?: string[];
  /** Rwandan mobile number */
  @IsString() @MaxLength(20) phone: string;
  @IsOptional() @IsString() @MaxLength(254) email?: string;
  @IsOptional() @IsString() @MaxLength(60) province?: string;
  @IsOptional() @IsString() @MaxLength(60) district?: string;
  @IsOptional() @IsString() @MaxLength(60) sector?: string;
  @IsOptional() @IsString() @MaxLength(60) cell?: string;
  @IsOptional() @IsString() @MaxLength(60) village?: string;
  @IsOptional() @IsLatitude() latitude?: number;
  @IsOptional() @IsLongitude() longitude?: number;
  /** Experience & references */
  @IsOptional() @IsString() @MaxLength(2000) experience?: string;
  @ApiProperty({ enum: IdDocumentType, required: false })
  @IsOptional()
  @IsEnum(IdDocumentType)
  idType?: IdDocumentType;
  @IsOptional() @IsString() @MaxLength(40) idNumber?: string;
  @IsOptional() @IsString() @MaxLength(120) nextOfKinName?: string;
  /** e.g. brother */
  @IsOptional() @IsString() @MaxLength(40) nextOfKinRelation?: string;
  @IsOptional() @IsString() @MaxLength(20) nextOfKinPhone?: string;
  @IsOptional() @IsString() @MaxLength(120) nextOfKinAddress?: string;
  @IsOptional() @IsString() @MaxLength(40) nextOfKinIdNumber?: string;
  /** Mobile Money number for payouts */
  @IsOptional() @IsString() @MaxLength(20) payoutMsisdn?: string;
  @IsOptional() @IsString() @MaxLength(80) payoutBankName?: string;
  @IsOptional() @IsString() @MaxLength(40) payoutBankAccount?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class UpdateWorkerDto extends PartialType(CreateWorkerDto) {}

export class ListWorkersQuery {
  @ApiProperty({ enum: WorkerStatus, required: false })
  @IsOptional()
  @IsEnum(WorkerStatus)
  status?: WorkerStatus;

  /** Service type key */
  @IsOptional() @IsString() category?: string;

  /** Name or phone */
  @IsOptional() @IsString() @MaxLength(80) q?: string;

  /** Include deactivated workers */
  @IsOptional() @QueryBoolean() @IsBoolean() includeInactive?: boolean;
}

export class SetActiveDto {
  @IsBoolean() active: boolean;
}

export class VerifyWorkerDto {
  /** Every check from "Check against the ID" must be true */
  @IsObject() checks: Partial<
    Record<(typeof VERIFICATION_CHECKS)[number], boolean>
  >;
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}

export class DeclineWorkerDto {
  @IsString() @MinLength(5) @MaxLength(1000) reason: string;
}

export class WorkerDocumentView {
  @ApiProperty({ enum: ['PHOTO', 'ID_FRONT', 'ID_BACK'] })
  kind: 'PHOTO' | 'ID_FRONT' | 'ID_BACK';
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: Date;
}

export class ChecklistItemView {
  @ApiProperty({
    enum: [
      'personal',
      'contact',
      'services',
      'identity',
      'nextOfKin',
      'payout',
    ],
  })
  key:
    'personal' | 'contact' | 'services' | 'identity' | 'nextOfKin' | 'payout';
  label: string;
  done: boolean;
  missing: string | null;
}

export class ActivityView {
  id: string;
  /** e.g. worker.created, worker.document_uploaded, worker.verified */
  action: string;
  actorName: string;
  at: Date;
}

export class WorkerSummaryView {
  id: string;
  fullName: string;
  @ApiProperty({ enum: WorkerStatus })
  status: WorkerStatus;
  active: boolean;
  @ApiProperty({ enum: Gender })
  gender: Gender;
  @ApiProperty({ enum: Language, isArray: true })
  languages: Language[];
  categories: string[];
  phone: string;
  district: string | null;
  sector: string | null;
  hasPhoto: boolean;
  ratingAverage: number | null;
  completedJobs: number;
  createdByName: string | null;
  createdAt: Date;
}

export class WorkerDetailView extends WorkerSummaryView {
  dateOfBirth: Date | null;
  nationality: string | null;
  countryOfResidence: string | null;
  email: string | null;
  province: string | null;
  cell: string | null;
  village: string | null;
  latitude: number | null;
  longitude: number | null;
  experience: string | null;
  @ApiProperty({ enum: IdDocumentType, nullable: true })
  idType: IdDocumentType | null;
  idNumber: string | null;
  nextOfKinName: string | null;
  nextOfKinRelation: string | null;
  nextOfKinPhone: string | null;
  nextOfKinAddress: string | null;
  nextOfKinIdNumber: string | null;
  payoutMsisdn: string | null;
  payoutBankName: string | null;
  payoutBankAccount: string | null;
  notes: string | null;
  verifiedByName: string | null;
  verifiedAt: Date | null;
  declineReason: string | null;
  documents: WorkerDocumentView[];
  checklist: ChecklistItemView[];
  activity: ActivityView[];
}
