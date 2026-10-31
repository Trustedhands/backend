import { Module } from '@nestjs/common';
import { AuthAccountsModule } from '../auth/auth.module.js';
import { SupportService } from './application/support.service.js';
import {
  AdminSupportController,
  SupportController,
} from './presentation/support.controller.js';

@Module({
  imports: [AuthAccountsModule],
  controllers: [SupportController, AdminSupportController],
  providers: [SupportService],
})
export class SupportModule {}
