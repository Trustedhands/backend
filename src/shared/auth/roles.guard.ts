import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { UserRole } from '../../generated/prisma/enums.js';
import { PrismaService } from '../database/prisma.service.js';
import type { AuthUser } from './auth-user.js';
import { ROLES } from './decorators.js';

/**
 * Global guard for @Roles(). Roles live on the Profile row rather than in the
 * JWT, so revoking admin access takes effect immediately.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES,
      [context.getHandler(), context.getClass()],
    );
    if (!roles?.length) return true;

    const { user } = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    if (!user) throw new ForbiddenException();

    const profile = await this.prisma.profile.findUnique({
      where: { id: user.id },
      select: { role: true },
    });
    if (!profile || !roles.includes(profile.role)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
