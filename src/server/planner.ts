import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { database } from './db';
import { people, templates, scheduled, templatePeople, scheduledPeople, metadata, requests } from './schema';
import { getScheduleDatesForTemplate, remapDateByWeekPattern } from '../shared/planner';
import type { ActivityTemplate, ScheduledActivity } from '../shared/planner';
import { broadcast } from './events';
import * as validation from './validation';

type DB = Pick<ReturnType<typeof database>, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;
type Kind = 'people' | 'templates' | 'scheduled';
export class ApiError extends Error {
  constructor(public status: number, public code: string, public details: Record<string, unknown> = {}) { super(code); }
}
const tableFor = (kind: Kind) => kind === 'people' ? people : kind === 'templates' ? templates : scheduled;
function clean(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, (k === 'startTime' || k === 'endTime') && typeof v === 'string' ? v.slice(0, 5) : v]));
}
export async function aggregates(db: DB, kind: Kind, ids?: string[]) {
  if (ids?.length === 0) return [];
  const table = tableFor(kind);
  const rows = await db.select().from(table).where(ids ? inArray(table.id, ids) : undefined).orderBy(asc(table.id));
  if (kind === 'people') return rows.map(clean);
  const join = kind === 'templates' ? templatePeople : scheduledPeople;
  const assignments = await db.select().from(join).where(ids ? inArray(join.activityId, ids) : undefined).orderBy(asc(join.personId));
  return rows.map(row => ({ ...clean(row), personIds: assignments.filter(a => a.activityId === row.id).map(a => a.personId) }));
}
export async function readPlanner(from: string, to: string) {
  return database().transaction(async tx => {
    const ids = await tx.select({ id: scheduled.id }).from(scheduled).where(and(gte(scheduled.date, from), lte(scheduled.date, to)));
    const [persons, activityTemplates, activities] = await Promise.all([
      aggregates(tx, 'people'), aggregates(tx, 'templates'), aggregates(tx, 'scheduled', ids.map(r => r.id)),
    ]);
    const [meta] = await tx.select().from(metadata);
    return { people: persons, activityTemplates, scheduled: activities, calendarRevision: meta?.calendarRevision ?? 0 };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
}
async function checkVersion(tx: DB, kind: Kind, id: string, expectedVersion: number) {
  const table = tableFor(kind);
  const [row] = await tx.select({ id: table.id, version: table.version }).from(table).where(eq(table.id, id)).for('update');
  if (!row || row.version !== expectedVersion) {
    const [latest] = await aggregates(tx, kind, [id]);
    throw new ApiError(409, 'VERSION_CONFLICT', { submittedVersion: expectedVersion, latest: latest ?? null });
  }
}
async function assignments(tx: DB, kind: 'templates' | 'scheduled', activityId: string, personIds: string[]) {
  if (personIds.length) {
    const found = await tx.select({ id: people.id }).from(people).where(inArray(people.id, personIds));
    if (found.length !== personIds.length) throw new ApiError(400, 'INVALID_ASSIGNMENTS');
  }
  const table = kind === 'templates' ? templatePeople : scheduledPeople;
  await tx.delete(table).where(eq(table.activityId, activityId));
  if (personIds.length) await tx.insert(table).values(personIds.map(personId => ({ activityId, personId })));
}
function activityValues(input: Record<string, unknown>) {
  return {
    title: input.title as string, color: input.color as string, icon: (input.icon as string) ?? null,
    notes: (input.notes as string) ?? null, startTime: (input.startTime as string) ?? null,
    endTime: (input.endTime as string) ?? null, isRecurring: Boolean(input.isRecurring),
  };
}
async function insertScheduled(tx: DB, input: ScheduledActivity) {
  await tx.insert(scheduled).values({ ...activityValues(input), id: input.id, date: input.date,
    templateId: input.templateId ?? null, recurrenceId: input.recurrenceId ?? null });
  await assignments(tx, 'scheduled', input.id, input.personIds);
}

export async function command(kind: Kind | 'clone', method: string, recordId: string | undefined, raw: unknown) {
  if (recordId) validation.id.parse(recordId);
  const input = kind === 'clone' ? validation.cloneInput.parse(raw)
    : method === 'POST' ? (kind === 'people' ? validation.personInput.parse(raw) : kind === 'templates' ? validation.templateInput.parse(raw) : validation.scheduleInput.parse(raw))
    : method === 'PATCH' && kind === 'scheduled' ? validation.updateInput.parse(raw)
    : method === 'PATCH' && kind === 'templates' ? validation.templateUpdateInput.parse(raw)
    : method === 'DELETE' ? (kind === 'scheduled' ? validation.scheduledDeleteInput.parse(raw) : validation.deleteInput.parse(raw))
    : (() => { throw new ApiError(405, 'METHOD_NOT_ALLOWED'); })();
  if (method !== 'POST' && !recordId) throw new ApiError(400, 'ID_REQUIRED');
  const key = 'idempotencyKey' in input ? input.idempotencyKey : undefined;
  const fingerprint = createHash('sha256').update(JSON.stringify({ kind, method, recordId, input })).digest('hex');
  const result = await database().transaction(async tx => {
    // Shared for ordinary writes; exclusive for commands that affect other aggregates.
    // This prevents FK/parent-lock inversions and gives bulk commands a stable membership.
    const bulk = kind === 'clone' || (method === 'DELETE' && (kind !== 'scheduled' || ('scope' in input && input.scope === 'future')));
    await tx.execute(bulk ? sql`SELECT pg_advisory_xact_lock(19042027)` : sql`SELECT pg_advisory_xact_lock_shared(19042027)`);
    if (key) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
      const [previous] = await tx.select().from(requests).where(eq(requests.key, key));
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new ApiError(409, 'IDEMPOTENCY_KEY_REUSED');
        return previous.result as { calendarRevision: number; records: Record<string, unknown>[] };
      }
    }
    let records: Record<string, unknown>[] = [];
    if (kind === 'clone' && 'source' in input) {
      const sourceRows = await tx.select({ id: scheduled.id }).from(scheduled)
        .where(and(gte(scheduled.date, `${input.source}-01`), lte(scheduled.date, monthEnd(input.source)))).orderBy(asc(scheduled.id)).for('update');
      const source = await aggregates(tx, 'scheduled', sourceRows.map(r => r.id)) as unknown as ScheduledActivity[];
      const ids: string[] = [];
      for (const activity of source) {
        const id = randomUUID(); ids.push(id);
        // Deliberately preserve recurrenceId across cloned months.
        await insertScheduled(tx, { ...activity, id, version: 1, date: remapDateByWeekPattern(activity.date, input.source, input.target) });
      }
      records = await aggregates(tx, 'scheduled', ids);
    } else if (method === 'POST' && kind === 'people' && 'name' in input) {
      const id = randomUUID();
      await tx.insert(people).values({ id, name: input.name, icon: input.icon });
      records = await aggregates(tx, 'people', [id]);
    } else if (method === 'POST' && kind === 'templates' && 'personIds' in input) {
      const id = randomUUID();
      await tx.insert(templates).values({ id, ...activityValues(input) });
      await assignments(tx, 'templates', id, input.personIds);
      records = await aggregates(tx, 'templates', [id]);
    } else if (method === 'POST' && kind === 'scheduled' && 'templateId' in input) {
      const [template] = await aggregates(tx, 'templates', [input.templateId]) as unknown as ActivityTemplate[];
      if (!template) throw new ApiError(404, 'NOT_FOUND');
      const dates = getScheduleDatesForTemplate(template, input.date, input.selectedMonth);
      const recurrenceId = template.isRecurring ? randomUUID() : undefined;
      const ids: string[] = [];
      for (const date of dates) {
        const id = randomUUID(); ids.push(id);
        await insertScheduled(tx, { ...template, templateId: template.id, id, version: 1, date, recurrenceId });
      }
      records = await aggregates(tx, 'scheduled', ids);
    } else if (kind !== 'clone' && recordId && 'expectedVersion' in input) {
      await checkVersion(tx, kind, recordId, input.expectedVersion);
      if (method === 'PATCH' && kind === 'templates' && 'personIds' in input && !('date' in input)) {
        const update = validation.templateUpdateInput.parse(input);
        await tx.update(templates).set({ ...activityValues(update), version: sql`${templates.version} + 1` })
          .where(and(eq(templates.id, recordId), eq(templates.version, input.expectedVersion)));
        await assignments(tx, 'templates', recordId, update.personIds);
        records = await aggregates(tx, 'templates', [recordId]);
      } else if (method === 'PATCH' && kind === 'scheduled' && 'personIds' in input && 'date' in input) {
        const update = validation.updateInput.parse(input);
        await tx.update(scheduled).set({ ...activityValues(update), date: update.date, version: sql`${scheduled.version} + 1` })
          .where(and(eq(scheduled.id, recordId), eq(scheduled.version, input.expectedVersion)));
        await assignments(tx, 'scheduled', recordId, update.personIds);
        records = await aggregates(tx, 'scheduled', [recordId]);
      } else if (method === 'DELETE') {
        if (kind === 'people') {
          const templateIds = await tx.select({ id: templatePeople.activityId }).from(templatePeople).where(eq(templatePeople.personId, recordId));
          const activityIds = await tx.select({ id: scheduledPeople.activityId }).from(scheduledPeople).where(eq(scheduledPeople.personId, recordId));
          if (templateIds.length) await tx.update(templates).set({ version: sql`${templates.version} + 1` }).where(inArray(templates.id, templateIds.map(r => r.id)));
          if (activityIds.length) await tx.update(scheduled).set({ version: sql`${scheduled.version} + 1` }).where(inArray(scheduled.id, activityIds.map(r => r.id)));
        } else if (kind === 'templates') {
          await tx.update(scheduled).set({ version: sql`${scheduled.version} + 1` }).where(eq(scheduled.templateId, recordId));
        }
        if (kind === 'scheduled' && 'scope' in input && input.scope === 'future') {
          const [target] = await tx.select().from(scheduled).where(eq(scheduled.id, recordId));
          const predicate = target.recurrenceId ? and(eq(scheduled.recurrenceId, target.recurrenceId), gte(scheduled.date, target.date)) : eq(scheduled.id, recordId);
          const rows = await tx.select({ id: scheduled.id }).from(scheduled).where(predicate).orderBy(asc(scheduled.id)).for('update');
          await tx.delete(scheduled).where(inArray(scheduled.id, rows.map(r => r.id)));
        } else {
          const table = tableFor(kind);
          await tx.delete(table).where(and(eq(table.id, recordId), eq(table.version, input.expectedVersion)));
        }
      }
    } else throw new ApiError(400, 'INVALID_COMMAND');
    await tx.insert(metadata).values({ id: 1, calendarRevision: 0 }).onConflictDoNothing();
    const [meta] = await tx.update(metadata).set({ calendarRevision: sql`${metadata.calendarRevision} + 1` }).where(eq(metadata.id, 1)).returning();
    const result = { records, calendarRevision: meta.calendarRevision };
    if (key) await tx.insert(requests).values({ key, fingerprint, result });
    return result;
  });
  broadcast(result.calendarRevision);
  return result;
}
export function monthEnd(month: string) {
  const [year, number] = month.split('-').map(Number);
  return `${month}-${new Date(Date.UTC(year, number, 0)).getUTCDate()}`;
}
