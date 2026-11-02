import { SettlementJob } from '../src/modules/finance/application/settlement.job.js';
import {
  HOME,
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
 * Escrow → release → refunds → payouts, against the test database, with MoMo
 * faked. Ledger assertions are per request or per worker because other suites
 * share the database.
 */
describe('Finance (e2e)', () => {
  let t: TestApp;
  let client: TestUser;
  let ops: TestUser;
  let finance: TestUser;
  let support: TestUser;
  let job: SettlementJob;
  const workerIds: string[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    job = t.app.get(SettlementJob);
    client = await registerUser(t, { fullName: 'Claire Dubois' });
    ops = await makeStaff(
      t,
      await registerUser(t, { fullName: 'Eric Ops' }),
      'SUPER_ADMIN',
    );
    finance = await makeStaff(
      t,
      await registerUser(t, { fullName: 'Moses Finance' }),
      'FINANCE',
    );
    support = await makeStaff(
      t,
      await registerUser(t, { fullName: 'Sandrine Support' }),
      'CUSTOMER_SERVICE',
    );
  });

  afterAll(async () => {
    if (!t) return;
    await deleteUsers(
      t.prisma,
      [client, ops, finance, support].filter(Boolean).map((u) => u.id),
      workerIds,
    );
    await t.app.close();
  });

  const balance = async (where: object) =>
    (await t.prisma.ledgerEntry.aggregate({ where, _sum: { amountRwf: true } }))
      ._sum.amountRwf ?? 0;
  const escrowOf = (serviceRequestId: string) =>
    balance({ account: 'ESCROW', serviceRequestId });
  const walletOf = (workerId: string) =>
    balance({ account: 'WORKER', workerId });
  const platformOn = (serviceRequestId: string) =>
    balance({ account: 'PLATFORM', serviceRequestId });

  /** A paid request with its held worker confirmed (20,000 + 1,000 fee). */
  async function paidRequest(): Promise<{
    id: string;
    workerId: string;
    paymentId: string;
  }> {
    const workerId = await createVerifiedWorker(t, {
      fullName: 'Jeanne Mukamana',
    });
    workerIds.push(workerId);
    await t.prisma.worker.update({
      where: { id: workerId },
      data: { payoutMsisdn: '+250790002210' },
    });
    const created = await t
      .http()
      .post('/v1/service-requests')
      .set(bearer(client))
      .send({
        category: 'CLEANING',
        description: 'Deep clean',
        scheduledAt: new Date(Date.now() + 2 * 864e5).toISOString(),
        durationHours: 4,
        household: HOME,
        preferredLanguages: [],
        address: { district: 'Gasabo', sector: 'Kacyiru', street: 'KG 9 Ave' },
      })
      .expect(201);
    const id: string = created.body.id;
    await t
      .http()
      .post(`/v1/admin/service-requests/${id}/price`)
      .set(bearer(ops))
      .send({ workerFeeRwf: 20_000, workerId })
      .expect(200);
    const payment = await t
      .http()
      .post(`/v1/service-requests/${id}/payments`)
      .set(bearer(client))
      .send({ msisdn: '0781234567' })
      .expect(201);
    const stored = await t.prisma.payment.findUniqueOrThrow({
      where: { id: payment.body.id },
    });
    t.momo.statuses.set(stored.providerReference!, {
      status: 'SUCCESSFUL',
      transactionId: 'tx',
    });
    await t
      .http()
      .get(`/v1/payments/${payment.body.id}`)
      .set(bearer(client))
      .expect(200);
    await t
      .http()
      .post(`/v1/admin/service-requests/${id}/assign`)
      .set(bearer(ops))
      .send({})
      .expect(200);
    return { id, workerId, paymentId: payment.body.id };
  }

  /** Completes the MoMo transfer behind the latest refund or payout and fires its callback. */
  async function completeTransfer(
    path: 'refunds' | 'payouts',
    id: string,
    ok = true,
  ) {
    const row =
      path === 'refunds'
        ? await t.prisma.refund.findUniqueOrThrow({ where: { id } })
        : await t.prisma.payout.findUniqueOrThrow({ where: { id } });
    t.transfers.statuses.set(
      row.providerReference!,
      ok
        ? { status: 'SUCCESSFUL', transactionId: 'dsb-tx' }
        : {
            status: 'FAILED',
            reason: 'The number isn’t registered for MTN Mobile Money.',
          },
    );
    await t.http().put(`/v1/webhooks/momo/${path}/${id}`).send({}).expect(200);
  }

  it('holds payments in escrow and splits them when the client confirms', async () => {
    const { id, workerId } = await paidRequest();
    expect(await escrowOf(id)).toBe(21_000);

    // Nothing is released before completion
    await job.runOnce();
    expect(await walletOf(workerId)).toBe(0);

    await t
      .http()
      .post(`/v1/service-requests/${id}/complete`)
      .set(bearer(client))
      .expect(200);
    const report = await job.runOnce();
    expect(report.released).toBeGreaterThanOrEqual(1);
    expect(await escrowOf(id)).toBe(0);
    expect(await walletOf(workerId)).toBe(20_000);
    expect(await platformOn(id)).toBe(1_000);

    // Releasing again is a no-op
    await job.runOnce();
    expect(await walletOf(workerId)).toBe(20_000);

    const txs = await t
      .http()
      .get('/v1/admin/finance/transactions?pageSize=100')
      .set(bearer(finance))
      .expect(200);
    expect(
      txs.body.items.find(
        (r: { serviceRequestId: string }) => r.serviceRequestId === id,
      ),
    ).toMatchObject({
      amountRwf: 21_000,
      workerShareRwf: 20_000,
      feeRwf: 1_000,
      status: 'SETTLED',
    });
  });

  it('completes unconfirmed jobs automatically after the release window', async () => {
    const { id, workerId } = await paidRequest();
    // Pretend the visit ended long ago
    await t.prisma.serviceRequest.update({
      where: { id },
      data: { scheduledAt: new Date(Date.now() - 3 * 864e5) },
    });
    await job.runOnce();
    const detail = await t
      .http()
      .get(`/v1/service-requests/${id}`)
      .set(bearer(client))
      .expect(200);
    expect(detail.body.status).toBe('COMPLETED');
    expect(detail.body.timeline.at(-1)).toMatchObject({
      status: 'COMPLETED',
      note: 'Completed automatically after the visit',
    });
    expect(await walletOf(workerId)).toBe(20_000);
  });

  it('refunds from escrow before release, taking it from the worker share', async () => {
    const { id, workerId } = await paidRequest();
    await t
      .http()
      .post('/v1/admin/finance/refunds')
      .set(bearer(support))
      .send({ serviceRequestId: id, amountRwf: 2_000, reason: 'Late arrival' })
      .expect(403);
    await t
      .http()
      .post('/v1/admin/finance/refunds')
      .set(bearer(finance))
      .send({ serviceRequestId: id, amountRwf: 21_001, reason: 'Too much' })
      .expect(409);

    const refund = await t
      .http()
      .post('/v1/admin/finance/refunds')
      .set(bearer(finance))
      .send({
        serviceRequestId: id,
        amountRwf: 2_000,
        reason: 'Worker arrived late; second bathroom unfinished',
      })
      .expect(201);
    expect(refund.body).toMatchObject({
      status: 'PENDING',
      chargedTo: 'ESCROW',
      msisdnMasked: '078 *** 4567',
      issuedByName: 'Moses Finance',
    });
    expect(t.transfers.sent.at(-1)).toMatchObject({
      amount: 2_000,
      msisdn: '250781234567',
      callbackPath: `refunds/${refund.body.id}`,
    });
    // Reserved immediately
    expect(await escrowOf(id)).toBe(19_000);

    await completeTransfer('refunds', refund.body.id);
    const history = await t
      .http()
      .get('/v1/payments')
      .set(bearer(client))
      .expect(200);
    expect(
      history.body.transactions.find(
        (x: { id: string }) => x.id === refund.body.id,
      ),
    ).toMatchObject({
      kind: 'REFUND',
      status: 'REFUNDED',
      amountRwf: 2_000,
    });

    await t
      .http()
      .post(`/v1/service-requests/${id}/complete`)
      .set(bearer(client))
      .expect(200);
    await job.runOnce();
    expect(await walletOf(workerId)).toBe(18_000);
    expect(await platformOn(id)).toBe(1_000);

    // After release, refunds come from the platform
    const late = await t
      .http()
      .post('/v1/admin/finance/refunds')
      .set(bearer(finance))
      .send({ serviceRequestId: id, amountRwf: 500, reason: 'Goodwill' })
      .expect(201);
    expect(late.body.chargedTo).toBe('PLATFORM');
    expect(await platformOn(id)).toBe(500);
    expect(await walletOf(workerId)).toBe(18_000);
  });

  it('returns the reserved amount when a refund transfer fails', async () => {
    const { id } = await paidRequest();
    const refund = await t
      .http()
      .post('/v1/admin/finance/refunds')
      .set(bearer(finance))
      .send({
        serviceRequestId: id,
        amountRwf: 5_000,
        reason: 'Partial cancel',
      })
      .expect(201);
    expect(await escrowOf(id)).toBe(16_000);
    await completeTransfer('refunds', refund.body.id, false);
    expect(await escrowOf(id)).toBe(21_000);
    const stored = await t.prisma.refund.findUniqueOrThrow({
      where: { id: refund.body.id },
    });
    expect(stored).toMatchObject({ status: 'FAILED' });

    // A rejected transfer fails straight away
    t.transfers.rejectNext = true;
    const rejected = await t
      .http()
      .post('/v1/admin/finance/refunds')
      .set(bearer(finance))
      .send({ serviceRequestId: id, amountRwf: 1_000, reason: 'Retry' })
      .expect(201);
    expect(rejected.body.status).toBe('FAILED');
    expect(await escrowOf(id)).toBe(21_000);
  });

  it('gives the platform what was not refunded on a cancelled paid job', async () => {
    const { id, workerId } = await paidRequest();
    await t
      .http()
      .post(`/v1/admin/service-requests/${id}/cancel`)
      .set(bearer(ops))
      .send({ reason: 'Client no longer needs it' })
      .expect(200);
    const refund = await t
      .http()
      .post('/v1/admin/finance/refunds')
      .set(bearer(finance))
      .send({ serviceRequestId: id, amountRwf: 15_000, reason: 'Cancelled' })
      .expect(201);

    // Only this request is moved back in time; the job itself runs at the real now
    const cancelledLongAgo = () =>
      t.prisma.serviceRequestEvent.updateMany({
        where: { serviceRequestId: id, status: 'CANCELLED' },
        data: { createdAt: new Date(Date.now() - 3 * 864e5) },
      });

    // Inside the release window: nothing moves
    await job.runOnce();
    expect(await escrowOf(id)).toBe(6_000);

    // Past the window but with the refund still in flight: still nothing
    await cancelledLongAgo();
    await job.runOnce();
    expect(await escrowOf(id)).toBe(6_000);

    // Refund done: the remainder goes to the platform; the worker gets nothing
    await completeTransfer('refunds', refund.body.id);
    await job.runOnce();
    expect(await escrowOf(id)).toBe(0);
    expect(await platformOn(id)).toBe(6_000);
    expect(await walletOf(workerId)).toBe(0);

    const txs = await t
      .http()
      .get('/v1/admin/finance/transactions?pageSize=100')
      .set(bearer(finance))
      .expect(200);
    expect(
      txs.body.items.find(
        (r: { serviceRequestId: string }) => r.serviceRequestId === id,
      ),
    ).toMatchObject({
      workerShareRwf: 0,
      feeRwf: 6_000,
      refundedRwf: 15_000,
      status: 'SETTLED',
      requestCancelled: true,
    });
  });

  it('pays workers out by MoMo, never more than their wallet, and reverses failures', async () => {
    const { id, workerId } = await paidRequest();
    await t
      .http()
      .post(`/v1/service-requests/${id}/complete`)
      .set(bearer(client))
      .expect(200);
    await job.runOnce();
    expect(await walletOf(workerId)).toBe(20_000);

    const list = await t
      .http()
      .get('/v1/admin/finance/payouts')
      .set(bearer(finance))
      .expect(200);
    expect(
      list.body.toPay.find(
        (w: { workerId: string }) => w.workerId === workerId,
      ),
    ).toMatchObject({
      balanceRwf: 20_000,
      payoutMethod: 'MOMO',
      destination: 'MoMo · 079 *** 2210',
    });

    await t
      .http()
      .post('/v1/admin/finance/payouts')
      .set(bearer(finance))
      .send({ workerId, amountRwf: 20_001, method: 'MOMO' })
      .expect(409);
    await t
      .http()
      .post('/v1/admin/finance/payouts')
      .set(bearer(finance))
      .send({ workerId, method: 'BANK' })
      .expect(422);

    const failing = await t
      .http()
      .post('/v1/admin/finance/payouts')
      .set(bearer(finance))
      .send({ workerId, amountRwf: 5_000, method: 'MOMO' })
      .expect(201);
    expect(await walletOf(workerId)).toBe(15_000);
    await completeTransfer('payouts', failing.body.id, false);
    expect(await walletOf(workerId)).toBe(20_000);

    const payout = await t
      .http()
      .post('/v1/admin/finance/payouts')
      .set(bearer(finance))
      .send({ workerId, method: 'MOMO' })
      .expect(201);
    expect(payout.body).toMatchObject({
      amountRwf: 20_000,
      status: 'PENDING',
      initiatedByName: 'Moses Finance',
    });
    expect(t.transfers.sent.at(-1)).toMatchObject({
      amount: 20_000,
      msisdn: '250790002210',
    });
    await completeTransfer('payouts', payout.body.id);
    expect(await walletOf(workerId)).toBe(0);
    const done = await t.prisma.payout.findUniqueOrThrow({
      where: { id: payout.body.id },
    });
    expect(done.status).toBe('SUCCESSFUL');

    const wallet = await t
      .http()
      .get(`/v1/admin/finance/workers/${workerId}/wallet`)
      .set(bearer(ops))
      .expect(200);
    expect(wallet.body.balanceRwf).toBe(0);
    expect(wallet.body.entries.map((e: { kind: string }) => e.kind)).toEqual(
      expect.arrayContaining([
        'RELEASED_TO_WORKER',
        'PAYOUT',
        'PAYOUT_REVERSED',
      ]),
    );
  });

  it('records bank payouts when finance confirms them', async () => {
    const { id, workerId } = await paidRequest();
    await t.prisma.worker.update({
      where: { id: workerId },
      data: {
        payoutBankName: 'Bank of Kigali',
        payoutBankAccount: '000123454410',
      },
    });
    await t
      .http()
      .post(`/v1/service-requests/${id}/complete`)
      .set(bearer(client))
      .expect(200);
    await job.runOnce();

    const bank = await t
      .http()
      .post('/v1/admin/finance/payouts')
      .set(bearer(finance))
      .send({ workerId, amountRwf: 10_000, method: 'BANK' })
      .expect(201);
    expect(bank.body).toMatchObject({
      status: 'PENDING',
      destination: 'Bank of Kigali · •••• 4410',
    });
    const paid = await t
      .http()
      .post(`/v1/admin/finance/payouts/${bank.body.id}/mark-paid`)
      .set(bearer(finance))
      .send({ reference: 'BK-778812' })
      .expect(200);
    expect(paid.body).toMatchObject({
      status: 'SUCCESSFUL',
      manualReference: 'BK-778812',
    });
    await t
      .http()
      .post(`/v1/admin/finance/payouts/${bank.body.id}/mark-failed`)
      .set(bearer(finance))
      .send({ reason: 'Bounced' })
      .expect(409);

    const second = await t
      .http()
      .post('/v1/admin/finance/payouts')
      .set(bearer(finance))
      .send({ workerId, amountRwf: 4_000, method: 'BANK' })
      .expect(201);
    await t
      .http()
      .post(`/v1/admin/finance/payouts/${second.body.id}/mark-failed`)
      .set(bearer(finance))
      .send({ reason: 'Wrong account' })
      .expect(200);
    expect(await walletOf(workerId)).toBe(10_000);
  });

  it('reports totals, exports CSV, and shows money only to finance roles', async () => {
    const overview = await t
      .http()
      .get('/v1/admin/finance/overview')
      .set(bearer(finance))
      .expect(200);
    expect(overview.body).toEqual(
      expect.objectContaining({
        escrowRwf: expect.any(Number),
        platformBalanceRwf: expect.any(Number),
        workerWalletsRwf: expect.any(Number),
      }),
    );
    await t
      .http()
      .get('/v1/admin/finance/overview')
      .set(bearer(support))
      .expect(403);

    const csv = await t
      .http()
      .get('/v1/admin/finance/transactions.csv')
      .set(bearer(finance))
      .expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.split('\r\n')[0]).toBe(
      'Receipt,Paid at,Client,Service,Request,Paid (RWF),Worker (RWF),Fee (RWF),Refunded (RWF),Status',
    );
    expect(csv.text).toContain('Claire Dubois');

    const forFinance = await t
      .http()
      .get('/v1/admin/dashboard')
      .set(bearer(finance))
      .expect(200);
    expect(forFinance.body.finance).toEqual(
      expect.objectContaining({ feesThisMonthRwf: expect.any(Number) }),
    );
    const forSupport = await t
      .http()
      .get('/v1/admin/dashboard')
      .set(bearer(support))
      .expect(200);
    expect(forSupport.body.finance).toBeNull();
  });

  it('runs settlement on demand only with the cron secret', async () => {
    const path = '/v1/internal/settlement';
    await t.http().get(path).expect(401);
    await t.http().get(path).set(bearer(ops)).expect(401);
    await t
      .http()
      .get(path)
      .set('Authorization', 'Bearer not-the-cron-secret-at-all-0123456789')
      .expect(401);
    const run = await t
      .http()
      .get(path)
      .set('Authorization', `Bearer ${process.env['CRON_SECRET']}`)
      .expect(200);
    expect(run.body).toEqual({
      autoCompleted: expect.any(Number),
      released: expect.any(Number),
      paymentsChecked: expect.any(Number),
      transfersChecked: expect.any(Number),
    });
  });
});
