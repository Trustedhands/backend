import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../../shared/auth/decorators.js';
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
  constructor(private readonly ops: OperationsService) {}

  @RequirePermission('dashboard.view')
  @Get('dashboard')
  dashboard(): Promise<DashboardView> {
    return this.ops.dashboard();
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
