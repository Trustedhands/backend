import { Module } from '@nestjs/common';
import { WorkersService } from './application/workers.service.js';
import { AdminWorkersController } from './presentation/admin-workers.controller.js';

@Module({
  controllers: [AdminWorkersController],
  providers: [WorkersService],
  exports: [WorkersService],
})
export class WorkersModule {}
