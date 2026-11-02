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
import { MoneyTransferGateway } from '../src/modules/payments/application/money-transfer.gateway.js';
import { PaymentRejectedError } from '../src/modules/payments/application/mobile-money.gateway.js';
import { PrismaService } from '../src/shared/database/prisma.service.js';
import { setupApp } from '../src/setup-app.js';
import { assertLocalDatabase } from './test-env.js';

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

/** Household details for services that ask for them (cleaning, house help…). */
export const HOME = {
  homeType: 'APARTMENT',
  bedrooms: 2,
  bathrooms: 1,
  areas: ['KITCHEN', 'LIVING_ROOM'],
};

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

/** Stands in for MoMo Disbursement (refunds and payouts). */
export class FakeTransfers extends MoneyTransferGateway {
  readonly sent: Array<{
    referenceId: string;
    amount: number;
    msisdn: string;
    callbackPath: string;
  }> = [];
  readonly statuses = new Map<string, ProviderPaymentStatus>();
  /** Next transfer is refused outright (e.g. unregistered number) */
  rejectNext = false;

  async transfer(input: {
    referenceId: string;
    amount: number;
    msisdn: string;
    callbackPath: string;
  }): Promise<void> {
    if (this.rejectNext) {
      this.rejectNext = false;
      throw new PaymentRejectedError('MoMo rejected the request (400)');
    }
    this.sent.push(input);
    this.statuses.set(input.referenceId, { status: 'PENDING' });
  }

  async getTransferStatus(referenceId: string): Promise<ProviderPaymentStatus> {
    return this.statuses.get(referenceId) ?? { status: 'NOT_FOUND' };
  }
}

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  mailer: FakeMailer;
  sms: FakeSms;
  momo: FakeMomo;
  transfers: FakeTransfers;
  http: () => ReturnType<typeof request>;
}

/** The real app against the database in .env, with outbound providers faked. */
export async function createTestApp(): Promise<TestApp> {
  assertLocalDatabase(process.env['DATABASE_URL'] ?? '');
  const mailer = new FakeMailer();
  const sms = new FakeSms();
  const momo = new FakeMomo();
  const transfers = new FakeTransfers();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Mailer)
    .useValue(mailer)
    .overrideProvider(SmsSender)
    .useValue(sms)
    .overrideProvider(MobileMoneyGateway)
    .useValue(momo)
    .overrideProvider(MoneyTransferGateway)
    .useValue(transfers)
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
    transfers,
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

/** Turns a registered user into staff with the given role. */
export async function makeStaff(
  t: TestApp,
  user: TestUser,
  staffRole:
    | 'SUPER_ADMIN'
    | 'VERIFICATION_LEAD'
    | 'FINANCE'
    | 'CUSTOMER_SERVICE' = 'SUPER_ADMIN',
): Promise<TestUser> {
  await t.prisma.profile.update({
    where: { id: user.id },
    data: { role: 'ADMIN', staffRole },
  });
  return user;
}

/** A ready-to-assign worker, inserted directly (the verification flow has its own tests). */
export async function createVerifiedWorker(
  t: TestApp,
  overrides: Partial<{
    fullName: string;
    gender: 'FEMALE' | 'MALE';
    languages: Array<'EN' | 'FR' | 'RW' | 'SW'>;
    categories: string[];
    latitude: number;
    longitude: number;
  }> = {},
): Promise<string> {
  const worker = await t.prisma.worker.create({
    data: {
      status: 'VERIFIED',
      fullName: overrides.fullName ?? 'Jeanne Mukamana',
      gender: overrides.gender ?? 'FEMALE',
      languages: overrides.languages ?? ['EN', 'FR'],
      categories: overrides.categories ?? ['CLEANING'],
      phone: '+250788000111',
      latitude: overrides.latitude,
      longitude: overrides.longitude,
      verifiedAt: new Date(),
    },
  });
  return worker.id;
}

/** Removes everything the given users created. */
export async function deleteUsers(
  prisma: PrismaService,
  userIds: string[],
  workerIds: string[] = [],
) {
  const requests = { clientId: { in: userIds } };
  await prisma.supportTicket.deleteMany({
    where: {
      OR: [{ clientId: { in: userIds } }, { assignedToId: { in: userIds } }],
    },
  });
  await prisma.review.deleteMany({
    where: {
      OR: [{ clientId: { in: userIds } }, { workerId: { in: workerIds } }],
    },
  });
  const requestIds = (
    await prisma.serviceRequest.findMany({
      where: requests,
      select: { id: true },
    })
  ).map((r) => r.id);
  await prisma.walletEntry.deleteMany({
    where: { profileId: { in: userIds } },
  });
  await prisma.walletTopUp.deleteMany({
    where: { profileId: { in: userIds } },
  });
  await prisma.ledgerEntry.deleteMany({
    where: {
      OR: [
        { serviceRequestId: { in: requestIds } },
        { workerId: { in: workerIds } },
      ],
    },
  });
  await prisma.refund.deleteMany({
    where: { payment: { clientId: { in: userIds } } },
  });
  await prisma.payout.deleteMany({ where: { workerId: { in: workerIds } } });
  await prisma.serviceRequestEvent.deleteMany({
    where: { serviceRequest: requests },
  });
  await prisma.payment.deleteMany({ where: { clientId: { in: userIds } } });
  await prisma.serviceRequest.deleteMany({ where: requests });
  if (workerIds.length) {
    await prisma.serviceRequest.updateMany({
      where: { assignedWorkerId: { in: workerIds } },
      data: { assignedWorkerId: null },
    });
    await prisma.worker.deleteMany({ where: { id: { in: workerIds } } });
  }
  await prisma.staffInvitation.deleteMany({
    where: { invitedById: { in: userIds } },
  });
  await prisma.auditEvent.deleteMany({
    where: {
      OR: [
        { actorId: { in: userIds } },
        { entityId: { in: [...userIds, ...workerIds] } },
      ],
    },
  });
  // Cascades to profiles, addresses, saved methods, tokens and codes
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
