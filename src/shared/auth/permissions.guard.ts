import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthUser } from './auth-user.js';
import { PERMISSIONS_KEY } from './decorators.js';
import { can, type Permission } from './permissions.js';

/**
 * Global guard for @RequirePermission(). Staff roles live on the Profile row,
 * not in the token, so role changes and removals take effect immediately.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const { user } = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    if (!user) throw new ForbiddenException();
    const profile = await this.prisma.profile.findUnique({
      where: { id: user.id },
      select: { role: true, staffRole: true, staffDisabledAt: true },
    });
    const role =
      profile?.role === 'ADMIN' && !profile.staffDisabledAt
        ? profile.staffRole
        : null;
    if (!role || !required.every((p) => can(role, p))) {
      throw new ForbiddenException("You don't have access to this");
    }
    return true;
  }
}
