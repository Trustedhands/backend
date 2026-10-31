import { PasswordHasher } from './password-hasher.js';

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();

  it('verifies the right password and rejects others', async () => {
    const stored = await hasher.hash('kigali2026');
    expect(stored).toMatch(/^scrypt\$32768\$8\$1\$/);
    await expect(hasher.verify('kigali2026', stored)).resolves.toBe(true);
    await expect(hasher.verify('kigali2027', stored)).resolves.toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hasher.hash('same-pass1')).not.toBe(
      await hasher.hash('same-pass1'),
    );
  });

  it('rejects malformed hashes', async () => {
    await expect(hasher.verify('x', 'bcrypt$whatever')).resolves.toBe(false);
  });
});
