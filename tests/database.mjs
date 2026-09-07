import postgres from 'postgres';
import { execFileSync } from 'node:child_process';

export function testDatabaseUrl() {
  const value = process.env.E2E_DATABASE_URL;
  if (!value || !/^\/[a-zA-Z0-9_]+_e2e$/.test(new URL(value).pathname)) {
    throw new Error('E2E_DATABASE_URL must target a dedicated database whose name ends in _e2e');
  }
  return value;
}
export async function resetTestDatabase() {
  const url = testDatabaseUrl();
  const connection = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await connection`DROP SCHEMA IF EXISTS public CASCADE`;
    await connection`DROP SCHEMA IF EXISTS drizzle CASCADE`;
    await connection`CREATE SCHEMA public`;
  } finally { await connection.end(); }
  for (let pass = 0; pass < 2; pass++) {
    execFileSync(process.execPath, ['scripts/migrate.mjs'], { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  }
}
