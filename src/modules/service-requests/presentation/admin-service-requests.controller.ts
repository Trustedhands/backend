import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../../shared/auth/auth-user.js';
import { CurrentUser, Roles } from '../../../shared/auth/decorators.js';
import { ServiceRequestsService } from '../application/service-requests.service.js';
import { ServiceRequestQueries } from '../infrastructure/service-request.queries.js';
import {
  AdminListServiceRequestsQuery,
  AssignWorkerDto,
  CancelDto,
  PriceDto,
} from './service-request.dto.js';
import {
  AdminServiceRequestDetailView,
  AdminServiceRequestPage,
} from './service-request.views.js';

@ApiTags('admin: service requests')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/service-requests')
export class AdminServiceRequestsController {
  constructor(
    private readonly service: ServiceRequestsService,
    private readonly queries: ServiceRequestQueries,
  ) {}

  @Get()
  async list(
    @Query() query: AdminListServiceRequestsQuery,
  ): Promise<AdminServiceRequestPage> {
    const { items, total } = await this.queries.listForAdmin({
      status: query.status,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminServiceRequestDetailView> {
    return this.queries.getForAdmin(id);
  }

  /** Send or revise the price */
  @Post(':id/price')
  @HttpCode(200)
  async price(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PriceDto,
  ): Promise<AdminServiceRequestDetailView> {
    await this.service.price(admin.id, id, dto);
    return this.queries.getForAdmin(id);
  }

  @Post(':id/assign')
  @HttpCode(200)
  async assign(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignWorkerDto,
  ): Promise<AdminServiceRequestDetailView> {
    await this.service.assignWorker(admin.id, id, dto.workerId);
    return this.queries.getForAdmin(id);
  }

  @Post(':id/start')
  @HttpCode(200)
  async start(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminServiceRequestDetailView> {
    await this.service.start(admin.id, id);
    return this.queries.getForAdmin(id);
  }

  @Post(':id/complete')
  @HttpCode(200)
  async complete(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminServiceRequestDetailView> {
    await this.service.complete({ id: admin.id, isAdmin: true }, id);
    return this.queries.getForAdmin(id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentUser() admin: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelDto,
  ): Promise<AdminServiceRequestDetailView> {
    await this.service.cancel({ id: admin.id, isAdmin: true }, id, dto.reason);
    return this.queries.getForAdmin(id);
  }
}
