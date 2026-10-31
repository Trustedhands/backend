import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../../shared/auth/auth-user.js';
import {
  CurrentUser,
  RequirePermission,
} from '../../../shared/auth/decorators.js';
import { can } from '../../../shared/auth/permissions.js';
import { PrismaService } from '../../../shared/database/prisma.service.js';
import { OperationsService } from '../application/operations.service.js';
import {
  ClientDetailView,
  ClientPageView,
  DashboardView,
  ListClientsQuery,
  SearchQuery,
  SearchResultsView,
} from './operations.views.js';

@ApiTags('admin: overview')
@ApiBearerAuth()
@Controller('admin')
export class OperationsController {
  constructor(
    private readonly ops: OperationsService,
    private readonly prisma: PrismaService,
  ) {}

  @RequirePermission('dashboard.view')
  @Get('dashboard')
  async dashboard(@CurrentUser() user: AuthUser): Promise<DashboardView> {
    const profile = await this.prisma.profile.findUniqueOrThrow({
      where: { id: user.id },
      select: { staffRole: true },
    });
    return this.ops.dashboard(
      profile.staffRole !== null && can(profile.staffRole, 'payments.view'),
    );
  }

  @RequirePermission('dashboard.view')
  @Get('search')
  search(@Query() query: SearchQuery): Promise<SearchResultsView> {
    return this.ops.search(query.q);
  }

  @RequirePermission('clients.view')
  @Get('clients')
  clients(@Query() query: ListClientsQuery): Promise<ClientPageView> {
    return this.ops.clients({
      q: query.q,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
  }

  @RequirePermission('clients.view')
  @Get('clients/:id')
  client(@Param('id', ParseUUIDPipe) id: string): Promise<ClientDetailView> {
    return this.ops.client(id);
  }
}
