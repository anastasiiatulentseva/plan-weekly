import type { APIRoute } from 'astro';
import { z } from 'zod';
import { authenticated, equalSecret, invalidInvite, inviteLimited, publicOrigin, secret, sessionCookie, signSession } from '../../server/security';
import { ApiError, command, readPlanner } from '../../server/planner';
import { rangeInput } from '../../server/validation';
import { onShutdown, subscribe } from '../../server/events';

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
});
async function body(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new ApiError(415, 'JSON_REQUIRED');
  if (!request.body) throw new ApiError(400, 'INVALID_REQUEST');
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 32768) { await reader.cancel(); throw new ApiError(413, 'REQUEST_TOO_LARGE'); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(400, 'INVALID_REQUEST'); }
}
export const ALL: APIRoute = async ({ request, params, url }) => {
  try {
    const path = params.path ?? '';
    const method = request.method;
    if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) throw new ApiError(405, 'METHOD_NOT_ALLOWED');
    const mutation = method !== 'GET';
    if (mutation && request.headers.get('origin') !== publicOrigin()) throw new ApiError(403, 'ORIGIN_REJECTED');
    if (path === 'session' && method === 'POST') {
      if (inviteLimited()) return json({ code: 'AUTHENTICATION_FAILED' }, 429, { 'Retry-After': '60' });
      const input = z.object({ token: z.string().max(512) }).strict().parse(await body(request));
      if (!equalSecret(input.token, secret('INVITE_TOKEN'))) { invalidInvite(); throw new ApiError(401, 'AUTHENTICATION_FAILED'); }
      return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(signSession()) });
    }
    if (!authenticated(request)) throw new ApiError(401, 'AUTHENTICATION_FAILED');
    if (path === 'session' && method === 'DELETE') {
      z.object({}).strict().parse(await body(request));
      return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', true) });
    }
    if (path === 'invite' && method === 'GET') return json({ url: `${publicOrigin()}/#join=${encodeURIComponent(secret('INVITE_TOKEN'))}` });
    if (path === 'planner' && method === 'GET') {
      const range = rangeInput.parse(Object.fromEntries(url.searchParams));
      return json(await readPlanner(range.from, range.to));
    }
    if (path === 'events' && method === 'GET') {
      let cleanup: (cancelled?: boolean) => void = () => {};
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          let closed = false;
          const send = (event: string, value: unknown) => { if (!closed) controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`)); };
          const unsubscribe = subscribe(revision => send('revision', { calendarRevision: revision }));
          const heartbeat = setInterval(() => {
            // Existing streams must end after expiry or SESSION_SECRET rotation too.
            if (!authenticated(request)) cleanup();
            else send('heartbeat', {});
          }, 15_000);
          const removeShutdown = onShutdown(() => cleanup());
          const abort = () => cleanup();
          cleanup = (cancelled = false) => {
            if (closed) return;
            closed = true; clearInterval(heartbeat); unsubscribe(); removeShutdown();
            request.signal.removeEventListener('abort', abort);
            if (!cancelled) controller.close();
          };
          request.signal.addEventListener('abort', abort, { once: true });
          send('ready', {});
          if (request.signal.aborted) cleanup();
        },
        cancel() { cleanup(true); },
      });
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' } });
    }
    const [kind, id, extra] = path.split('/');
    if (extra || !['people', 'templates', 'scheduled', 'clone'].includes(kind)) throw new ApiError(404, 'NOT_FOUND');
    if ((method === 'POST' && id) || (kind === 'clone' && method !== 'POST') || method === 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED');
    return json(await command(kind as 'people' | 'templates' | 'scheduled' | 'clone', method, id, await body(request)), method === 'POST' ? 201 : 200);
  } catch (error) {
    if (error instanceof ApiError) return json({ code: error.code, ...error.details }, error.status);
    if (error instanceof z.ZodError) return json({ code: 'INVALID_REQUEST' }, 400);
    // Never serialize driver errors, request bodies, cookies, or environment values.
    return json({ code: 'SERVICE_UNAVAILABLE' }, 503);
  }
};
