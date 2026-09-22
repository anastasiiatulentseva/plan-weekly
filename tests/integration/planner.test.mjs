import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { resetTestDatabase, testDatabaseUrl } from '../database.mjs';
import { command, readPlanner } from '../../src/server/planner.ts';
import { closeDatabase } from '../../src/server/db.ts';
import { ALL } from '../../src/pages/api/[...path].ts';
import { GET as ready } from '../../src/pages/readyz.ts';
import { GET as health } from '../../src/pages/healthz.ts';
import { cookieName, signSession } from '../../src/server/security.ts';

let sql;
before(async () => {
  process.env.DATABASE_URL = testDatabaseUrl();
  process.env.PUBLIC_ORIGIN = 'https://plans.example';
  process.env.SESSION_SECRET = 'test-session-secret-'.repeat(4);
  process.env.INVITE_TOKEN = 'test-invitation-secret-'.repeat(4);
  await resetTestDatabase();
  sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
});
beforeEach(async () => {
  await sql`TRUNCATE people, activity_templates, scheduled_activities, mutation_requests, calendar_metadata CASCADE`;
});
after(async () => { await closeDatabase(); await sql?.end(); });
const base = { title: 'Football', color: '#0ea5e9', personIds: [], isRecurring: false };
async function person(name = 'Alex') { return (await command('people', 'POST', undefined, { name })).records[0]; }
async function template(extra = {}) { return (await command('templates', 'POST', undefined, { ...base, ...extra })).records[0]; }
async function schedule(templateId, date = '2026-09-15', key = randomUUID()) {
  return command('scheduled', 'POST', undefined, { templateId, date, selectedMonth: date.slice(0, 7), idempotencyKey: key });
}
function updateInput(record, patch = {}) {
  const { id, version, templateId, recurrenceId, ...fields } = record;
  return { ...fields, expectedVersion: version, ...patch };
}
async function request(path, method = 'GET', body, options = {}) {
  const url = new URL('https://plans.example/api/' + path);
  const headers = { ...(options.member === false ? {} : { cookie: `${cookieName}=${signSession()}` }),
    ...(method === 'GET' ? {} : { origin: process.env.PUBLIC_ORIGIN, 'content-type': 'application/json' }), ...options.headers };
  const req = new Request(url, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: options.signal });
  return ALL({ request: req, params: { path: url.pathname.slice(5) }, url });
}

