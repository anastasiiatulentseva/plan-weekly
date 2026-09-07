import { defineMiddleware } from 'astro:middleware';
import { closeDatabase } from './server/db';
import { closeEvents } from './server/events';

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  closeEvents();
  await closeDatabase();
  process.exit(0);
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
export const onRequest = defineMiddleware(async (_context, next) => {
  if (stopping) return new Response('unavailable', { status: 503 });
  const response = await next();
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Frame-Options', 'DENY');
  return response;
});
