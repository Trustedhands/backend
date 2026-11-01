import { execFileSync } from 'node:child_process';
import { Client } from 'pg';
import {
  assertLocalDatabase,
  TEST_DATABASE_URL,
  TEST_ENV,
} from './test-env.js';

const COMPOSE = ['compose', '-f', 'docker-compose.test.yml'];

async function query(sql: string): Promise<boolean> {
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  try {
    await client.connect();
    await client.query(sql);
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

/** Starts the test database if needed, then rebuilds it from the migrations. */
export default async function setup(): Promise<void> {
  assertLocalDatabase(TEST_DATABASE_URL);
  if (!(await query('select 1'))) {
    execFileSync('docker', [...COMPOSE, 'up', '-d', '--wait'], {
      stdio: 'inherit',
    });
  }
  // A clean schema every run; the migrations also seed service types and settings
  const wiped = await query(
    'drop schema if exists app cascade; drop table if exists public._prisma_migrations;',
  );
  if (!wiped)
    throw new Error(`Test database at ${TEST_DATABASE_URL} is not reachable`);
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: { ...process.env, ...TEST_ENV },
  });
}
