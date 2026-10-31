import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../../shared/auth/auth-user.js';
import {
  CurrentUser,
  Public,
  RequirePermission,
} from '../../../shared/auth/decorators.js';
import { ConfigurationService } from '../application/configuration.service.js';
import {
  CreateServiceTypeDto,
  PublicServiceTypeView,
  ServiceTypeView,
  SettingsView,
  UpdateServiceTypeDto,
  UpdateSettingsDto,
} from './configuration.dto.js';

/** Services the client app can offer. */
@ApiTags('service types')
@Controller('service-types')
export class ServiceTypesController {
  constructor(private readonly config: ConfigurationService) {}

  @Public()
  @Get()
  list(): Promise<PublicServiceTypeView[]> {
    return this.config.visibleServiceTypes();
  }
}

@ApiTags('admin: settings')
@ApiBearerAuth()
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(private readonly config: ConfigurationService) {}

  /** Readable by all staff: pricing shows the platform fee */
  @RequirePermission('dashboard.view')
  @Get()
  get(): Promise<SettingsView> {
    return this.config.settings();
  }

  @RequirePermission('settings.manage')
  @Patch()
  update(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateSettingsDto,
  ): Promise<SettingsView> {
    return this.config.updateSettings(user.id, dto);
  }

  @RequirePermission('dashboard.view')
  @Get('service-types')
  serviceTypes(): Promise<ServiceTypeView[]> {
    return this.config.serviceTypes();
  }

  @RequirePermission('settings.manage')
  @Post('service-types')
  createServiceType(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateServiceTypeDto,
  ): Promise<ServiceTypeView> {
    return this.config.createServiceType(user.id, dto);
  }

  @RequirePermission('settings.manage')
  @Patch('service-types/:key')
  updateServiceType(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Body() dto: UpdateServiceTypeDto,
  ): Promise<ServiceTypeView> {
    return this.config.updateServiceType(user.id, key, dto);
  }
}
