import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';
import type { UserRole } from '../../generated/prisma/enums.js';
import type { AuthUser } from './auth-user.js';

export const IS_PUBLIC = 'auth:isPublic';
export const ROLES = 'auth:roles';

/** Skip authentication for this route (e.g. health checks, provider webhooks). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Require the caller's profile to have one of these roles. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user: AuthUser }>();
    return request.user;
  },
);
