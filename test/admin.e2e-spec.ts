import { randomUUID } from 'node:crypto';
import {
  bearer,
  createTestApp,
  createVerifiedWorker,
  deleteUsers,
  makeStaff,
  registerUser,
  testEmail,
  testPhone,
  type TestApp,
  type TestUser,
} from './support.js';

/** Smallest valid PNG (1×1) */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/**
 * The admin console's API against the real database. Suites run in parallel on
 * one database, so this one never changes settings other suites rely on.
 */
describe('Admin console (e2e)', () => {
  let t: TestApp;
  let superAdmin: TestUser;
  let lead: TestUser;
  let finance: TestUser;
  let support: TestUser;
  let client: TestUser;
  const users: string[] = [];
  const workerIds: string[] = [];
  const serviceKeys: string[] = [];

  const staff = async (name: string, role: Parameters<typeof makeStaff>[2]) => {
    const user = await makeStaff(
      t,
      await registerUser(t, { fullName: name }),
      role,
    );
    users.push(user.id);
    return user;
  };

  beforeAll(async () => {
    t = await createTestApp();
    superAdmin = await staff('Eric Nkurunziza', 'SUPER_ADMIN');
    lead = await staff('Aline Kayitesi', 'VERIFICATION_LEAD');
    finance = await staff('Moses Bizimana', 'FINANCE');
    support = await staff('Sandrine Mukamana', 'CUSTOMER_SERVICE');
    client = await registerUser(t, { fullName: 'Claire Dubois' });
    users.push(client.id);
    await t.http().put('/v1/me/home-address').set(bearer(client)).send({
      district: 'Gasabo',
      sector: 'Kimihurura',
      street: 'KG 674 St',
      latitude: -1.9536,
      longitude: 30.0935,
    });
  });

  afterAll(async () => {
    if (!t) return;
    const invited = await t.prisma.user.findMany({
      where: { email: { startsWith: 'e2e-invite-' } },
      select: { id: true },
    });
    await deleteUsers(
      t.prisma,
      [...users, ...invited.map((u) => u.id)],
      workerIds,
    );
    await t.prisma.serviceType.deleteMany({
      where: { key: { in: serviceKeys } },
    });
    await t.app.close();
  });

  const newRequest = (overrides: Record<string, unknown> = {}) =>
    t
      .http()
      .post('/v1/service-requests')
      .set(bearer(client))
      .send({
        category: 'CLEANING',
        description:
          'Guest house, 6 rooms. Change linen and clean common areas.',
        scheduledAt: new Date(Date.now() + 3 * 864e5).toISOString(),
        durationHours: 4,
        preferredGender: 'FEMALE',
        preferredLanguages: ['FR'],
        address: {
          district: 'Gasabo',
          sector: 'Kimihurura',
          street: 'KG 674 St',
          latitude: -1.9536,
          longitude: 30.0935,
        },
        ...overrides,
      })
      .expect(201)
      .then((r) => r.body.id as string);

  describe('roles and permissions', () => {
    it('reports each staff member’s permissions', async () => {
      const me = await t
        .http()
        .get('/v1/admin/me')
        .set(bearer(lead))
        .expect(200);
      expect(me.body).toMatchObject({
        staffRole: 'VERIFICATION_LEAD',
        fullName: 'Aline Kayitesi',
      });
      expect(me.body.permissions).toEqual(
        expect.arrayContaining(['workers.manage', 'workers.verify']),
      );
      expect(me.body.permissions).not.toContain('requests.manage');
      await t.http().get('/v1/admin/me').set(bearer(client)).expect(403);
    });

    it('limits each role to its own actions', async () => {
      const id = await newRequest();
      const workerId = await createVerifiedWorker(t);
      workerIds.push(workerId);
      await t
        .http()
        .post(`/v1/admin/service-requests/${id}/price`)
        .set(bearer(finance))
        .send({ workerFeeRwf: 1000, workerId })
        .expect(403);
      await t
        .http()
        .post('/v1/admin/workers')
        .set(bearer(support))
        .send({ fullName: 'X', gender: 'MALE', phone: testPhone() })
        .expect(403);
      await t.http().get('/v1/admin/team').set(bearer(lead)).expect(403);
      await t
        .http()
        .patch('/v1/admin/settings')
        .set(bearer(finance))
        .send({ vouchersEnabled: false })
        .expect(403);
      // Everyone can see the dashboard and requests
      await t
        .http()
        .get('/v1/admin/dashboard')
        .set(bearer(support))
        .expect(200);
      await t
        .http()
        .get(`/v1/admin/service-requests/${id}`)
        .set(bearer(finance))
        .expect(200);
    });
  });

  describe('team', () => {
    it('invites by email; the link creates a staff account and signs in', async () => {
      const email = `e2e-invite-${randomUUID()}@example.test`;
      const team = await t
        .http()
        .post('/v1/admin/team/invitations')
        .set(bearer(superAdmin))
        .send({ email, staffRole: 'CUSTOMER_SERVICE' })
        .expect(201);
      expect(
        team.body.pendingInvitations.map((i: { email: string }) => i.email),
      ).toContain(email);

      const message = t.mailer.sent.findLast((m) => m.to === email)!;
      expect(message.subject).toContain('invited you');
      const token = message.text.match(/token=([\w-]+)/)![1]!;

      const preview = await t
        .http()
        .get(`/v1/team/invitations/${token}`)
        .expect(200);
      expect(preview.body).toMatchObject({
        email,
        staffRole: 'CUSTOMER_SERVICE',
        invitedBy: 'Eric Nkurunziza',
      });

      const accepted = await t
        .http()
        .post('/v1/team/invitations/accept')
        .send({
          token,
          fullName: 'New Agent',
          password: 'kigali2026',
          phone: testPhone(),
        })
        .expect(201);
      expect(accepted.headers['set-cookie']?.toString()).toContain(
        'th_refresh_admin=',
      );
      const me = await t
        .http()
        .get('/v1/admin/me')
        .set(bearer({ token: accepted.body.accessToken }))
        .expect(200);
      expect(me.body).toMatchObject({ staffRole: 'CUSTOMER_SERVICE', email });

      // The link works once
      await t
        .http()
        .post('/v1/team/invitations/accept')
        .send({
          token,
          fullName: 'Again',
          password: 'kigali2026',
          phone: testPhone(),
        })
        .expect(422);
    });

    it('refuses to invite an existing account and protects the last super admin', async () => {
      await t
        .http()
        .post('/v1/admin/team/invitations')
        .set(bearer(superAdmin))
        .send({ email: client.email, staffRole: 'FINANCE' })
        .expect(409)
        .expect((r) => expect(r.body.code).toBe('email_in_use'));
      await t
        .http()
        .patch(`/v1/admin/team/${superAdmin.id}`)
        .set(bearer(superAdmin))
        .send({ disabled: true })
        .expect(403);
    });

    it('removing access signs the member out and blocks admin endpoints', async () => {
      const temp = await staff('Temporary Staff', 'FINANCE');
      await t
        .http()
        .patch(`/v1/admin/team/${temp.id}`)
        .set(bearer(superAdmin))
        .send({ disabled: true })
        .expect(200);
      await t.http().get('/v1/admin/dashboard').set(bearer(temp)).expect(403);
      await t
        .http()
        .post('/v1/auth/refresh')
        .set('Cookie', temp.cookie)
        .expect(401);
    });
  });

  describe('settings and service types', () => {
    it('updates settings and logs who changed what', async () => {
      const before = await t
        .http()
        .get('/v1/admin/settings')
        .set(bearer(finance))
        .expect(200);
      const toggled = !before.body.vouchersEnabled;
      await t
        .http()
        .patch('/v1/admin/settings')
        .set(bearer(superAdmin))
        .send({ vouchersEnabled: toggled })
        .expect(200);
      const event = await t.prisma.auditEvent.findFirst({
        where: { actorId: superAdmin.id, action: 'settings.updated' },
        orderBy: { createdAt: 'desc' },
      });
      expect(event?.data).toEqual({
        vouchersEnabled: { from: !toggled, to: toggled },
      });
      await t
        .http()
        .patch('/v1/admin/settings')
        .set(bearer(superAdmin))
        .send({ vouchersEnabled: before.body.vouchersEnabled })
        .expect(200);
      await t
        .http()
        .patch('/v1/admin/settings')
        .set(bearer(superAdmin))
        .send({ matchingPriority: ['RATING'] })
        .expect(422);
    });

    it('pausing MoMo stops new payments until it is switched back on', async () => {
      const id = await newRequest();
      const workerId = await createVerifiedWorker(t);
      workerIds.push(workerId);
      await t
        .http()
        .post(`/v1/admin/service-requests/${id}/price`)
        .set(bearer(superAdmin))
        .send({ workerFeeRwf: 10000, workerId })
        .expect(200);
      await t
        .http()
        .patch('/v1/admin/settings')
        .set(bearer(superAdmin))
        .send({ momoEnabled: false })
        .expect(200);
      try {
        await t
          .http()
          .post(`/v1/service-requests/${id}/payments`)
          .set(bearer(client))
          .send({ msisdn: '0781234567' })
          .expect(502)
          .expect((r) => expect(r.body.code).toBe('payments_paused'));
      } finally {
        await t
          .http()
          .patch('/v1/admin/settings')
          .set(bearer(superAdmin))
          .send({ momoEnabled: true })
          .expect(200);
      }
      await t
        .http()
        .post(`/v1/service-requests/${id}/payments`)
        .set(bearer(client))
        .send({ msisdn: '0781234567' })
        .expect(201);
    });

    it('adds and hides services; clients only see and request visible ones', async () => {
      const key = `E2E_${randomUUID().slice(0, 8).toUpperCase().replace(/-/g, '')}`;
      serviceKeys.push(key);
      await t
        .http()
        .post('/v1/admin/settings/service-types')
        .set(bearer(superAdmin))
        .send({
          key,
          label: 'Gardening',
          feeType: 'SERVICE',
          pricingGuide: '6,000 RWF / hour',
        })
        .expect(201);
      const visible = await t.http().get('/v1/service-types').expect(200);
      expect(visible.body.map((s: { key: string }) => s.key)).toContain(key);

      await t
        .http()
        .patch(`/v1/admin/settings/service-types/${key}`)
        .set(bearer(superAdmin))
        .send({ visible: false })
        .expect(200);
      const after = await t.http().get('/v1/service-types').expect(200);
      expect(after.body.map((s: { key: string }) => s.key)).not.toContain(key);
      await t
        .http()
        .post('/v1/service-requests')
        .set(bearer(client))
        .send({
          category: key,
          description: 'Trim the hedges',
          scheduledAt: new Date(Date.now() + 864e5).toISOString(),
          durationHours: 2,
          preferredLanguages: [],
          address: {
            district: 'Gasabo',
            sector: 'Kimihurura',
            street: 'KG 674 St',
          },
        })
        .expect(422)
        .expect((r) => expect(r.body.code).toBe('unknown_service'));
    });
  });

  describe('worker onboarding and verification', () => {
    const fullProfile = () => ({
      fullName: 'Diane Uwase',
      gender: 'FEMALE',
      dateOfBirth: '1994-06-12',
      nationality: 'Rwanda',
      languages: ['RW', 'EN'],
      categories: ['COOKING', 'CLEANING'],
      phone: testPhone(),
      province: 'Kigali City',
      district: 'Gasabo',
      sector: 'Kimironko',
      cell: 'Bibare',
      village: 'Imena',
      latitude: -1.9441,
      longitude: 30.1269,
      experience: '4 years as a cook for a family in Nyarutarama.',
      idType: 'NATIONAL_ID',
      idNumber: '1 1994 7 0012345 0 12',
      nextOfKinName: 'Emmanuel Uwase',
      nextOfKinRelation: 'brother',
      nextOfKinPhone: testPhone(),
      payoutMsisdn: testPhone(),
    });

    const upload = (id: string, kind: string, as: TestUser = lead) =>
      t
        .http()
        .post(`/v1/admin/workers/${id}/documents/${kind}`)
        .set(bearer(as))
        .attach('file', PNG, `${kind}.png`);

    it('creates, completes, and verifies with a second admin', async () => {
      const created = await t
        .http()
        .post('/v1/admin/workers')
        .set(bearer(lead))
        .send(fullProfile())
        .expect(201);
      const id: string = created.body.id;
      workerIds.push(id);
      expect(created.body).toMatchObject({
        status: 'DRAFT',
        idNumber: '11994700123450 12'.replace(/\s/g, ''),
        createdByName: 'Aline Kayitesi',
      });
      expect(
        created.body.checklist.find(
          (c: { key: string }) => c.key === 'identity',
        ),
      ).toMatchObject({ done: false, missing: 'ID front' });

      // Can't submit with documents missing
      await t
        .http()
        .post(`/v1/admin/workers/${id}/submit`)
        .set(bearer(lead))
        .expect(422);
      await upload(id, 'PHOTO').expect(201);
      await upload(id, 'ID_FRONT').expect(201);
      const withDocs = await upload(id, 'ID_BACK').expect(201);
      expect(
        withDocs.body.checklist.every((c: { done: boolean }) => c.done),
      ).toBe(true);
      await t
        .http()
        .post(`/v1/admin/workers/${id}/documents/PHOTO`)
        .set(bearer(lead))
        .attach('file', Buffer.from('%PDF-1.7 id'), 'photo.pdf')
        .expect(422);

      const submitted = await t
        .http()
        .post(`/v1/admin/workers/${id}/submit`)
        .set(bearer(lead))
        .expect(201);
      expect(submitted.body.status).toBe('PENDING_VERIFICATION');

      const allChecks = {
        fullName: true,
        dateOfBirth: true,
        idNumber: true,
        photo: true,
        reference: true,
      };
      await t
        .http()
        .post(`/v1/admin/workers/${id}/verify`)
        .set(bearer(superAdmin))
        .send({ checks: { ...allChecks, reference: false } })
        .expect(422);
      const verified = await t
        .http()
        .post(`/v1/admin/workers/${id}/verify`)
        .set(bearer(superAdmin))
        .send({ checks: allChecks, comment: 'Reference confirmed by phone' })
        .expect(201);
      expect(verified.body).toMatchObject({
        status: 'VERIFIED',
        verifiedByName: 'Eric Nkurunziza',
      });
      expect(
        verified.body.activity.map((a: { action: string }) => a.action),
      ).toEqual(
        expect.arrayContaining([
          'worker.created',
          'worker.document_uploaded',
          'worker.submitted',
          'worker.verified',
        ]),
      );

      const photo = await t
        .http()
        .get(`/v1/admin/workers/${id}/documents/PHOTO`)
        .set(bearer(finance))
        .buffer(true)
        .expect(200);
      expect(photo.headers['content-type']).toBe('image/png');
      expect(photo.headers['content-security-policy']).toContain('sandbox');

      // Changing identity details sends the worker back to verification
      const edited = await t
        .http()
        .patch(`/v1/admin/workers/${id}`)
        .set(bearer(lead))
        .send({ idNumber: '1199470099999012' })
        .expect(200);
      expect(edited.body.status).toBe('PENDING_VERIFICATION');
      // …but contact details don't
      await t
        .http()
        .post(`/v1/admin/workers/${id}/verify`)
        .set(bearer(superAdmin))
        .send({ checks: allChecks })
        .expect(201);
      const contact = await t
        .http()
        .patch(`/v1/admin/workers/${id}`)
        .set(bearer(lead))
        .send({ phone: testPhone() })
        .expect(200);
      expect(contact.body.status).toBe('VERIFIED');
    });

    it('declines with a reason; unverified workers can’t be held', async () => {
      const created = await t
        .http()
        .post('/v1/admin/workers')
        .set(bearer(lead))
        .send(fullProfile())
        .expect(201);
      const id: string = created.body.id;
      workerIds.push(id);
      for (const kind of ['PHOTO', 'ID_FRONT', 'ID_BACK'])
        await upload(id, kind).expect(201);
      await t
        .http()
        .post(`/v1/admin/workers/${id}/submit`)
        .set(bearer(lead))
        .expect(201);

      const requestId = await newRequest();
      await t
        .http()
        .post(`/v1/admin/service-requests/${requestId}/price`)
        .set(bearer(superAdmin))
        .send({ workerFeeRwf: 15000, workerId: id })
        .expect(409)
        .expect((r) => expect(r.body.code).toBe('worker_not_assignable'));

      await t
        .http()
        .post(`/v1/admin/workers/${id}/decline`)
        .set(bearer(superAdmin))
        .send({ reason: 'x' })
        .expect(400);
      const declined = await t
        .http()
        .post(`/v1/admin/workers/${id}/decline`)
        .set(bearer(superAdmin))
        .send({ reason: "Profile photo doesn't match the ID" })
        .expect(201);
      expect(declined.body).toMatchObject({
        status: 'DECLINED',
        declineReason: "Profile photo doesn't match the ID",
      });
    });
  });

  describe('price & match', () => {
    it('suggests workers by availability, language and gender, flags clashes, and reminds', async () => {
      const near = await createVerifiedWorker(t, {
        fullName: 'Grace Ineza',
        languages: ['FR', 'RW'],
        latitude: -1.9541,
        longitude: 30.094,
      });
      const english = await createVerifiedWorker(t, {
        fullName: 'Alice Umutoni',
        languages: ['EN'],
        latitude: -1.96,
        longitude: 30.12,
      });
      const male = await createVerifiedWorker(t, {
        fullName: 'Jean Ndayisaba',
        gender: 'MALE',
        languages: ['FR'],
      });
      const busy = await createVerifiedWorker(t, {
        fullName: 'Chantal Mukeshimana',
        languages: ['FR'],
      });
      workerIds.push(near, english, male, busy);

      const when = new Date(Date.now() + 5 * 864e5);
      const other = await newRequest({ scheduledAt: when.toISOString() });
      await t
        .http()
        .post(`/v1/admin/service-requests/${other}/price`)
        .set(bearer(superAdmin))
        .send({ workerFeeRwf: 15000, workerId: busy })
        .expect(200);

      const id = await newRequest({
        scheduledAt: new Date(when.getTime() + 60 * 60_000).toISOString(),
      });
      const suggestions = await t
        .http()
        .get(`/v1/admin/service-requests/${id}/suggested-workers`)
        .set(bearer(superAdmin))
        .expect(200);
      const ours = suggestions.body.filter((s: { id: string }) =>
        [near, english, male, busy].includes(s.id),
      );
      expect(ours.map((s: { id: string }) => s.id)).toEqual(
        [near, male, english, busy]
          .filter(() => true)
          .sort(
            (a, b) =>
              ours.findIndex((s: { id: string }) => s.id === a) -
              ours.findIndex((s: { id: string }) => s.id === b),
          ),
      );
      const byId = Object.fromEntries(
        ours.map((s: { id: string }) => [s.id, s]),
      );
      expect(byId[busy]).toMatchObject({
        available: false,
        conflict: { reference: expect.stringMatching(/^SR-/) },
      });
      expect(byId[near]).toMatchObject({
        available: true,
        languageMatch: true,
        genderMatch: true,
      });
      expect(byId[near].distanceKm).toBeLessThan(1);
      expect(byId[male]).toMatchObject({ genderMatch: false });
      expect(byId[english]).toMatchObject({ languageMatch: false });
      // Available + language + gender match sorts first; the busy worker sorts last
      expect(ours[0].id).toBe(near);
      expect(ours.at(-1).id).toBe(busy);

      await t
        .http()
        .post(`/v1/admin/service-requests/${id}/price`)
        .set(bearer(superAdmin))
        .send({ workerFeeRwf: 15000, workerId: near })
        .expect(200);
      const pipeline = await t
        .http()
        .get('/v1/admin/service-requests/pipeline?days=30')
        .set(bearer(support))
        .expect(200);
      const priced = pipeline.body.columns.find(
        (c: { key: string }) => c.key === 'PRICED',
      );
      expect(priced.cards.map((c: { id: string }) => c.id)).toEqual(
        expect.arrayContaining([id, other]),
      );

      const reminded = await t
        .http()
        .post(`/v1/admin/service-requests/${id}/remind`)
        .set(bearer(superAdmin))
        .expect(200);
      expect(reminded.body.remindedAt).toEqual(expect.any(String));
      expect(
        t.mailer.sent.findLast((m) => m.to === client.email)?.subject,
      ).toContain('Your price for Cleaning is ready');
      await t
        .http()
        .post(`/v1/admin/service-requests/${id}/remind`)
        .set(bearer(superAdmin))
        .expect(409)
        .expect((r) => expect(r.body.code).toBe('reminder_cooldown'));
    });
  });

  describe('customer service', () => {
    it('assigns, notes internally and replies to the client by email', async () => {
      const ticket = await t
        .http()
        .post('/v1/support/tickets')
        .set(bearer(client))
        .field(
          'description',
          'Price question\nWhy is laundry more expensive this week?',
        )
        .expect(201);
      const id: string = ticket.body.id;

      await t
        .http()
        .patch(`/v1/admin/support/tickets/${id}`)
        .set(bearer(support))
        .send({ assignedToId: support.id })
        .expect(200);
      await t
        .http()
        .post(`/v1/admin/support/tickets/${id}/notes`)
        .set(bearer(support))
        .send({ body: 'Checked: extra ironing.' })
        .expect(201);
      await t
        .http()
        .post(`/v1/admin/support/tickets/${id}/replies`)
        .set(bearer(finance))
        .send({ body: 'Hi' })
        .expect(403);
      const replied = await t
        .http()
        .post(`/v1/admin/support/tickets/${id}/replies`)
        .set(bearer(support))
        .send({
          body: 'Hi Claire, the price included extra ironing. Happy to adjust next time.',
        })
        .expect(201);
      expect(replied.body).toMatchObject({
        status: 'ACTIVE',
        assignedTo: { id: support.id, fullName: 'Sandrine Mukamana' },
        notes: [
          {
            body: 'Checked: extra ironing.',
            author: { fullName: 'Sandrine Mukamana' },
          },
        ],
        replies: [{ body: expect.stringContaining('extra ironing') }],
      });
      const email = t.mailer.sent.findLast((m) => m.to === client.email)!;
      expect(email.subject).toBe(
        `Re: Price question (${ticket.body.reference})`,
      );
      expect(email.text).toContain('Sandrine Mukamana');
    });
  });

  describe('dashboard, search and clients', () => {
    it('summarises the day, finds by reference and lists clients', async () => {
      const id = await newRequest();
      const ref = (
        await t
          .http()
          .get(`/v1/admin/service-requests/${id}`)
          .set(bearer(superAdmin))
      ).body.reference as string;

      const dash = await t
        .http()
        .get('/v1/admin/dashboard')
        .set(bearer(superAdmin))
        .expect(200);
      expect(dash.body.counts.newCount).toBeGreaterThanOrEqual(1);
      expect(dash.body.counts.oldestNewWaitingMinutes).toEqual(
        expect.any(Number),
      );
      expect(dash.body.needsAction.length).toBeGreaterThan(0);

      const found = await t
        .http()
        .get(`/v1/admin/search?q=${ref}`)
        .set(bearer(support))
        .expect(200);
      expect(found.body.requests.map((r: { id: string }) => r.id)).toEqual([
        id,
      ]);
      const byName = await t
        .http()
        .get('/v1/admin/search?q=Claire Dubois')
        .set(bearer(support))
        .expect(200);
      expect(byName.body.clients.map((c: { id: string }) => c.id)).toContain(
        client.id,
      );

      const clients = await t
        .http()
        .get(`/v1/admin/clients?q=${encodeURIComponent(client.email)}`)
        .set(bearer(lead))
        .expect(200);
      expect(clients.body.items[0]).toMatchObject({
        id: client.id,
        fullName: 'Claire Dubois',
        requestCount: expect.any(Number),
      });
      const detail = await t
        .http()
        .get(`/v1/admin/clients/${client.id}`)
        .set(bearer(lead))
        .expect(200);
      expect(detail.body).toMatchObject({ sector: 'Kimihurura' });
      expect(detail.body.recentRequests.length).toBeGreaterThan(0);
      await t
        .http()
        .get(`/v1/admin/clients/${superAdmin.id}`)
        .set(bearer(lead))
        .expect(404);
      void testEmail;
    });
  });
});
