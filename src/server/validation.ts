import { z } from 'zod';
export const id = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
export const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === v && v >= '1900-01-01' && v <= '9999-12-31';
});
export const monthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).refine(v => v >= '1900-01' && v <= '9999-12');
const optionalText = (max: number) => z.string().max(max).optional().nullable();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().nullable();
export const personInput = z.object({ name: z.string().trim().min(1).max(100), icon: optionalText(32), idempotencyKey: z.string().uuid().optional() }).strict();
const fields = {
  title: z.string().trim().min(1).max(200), color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  icon: optionalText(32), personIds: z.array(id).max(100).refine(v => new Set(v).size === v.length),
  startTime: time, endTime: time, notes: optionalText(5000), isRecurring: z.boolean().optional(),
};
const validTimes = (v: { startTime?: string | null; endTime?: string | null }) => !v.startTime || !v.endTime || v.startTime <= v.endTime;
export const templateInput = z.object({ ...fields, idempotencyKey: z.string().uuid().optional() }).strict().refine(validTimes, 'Invalid time range');
export const versionInput = z.number().int().positive().max(2147483647);
export const templateUpdateInput = z.object({ ...fields, expectedVersion: versionInput }).strict().refine(validTimes, 'Invalid time range');
export const deleteInput = z.object({ expectedVersion: versionInput }).strict();
export const scheduleInput = z.object({ templateId: id, date: dateKey, selectedMonth: monthKey, idempotencyKey: z.string().uuid() }).strict().refine(v => v.date.startsWith(v.selectedMonth), 'Date must be in selected month');
export const updateInput = z.object({ ...fields, date: dateKey, expectedVersion: versionInput }).strict().refine(validTimes, 'Invalid time range');
export const scheduledDeleteInput = z.object({ expectedVersion: versionInput, scope: z.enum(['single', 'future']), idempotencyKey: z.string().uuid() }).strict();
export const cloneInput = z.object({ source: monthKey, target: monthKey, idempotencyKey: z.string().uuid() }).strict().refine(v => v.source !== v.target);
export const rangeInput = z.object({ from: dateKey, to: dateKey }).refine(v => v.from <= v.to && (Date.parse(v.to) - Date.parse(v.from)) <= 100 * 86400000, 'Invalid date range');
