import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import type { AuthUser } from '../../../shared/auth/auth-user.js';
import {
  CurrentUser,
  RequirePermission,
} from '../../../shared/auth/decorators.js';
import {
  MAX_UPLOAD_BYTES,
  serveUpload,
} from '../../../shared/files/file-type.js';
import { WorkersService } from '../application/workers.service.js';
import type { DocumentKind } from '../domain/worker-profile.js';

const DOCUMENT_KIND = {
  PHOTO: 'PHOTO',
  ID_FRONT: 'ID_FRONT',
  ID_BACK: 'ID_BACK',
} as const;
import {
  CreateWorkerDto,
  DeclineWorkerDto,
  ListWorkersQuery,
  SetActiveDto,
  UpdateWorkerDto,
  VerifyWorkerDto,
  WorkerDetailView,
  WorkerSummaryView,
} from './worker.dto.js';

@ApiTags('admin: workers')
@ApiBearerAuth()
@Controller('admin/workers')
export class AdminWorkersController {
  constructor(private readonly workers: WorkersService) {}

  @RequirePermission('workers.view')
  @Get()
  list(@Query() query: ListWorkersQuery): Promise<WorkerSummaryView[]> {
    return this.workers.list(query);
  }

  @RequirePermission('workers.view')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<WorkerDetailView> {
    return this.workers.get(id);
  }

  /** Saved as a draft; upload documents, then submit for verification */
  @RequirePermission('workers.manage')
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateWorkerDto,
  ): Promise<WorkerDetailView> {
    return this.workers.create(user.id, dto);
  }

  @RequirePermission('workers.manage')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkerDto,
  ): Promise<WorkerDetailView> {
    return this.workers.update(user.id, id, dto);
  }

  /** PHOTO (JPG/PNG), ID_FRONT or ID_BACK (JPG/PNG/PDF), up to 5 MB; replaces any previous one */
  @RequirePermission('workers.manage')
  @Post(':id/documents/:kind')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  upload(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('kind', new ParseEnumPipe(DOCUMENT_KIND)) kind: DocumentKind,
    @UploadedFile()
    file: { originalname: string; buffer: Buffer; size: number } | undefined,
  ): Promise<WorkerDetailView> {
    return this.workers.uploadDocument(user.id, id, kind, file);
  }

  @RequirePermission('workers.view')
  @Get(':id/documents/:kind')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header(
    'Content-Security-Policy',
    "sandbox; default-src 'none'; img-src 'self'",
  )
  @Header('Cache-Control', 'private, max-age=300')
  async document(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('kind', new ParseEnumPipe(DOCUMENT_KIND)) kind: DocumentKind,
  ): Promise<StreamableFile> {
    return serveUpload(await this.workers.document(id, kind));
  }

  @RequirePermission('workers.manage')
  @Post(':id/submit')
  submit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WorkerDetailView> {
    return this.workers.submitForVerification(user.id, id);
  }

  /** Must be a different admin from the one who added the worker */
  @RequirePermission('workers.verify')
  @Post(':id/verify')
  verify(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyWorkerDto,
  ): Promise<WorkerDetailView> {
    return this.workers.verify(user.id, id, dto);
  }

  @RequirePermission('workers.verify')
  @Post(':id/decline')
  decline(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeclineWorkerDto,
  ): Promise<WorkerDetailView> {
    return this.workers.decline(user.id, id, dto.reason);
  }

  @RequirePermission('workers.manage')
  @Patch(':id/active')
  setActive(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetActiveDto,
  ): Promise<WorkerDetailView> {
    return this.workers.setActive(user.id, id, dto.active);
  }
}
