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
import { CurrentUser } from '../../../shared/auth/decorators.js';
import { ServiceRequestsService } from '../application/service-requests.service.js';
import { ServiceRequestQueries } from '../infrastructure/service-request.queries.js';
import {
  AdjustmentDto,
  CancelDto,
  CreateServiceRequestDto,
  ListServiceRequestsQuery,
} from './service-request.dto.js';
import {
  ServiceRequestDetailView,
  ServiceRequestSummaryView,
} from './service-request.views.js';

@ApiTags('service requests')
@ApiBearerAuth()
@Controller('service-requests')
export class ServiceRequestsController {
  constructor(
    private readonly service: ServiceRequestsService,
    private readonly queries: ServiceRequestQueries,
  ) {}

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateServiceRequestDto,
  ): Promise<ServiceRequestDetailView> {
    const { id } = await this.service.submit({
      clientId: user.id,
      ...dto,
      address: {
        ...dto.address,
        latitude: dto.address.latitude ?? null,
        longitude: dto.address.longitude ?? null,
      },
    });
    return this.queries.getForClient(user.id, id);
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListServiceRequestsQuery,
  ): Promise<ServiceRequestSummaryView[]> {
    return this.queries.listForClient(user.id, query.scope);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ServiceRequestDetailView> {
    return this.queries.getForClient(user.id, id);
  }

  /** "Not right? Ask us to adjust" */
  @Post(':id/adjustment')
  @HttpCode(200)
  async requestAdjustment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustmentDto,
  ): Promise<ServiceRequestDetailView> {
    await this.service.requestAdjustment(user.id, id, dto.note);
    return this.queries.getForClient(user.id, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelDto,
  ): Promise<ServiceRequestDetailView> {
    await this.service.cancel({ id: user.id, isAdmin: false }, id, dto.reason);
    return this.queries.getForClient(user.id, id);
  }

  /** "Mark as done" */
  @Post(':id/complete')
  @HttpCode(200)
  async complete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ServiceRequestDetailView> {
    await this.service.complete({ id: user.id, isAdmin: false }, id);
    return this.queries.getForClient(user.id, id);
  }
}
