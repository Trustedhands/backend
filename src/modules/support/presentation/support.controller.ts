import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import type { AuthUser } from '../../../shared/auth/auth-user.js';
import { CurrentUser, Roles } from '../../../shared/auth/decorators.js';
import { SupportService } from '../application/support.service.js';
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  type UploadedFile,
} from '../domain/ticket.js';
import {
  AdminListTicketsQuery,
  AdminTicketPage,
  AdminTicketView,
  CreateTicketDto,
  TicketView,
  UpdateTicketDto,
} from './support.dto.js';

const uploads = FilesInterceptor('files', MAX_ATTACHMENTS, {
  storage: memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: MAX_ATTACHMENTS, fields: 5 },
});

/** Served inline but inert: no MIME sniffing, and any script in a file can't run. */
function serveFile(file: {
  filename: string;
  contentType: string;
  data: Buffer;
}): StreamableFile {
  return new StreamableFile(file.data, {
    type: file.contentType,
    length: file.data.length,
    disposition: `inline; filename="${file.filename}"`,
  });
}

@ApiTags('support')
@ApiBearerAuth()
@Controller('support/tickets')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  /** "Report an issue" (multipart/form-data) */
  @Post()
  @UseInterceptors(uploads)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['description'],
      properties: {
        description: { type: 'string', minLength: 10, maxLength: 4000 },
        serviceRequestId: { type: 'string', format: 'uuid' },
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          maxItems: MAX_ATTACHMENTS,
        },
      },
    },
  })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTicketDto,
    @UploadedFiles() files: UploadedFile[] = [],
  ): Promise<TicketView> {
    return this.support.create(user.id, dto, files);
  }

  /** "My tickets" */
  @Get()
  list(@CurrentUser() user: AuthUser): Promise<TicketView[]> {
    return this.support.listForClient(user.id);
  }

  @Get(':id/attachments/:attachmentId')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header(
    'Content-Security-Policy',
    "sandbox; default-src 'none'; img-src 'self'",
  )
  @Header('Cache-Control', 'private, max-age=300')
  async attachment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
  ): Promise<StreamableFile> {
    return serveFile(
      await this.support.attachment(id, attachmentId, {
        id: user.id,
        isAdmin: false,
      }),
    );
  }
}

@ApiTags('admin: support')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/support/tickets')
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  list(@Query() query: AdminListTicketsQuery): Promise<AdminTicketPage> {
    return this.support.listForAdmin({
      status: query.status,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminTicketView> {
    return this.support.getForAdmin(id);
  }

  /** Change status (OPEN → ACTIVE → CLOSED, or reopen) or rename */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketDto,
  ): Promise<AdminTicketView> {
    return this.support.update(id, dto);
  }

  @Get(':id/attachments/:attachmentId')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header(
    'Content-Security-Policy',
    "sandbox; default-src 'none'; img-src 'self'",
  )
  @Header('Cache-Control', 'private, max-age=300')
  async attachment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) attachmentId: string,
  ): Promise<StreamableFile> {
    return serveFile(
      await this.support.attachment(id, attachmentId, {
        id: user.id,
        isAdmin: true,
      }),
    );
  }
}
