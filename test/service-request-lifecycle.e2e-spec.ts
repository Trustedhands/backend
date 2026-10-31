import {
  bearer,
  createTestApp,
  createVerifiedWorker,
  deleteUsers,
  makeStaff,
  registerUser,
  type TestApp,
  type TestUser,
} from './support.js';

/**
 * Runs the full client ↔ ops lifecycle against the real database configured
 * in .env, with real auth. Every row created here is removed afterwards.
 */
describe('Service request lifecycle (e2e)', () => {
  let t: TestApp;
  let client: TestUser;
  let admin: TestUser;
  let workerId: string | undefined;

  const as = bearer;

  beforeAll(async () => {
    t = await createTestApp();
    client = await registerUser(t, { fullName: 'Claire Dubois' });
    admin = await makeStaff(
      t,
      await registerUser(t, { fullName: 'E2E Admin' }),
    );
    workerId = await createVerifiedWorker(t, { languages: ['EN', 'FR', 'RW'] });
  });

  afterAll(async () => {
    if (t) {
      await deleteUsers(
        t.prisma,
        [client?.id, admin?.id].filter(Boolean) as string[],
        workerId ? [workerId] : [],
      );
      await t.app.close();
    }
  });

  it('takes a request from submission to completion', async () => {
    const { http, prisma, momo } = t;
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

    // Registration created the profile
    const me = await http().get('/v1/me').set(as(client)).expect(200);
    expect(me.body).toMatchObject({
      emailVerified: false,
      phoneVerified: false,
      profile: { fullName: 'Claire Dubois', role: 'CLIENT' },
    });

    await http()
      .put('/v1/me/home-address')
      .set(as(client))
      .send(newRequest.address)
      .expect(200)
      .expect((res) => expect(res.body.homeAddress.sector).toBe('Kacyiru'));

    // Client submits
    const created = await http()
      .post('/v1/service-requests')
      .set(as(client))
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
    await http().get('/v1/admin/service-requests').set(as(client)).expect(403);
    await http()
      .post(`/v1/admin/service-requests/${id}/price`)
      .set(as(admin))
      .send({ workerFeeRwf: 20_000, workerId, total: 1 })
      .expect(400);

    // Ops sees it in the queue and prices it
    const queue = await http()
      .get('/v1/admin/service-requests?status=REQUESTED')
      .set(as(admin))
      .expect(200);
    expect(queue.body.items.map((r: { id: string }) => r.id)).toContain(id);

    const priced = await http()
      .post(`/v1/admin/service-requests/${id}/price`)
      .set(as(admin))
      .send({ workerFeeRwf: 20_000, workerId })
      .expect(200);
    // The platform fee comes from Settings (1,000 RWF by default)
    expect(priced.body).toMatchObject({
      status: 'PRICED',
      totalRwf: 21_000,
      quote: { workerFeeRwf: 20_000, serviceFeeRwf: 1_000 },
      client: { fullName: 'Claire Dubois' },
      worker: { id: workerId },
    });
    // The client doesn't see the held worker yet
    const clientView = await http()
      .get(`/v1/service-requests/${id}`)
      .set(as(client))
      .expect(200);
    expect(clientView.body.worker).toBeNull();

    // Can't confirm the worker before payment
    await http()
      .post(`/v1/admin/service-requests/${id}/assign`)
      .set(as(admin))
      .send({})
      .expect(409);

    // Client accepts and pays
    const payment = await http()
      .post(`/v1/service-requests/${id}/payments`)
      .set(as(client))
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
      .set(as(client))
      .send({ msisdn: '078 123 4567' })
      .expect(201);
    expect(again.body.id).toBe(payment.body.id);
    await http()
      .post(`/v1/admin/service-requests/${id}/price`)
      .set(as(admin))
      .send({ workerFeeRwf: 1, workerId })
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
      .set(as(client))
      .expect(200);
    expect(paid.body.status).toBe('PAID');
    expect(paid.body.payment.receiptReference).toMatch(/^RC-\d+$/);
    expect(paid.body.hasPendingPayment).toBe(false);

    // Ops confirms the held worker, client sees them, then marks the job done
    await http()
      .post(`/v1/admin/service-requests/${id}/assign`)
      .set(as(admin))
      .send({})
      .expect(200);
    const assigned = await http()
      .get(`/v1/service-requests/${id}`)
      .set(as(client))
      .expect(200);
    expect(assigned.body.worker).toMatchObject({
      fullName: 'Jeanne Mukamana',
      idVerified: true,
      completedJobs: 0,
    });
    expect(assigned.body.worker.phone).toBeUndefined();

    const done = await http()
      .post(`/v1/service-requests/${id}/complete`)
      .set(as(client))
      .expect(200);
    expect(done.body.status).toBe('COMPLETED');
    expect(done.body.timeline.map((t: { status: string }) => t.status)).toEqual(
      ['REQUESTED', 'PRICED', 'PAID', 'ASSIGNED', 'COMPLETED'],
    );

    const past = await http()
      .get('/v1/service-requests?scope=past')
      .set(as(client))
      .expect(200);
    expect(past.body.map((r: { id: string }) => r.id)).toEqual([id]);

    const history = await http()
      .get('/v1/payments')
      .set(as(client))
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
    await http().get(`/v1/service-requests/${id}`).set(as(admin)).expect(404);
  });
});
