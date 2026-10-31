import {
  bearer,
  createTestApp,
  deleteUsers,
  registerUser,
  type TestApp,
  type TestUser,
} from './support.js';

// Must be set before the app (and its config) is created
process.env.SUPPORT_INBOX = 'ops@example.test';

/** Smallest valid PNG (1×1) */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

describe('Reviews and support (e2e)', () => {
  let t: TestApp;
  let client: TestUser;
  let other: TestUser;
  let admin: TestUser;
  const workerIds: string[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    client = await registerUser(t, { fullName: 'Claire Dubois' });
    other = await registerUser(t, { fullName: 'Someone Else' });
    admin = await registerUser(t, { fullName: 'Ops Admin' });
    await t.prisma.profile.update({
      where: { id: admin.id },
      data: { role: 'ADMIN' },
    });
  });

  afterAll(async () => {
    if (t) {
      const ids = [client, other, admin].filter(Boolean).map((u) => u.id);
      await t.prisma.supportTicket.deleteMany({
        where: { clientId: { in: ids } },
      });
      await t.prisma.review.deleteMany({ where: { clientId: { in: ids } } });
      await deleteUsers(t.prisma, ids, workerIds);
      await t.app.close();
    }
  });

  /** Drives a request to the given point using the API, as the apps would. */
  async function bookedRequest(until: 'priced' | 'completed'): Promise<string> {
    const http = t.http;
    const created = await http()
      .post('/v1/service-requests')
      .set(bearer(client))
      .send({
        category: 'CLEANING',
        description: 'Full clean',
        scheduledAt: new Date(Date.now() + 2 * 864e5).toISOString(),
        durationHours: 3,
        preferredLanguages: [],
        address: { district: 'Gasabo', sector: 'Kacyiru', street: 'KG 9 Ave' },
      })
      .expect(201);
    const id: string = created.body.id;
    await http()
      .post(`/v1/admin/service-requests/${id}/price`)
      .set(bearer(admin))
      .send({ workerFeeRwf: 20000, serviceFeeRwf: 1000 })
      .expect(200);
    if (until === 'priced') return id;

    const payment = await http()
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
    await http()
      .get(`/v1/payments/${payment.body.id}`)
      .set(bearer(client))
      .expect(200);

    const worker = await http()
      .post('/v1/admin/workers')
      .set(bearer(admin))
      .send({
        fullName: 'Jeanne Mukamana',
        phone: '+250788000111',
        gender: 'FEMALE',
        languages: ['FR'],
        categories: ['CLEANING'],
      })
      .expect(201);
    workerIds.push(worker.body.id);
    await http()
      .post(`/v1/admin/service-requests/${id}/assign`)
      .set(bearer(admin))
      .send({ workerId: worker.body.id })
      .expect(200);
    await http()
      .post(`/v1/service-requests/${id}/complete`)
      .set(bearer(client))
      .expect(200);
    return id;
  }

  describe('reviews', () => {
    it('reviews a completed job once, and feeds the worker rating', async () => {
      const id = await bookedRequest('completed');
      const review = await t
        .http()
        .post(`/v1/service-requests/${id}/review`)
        .set(bearer(client))
        .send({
          rating: 5,
          tags: ['ON_TIME', 'THOROUGH'],
          comment: 'Great job on the kitchen.',
        })
        .expect(201);
      expect(review.body).toMatchObject({
        rating: 5,
        tags: ['ON_TIME', 'THOROUGH'],
        comment: 'Great job on the kitchen.',
      });

      const detail = await t
        .http()
        .get(`/v1/service-requests/${id}`)
        .set(bearer(client))
        .expect(200);
      expect(detail.body).toMatchObject({
        hasReview: true,
        review: { rating: 5 },
      });
      expect(detail.body.worker).toMatchObject({
        ratingAverage: 5,
        completedJobs: 1,
      });

      await t
        .http()
        .post(`/v1/service-requests/${id}/review`)
        .set(bearer(client))
        .send({ rating: 4, tags: [] })
        .expect(409)
        .expect((res) => expect(res.body.code).toBe('already_reviewed'));
      await t
        .http()
        .post(`/v1/service-requests/${id}/review`)
        .set(bearer(other))
        .send({ rating: 1, tags: [] })
        .expect(404);
    });

    it('refuses reviews before completion and unknown tags', async () => {
      const id = await bookedRequest('priced');
      await t
        .http()
        .post(`/v1/service-requests/${id}/review`)
        .set(bearer(client))
        .send({ rating: 4, tags: [] })
        .expect(409)
        .expect((res) => expect(res.body.code).toBe('not_reviewable'));
      await t
        .http()
        .post(`/v1/service-requests/${id}/review`)
        .set(bearer(client))
        .send({ rating: 4, tags: ['RUDE'] })
        .expect(400);
    });

    it('alerts ops about low ratings and lists them for admins', async () => {
      const id = await bookedRequest('completed');
      await t
        .http()
        .post(`/v1/service-requests/${id}/review`)
        .set(bearer(client))
        .send({ rating: 2, tags: [], comment: 'Arrived an hour late' })
        .expect(201);
      const alert = t.mailer.sent.find(
        (m) =>
          m.to === 'ops@example.test' &&
          m.subject.startsWith('Low rating (2/5)'),
      );
      expect(alert?.text).toContain('Arrived an hour late');

      const low = await t
        .http()
        .get('/v1/admin/reviews?maxRating=2')
        .set(bearer(admin))
        .expect(200);
      expect(
        low.body.items.map(
          (r: { serviceRequestId: string }) => r.serviceRequestId,
        ),
      ).toContain(id);
      await t.http().get('/v1/admin/reviews').set(bearer(client)).expect(403);
    });
  });

  describe('support tickets', () => {
    it('reports an issue with a photo, notifies ops, and serves the file safely', async () => {
      const id = await bookedRequest('priced');
      const res = await t
        .http()
        .post('/v1/support/tickets')
        .set(bearer(client))
        .field(
          'description',
          "Late arrival\nThe worker arrived at 10:15 instead of 9:00, so the second bathroom wasn't finished.",
        )
        .field('serviceRequestId', id)
        .attach('files', PNG, {
          filename: 'bathroom photo.png',
          contentType: 'image/png',
        })
        .expect(201);
      expect(res.body).toMatchObject({
        subject: 'Late arrival',
        status: 'OPEN',
        serviceRequest: { id, category: 'CLEANING' },
        attachments: [
          {
            filename: 'bathroom photo.png',
            contentType: 'image/png',
            sizeBytes: PNG.length,
          },
        ],
      });
      expect(res.body.reference).toMatch(/^TK-\d+$/);
      const ticketId: string = res.body.id;
      const fileId: string = res.body.attachments[0].id;

      const notice = t.mailer.sent.find(
        (m) =>
          m.to === 'ops@example.test' && m.subject.includes(res.body.reference),
      );
      expect(notice?.text).toContain('Claire Dubois');

      const file = await t
        .http()
        .get(`/v1/support/tickets/${ticketId}/attachments/${fileId}`)
        .set(bearer(client))
        .buffer(true)
        .expect(200);
      expect(file.headers['content-type']).toBe('image/png');
      expect(file.headers['x-content-type-options']).toBe('nosniff');
      expect(file.headers['content-security-policy']).toContain('sandbox');
      expect(Buffer.compare(file.body as Buffer, PNG)).toBe(0);

      // Other clients can't see it; admins can
      await t
        .http()
        .get(`/v1/support/tickets/${ticketId}/attachments/${fileId}`)
        .set(bearer(other))
        .expect(404);
      await t
        .http()
        .get(`/v1/admin/support/tickets/${ticketId}/attachments/${fileId}`)
        .set(bearer(admin))
        .expect(200);

      const mine = await t
        .http()
        .get('/v1/support/tickets')
        .set(bearer(client))
        .expect(200);
      expect(mine.body.map((x: { id: string }) => x.id)).toContain(ticketId);
      const theirs = await t
        .http()
        .get('/v1/support/tickets')
        .set(bearer(other))
        .expect(200);
      expect(theirs.body).toEqual([]);
    });

    it('rejects disguised files and requests that are not yours', async () => {
      await t
        .http()
        .post('/v1/support/tickets')
        .set(bearer(client))
        .field('description', 'Something went wrong with my booking')
        .attach('files', Buffer.from('MZ not really a pdf'), {
          filename: 'invoice.pdf',
          contentType: 'application/pdf',
        })
        .expect(422)
        .expect((r) => expect(r.body.code).toBe('unsupported_file'));

      const id = await bookedRequest('priced');
      await t
        .http()
        .post('/v1/support/tickets')
        .set(bearer(other))
        .field('description', 'Trying to attach to a stranger booking')
        .field('serviceRequestId', id)
        .expect(404);
    });

    it('lets ops move tickets through their statuses', async () => {
      const created = await t
        .http()
        .post('/v1/support/tickets')
        .set(bearer(client))
        .field('description', 'Shirt damaged during laundry')
        .expect(201);
      const id: string = created.body.id;

      const queue = await t
        .http()
        .get('/v1/admin/support/tickets?status=OPEN')
        .set(bearer(admin))
        .expect(200);
      expect(
        queue.body.items.find((x: { id: string }) => x.id === id),
      ).toMatchObject({
        client: { fullName: 'Claire Dubois', email: client.email },
      });

      await t
        .http()
        .patch(`/v1/admin/support/tickets/${id}`)
        .set(bearer(admin))
        .send({ status: 'ACTIVE' })
        .expect(200);
      await t
        .http()
        .patch(`/v1/admin/support/tickets/${id}`)
        .set(bearer(admin))
        .send({ status: 'OPEN' })
        .expect(409);
      const closed = await t
        .http()
        .patch(`/v1/admin/support/tickets/${id}`)
        .set(bearer(admin))
        .send({ status: 'CLOSED', subject: 'Shirt damaged' })
        .expect(200);
      expect(closed.body).toMatchObject({
        status: 'CLOSED',
        subject: 'Shirt damaged',
        closedAt: expect.any(String),
      });
      await t
        .http()
        .patch(`/v1/admin/support/tickets/${id}`)
        .set(bearer(client))
        .send({ status: 'ACTIVE' })
        .expect(403);
    });
  });
});
