import { Module } from '@nestjs/common';
import { AuthAccountsModule } from '../auth/auth.module.js';
import { TeamService } from './application/team.service.js';
import {
  AdminTeamController,
  InvitationsController,
} from './presentation/team.controller.js';

@Module({
  imports: [AuthAccountsModule],
  controllers: [AdminTeamController, InvitationsController],
  providers: [TeamService],
})
export class TeamModule {}
