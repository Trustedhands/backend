import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from './auth-user.js';
import type { Permission } from './permissions.js';

export const IS_PUBLIC = 'auth:isPublic';
export const PERMISSIONS_KEY = 'auth:permissions';

/** Skip authentication for this route (e.g. health checks, provider webhooks). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Staff-only route: the caller's staff role must grant every listed permission. */
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx
      .switchToHttp()
      .getRequest<Request & { user: AuthUser }>();
    return request.user;
  },
);
