import { expect, test, type Page } from '@playwright/test';

const invite = 'browser-test-invite-'.repeat(4);
const month = new Date().toISOString().slice(0, 7);
const today = new Date().toISOString().slice(0, 10);
function monthDay(page: Page, dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00`);
  const weekday = new Intl.DateTimeFormat('en-IE', { weekday: 'short' }).format(date);
  const day = new Intl.DateTimeFormat('en-IE', { day: 'numeric' }).format(date);
  const monthLabel = new Intl.DateTimeFormat('en-IE', { month: 'short' }).format(date);
  return page.locator('.month-day').filter({ hasText: `${weekday}, ${day} ${monthLabel}` });
}
function adjacentDayInMonth(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() === 1 ? 2 : date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
async function join(page: Page) {
  await page.goto('/#join=' + invite);
  await expect(page.getByRole('status')).toHaveText('Connected');
  await expect(page).toHaveURL('http://localhost:4329/');
  await page.getByRole('button', { name: 'Planner options' }).click();
  await page.getByRole('menuitem', { name: 'Edit mode', exact: true }).click();
  await page.getByRole('button', { name: 'Month', exact: true }).click();
}
async function api(page: Page, path: string, method = 'GET', body?: unknown) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch('/api/' + path, { method, ...(method === 'GET' ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  }, { path, method, body });
}
async function seed(page: Page, title: string) {
  const template = await api(page, 'templates', 'POST', { title, color: '#0ea5e9', personIds: [] });
  expect(template.status).toBe(201);
  const scheduled = await api(page, 'scheduled', 'POST', { templateId: template.data.records[0].id, date: today, selectedMonth: month, idempotencyKey: crypto.randomUUID() });
  expect(scheduled.status).toBe(201);
  return scheduled.data.records[0];
}

test('two browsers receive person, activity creation, edits, assignments and deletion through SSE', async ({ browser }) => {
  const a = await browser.newContext(), b = await browser.newContext();
  const first = await a.newPage(), second = await b.newPage();
  try {
    await join(first); await join(second);
    await first.getByRole('textbox', { name: 'Person name' }).fill('Sync Alex');
    await first.getByRole('button', { name: 'Add person', exact: true }).click();
    await expect(second.getByRole('button', { name: 'Remove Sync Alex' })).toBeVisible();
    await first.getByRole('textbox', { name: 'Activity name' }).fill('Sync Football');
    await first.getByRole('button', { name: 'Add activity', exact: true }).click();
    const template = first.locator('.calendar-activity-list .activity-card').filter({ hasText: 'Sync Football' });
    await expect(second.locator('.calendar-activity-list .activity-card').filter({ hasText: 'Sync Football' })).toBeVisible();
    await template.dragTo(monthDay(first, today));
    await expect(second.getByRole('button', { name: 'Edit Sync Football', exact: true })).toBeVisible();
    await first.getByRole('button', { name: 'Edit Sync Football', exact: true }).click();
    const editor = first.getByRole('dialog', { name: 'Edit activity' });
    await editor.getByRole('textbox', { name: 'Title', exact: true }).fill('Sync Updated');
    await editor.getByRole('checkbox', { name: 'Sync Alex' }).check();
    await editor.getByRole('button', { name: 'Save changes' }).click();
    await expect(second.getByRole('button', { name: 'Edit Sync Updated', exact: true })).toBeVisible();
    await second.getByRole('button', { name: 'Edit Sync Updated', exact: true }).click();
    await expect(second.getByRole('dialog', { name: 'Edit activity' }).getByRole('checkbox', { name: 'Sync Alex' })).toBeChecked();
    await first.locator('.scheduled-card').filter({ hasText: 'Sync Updated' }).getByRole('button', { name: 'Delete Sync Updated' }).click();
    await expect(second.getByRole('button', { name: 'Edit Sync Updated', exact: true })).toHaveCount(0);
    await expect(second.getByText('This activity was deleted or moved outside the visible range. Your draft has been kept.')).toBeVisible();
  } finally { await a.close(); await b.close(); }
});

test('editing a reusable card leaves placed copies unchanged, and dragging moves the existing copy', async ({ page }) => {
  await join(page);
  const placed = await seed(page, 'Reusable Original');
  const reusable = page.locator('.calendar-activity-list .activity-card').filter({ hasText: 'Reusable Original' });
  await reusable.getByRole('button', { name: 'Edit reusable Reusable Original' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit reusable activity' });
  await editor.getByRole('textbox', { name: 'Reusable activity title' }).fill('Reusable Updated');
  await editor.getByRole('button', { name: 'Use color #10b981' }).click();
  await editor.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('.calendar-activity-list .activity-card').filter({ hasText: 'Reusable Updated' })).toBeVisible();
  const scheduled = page.locator('.scheduled-card').filter({ hasText: 'Reusable Original' });
  await expect(scheduled).toBeVisible();
  const destination = adjacentDayInMonth(today);
  await scheduled.dragTo(monthDay(page, destination));
  await expect(monthDay(page, destination).locator('.scheduled-card').filter({ hasText: 'Reusable Original' })).toBeVisible();
  const monthEnd = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const result = await api(page, `planner?from=${month}-01&to=${month}-${monthEnd}`);
  expect(result.status).toBe(200);
  expect(result.data.scheduled.filter((activity: { id: string }) => activity.id === placed.id)).toMatchObject([{ date: destination, title: 'Reusable Original', color: '#0ea5e9' }]);
});

test('dirty draft survives remote edit, stale save is blocked, explicit review allows retry', async ({ browser }) => {
  const a = await browser.newContext(), b = await browser.newContext();
  const first = await a.newPage(), second = await b.newPage();
  try {
    await join(first); await join(second); await seed(first, 'Conflict Original');
    await first.getByRole('button', { name: 'Edit Conflict Original', exact: true }).click();
    await second.getByRole('button', { name: 'Edit Conflict Original', exact: true }).click();
    const editorA = first.getByRole('dialog', { name: 'Edit activity' });
    const editorB = second.getByRole('dialog', { name: 'Edit activity' });
    await editorA.getByRole('textbox', { name: 'Title', exact: true }).fill('My unsaved draft');
    await editorB.getByRole('textbox', { name: 'Title', exact: true }).fill('Other saved version');
    await editorB.getByRole('button', { name: 'Save changes' }).click();
    await expect(editorA.getByText('This activity changed on another device. Your draft has been kept.')).toBeVisible();
    await expect(editorA.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('My unsaved draft');
    await expect(editorA.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await editorA.getByRole('button', { name: 'Review and retry' }).click();
    await editorA.getByRole('button', { name: 'Save changes' }).click();
    await expect(second.getByRole('button', { name: 'Edit My unsaved draft', exact: true })).toBeVisible();
  } finally { await a.close(); await b.close(); }
});

test('invitation fragments are removed, cookies are secure, only preferences migrate, and logout revokes browser access', async ({ page, context }) => {
  await page.addInitScript(() => localStorage.setItem('plan-by-week:v1', JSON.stringify({ selectedMonth: new Date().toISOString().slice(0, 7), viewMode: 'month', state: { people: [{ id: 'legacy-person', name: 'Do not import me' }] } })));
  await join(page);
  const cookie = (await context.cookies()).find(c => c.name === '__Host-family_session');
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/' });
  expect(await page.evaluate(() => localStorage.getItem('plan-by-week:v1'))).toBeNull();
  const preferences = await page.evaluate(() => JSON.parse(localStorage.getItem('plan-by-week:preferences:v1')!));
  expect(Object.keys(preferences).sort()).toEqual(['selectedMonth', 'selectedWeekStart', 'viewMode']);
  await expect(page.getByText('Do not import me')).toHaveCount(0);
  await page.getByRole('button', { name: 'Planner options' }).click();
  await page.getByRole('menuitem', { name: 'Leave this calendar' }).click();
  await expect(page.getByRole('status')).toContainText('invitation is required');
  expect((await api(page, 'invite')).status).toBe(401);
});

test('failed optimistic save rolls back the card and keeps the draft; offline edits are refused', async ({ page, context }) => {
  await join(page); await seed(page, 'Failure Original');
  await page.getByRole('button', { name: 'Edit Failure Original', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit activity' });
  await editor.getByRole('textbox', { name: 'Title', exact: true }).fill('Failure Draft');
  await page.route('**/api/scheduled/*', route => route.request().method() === 'PATCH' ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"code":"SERVICE_UNAVAILABLE"}' }) : route.continue());
  await editor.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: 'Edit Failure Original', exact: true })).toBeVisible();
  await expect(editor.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Failure Draft');
  await page.unroute('**/api/scheduled/*');
  await context.setOffline(true);
  await editor.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('alert').first()).toContainText('Offline');
  await context.setOffline(false);
  await expect(page.getByRole('status')).toHaveText('Connected');
  await editor.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: 'Edit Failure Draft', exact: true })).toBeVisible();
});

test('reconnection refetches missed changes even when no new command follows it', async ({ browser }) => {
  const a = await browser.newContext(), b = await browser.newContext();
  const first = await a.newPage(), second = await b.newPage();
  try {
    await join(first); await join(second);
    await b.setOffline(true);
    await seed(first, 'Created while disconnected');
    await b.setOffline(false);
    await expect(second.getByRole('button', { name: 'Edit Created while disconnected', exact: true })).toBeVisible();
  } finally { await a.close(); await b.close(); }
});
