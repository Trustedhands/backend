import { SettlementJob } from '../src/modules/finance/application/settlement.job.js';
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

/** Long-term placements (house help, drivers): match fee instead of a per-visit price. */
describe('Placements (e2e)', () => {
  let t: TestApp;
  let client: TestUser;
  let ops: TestUser;
  const workerIds: string[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    client = await registerUser(t, { fullName: 'Amara Osei' });
    ops = await makeStaff(t, await registerUser(t, { fullName: 'Eric Ops' }));
  });

  afterAll(async () => {
    if (!t) return;
    await deleteUsers(
      t.prisma,
      [client, ops].filter(Boolean).map((u) => u.id),
      workerIds,
    );
    await t.app.close();
  });

  const address = {
    district: 'Gasabo',
    sector: 'Nyarutarama',
    street: 'KG 5 Ave',
  };
  const inDays = (d: number) => new Date(Date.now() + d * 864e5).toISOString();
  const submit = (body: Record<string, unknown>) =>
    t
      .http()
      .post('/v1/service-requests')
      .set(bearer(client))
      .send({
        description: 'Live-out house help for a family of four',
        preferredLanguages: ['EN'],
        address,
        ...body,
      });
  const worker = async (name: string) => {
    const id = await createVerifiedWorker(t, {
      fullName: name,
      categories: ['HOUSE_HELP', 'DRIVER', 'CLEANING'],
      languages: ['EN'],
    });
    workerIds.push(id);
    return id;
  };

  it('takes placement terms instead of a duration', async () => {
    const created = await submit({
      category: 'HOUSE_HELP',
      scheduledAt: inDays(10),
      placement: { arrangement: 'LIVE_OUT', daysPerWeek: 6, salaryRwf: 80_000 },
    }).expect(201);
    expect(created.body).toMatchObject({
      kind: 'PLACEMENT',
      categoryLabel: 'House help (long-term)',
      durationHours: null,
      placement: { arrangement: 'LIVE_OUT', daysPerWeek: 6, salaryRwf: 80_000 },
    });

    await submit({ category: 'HOUSE_HELP', scheduledAt: inDays(10) })
      .expect(422)
      .expect((r) => expect(r.body.code).toBe('placement_required'));
    await submit({
      category: 'HOUSE_HELP',
      scheduledAt: inDays(10),
      placement: { arrangement: 'LIVE_IN', daysPerWeek: 8 },
    }).expect(400);
  });

  it('lets "either" services be a visit or a placement', async () => {
    const trip = await submit({
      category: 'DRIVER',
      kind: 'VISIT',
      scheduledAt: inDays(3),
      durationHours: 2,
    }).expect(201);
    expect(trip.body).toMatchObject({
      kind: 'VISIT',
      durationHours: 2,
      placement: null,
    });
    const driver = await submit({
      category: 'DRIVER',
      kind: 'PLACEMENT',
      scheduledAt: inDays(14),
      placement: { arrangement: 'LIVE_OUT', daysPerWeek: 5 },
    }).expect(201);
    expect(driver.body).toMatchObject({
      kind: 'PLACEMENT',
      placement: { salaryRwf: null },
    });
    // A visit still needs a duration
    await submit({
      category: 'DRIVER',
      kind: 'VISIT',
      scheduledAt: inDays(3),
    }).expect(422);
  });

  it('charges the match fee, flags placement clashes, and gives the platform the whole fee', async () => {
    const settings = await t
      .http()
      .get('/v1/admin/settings')
      .set(bearer(ops))
      .expect(200);
    const matchFee: number = settings.body.matchFeeRwf;
    const busy = await worker('Grace Ineza');
    const free = await worker('Alice Umutoni');

    // Grace is already held for another placement
    const first = await submit({
      category: 'HOUSE_HELP',
      scheduledAt: inDays(20),
      placement: { arrangement: 'LIVE_IN', daysPerWeek: 6 },
    }).expect(201);
    await t
      .http()
      .post(`/v1/admin/service-requests/${first.body.id}/price`)
      .set(bearer(ops))
      .send({ workerFeeRwf: 0, workerId: busy })
      .expect(200);

    const id: string = (
      await submit({
        category: 'HOUSE_HELP',
        scheduledAt: inDays(12),
        placement: {
          arrangement: 'LIVE_OUT',
          daysPerWeek: 6,
          salaryRwf: 90_000,
        },
      }).expect(201)
    ).body.id;
    const suggestions = await t
      .http()
      .get(`/v1/admin/service-requests/${id}/suggested-workers`)
      .set(bearer(ops))
      .expect(200);
    const byId = Object.fromEntries(
      suggestions.body.map((s: { id: string }) => [s.id, s]),
    );
    expect(byId[busy]).toMatchObject({
      available: false,
      conflict: { reference: expect.stringMatching(/^SR-/) },
    });
    expect(byId[free]).toMatchObject({ available: true });

    // A visit after Grace's placement starts clashes too
    const visit = await submit({
      category: 'CLEANING',
      scheduledAt: inDays(25),
      durationHours: 3,
    }).expect(201);
    const visitSuggestions = await t
      .http()
      .get(`/v1/admin/service-requests/${visit.body.id}/suggested-workers`)
      .set(bearer(ops))
      .expect(200);
    expect(
      visitSuggestions.body.find((s: { id: string }) => s.id === busy),
    ).toMatchObject({ available: false });

    // Priced at the match fee; any worker fee entered is ignored
    const priced = await t
      .http()
      .post(`/v1/admin/service-requests/${id}/price`)
      .set(bearer(ops))
      .send({ workerFeeRwf: 50_000, workerId: free })
      .expect(200);
    expect(priced.body).toMatchObject({
      totalRwf: matchFee,
      quote: { workerFeeRwf: 0, serviceFeeRwf: matchFee },
    });

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

    // Client confirms the worker has started
    await t
      .http()
      .post(`/v1/service-requests/${id}/complete`)
      .set(bearer(client))
      .expect(200);
    await t.app.get(SettlementJob).runOnce();
    const sum = async (where: object) =>
      (
        await t.prisma.ledgerEntry.aggregate({
          where,
          _sum: { amountRwf: true },
        })
      )._sum.amountRwf ?? 0;
    expect(await sum({ account: 'PLATFORM', serviceRequestId: id })).toBe(
      matchFee,
    );
    expect(await sum({ account: 'WORKER', workerId: free })).toBe(0);
    expect(await sum({ account: 'ESCROW', serviceRequestId: id })).toBe(0);
  });
});
