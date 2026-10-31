import {
  bearer,
  createTestApp,
  deleteUsers,
  refreshCookie,
  registerUser,
  testEmail,
  testPhone,
  type TestApp,
  type TestUser,
} from './support.js';

describe('Auth (e2e)', () => {
  let t: TestApp;
  const created: string[] = [];

  const register = async (overrides?: Parameters<typeof registerUser>[1]) => {
    const user = await registerUser(t, overrides);
    created.push(user.id);
    return user;
  };

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    if (t) {
      await deleteUsers(t.prisma, created);
      await t.app.close();
    }
  });

  it('registers with a profile, emails a code, and rejects duplicates and weak passwords', async () => {
    const email = testEmail();
    const user = await register({
      email: email.toUpperCase().replace('@EXAMPLE.TEST', '@example.test'),
    });
    expect(user.email.toLowerCase()).toBe(email);

    const me = await t.http().get('/v1/me').set(bearer(user)).expect(200);
    expect(me.body).toMatchObject({
      email,
      emailVerified: false,
      profile: { fullName: 'E2E Client' },
    });
    expect(me.body.phone).toMatch(/^\+2507\d{8}$/);
    expect(t.mailer.sent.at(-1)).toMatchObject({
      to: email,
      subject: expect.stringContaining('verification code'),
    });

    await t
      .http()
      .post('/v1/auth/register')
      .send({
        email,
        password: 'another2026',
        phone: testPhone(),
        fullName: 'Dup',
        accountType: 'INDIVIDUAL',
      })
      .expect(409)
      .expect((res) => expect(res.body.code).toBe('email_taken'));

    await t
      .http()
      .post('/v1/auth/register')
      .send({
        email: testEmail(),
        password: 'nodigitshere',
        phone: testPhone(),
        fullName: 'Weak',
        accountType: 'INDIVIDUAL',
      })
      .expect(422)
      .expect((res) => expect(res.body.code).toBe('weak_password'));
  });

  it('logs in, and refuses wrong passwords and bad tokens alike', async () => {
    const user = await register();
    await t
      .http()
      .post('/v1/auth/login')
      .send({ email: user.email, password: 'wrong-pass1' })
      .expect(401);
    await t
      .http()
      .post('/v1/auth/login')
      .send({ email: testEmail(), password: 'whatever1' })
      .expect(401);

    const res = await t
      .http()
      .post('/v1/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(200);
    expect(res.body).toMatchObject({
      accessToken: expect.any(String),
      expiresIn: 900,
    });
    expect(res.body.refreshToken).toBeUndefined();
    const setCookie = (res.headers['set-cookie'] as unknown as string[]).find(
      (c) => c.startsWith('th_refresh='),
    )!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Path=\/v1\/auth/);

    await t
      .http()
      .get('/v1/me')
      .set({ Authorization: 'Bearer not-a-jwt' })
      .expect(401);
  });

  it('rotates refresh tokens and revokes the family when an old one is replayed', async () => {
    const user = await register();

    const first = await t
      .http()
      .post('/v1/auth/refresh')
      .set('Cookie', user.cookie)
      .expect(200);
    const rotated = refreshCookie(first);
    expect(rotated).not.toBe(user.cookie);
    await t
      .http()
      .get('/v1/me')
      .set(bearer({ token: first.body.accessToken }))
      .expect(200);

    // Replaying the original (already rotated) token looks like theft…
    await t
      .http()
      .post('/v1/auth/refresh')
      .set('Cookie', user.cookie)
      .expect(401);
    // …so the legitimate newer token is revoked too
    await t.http().post('/v1/auth/refresh').set('Cookie', rotated).expect(401);
  });

  it('refuses cookie endpoints from untrusted origins', async () => {
    const user = await register();
    await t
      .http()
      .post('/v1/auth/refresh')
      .set('Cookie', user.cookie)
      .set('Origin', 'https://evil.example')
      .expect(403);
    await t
      .http()
      .post('/v1/auth/refresh')
      .set('Cookie', user.cookie)
      .set('Origin', 'http://localhost:3001')
      .expect(200);
  });

  it('verifies email with the emailed code, counting wrong attempts', async () => {
    const user = await register();
    const code = t.mailer.lastCode(user.email);
    const wrong = code === '000000' ? '111111' : '000000';

    await t
      .http()
      .post('/v1/auth/email/verify')
      .set(bearer(user))
      .send({ code: wrong })
      .expect(422);
    const attempts = await t.prisma.verificationCode.findFirstOrThrow({
      where: { userId: user.id, purpose: 'EMAIL_VERIFY', consumedAt: null },
    });
    expect(attempts.attempts).toBe(1);

    await t
      .http()
      .post('/v1/auth/email/verify')
      .set(bearer(user))
      .send({ code })
      .expect(204);
    await t
      .http()
      .post('/v1/auth/email/verify')
      .set(bearer(user))
      .send({ code })
      .expect(422);
    const me = await t.http().get('/v1/me').set(bearer(user)).expect(200);
    expect(me.body.emailVerified).toBe(true);

    // Resending enforces a cooldown and is pointless once verified
    await t
      .http()
      .post('/v1/auth/email/send-code')
      .set(bearer(user))
      .expect(409);
  });

  it('verifies a phone number by SMS code, one account per number', async () => {
    const phone = testPhone();
    const user = await register({ phone });
    const e164 = `+250${phone.slice(1)}`;

    await t
      .http()
      .post('/v1/auth/phone/send-code')
      .set(bearer(user))
      .send({})
      .expect(204);
    await t
      .http()
      .post('/v1/auth/phone/verify')
      .set(bearer(user))
      .send({ code: t.sms.lastCode(e164) })
      .expect(204);
    const me = await t.http().get('/v1/me').set(bearer(user)).expect(200);
    expect(me.body).toMatchObject({ phone: e164, phoneVerified: true });

    const other = await register();
    await t
      .http()
      .post('/v1/auth/phone/send-code')
      .set(bearer(other))
      .send({ phone })
      .expect(409)
      .expect((res) => expect(res.body.code).toBe('phone_taken'));
  });

  it('resets a forgotten password by emailed code and signs out other sessions', async () => {
    const user = await register();
    await t
      .http()
      .post('/v1/auth/password/forgot')
      .send({ email: testEmail() })
      .expect(202);
    await t
      .http()
      .post('/v1/auth/password/forgot')
      .send({ email: user.email })
      .expect(202);
    const code = t.mailer.lastCode(user.email);
    expect(t.mailer.sent.at(-1)!.subject).toContain('password reset');

    await t
      .http()
      .post('/v1/auth/password/reset')
      .send({ email: user.email, code, newPassword: 'newpass2026' })
      .expect(200);
    await t
      .http()
      .post('/v1/auth/refresh')
      .set('Cookie', user.cookie)
      .expect(401);
    await t
      .http()
      .post('/v1/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(401);
    await t
      .http()
      .post('/v1/auth/login')
      .send({ email: user.email, password: 'newpass2026' })
      .expect(200);
    expect(t.mailer.sent.at(-1)!.subject).toContain('password was changed');
  });

  it('changes password with the current one', async () => {
    const user: TestUser = await register();
    await t
      .http()
      .post('/v1/auth/password/change')
      .set(bearer(user))
      .send({ currentPassword: 'nope12345', newPassword: 'changed2026' })
      .expect(422);
    const res = await t
      .http()
      .post('/v1/auth/password/change')
      .set(bearer(user))
      .send({ currentPassword: user.password, newPassword: 'changed2026' })
      .expect(200);
    await t
      .http()
      .post('/v1/auth/refresh')
      .set('Cookie', user.cookie)
      .expect(401);
    await t
      .http()
      .post('/v1/auth/refresh')
      .set('Cookie', refreshCookie(res))
      .expect(200);
  });

  it('logs out by revoking the refresh token', async () => {
    const user = await register();
    const res = await t
      .http()
      .post('/v1/auth/logout')
      .set('Cookie', user.cookie)
      .expect(204);
    expect((res.headers['set-cookie'] as unknown as string[]).join()).toMatch(
      /th_refresh=;/,
    );
    await t
      .http()
      .post('/v1/auth/refresh')
      .set('Cookie', user.cookie)
      .expect(401);
  });

  it('keeps the client app and admin console sessions apart', async () => {
    const user = await register();
    const admin = await t
      .http()
      .post('/v1/auth/login?app=admin')
      .send({ email: user.email, password: user.password })
      .expect(200);
    const adminCookie = (
      admin.headers['set-cookie'] as unknown as string[]
    ).find((c) => c.startsWith('th_refresh_admin='))!;
    expect(adminCookie).toBeDefined();
    const adminToken = adminCookie.split(';')[0]!;

    // Each refresh reads only its own cookie
    await t
      .http()
      .post('/v1/auth/refresh')
      .set('Cookie', adminToken)
      .expect(401);
    await t
      .http()
      .post('/v1/auth/refresh?app=admin')
      .set('Cookie', adminToken)
      .expect(200);
    await t
      .http()
      .post('/v1/auth/refresh')
      .set('Cookie', user.cookie)
      .expect(200);

    // Logging out of one leaves the other alone
    const out = await t
      .http()
      .post('/v1/auth/logout?app=admin')
      .set('Cookie', adminToken)
      .expect(204);
    expect((out.headers['set-cookie'] as unknown as string[]).join()).toMatch(
      /th_refresh_admin=;/,
    );
  });
});
