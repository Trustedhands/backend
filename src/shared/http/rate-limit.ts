import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { Env } from '../../config/env.js';

export const RATE_LIMIT_KEY = 'http:rateLimit';

export interface RateLimitOptions {
  /** Requests allowed per window, per client IP and route */
  limit: number;
  ttlMs: number;
}

const DEFAULT_LIMIT: RateLimitOptions = { limit: 60, ttlMs: 60_000 };

/** Override the per-IP limit for a route or controller guarded by RateLimitGuard. */
export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_KEY, options);

interface Window {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window, in-memory, per-IP limits. Counts live in this process only,
 * which is enough to slow down credential guessing on one instance.
 * (Replaces @nestjs/throttler, a CommonJS package that require()s the
 * ESM-only @nestjs/common and so fails on runtimes without require(esm).)
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly windows = new Map<string, Window>();
  private readonly disabled: boolean;
  private nextSweep = 0;

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService<Env, true>,
  ) {
    // e2e suites register many accounts from one IP
    this.disabled = config.get('NODE_ENV', { infer: true }) === 'test';
  }

  canActivate(context: ExecutionContext): boolean {
    if (this.disabled) return true;
    const { limit, ttlMs } =
      this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? DEFAULT_LIMIT;

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const now = Date.now();
    this.sweep(now);

    const key = `${context.getClass().name}.${context.getHandler().name}:${request.ip}`;
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + ttlMs };
      this.windows.set(key, window);
    }
    window.count += 1;
    if (window.count <= limit) return true;

    const retryAfter = Math.ceil((window.resetAt - now) / 1000);
    http.getResponse<Response>().setHeader('Retry-After', String(retryAfter));
    throw new HttpException(
      'Too many requests. Please wait a minute and try again.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /** Drops expired windows at most once a minute so the map stays small. */
  private sweep(now: number): void {
    if (now < this.nextSweep) return;
    this.nextSweep = now + 60_000;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}
