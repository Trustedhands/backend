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

/** Client wallet: MoMo top-ups, ops credits, paying from it, refunds back to it. */
describe('Client wallet (e2e)', () => {
  let t: TestApp;
  let client: TestUser;
  let ops: TestUser;
  let finance: TestUser;
  let support: TestUser;
  const workerIds: string[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    client = await registerUser(t, { fullName: 'Aline Uwase' });
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
    await t.prisma.platformSettings.updateMany({
      data: { clientWalletEnabled: false },
    });
    await deleteUsers(
      t.prisma,
      [client, ops, finance, support].filter(Boolean).map((u) => u.id),
      workerIds,
    );
    await t.app.close();
  });

  const wallet = async () =>
    (await t.http().get('/v1/wallet').set(bearer(client)).expect(200)).body;

  const setWallet = (enabled: boolean) =>
    t
      .http()
      .patch('/v1/admin/settings')
      .set(bearer(ops))
      .send({ clientWalletEnabled: enabled })
      .expect(200);

  /** A cleaning visit priced at 20,000 + the 1,000 service fee. */
  async function pricedRequest(): Promise<string> {
    const workerId = await createVerifiedWorker(t, { fullName: 'Jeanne M.' });
    workerIds.push(workerId);
    const created = await t
      .http()
      .post('/v1/service-requests')
      .set(bearer(client))
      .send({
        category: 'CLEANING',
        description: 'Weekly clean',
        scheduledAt: new Date(Date.now() + 2 * 864e5).toISOString(),
        durationHours: 3,
        household: HOME,
        preferredLanguages: [],
        address: { district: 'Gasabo', sector: 'Kacyiru', street: 'KG 9 Ave' },
      })
      .expect(201);
    await t
      .http()
      .post(`/v1/admin/service-requests/${created.body.id}/price`)
      .set(bearer(ops))
      .send({ workerFeeRwf: 20_000, workerId })
      .expect(200);
    return created.body.id;
  }

  it('tops up with MoMo once the wallet is switched on', async () => {
    await setWallet(false);
    await t
      .http()
      .post('/v1/wallet/top-ups')
      .set(bearer(client))
      .send({ amountRwf: 5_000, msisdn: '0781234567' })
      .expect(502)
      .expect((r) => expect(r.body.code).toBe('wallet_disabled'));

    await setWallet(true);
    await t
      .http()
      .post('/v1/wallet/top-ups')
      .set(bearer(client))
      .send({ amountRwf: 100, msisdn: '0781234567' })
      .expect(400);
    const started = await t
      .http()
      .post('/v1/wallet/top-ups')
      .set(bearer(client))
      .send({ amountRwf: 5_000, msisdn: '0781234567' })
      .expect(201);
    expect(started.body).toMatchObject({
      status: 'PENDING',
      amountRwf: 5_000,
      msisdnMasked: '078 *** 4567',
    });
    expect((await wallet()).pendingTopUps).toHaveLength(1);

    const row = await t.prisma.walletTopUp.findUniqueOrThrow({
      where: { id: started.body.id },
    });
    t.momo.statuses.set(row.providerReference, {
      status: 'SUCCESSFUL',
      transactionId: 'top-up-tx',
    });
    // Callback and polling both see it; it's credited once
    await t.http().put(`/v1/webhooks/momo/${row.id}`).send({}).expect(200);
    const done = await t
      .http()
      .get(`/v1/wallet/top-ups/${row.id}`)
      .set(bearer(client))
      .expect(200);
    expect(done.body.status).toBe('SUCCESSFUL');

    const view = await wallet();
    expect(view).toMatchObject({
      balanceRwf: 5_000,
      enabled: true,
      pendingTopUps: [],
    });
    expect(view.entries).toEqual([
      expect.objectContaining({
        type: 'TOP_UP',
        amountRwf: 5_000,
        label: 'Top-up from Mobile Money',
      }),
    ]);
  });

  it('lets finance (not support) credit a client, with a reason', async () => {
    const path = `/v1/admin/clients/${client.id}/wallet/credits`;
    await t
      .http()
      .post(path)
      .set(bearer(support))
      .send({ amountRwf: 20_000, note: 'Cash received' })
      .expect(403);
    await t
      .http()
      .post(path)
      .set(bearer(finance))
      .send({ amountRwf: 20_000 })
      .expect(400);
    const credited = await t
      .http()
      .post(path)
      .set(bearer(finance))
      .send({ amountRwf: 20_000, note: 'Cash received at the office' })
      .expect(201);
    expect(credited.body.balanceRwf).toBe(25_000);
    expect(credited.body.entries[0]).toMatchObject({
      type: 'ADJUSTMENT',
      note: 'Cash received at the office',
      createdByName: 'Moses Finance',
    });

    // Support can still see it, and the clients list shows the balance
    await t
      .http()
      .get(`/v1/admin/clients/${client.id}/wallet`)
      .set(bearer(support))
      .expect(200);
    const list = await t
      .http()
      .get('/v1/admin/clients')
      .query({ q: client.email })
      .set(bearer(support))
      .expect(200);
    expect(list.body.items[0]).toMatchObject({
      id: client.id,
      walletBalanceRwf: 25_000,
    });
    expect(
      await t.prisma.auditEvent.count({
        where: { entityType: 'client', entityId: client.id },
      }),
    ).toBe(1);
  });

  it('pays a booking from the wallet into escrow, and refunds go back to it', async () => {
    const id = await pricedRequest();
    const paid = await t
      .http()
      .post(`/v1/service-requests/${id}/payments`)
      .set(bearer(client))
      .send({ method: 'WALLET' })
      .expect(201);
    expect(paid.body).toMatchObject({
      status: 'SUCCESSFUL',
      method: 'WALLET',
      amountRwf: 21_000,
      msisdnMasked: null,
    });

    const detail = await t
      .http()
      .get(`/v1/service-requests/${id}`)
      .set(bearer(client))
      .expect(200);
    expect(detail.body).toMatchObject({
      status: 'PAID',
      payment: { method: 'WALLET', amountRwf: 21_000 },
    });
    const escrow = await t.prisma.ledgerEntry.aggregate({
      where: { account: 'ESCROW', serviceRequestId: id },
      _sum: { amountRwf: true },
    });
    expect(escrow._sum.amountRwf).toBe(21_000);
    expect((await wallet()).balanceRwf).toBe(4_000);

    // Not enough left for a second booking
    const second = await pricedRequest();
    await t
      .http()
      .post(`/v1/service-requests/${second}/payments`)
      .set(bearer(client))
      .send({ method: 'WALLET' })
      .expect(409)
      .expect((r) => expect(r.body.code).toBe('insufficient_wallet'));
    expect((await wallet()).balanceRwf).toBe(4_000);

    // Refunds of wallet payments land in the wallet at once, no MoMo transfer
    const sent = t.transfers.sent.length;
    const refund = await t
      .http()
      .post('/v1/admin/finance/refunds')
      .set(bearer(finance))
      .send({ serviceRequestId: id, amountRwf: 6_000, reason: 'Arrived late' })
      .expect(201);
    expect(refund.body).toMatchObject({
      status: 'SUCCESSFUL',
      destination: 'WALLET',
      msisdnMasked: null,
    });
    expect(t.transfers.sent.length).toBe(sent);
    const after = await wallet();
    expect(after.balanceRwf).toBe(10_000);
    expect(after.entries[0]).toMatchObject({
      type: 'REFUND_CREDIT',
      amountRwf: 6_000,
      label: `Refund for ${detail.body.reference}`,
    });
  });

  it('keeps household details only for services that ask', async () => {
    const created = await t
      .http()
      .post('/v1/service-requests')
      .set(bearer(client))
      .send({
        category: 'DRIVER',
        kind: 'VISIT',
        description: 'Airport pickup',
        scheduledAt: new Date(Date.now() + 864e5).toISOString(),
        durationHours: 2,
        household: HOME,
        preferredLanguages: [],
        address: { district: 'Gasabo', sector: 'Kacyiru', street: 'KG 9 Ave' },
      })
      .expect(201);
    expect(created.body.household).toBeNull();
  });
});
