import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import {
  type EmailMessage,
  Mailer,
  SmsSender,
} from '../src/modules/auth/application/ports.js';
import {
  MobileMoneyGateway,
  type ProviderPaymentStatus,
} from '../src/modules/payments/application/mobile-money.gateway.js';
import { PrismaService } from '../src/shared/database/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

/** Captures outgoing email so tests can read verification codes. */
export class FakeMailer extends Mailer {
  readonly sent: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }
  /** Latest 6-digit code emailed to `to` */
  lastCode(to: string): string {
    const message = this.sent.filter((m) => m.to === to).at(-1);
    const code = message?.text.match(/\b(\d{6})\b/)?.[1];
    if (!code) throw new Error(`No code emailed to ${to}`);
    return code;
  }
}

export class FakeSms extends SmsSender {
  readonly sent: Array<{ to: string; text: string }> = [];
  async send(to: string, text: string): Promise<void> {
    this.sent.push({ to, text });
  }
  lastCode(to: string): string {
    const code = this.sent
      .filter((m) => m.to === to)
      .at(-1)
      ?.text.match(/\b(\d{6})\b/)?.[1];
    if (!code) throw new Error(`No code texted to ${to}`);
    return code;
  }
}

/** Stands in for MTN MoMo; tests decide when a charge succeeds. */
export class FakeMomo extends MobileMoneyGateway {
  readonly statuses = new Map<string, ProviderPaymentStatus>();
  async requestToPay(input: { referenceId: string }): Promise<void> {
    this.statuses.set(input.referenceId, { status: 'PENDING' });
  }
  async getStatus(referenceId: string): Promise<ProviderPaymentStatus> {
    return this.statuses.get(referenceId) ?? { status: 'NOT_FOUND' };
  }
}

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  mailer: FakeMailer;
  sms: FakeSms;
  momo: FakeMomo;
  http: () => ReturnType<typeof request>;
}

/** The real app against the database in .env, with outbound providers faked. */
export async function createTestApp(): Promise<TestApp> {
  const mailer = new FakeMailer();
  const sms = new FakeSms();
  const momo = new FakeMomo();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Mailer)
    .useValue(mailer)
    .overrideProvider(SmsSender)
    .useValue(sms)
    .overrideProvider(MobileMoneyGateway)
    .useValue(momo)
    .compile();
  const app = moduleRef.createNestApplication();
  setupApp(app);
  await app.init();
  return {
    app,
    prisma: app.get(PrismaService),
    mailer,
    sms,
    momo,
    http: () => request(app.getHttpServer()),
  };
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  token: string;
  /** Raw Set-Cookie header carrying the refresh token */
  cookie: string;
}

/** A unique, clearly-fake address per test user. */
export const testEmail = () => `e2e-${randomUUID()}@example.test`;

/** Random valid MTN Rwanda number, so parallel runs don't collide. */
export const testPhone = () =>
  `078${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;

export async function registerUser(
  t: TestApp,
  overrides: Partial<{ email: string; fullName: string; phone: string }> = {},
): Promise<TestUser> {
  const email = overrides.email ?? testEmail();
  const password = 'kigali2026';
  const res = await t
    .http()
    .post('/v1/auth/register')
    .send({
      email,
      password,
      phone: overrides.phone ?? testPhone(),
      fullName: overrides.fullName ?? 'E2E Client',
      accountType: 'INDIVIDUAL',
    })
    .expect(201);
  // The API stores emails lower-cased
  const user = await t.prisma.user.findUniqueOrThrow({
    where: { email: email.toLowerCase() },
  });
  return {
    id: user.id,
    email,
    password,
    token: res.body.accessToken,
    cookie: refreshCookie(res),
  };
}

export function refreshCookie(res: {
  headers: Record<string, unknown>;
}): string {
  const cookies = (res.headers['set-cookie'] as string[] | undefined) ?? [];
  const cookie = cookies.find((c) => c.startsWith('th_refresh='));
  if (!cookie) throw new Error('No refresh cookie set');
  return cookie.split(';')[0]!;
}

export const bearer = (user: { token: string }) => ({
  Authorization: `Bearer ${user.token}`,
});

/** Removes everything the given users created. */
export async function deleteUsers(
  prisma: PrismaService,
  userIds: string[],
  workerIds: string[] = [],
) {
  const requests = { clientId: { in: userIds } };
  await prisma.serviceRequestEvent.deleteMany({
    where: { serviceRequest: requests },
  });
  await prisma.payment.deleteMany({ where: { clientId: { in: userIds } } });
  await prisma.serviceRequest.deleteMany({ where: requests });
  if (workerIds.length)
    await prisma.worker.deleteMany({ where: { id: { in: workerIds } } });
  // Cascades to profiles, addresses, saved methods, tokens and codes
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
