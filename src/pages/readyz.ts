import type { APIRoute } from 'astro';
import { sql } from 'drizzle-orm';
import { database } from '../server/db';
export const GET: APIRoute = async () => {
  try {
    await database().execute(sql`SELECT 1`);
    return new Response('ok', { headers: { 'Cache-Control': 'no-store' } });
  } catch { return new Response('unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
};
