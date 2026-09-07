import assert from 'node:assert/strict';
import test from 'node:test';
import { isTimeRangeValid, isFutureRecurringMatch, remapDateByWeekPattern } from '../src/shared/planner.ts';
import { extractPreferences } from '../src/shared/preferences.ts';
import { dateKey, rangeInput, templateInput, updateInput } from '../src/server/validation.ts';
import { authenticated, signSession, sessionCookie, cookieName } from '../src/server/security.ts';

test('time ranges allow missing endpoints and equality, reject reversed times', () => {
  assert.equal(isTimeRangeValid(undefined, '09:00'), true);
  assert.equal(isTimeRangeValid('09:00', undefined), true);
  assert.equal(isTimeRangeValid('09:00', '09:00'), true);
  assert.equal(isTimeRangeValid('10:00', '09:00'), false);
  const base = { title: 'Sport', color: '#abcdef', personIds: [] };
  assert.equal(templateInput.safeParse({ ...base, startTime: '25:00' }).success, false);
  assert.equal(templateInput.safeParse({ ...base, startTime: '10:00', endTime: '09:00' }).success, false);
  assert.equal(updateInput.safeParse({ ...base, date: '2026-09-10' }).success, false);
});
test('dates, ranges, duplicate assignments and unsafe colors are validated', () => {
  assert.equal(dateKey.safeParse('2026-02-29').success, false);
  assert.equal(dateKey.safeParse('2024-02-29').success, true);
  assert.equal(rangeInput.safeParse({ from: '2026-01-01', to: '2026-12-31' }).success, false);
  assert.equal(templateInput.safeParse({ title: 'Sport', color: 'url(bad)', personIds: [] }).success, false);
  assert.equal(templateInput.safeParse({ title: 'Sport', color: '#abcdef', personIds: ['a', 'a'] }).success, false);
});
test('future deletion includes selected date and linked cloned months but not other series', () => {
  const target = { id: 'a', date: '2026-09-15', recurrenceId: 'series' };
  const state = { activityTemplates: [] };
  assert.equal(isFutureRecurringMatch(target, target, state), true);
  assert.equal(isFutureRecurringMatch({ id: 'b', date: '2026-10-20', recurrenceId: 'series' }, target, state), true);
  assert.equal(isFutureRecurringMatch({ id: 'c', date: '2026-09-08', recurrenceId: 'series' }, target, state), false);
  assert.equal(isFutureRecurringMatch({ id: 'd', date: '2026-10-20', recurrenceId: 'other' }, target, state), false);
});
test('preference extraction excludes all calendar data and clamps invalid navigation', () => {
  const now = new Date(2026, 8, 6);
  const prefs = extractPreferences({ state: { people: ['private'] }, selectedMonth: '2020-01', selectedWeekStart: 'bad', viewMode: 'month' }, now);
  assert.deepEqual(prefs, { selectedMonth: '2026-09', selectedWeekStart: '2026-08-31', viewMode: 'month' });
  assert.equal(extractPreferences(null, now).viewMode, 'week');
});
test('month clone collisions deliberately preserve both occurrences', () => {
  const dates = ['2026-09-22', '2026-09-29'].map(d => remapDateByWeekPattern(d, '2026-09', '2026-10'));
  assert.deepEqual(dates, ['2026-10-27', '2026-10-27']);
});
test('session signatures resist tampering; invite rotation preserves sessions, session rotation invalidates them', () => {
  process.env.SESSION_SECRET = 'a'.repeat(48);
  process.env.INVITE_TOKEN = 'b'.repeat(48);
  const token = signSession();
  const request = value => new Request('https://plans.example/api/planner', { headers: { cookie: `${cookieName}=${value}` } });
  assert.equal(authenticated(request(token)), true);
  assert.equal(authenticated(request(token + 'x')), false);
  process.env.INVITE_TOKEN = 'c'.repeat(48);
  assert.equal(authenticated(request(token)), true);
  process.env.SESSION_SECRET = 'd'.repeat(48);
  assert.equal(authenticated(request(token)), false);
  const cookie = sessionCookie(token);
  for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(cookie.includes(attribute));
  assert.ok(sessionCookie('', true).includes('Max-Age=0'));
});
