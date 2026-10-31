import type { Request, Response } from 'express';
import type { IssuedSession } from '../application/sessions.service.js';

export const REFRESH_COOKIE = 'th_refresh';
/** Only sent to the auth endpoints, never to the rest of the API */
const COOKIE_PATH = '/v1/auth';

export interface CookieOptions {
  secure: boolean;
}

export function setRefreshCookie(
  res: Response,
  session: IssuedSession,
  options: CookieOptions,
): void {
  res.cookie(REFRESH_COOKIE, session.refreshToken, {
    httpOnly: true,
    secure: options.secure,
    // App and API are same-site (sibling subdomains / localhost ports)
    sameSite: 'lax',
    path: COOKIE_PATH,
    expires: session.refreshExpiresAt,
  });
}

export function clearRefreshCookie(
  res: Response,
  options: CookieOptions,
): void {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: options.secure,
    sameSite: 'lax',
    path: COOKIE_PATH,
  });
}

export function readRefreshCookie(req: Request): string | null {
  const value = (
    req.cookies as Record<string, string | undefined> | undefined
  )?.[REFRESH_COOKIE];
  return value || null;
}
