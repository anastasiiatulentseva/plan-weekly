import { clampWeekToMonth, isNavigableMonth, monthKeyFromDate, startOfMondayWeek, toDateKey } from './planner';
import type { ViewMode } from './planner';
export const preferencesKey = 'plan-by-week:preferences:v1';
export const legacyKey = 'plan-by-week:v1';
export function extractPreferences(value: unknown, now = new Date()) {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const currentMonth = monthKeyFromDate(now);
  const selectedMonth = typeof data.selectedMonth === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(data.selectedMonth) && isNavigableMonth(data.selectedMonth, currentMonth) ? data.selectedMonth : currentMonth;
  const selectedWeekStart = clampWeekToMonth(typeof data.selectedWeekStart === 'string' ? data.selectedWeekStart : toDateKey(startOfMondayWeek(now)), selectedMonth);
  return { selectedMonth, selectedWeekStart, viewMode: (data.viewMode === 'month' ? 'month' : 'week') as ViewMode };
}
