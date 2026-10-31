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
import { ServiceCategory } from '../../service-requests/domain/service-request.js';

/** Multipart text fields; files go in `files` (up to 3 JPG/PNG/PDF, 5 MB each). */
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
  @ApiProperty({ enum: ServiceCategory })
  category: ServiceCategory;
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

export class AdminTicketView extends TicketView {
  client: TicketClientView;
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

export class UpdateTicketDto {
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
