import 'reflect-metadata';
import { HttpException, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Env } from '../../config/env.js';
import { RateLimit, RateLimitGuard } from './rate-limit.js';

class Controller {
  @RateLimit({ limit: 2, ttlMs: 60_000 })
  strict() {}
  loose() {}
}

function guardFor(nodeEnv: Env['NODE_ENV']) {
  const config = { get: () => nodeEnv } as unknown as ConfigService<Env, true>;
  return new RateLimitGuard(new Reflector(), config);
}

function call(guard: RateLimitGuard, handler: () => void, ip = '1.1.1.1') {
  const headers: Record<string, string> = {};
  const context = {
    getHandler: () => handler,
    getClass: () => Controller,
    switchToHttp: () => ({
      getRequest: () => ({ ip }),
      getResponse: () => ({
        setHeader: (k: string, v: string) => (headers[k] = v),
      }),
    }),
  } as unknown as ExecutionContext;
  return { allowed: () => guard.canActivate(context), headers };
}

describe('RateLimitGuard', () => {
  afterEach(() => vi.useRealTimers());

  it('rejects requests over the route limit with 429 and Retry-After', () => {
    const guard = guardFor('production');
    const strict = Controller.prototype.strict;
    expect(call(guard, strict).allowed()).toBe(true);
    expect(call(guard, strict).allowed()).toBe(true);
    const third = call(guard, strict);
    expect(() => third.allowed()).toThrow(HttpException);
    expect(third.headers['Retry-After']).toBe('60');
  });

  it('counts each IP and route separately', () => {
    const guard = guardFor('production');
    const strict = Controller.prototype.strict;
    call(guard, strict).allowed();
    call(guard, strict).allowed();
    expect(call(guard, strict, '2.2.2.2').allowed()).toBe(true);
    expect(call(guard, Controller.prototype.loose).allowed()).toBe(true);
  });

  it('opens a new window once the old one expires', () => {
    vi.useFakeTimers();
    const guard = guardFor('production');
    const strict = Controller.prototype.strict;
    call(guard, strict).allowed();
    call(guard, strict).allowed();
    vi.advanceTimersByTime(60_000);
    expect(call(guard, strict).allowed()).toBe(true);
  });

  it('defaults to 60 a minute and is off in tests', () => {
    const guard = guardFor('production');
    const loose = Controller.prototype.loose;
    for (let i = 0; i < 60; i++) call(guard, loose).allowed();
    expect(() => call(guard, loose).allowed()).toThrow(HttpException);

    const testGuard = guardFor('test');
    for (let i = 0; i < 100; i++) call(testGuard, loose).allowed();
    expect(call(testGuard, loose).allowed()).toBe(true);
  });
});
