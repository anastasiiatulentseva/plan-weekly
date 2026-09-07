import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

let pool: ReturnType<typeof postgres> | undefined;
export function database() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('Database unavailable');
    pool = postgres(process.env.DATABASE_URL, { max: 10, prepare: false, connect_timeout: 5, onnotice: () => {} });
  }
  return drizzle(pool, { schema });
}
export async function closeDatabase() {
  const current = pool;
  pool = undefined;
  await current?.end({ timeout: 5 });
}
