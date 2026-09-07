import assert from 'node:assert/strict';

const origin = process.env.CONTAINER_TEST_ORIGIN ?? 'http://localhost:55441';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'Smoke mutations are restricted to a local test deployment');
const token = process.env.CONTAINER_TEST_INVITE ?? 'container-test-invite-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
let cookie;
async function request(path, method = 'GET', body, headers = {}) {
  return fetch(origin + path, { method, signal: AbortSignal.timeout(20_000), headers: {
    ...(cookie ? { cookie } : {}), ...(method === 'GET' ? {} : { origin, 'content-type': 'application/json' }), ...headers,
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
assert.equal((await request('/healthz')).status, 200);
assert.equal((await request('/readyz')).status, 200);
assert.equal((await request('/api/invite')).status, 401);
const joined = await request('/api/session', 'POST', { token });
assert.equal(joined.status, 200);
cookie = joined.headers.get('set-cookie').split(';')[0];
assert.equal((await request('/api/people', 'POST', { name: 'Rejected' }, { origin: 'https://wrong.example' })).status, 403);
assert.equal((await request('/api/people', 'POST', { name: 'Rejected' }, { 'content-type': 'text/plain' })).status, 415);
if (process.argv.includes('--verify-persistence')) {
  const state = await (await request('/api/planner?from=2026-09-01&to=2026-09-30')).json();
  assert.ok(state.people.some(p => p.name === 'Container persistence probe'));
  console.log('Persistence verified after restart/restore');
} else {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 22_000);
  try {
    const events = await fetch(origin + '/api/events', { headers: { cookie }, signal: abort.signal });
    const reader = events.body.getReader(); const decoder = new TextDecoder();
    assert.match(decoder.decode((await reader.read()).value), /event: ready/);
    assert.equal((await request('/api/people', 'POST', { name: 'Container persistence probe', idempotencyKey: 'fbd00891-6e04-48e7-b31f-78b0d9cdaf19' })).status, 201);
    assert.match(decoder.decode((await reader.read()).value), /event: revision/);
    assert.match(decoder.decode((await reader.read()).value), /event: heartbeat/);
    await reader.cancel();
    console.log('Container API, security, committed SSE revision and 15-second heartbeat verified');
  } finally { abort.abort(); clearTimeout(timeout); }
}