test('migrations are repeatable; dates and composite assignments have database constraints', async () => {
  const p = await person(); const t = await template({ personIds: [p.id] });
  await assert.rejects(sql`INSERT INTO activity_template_people (activity_id, person_id) VALUES (${t.id}, ${p.id})`, { code: '23505' });
  await assert.rejects(sql`UPDATE activity_templates SET start_time='12:00', end_time='10:00' WHERE id=${t.id}`, { code: '23514' });
  await assert.rejects(sql`INSERT INTO calendar_metadata (id) VALUES (2)`, { code: '23514' });
  await person(); await template(); // Duplicate names/titles remain valid.
});
test('range reads preserve history, exact times and database persistence after pool restart', async () => {
  const t = await template({ startTime: '09:00', notes: 'Keep me' });
  await schedule(t.id, '2020-01-07'); await schedule(t.id);
  const visible = await readPlanner('2026-09-01', '2026-09-30');
  assert.equal(visible.scheduled.length, 1); assert.equal(visible.scheduled[0].startTime, '09:00');
  await closeDatabase();
  const history = await readPlanner('2020-01-01', '2020-01-31');
  assert.equal(history.scheduled.length, 1); assert.equal(history.scheduled[0].notes, 'Keep me');
  assert.equal(history.calendarRevision, 3);
});
test('failed assignment changes roll back aggregate, joins and revision', async () => {
  const p = await person(); const t = await template({ personIds: [p.id] });
  const [a] = (await schedule(t.id)).records;
  const before = await readPlanner('2026-09-01', '2026-09-30');
  await assert.rejects(command('scheduled', 'PATCH', a.id, updateInput(a, { title: 'Must roll back', personIds: ['missing'] })), { code: 'INVALID_ASSIGNMENTS' });
  assert.deepEqual(await readPlanner('2026-09-01', '2026-09-30'), before);
});
test('template edits update future placements without changing scheduled copies', async () => {
  const p = await person();
  const t = await template({ title: 'Original', startTime: '08:00' });
  const [existing] = (await schedule(t.id)).records;
  const changed = await command('templates', 'PATCH', t.id, updateInput(t, {
    title: 'Updated', color: '#10b981', personIds: [p.id], startTime: '09:00', endTime: '10:00'
  }));
  assert.equal(changed.records[0].version, 2);
  assert.deepEqual(changed.records[0].personIds, [p.id]);
  const saved = await readPlanner('2026-09-01', '2026-09-30');
  assert.equal(saved.activityTemplates[0].title, 'Updated');
  assert.equal(saved.scheduled[0].id, existing.id);
  assert.equal(saved.scheduled[0].title, 'Original');
  assert.equal(saved.scheduled[0].startTime, '08:00');
  await assert.rejects(command('templates', 'PATCH', t.id, updateInput(t, { title: 'Stale' })), { status: 409 });
});
test('one of two writes at the same version conflicts; unrelated writes both succeed', async () => {
  const t = await template(); const [a] = (await schedule(t.id)).records;
  const results = await Promise.allSettled(['First', 'Second'].map(title => command('scheduled', 'PATCH', a.id, updateInput(a, { title }))));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const rejected = results.find(r => r.status === 'rejected').reason;
  assert.equal(rejected.status, 409); assert.equal(rejected.details.submittedVersion, 1); assert.equal(rejected.details.latest.version, 2);
  const [b] = (await schedule(t.id, '2026-09-16')).records;
  const current = (await readPlanner('2026-09-01', '2026-09-30')).scheduled.find(r => r.id === a.id);
  const unrelated = await Promise.all([command('scheduled', 'PATCH', a.id, updateInput(current)), command('scheduled', 'PATCH', b.id, updateInput(b))]);
  assert.equal(unrelated.length, 2);
});
test('assignment replacement increments once; moves are atomic; deletes require current version', async () => {
  const p = await person(); const t = await template(); const [a] = (await schedule(t.id)).records;
  const changed = await command('scheduled', 'PATCH', a.id, updateInput(a, { date: '2026-10-02', personIds: [p.id] }));
  assert.equal(changed.records[0].version, 2); assert.deepEqual(changed.records[0].personIds, [p.id]);
  assert.equal((await readPlanner('2026-09-01', '2026-09-30')).scheduled.length, 0);
  await assert.rejects(command('scheduled', 'DELETE', a.id, { expectedVersion: 1, scope: 'single', idempotencyKey: randomUUID() }), { status: 409 });
  await command('scheduled', 'DELETE', a.id, { expectedVersion: 2, scope: 'single', idempotencyKey: randomUUID() });
  assert.equal((await readPlanner('2026-10-01', '2026-10-31')).scheduled.length, 0);
});
test('person and template deletion retain scheduled copies and advance affected versions', async () => {
  const p = await person(); const t = await template({ personIds: [p.id] }); const [a] = (await schedule(t.id)).records;
  await command('people', 'DELETE', p.id, { expectedVersion: 1 });
  let state = await readPlanner('2026-09-01', '2026-09-30');
  assert.deepEqual(state.scheduled[0].personIds, []); assert.equal(state.scheduled[0].version, 2);
  assert.equal(state.activityTemplates[0].version, 2);
  await assert.rejects(command('templates', 'DELETE', t.id, { expectedVersion: 1 }), { status: 409 });
  await command('templates', 'DELETE', t.id, { expectedVersion: 2 });
  state = await readPlanner('2026-09-01', '2026-09-30');
  assert.equal(state.scheduled[0].id, a.id); assert.equal(state.scheduled[0].templateId, undefined); assert.equal(state.scheduled[0].version, 3);
});
test('recurring creation retries return original result, including concurrent retries and changed-key rejection', async () => {
  const t = await template({ isRecurring: true }); const key = randomUUID();
  const [a, b] = await Promise.all([schedule(t.id, '2026-09-15', key), schedule(t.id, '2026-09-15', key)]);
  assert.deepEqual(a, b); assert.equal(a.records.length, 3);
  assert.deepEqual(a.records.map(r => r.date).sort(), ['2026-09-15', '2026-09-22', '2026-09-29']);
  assert.deepEqual(await schedule(t.id, '2026-09-15', key), a);
  await assert.rejects(schedule(t.id, '2026-09-16', key), { code: 'IDEMPOTENCY_KEY_REUSED' });
  assert.equal((await readPlanner('2026-09-01', '2026-09-30')).calendarRevision, 2);
});
test('cloning retains collisions and series links; future deletion crosses cloned months and retries safely', async () => {
  const t = await template({ isRecurring: true }); const original = await schedule(t.id);
  const cloneInput = { source: '2026-09', target: '2026-10', idempotencyKey: randomUUID() };
  const clone = await command('clone', 'POST', undefined, cloneInput);
  assert.equal(clone.records.length, 3); assert.equal(clone.records.filter(a => a.date === '2026-10-27').length, 2);
  assert.ok(clone.records.every(a => a.recurrenceId === original.records[0].recurrenceId));
  assert.deepEqual(await command('clone', 'POST', undefined, cloneInput), clone);
  await command('clone', 'POST', undefined, { ...cloneInput, idempotencyKey: randomUUID() });
  assert.equal((await readPlanner('2026-10-01', '2026-10-31')).scheduled.length, 6);
  const target = original.records.find(a => a.date === '2026-09-22');
  const deletion = { expectedVersion: 1, scope: 'future', idempotencyKey: randomUUID() };
  const result = await command('scheduled', 'DELETE', target.id, deletion);
  assert.deepEqual(await command('scheduled', 'DELETE', target.id, deletion), result);
  assert.equal((await readPlanner('2026-09-01', '2026-10-31')).scheduled.length, 1);
});
test('API validates authentication, exact origin, JSON bodies and version preconditions', async () => {
  assert.equal((await request('planner?from=2026-09-01&to=2026-09-30', 'GET', undefined, { member: false })).status, 401);
  assert.equal((await request('people', 'POST', { name: 'Test' }, { headers: { origin: 'https://plans.example.evil' } })).status, 403);
  assert.equal((await request('people', 'POST', { name: 'Test' }, { headers: { 'content-type': 'text/plain' } })).status, 415);
  const p = await person();
  assert.equal((await request(`people/${p.id}`, 'DELETE', {})).status, 400);
  const conflict = await request(`people/${p.id}`, 'DELETE', { expectedVersion: 9 });
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), { code: 'VERSION_CONFLICT', submittedVersion: 9, latest: p });
  assert.equal((await request('planner?from=2026-02-30&to=2026-03-01')).status, 400);
});
test('invitation exchange and logout emit secure cookies; invalid attempts are limited', async () => {
  const joined = await request('session', 'POST', { token: process.env.INVITE_TOKEN }, { member: false });
  assert.equal(joined.status, 200);
  for (const value of ['HttpOnly', 'Secure', 'SameSite=Strict']) assert.ok(joined.headers.get('set-cookie').includes(value));
  const invite = await request('invite'); assert.ok((await invite.json()).url.startsWith('https://plans.example/#join='));
  assert.equal((await request('invite', 'GET', undefined, { member: false })).status, 401);
  assert.ok((await request('session', 'DELETE', {})).headers.get('set-cookie').includes('Max-Age=0'));
  for (let i = 0; i < 10; i++) assert.equal((await request('session', 'POST', { token: 'wrong' }, { member: false })).status, 401);
  assert.equal((await request('session', 'POST', { token: 'wrong' }, { member: false })).status, 429);
});
test('SSE authenticates, sends ready and committed revision events, and cleans up on disconnect', async () => {
  assert.equal((await request('events', 'GET', undefined, { member: false })).status, 401);
  const abort = new AbortController();
  const response = await request('events', 'GET', undefined, { signal: abort.signal });
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
  const reader = response.body.getReader(); const decoder = new TextDecoder();
  assert.match(decoder.decode((await reader.read()).value), /event: ready/);
  await person();
  assert.match(decoder.decode((await reader.read()).value), /event: revision.*\n.*calendarRevision":1/);
  abort.abort(); assert.equal((await reader.read()).done, true);
});
test('health is independent of PostgreSQL; readiness recovers after connection failure', async () => {
  assert.equal((await health()).status, 200); assert.equal((await ready()).status, 200);
  await closeDatabase(); const original = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://nobody:nothing@127.0.0.1:1/missing';
  try { assert.equal((await health()).status, 200); assert.equal((await ready()).status, 503); }
  finally { await closeDatabase(); process.env.DATABASE_URL = original; }
  assert.equal((await ready()).status, 200);
});
