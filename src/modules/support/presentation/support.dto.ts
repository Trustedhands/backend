import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { TicketStatus } from '../../../generated/prisma/enums.js';

/** Multipart text fields; files go in `files` (up to 3 JPG/PNG/PDF, under 4 MB in total). */
export class CreateTicketDto {
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  description: string;

  /** The booking this is about, if any */
  @IsOptional()
  @IsUUID()
  serviceRequestId?: string;
}

export class TicketAttachmentView {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export class TicketRequestView {
  id: string;
  /** e.g. SR-2041 */
  reference: string;
  /** Service type key */
  category: string;
  categoryLabel: string;
  scheduledAt: Date;
}

export class TicketView {
  id: string;
  /** e.g. TK-118 */
  reference: string;
  subject: string;
  description: string;
  @ApiProperty({ enum: TicketStatus })
  status: TicketStatus;
  serviceRequest: TicketRequestView | null;
  attachments: TicketAttachmentView[];
  createdAt: Date;
  closedAt: Date | null;
}

export class TicketClientView {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
}

export class StaffRefView {
  id: string;
  fullName: string;
}

export class TicketEntryView {
  id: string;
  author: StaffRefView;
  body: string;
  at: Date;
}

export class AdminTicketView extends TicketView {
  client: TicketClientView;
  assignedTo: StaffRefView | null;
  /** Staff-only */
  notes: TicketEntryView[];
  /** Replies emailed to the client */
  replies: TicketEntryView[];
}

export class AdminTicketPage {
  items: AdminTicketView[];
  total: number;
}

export class AdminListTicketsQuery {
  @ApiProperty({ enum: TicketStatus, required: false })
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

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

export class TicketTextDto {
  @IsString()
  @MinLength(2)
  @MaxLength(4000)
  body: string;
}

export class UpdateTicketDto {
  /** Staff member handling it; null to unassign */
  @IsOptional()
  @IsUUID()
  assignedToId?: string | null;

  @ApiProperty({ enum: TicketStatus, required: false })
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  subject?: string;
}
