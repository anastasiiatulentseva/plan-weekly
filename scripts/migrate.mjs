import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const connection = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
try {
  // Serialize startup migrations when an old and new container overlap.
  await connection`SELECT pg_advisory_lock(19042026)`;
  await migrate(drizzle(connection), { migrationsFolder: new URL('../drizzle/', import.meta.url).pathname });
  console.log('Migrations complete');
} catch {
  console.error('Database migration failed');
  process.exitCode = 1;
} finally {
  await connection.end({ timeout: 5 });
}
