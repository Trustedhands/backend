import type { Request, Response } from 'express';
import type { IssuedSession } from '../application/sessions.service.js';

/**
 * Each app keeps its own refresh cookie. Both apps talk to the same API host,
 * so with one cookie, signing into the admin console would replace a client
 * session in the same browser, and concurrent refreshes from both apps would
 * look like token theft.
 */
export type SessionApp = 'client' | 'admin';
const COOKIE_NAMES: Record<SessionApp, string> = {
  client: 'th_refresh',
  admin: 'th_refresh_admin',
};
/** Only sent to the auth endpoints, never to the rest of the API */
const COOKIE_PATH = '/v1/auth';

export interface CookieOptions {
  secure: boolean;
}

/** `?app=admin` selects the admin console's cookie; anything else is the client app. */
export function sessionApp(req: Request): SessionApp {
  return req.query['app'] === 'admin' ? 'admin' : 'client';
}

export function setRefreshCookie(
  res: Response,
  app: SessionApp,
  session: IssuedSession,
  options: CookieOptions,
): void {
  res.cookie(COOKIE_NAMES[app], session.refreshToken, {
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
  app: SessionApp,
  options: CookieOptions,
): void {
  res.clearCookie(COOKIE_NAMES[app], {
    httpOnly: true,
    secure: options.secure,
    sameSite: 'lax',
    path: COOKIE_PATH,
  });
}

export function readRefreshCookie(
  req: Request,
  app: SessionApp,
): string | null {
  const value = (
    req.cookies as Record<string, string | undefined> | undefined
  )?.[COOKIE_NAMES[app]];
  return value || null;
}
