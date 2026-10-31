import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import {
  MobileMoneyGateway,
  type ProviderPaymentStatus,
} from '../src/modules/payments/application/mobile-money.gateway.js';
import { SupabaseTokenVerifier } from '../src/shared/auth/supabase-token.verifier.js';
import { PrismaService } from '../src/shared/database/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

/** Stands in for MTN MoMo; tests decide when a charge succeeds. */
class FakeMomo extends MobileMoneyGateway {
  readonly statuses = new Map<string, ProviderPaymentStatus>();

  async requestToPay(input: { referenceId: string }): Promise<void> {
    this.statuses.set(input.referenceId, { status: 'PENDING' });
  }

  async getStatus(referenceId: string): Promise<ProviderPaymentStatus> {
    return this.statuses.get(referenceId) ?? { status: 'NOT_FOUND' };
  }
}

/**
 * Runs the full client ↔ ops lifecycle against the real database configured
 * in .env. Auth is faked (the bearer token is taken as the user id) and every
 * row created here is removed afterwards.
 */
describe('Service request lifecycle (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const momo = new FakeMomo();
  const clientId = randomUUID();
  const adminId = randomUUID();
  let workerId: string | undefined;

  const as = (userId: string) => ({ Authorization: `Bearer ${userId}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SupabaseTokenVerifier)
      .useValue({
        verify: async (token: string) => ({
          id: token,
          email: null,
          phone: null,
        }),
      })
      .overrideProvider(MobileMoneyGateway)
      .useValue(momo)
      .compile();

    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.profile.create({
      data: { id: adminId, role: 'ADMIN', fullName: 'E2E Admin' },
    });
  });

  afterAll(async () => {
    if (prisma) {
      const ids = [clientId, adminId];
      const requests = { clientId: { in: ids } };
      await prisma.serviceRequestEvent.deleteMany({
        where: { serviceRequest: requests },
      });
      await prisma.payment.deleteMany({ where: { clientId: { in: ids } } });
      await prisma.serviceRequest.deleteMany({ where: requests });
      if (workerId) await prisma.worker.delete({ where: { id: workerId } });
      await prisma.profile.deleteMany({ where: { id: { in: ids } } });
    }
    await app?.close();
  });

  it('takes a request from submission to completion', async () => {
    const http = () => request(app.getHttpServer());
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const newRequest = {
      category: 'CLEANING',
      description: '3-bedroom house, full clean incl. kitchen and 2 bathrooms.',
      scheduledAt: tomorrow.toISOString(),
      durationHours: 4,
      preferredGender: 'FEMALE',
      preferredLanguages: ['EN', 'FR'],
      address: {
        district: 'Gasabo',
        sector: 'Kacyiru',
        street: 'KG 9 Ave, house 14',
      },
    };

    // Sign-up must come first
    await http()
      .post('/v1/service-requests')
      .set(as(clientId))
      .send(newRequest)
      .expect(409)
      .expect((res) => expect(res.body.code).toBe('profile_required'));

    const me = await http()
      .post('/v1/me/profile')
      .set(as(clientId))
      .send({ accountType: 'INDIVIDUAL', fullName: 'Claire Dubois' })
      .expect(201);
    expect(me.body).toMatchObject({
      onboarded: true,
      profile: { fullName: 'Claire Dubois', role: 'CLIENT' },
    });

    await http()
      .put('/v1/me/home-address')
      .set(as(clientId))
      .send(newRequest.address)
      .expect(200)
      .expect((res) => expect(res.body.homeAddress.sector).toBe('Kacyiru'));

    // Client submits
    const created = await http()
      .post('/v1/service-requests')
      .set(as(clientId))
      .send(newRequest)
      .expect(201);
    const id: string = created.body.id;
    expect(created.body).toMatchObject({
      status: 'REQUESTED',
      totalRwf: null,
      quote: null,
    });
    expect(created.body.reference).toMatch(/^SR-\d+$/);

    // Clients can't use admin endpoints; unknown fields are rejected
    await http()
      .get('/v1/admin/service-requests')
      .set(as(clientId))
      .expect(403);
    await http()
      .post(`/v1/admin/service-requests/${id}/price`)
      .set(as(adminId))
      .send({ workerFeeRwf: 20_000, serviceFeeRwf: 1_000, total: 1 })
      .expect(400);

    // Ops sees it in the queue and prices it
    const queue = await http()
      .get('/v1/admin/service-requests?status=REQUESTED')
      .set(as(adminId))
      .expect(200);
    expect(queue.body.items.map((r: { id: string }) => r.id)).toContain(id);

    const priced = await http()
      .post(`/v1/admin/service-requests/${id}/price`)
      .set(as(adminId))
      .send({ workerFeeRwf: 20_000, serviceFeeRwf: 1_000 })
      .expect(200);
    expect(priced.body).toMatchObject({
      status: 'PRICED',
      totalRwf: 21_000,
      client: { fullName: 'Claire Dubois' },
    });

    // Can't assign a worker before payment
    const worker = await http()
      .post('/v1/admin/workers')
      .set(as(adminId))
      .send({
        fullName: 'Jeanne Mukamana',
        phone: '+250788000111',
        gender: 'FEMALE',
        languages: ['EN', 'FR', 'RW'],
        categories: ['CLEANING'],
        idVerified: true,
      })
      .expect(201);
    workerId = worker.body.id;
    await http()
      .post(`/v1/admin/service-requests/${id}/assign`)
      .set(as(adminId))
      .send({ workerId })
      .expect(409);

    // Client accepts and pays
    const payment = await http()
      .post(`/v1/service-requests/${id}/payments`)
      .set(as(clientId))
      .send({ msisdn: '078 123 4567' })
      .expect(201);
    expect(payment.body).toMatchObject({
      status: 'PENDING',
      amountRwf: 21_000,
      msisdnMasked: '078 *** 4567',
    });

    // A double tap returns the same charge; the price is frozen while it's pending
    const again = await http()
      .post(`/v1/service-requests/${id}/payments`)
      .set(as(clientId))
      .send({ msisdn: '078 123 4567' })
      .expect(201);
    expect(again.body.id).toBe(payment.body.id);
    await http()
      .post(`/v1/admin/service-requests/${id}/price`)
      .set(as(adminId))
      .send({ workerFeeRwf: 1, serviceFeeRwf: 1 })
      .expect(409)
      .expect((res) => expect(res.body.code).toBe('payment_in_progress'));

    // Payer approves on their phone; MoMo calls back
    const stored = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.body.id },
    });
    momo.statuses.set(stored.providerReference!, {
      status: 'SUCCESSFUL',
      transactionId: 'momo-tx-1',
    });
    await http()
      .put(`/v1/webhooks/momo/${payment.body.id}`)
      .send({ status: 'SUCCESSFUL' })
      .expect(200);

    const paid = await http()
      .get(`/v1/service-requests/${id}`)
      .set(as(clientId))
      .expect(200);
    expect(paid.body.status).toBe('PAID');
    expect(paid.body.payment.receiptReference).toMatch(/^RC-\d+$/);
    expect(paid.body.hasPendingPayment).toBe(false);

    // Ops assigns the worker, client sees them, then marks the job done
    await http()
      .post(`/v1/admin/service-requests/${id}/assign`)
      .set(as(adminId))
      .send({ workerId })
      .expect(200);
    const assigned = await http()
      .get(`/v1/service-requests/${id}`)
      .set(as(clientId))
      .expect(200);
    expect(assigned.body.worker).toMatchObject({
      fullName: 'Jeanne Mukamana',
      idVerified: true,
      completedJobs: 0,
    });
    expect(assigned.body.worker.phone).toBeUndefined();

    const done = await http()
      .post(`/v1/service-requests/${id}/complete`)
      .set(as(clientId))
      .expect(200);
    expect(done.body.status).toBe('COMPLETED');
    expect(done.body.timeline.map((t: { status: string }) => t.status)).toEqual(
      ['REQUESTED', 'PRICED', 'PAID', 'ASSIGNED', 'COMPLETED'],
    );

    const past = await http()
      .get('/v1/service-requests?scope=past')
      .set(as(clientId))
      .expect(200);
    expect(past.body.map((r: { id: string }) => r.id)).toEqual([id]);

    const history = await http()
      .get('/v1/payments')
      .set(as(clientId))
      .expect(200);
    expect(history.body).toMatchObject({
      monthSpentRwf: 21_000,
      monthPaymentCount: 1,
      walletBalanceRwf: 0,
    });
    expect(history.body.transactions[0]).toMatchObject({
      kind: 'PAYMENT',
      status: 'SUCCESSFUL',
      category: 'CLEANING',
    });

    // Another client can't see it
    await http().get(`/v1/service-requests/${id}`).set(as(adminId)).expect(404);
  });
});
