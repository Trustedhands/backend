import { Module } from '@nestjs/common';
import { ConfigurationService } from './application/configuration.service.js';
import {
  AdminSettingsController,
  ServiceTypesController,
} from './presentation/configuration.controller.js';

@Module({
  controllers: [ServiceTypesController, AdminSettingsController],
  providers: [ConfigurationService],
  exports: [ConfigurationService],
})
export class ConfigurationModule {}
