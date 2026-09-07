import { sql } from 'drizzle-orm';
import { pgTable, text, integer, bigint, boolean, date, time, primaryKey, index, check, jsonb } from 'drizzle-orm/pg-core';

export const people = pgTable('people', {
  id: text().primaryKey(), name: text().notNull(), icon: text(), version: integer().notNull().default(1),
}, t => [check('people_version_positive', sql`${t.version} > 0`)]);
const activityColumns = () => ({
  id: text().primaryKey(), title: text().notNull(), color: text().notNull(), icon: text(),
  isRecurring: boolean('is_recurring').notNull().default(false),
  startTime: time('start_time'), endTime: time('end_time'), notes: text(),
  version: integer().notNull().default(1),
});
export const templates = pgTable('activity_templates', activityColumns(), t => [
  check('template_times', sql`${t.startTime} IS NULL OR ${t.endTime} IS NULL OR ${t.startTime} <= ${t.endTime}`),
  check('template_version_positive', sql`${t.version} > 0`),
]);
export const scheduled = pgTable('scheduled_activities', {
  ...activityColumns(), date: date().notNull(),
  templateId: text('template_id').references(() => templates.id, { onDelete: 'set null' }),
  recurrenceId: text('recurrence_id'),
}, t => [index('scheduled_date_idx').on(t.date), index('scheduled_recurrence_idx').on(t.recurrenceId),
  index('scheduled_template_idx').on(t.templateId),
  check('scheduled_times', sql`${t.startTime} IS NULL OR ${t.endTime} IS NULL OR ${t.startTime} <= ${t.endTime}`),
  check('scheduled_version_positive', sql`${t.version} > 0`),
]);
export const templatePeople = pgTable('activity_template_people', {
  activityId: text('activity_id').notNull().references(() => templates.id, { onDelete: 'cascade' }),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
}, t => [primaryKey({ columns: [t.activityId, t.personId] }), index('template_person_idx').on(t.personId)]);
export const scheduledPeople = pgTable('scheduled_activity_people', {
  activityId: text('activity_id').notNull().references(() => scheduled.id, { onDelete: 'cascade' }),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
}, t => [primaryKey({ columns: [t.activityId, t.personId] }), index('scheduled_person_idx').on(t.personId)]);
export const metadata = pgTable('calendar_metadata', {
  id: integer().primaryKey().default(1), calendarRevision: bigint('calendar_revision', { mode: 'number' }).notNull().default(0),
}, t => [check('singleton', sql`${t.id} = 1`)]);
export const requests = pgTable('mutation_requests', {
  key: text().primaryKey(), fingerprint: text().notNull(), result: jsonb().notNull(),
});
