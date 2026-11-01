import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { Env } from '../../../config/env.js';
import type { AuthUser } from '../../../shared/auth/auth-user.js';
import {
  CurrentUser,
  Public,
  RequirePermission,
} from '../../../shared/auth/decorators.js';
import { RateLimit, RateLimitGuard } from '../../../shared/http/rate-limit.js';
import { AuthSessionView } from '../../auth/presentation/auth.dto.js';
import { setRefreshCookie } from '../../auth/presentation/refresh-cookie.js';
import { TeamService } from '../application/team.service.js';
import {
  AcceptInvitationDto,
  InvitationPreviewView,
  InviteDto,
  StaffMeView,
  TeamView,
  UpdateStaffDto,
} from './team.dto.js';

@ApiTags('admin: team')
@ApiBearerAuth()
@Controller('admin')
export class AdminTeamController {
  constructor(private readonly team: TeamService) {}

  /** The signed-in staff member and what they may do */
  @RequirePermission('dashboard.view')
  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<StaffMeView> {
    return this.team.me(user.id);
  }

  @RequirePermission('team.manage')
  @Get('team')
  list(): Promise<TeamView> {
    return this.team.team();
  }

  @RequirePermission('team.manage')
  @Post('team/invitations')
  invite(
    @CurrentUser() user: AuthUser,
    @Body() dto: InviteDto,
  ): Promise<TeamView> {
    return this.team.invite(user.id, dto.email, dto.staffRole);
  }

  @RequirePermission('team.manage')
  @Delete('team/invitations/:id')
  revoke(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TeamView> {
    return this.team.revokeInvitation(user.id, id);
  }

  @RequirePermission('team.manage')
  @Patch('team/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffDto,
  ): Promise<TeamView> {
    return this.team.updateMember(user.id, id, dto);
  }
}

/** The accept-invite page in the admin app. */
@ApiTags('team invitations')
@UseGuards(RateLimitGuard)
@Controller('team/invitations')
export class InvitationsController {
  private readonly secureCookies: boolean;

  constructor(
    private readonly team: TeamService,
    config: ConfigService<Env, true>,
  ) {
    this.secureCookies =
      config.get('NODE_ENV', { infer: true }) === 'production';
  }

  @Public()
  @RateLimit({ limit: 20, ttlMs: 60_000 })
  @Get(':token')
  preview(@Param('token') token: string): Promise<InvitationPreviewView> {
    return this.team.previewInvitation(token);
  }

  /** Creates the staff account and signs in (sets the refresh cookie) */
  @Public()
  @RateLimit({ limit: 10, ttlMs: 60_000 })
  @Post('accept')
  async accept(
    @Body() dto: AcceptInvitationDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionView> {
    const session = await this.team.acceptInvitation(
      dto,
      req.headers['user-agent'] ?? null,
    );
    // Invitations are for the admin console
    setRefreshCookie(res, 'admin', session, { secure: this.secureCookies });
    return { accessToken: session.accessToken, expiresIn: session.expiresIn };
  }
}
