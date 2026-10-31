import { Module } from '@nestjs/common';
import { ProfilesService } from './application/profiles.service.js';
import { MeController } from './presentation/me.controller.js';

@Module({
  controllers: [MeController],
  providers: [ProfilesService],
  exports: [ProfilesService],
})
export class IdentityModule {}
