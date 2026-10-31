import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../shared/auth/decorators.js';
import { WorkersService } from '../application/workers.service.js';
import {
  CreateWorkerDto,
  ListWorkersQuery,
  UpdateWorkerDto,
  WorkerView,
} from './worker.dto.js';

@ApiTags('admin: workers')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/workers')
export class AdminWorkersController {
  constructor(private readonly workers: WorkersService) {}

  @Get()
  list(@Query() query: ListWorkersQuery): Promise<WorkerView[]> {
    return this.workers.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<WorkerView> {
    return this.workers.get(id);
  }

  @Post()
  create(@Body() dto: CreateWorkerDto): Promise<WorkerView> {
    return this.workers.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkerDto,
  ): Promise<WorkerView> {
    return this.workers.update(id, dto);
  }
}
