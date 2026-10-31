// Makes an existing account a super admin (e.g. the first admin; invite the rest from the console).
// Usage: pnpm admin:promote someone@example.com
import 'dotenv/config';
import pg from 'pg';

const [email] = process.argv.slice(2);
if (!email) {
  console.error('Usage: pnpm admin:promote <email>');
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
await client.connect();
try {
  const { rowCount } = await client.query(
    `update app.profiles p set role = 'ADMIN', "staffRole" = 'SUPER_ADMIN', "staffDisabledAt" = null, "updatedAt" = now()
       from app.users u
      where u.id = p.id and u.email = lower(trim($1))`,
    [email],
  );
  if (rowCount === 0) {
    console.error(`No account with email ${email}. Register first, then rerun.`);
    process.exitCode = 1;
  } else {
    console.log(`${email} is now a super admin.`);
  }
} finally {
  await client.end();
}
