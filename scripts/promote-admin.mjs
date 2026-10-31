// Grants the admin role to an existing Supabase Auth user.
// Usage: pnpm admin:promote someone@example.com ["Full Name"]
import 'dotenv/config';
import pg from 'pg';

const [email, fullName] = process.argv.slice(2);
if (!email) {
  console.error('Usage: pnpm admin:promote <email> ["Full Name"]');
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
await client.connect();
try {
  const { rows } = await client.query('select id from auth.users where lower(email) = lower($1)', [email]);
  if (!rows.length) {
    console.error(`No Supabase Auth user with email ${email}. Sign up first, then rerun.`);
    process.exitCode = 1;
  } else {
    await client.query(
      `insert into app.profiles (id, role, "fullName", "updatedAt")
       values ($1, 'ADMIN', $2, now())
       on conflict (id) do update set role = 'ADMIN', "updatedAt" = now()`,
      [rows[0].id, fullName ?? email],
    );
    console.log(`${email} is now an admin.`);
  }
} finally {
  await client.end();
}
