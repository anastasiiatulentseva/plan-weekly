export type ViewMode = "week" | "month";
export type PrintMode = "week" | "month";
export type AppMode = "view" | "edit";
export type OpenMenu = "settings" | null;
export type IconMenu = "person" | "activity" | "editor" | null;
export type DeleteScope = "single" | "future";

export type Person = {
  id: string;
  version: number;
  name: string;
  icon?: string;
};

export type ActivityTemplate = {
  id: string;
  version: number;
  title: string;
  personIds: string[];
  color: string;
  icon?: string;
  isRecurring?: boolean;
  startTime?: string;
  endTime?: string;
  notes?: string;
};

export type ScheduledActivity = {
  id: string;
  version: number;
  templateId?: string;
  recurrenceId?: string;
  isRecurring?: boolean;
  title: string;
  personIds: string[];
  date: string;
  startTime?: string;
  endTime?: string;
  notes?: string;
  color: string;
  icon?: string;
};

export type MonthPlan = {
  monthKey: string;
  scheduled: ScheduledActivity[];
};

export type PlannerState = {
  people: Person[];
  activityTemplates: ActivityTemplate[];
  months: Record<string, MonthPlan>;
};

export type PersistedPlanner = {
  state: PlannerState;
  selectedMonth: string;
  selectedWeekStart: string;
  viewMode: ViewMode;
};


export function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}
export function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function monthKeyFromDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
}

export function dateFromKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function monthDateFromKey(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month - 1, 1);
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function addMonths(monthKey: string, amount: number) {
  const date = monthDateFromKey(monthKey);
  date.setMonth(date.getMonth() + amount);
  return monthKeyFromDate(date);
}

export function startOfMondayWeek(date: Date) {
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(date, offset);
}

export function isSameMonth(date: Date, monthKey: string) {
  return monthKeyFromDate(date) === monthKey;
}

export function isWeekend(date: Date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

export function isToday(date: Date) {
  return toDateKey(date) === toDateKey(new Date());
}

export function getWeekDays(weekStartKey: string) {
  const weekStart = dateFromKey(weekStartKey);
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

export function getMonthWeeks(monthKey: string) {
  const firstDay = monthDateFromKey(monthKey);
  const lastDay = new Date(firstDay.getFullYear(), firstDay.getMonth() + 1, 0);
  const firstWeekStart = startOfMondayWeek(firstDay);
  const lastWeekStart = startOfMondayWeek(lastDay);
  const weeks: Date[][] = [];

  for (
    let weekStart = firstWeekStart;
    weekStart <= lastWeekStart;
    weekStart = addDays(weekStart, 7)
  ) {
    weeks.push(Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)));
  }

  return weeks;
}

export function getFirstWeekStartForMonth(monthKey: string) {
  return toDateKey(startOfMondayWeek(monthDateFromKey(monthKey)));
}

export function clampWeekToMonth(weekStartKey: string, monthKey: string) {
  const weeks = getMonthWeeks(monthKey).map((week) => toDateKey(week[0]));
  return weeks.includes(weekStartKey) ? weekStartKey : weeks[0];
}

export function getMonthLabel(monthKey: string) {
  return new Intl.DateTimeFormat("en-IE", {
    month: "long",
    year: "numeric"
  }).format(monthDateFromKey(monthKey));
}

export function getWeekdayDateLabel(date: Date) {
  const weekday = new Intl.DateTimeFormat("en-IE", { weekday: "short" }).format(date);
  const day = new Intl.DateTimeFormat("en-IE", { day: "numeric" }).format(date);
  const month = new Intl.DateTimeFormat("en-IE", { month: "short" }).format(date);
  return `${weekday}, ${day} ${month}`;
}

export function remapDateByWeekPattern(dateKey: string, sourceMonth: string, targetMonth: string) {
  const sourceDate = dateFromKey(dateKey);
  const sourceWeekday = sourceDate.getDay();
  const sourceOrdinal =
    getMonthWeeks(sourceMonth)
      .flat()
      .filter(
        (date) =>
          isSameMonth(date, sourceMonth) &&
          date.getDay() === sourceWeekday &&
          date <= sourceDate
      ).length || 1;
  const targetCandidates = getMonthWeeks(targetMonth)
    .flat()
    .filter(
      (date) => isSameMonth(date, targetMonth) && date.getDay() === sourceWeekday
    );
  const targetDate =
    targetCandidates[Math.min(sourceOrdinal - 1, targetCandidates.length - 1)] ??
    monthDateFromKey(targetMonth);

  return toDateKey(targetDate);
}

export function isTimeRangeValid(startTime?: string, endTime?: string) {
  return !startTime || !endTime || startTime <= endTime;
}

export function getScheduleDatesForTemplate(
  template: ActivityTemplate,
  dateKey: string,
  selectedMonth: string
) {
  if (!template.isRecurring) return [dateKey];

  const selectedDate = dateFromKey(dateKey);
  return getMonthWeeks(selectedMonth)
    .flat()
    .filter((date) => {
      const targetDateKey = toDateKey(date);
      return (
        isSameMonth(date, selectedMonth) &&
        date.getDay() === selectedDate.getDay() &&
        targetDateKey >= dateKey
      );
    })
    .map(toDateKey);
}

export function isNavigableMonth(monthKey: string, baseMonth = monthKeyFromDate(new Date())) {
  return monthKey >= addMonths(baseMonth, -1) && monthKey <= addMonths(baseMonth, 1);
}

export function emptyState(): PlannerState {
  const currentMonth = monthKeyFromDate(new Date());
  return {
    people: [],
    activityTemplates: [],
    months: {
      [currentMonth]: {
        monthKey: currentMonth,
        scheduled: []
      }
    }
  };
}

export function ensureRollingMonths(state: PlannerState, selectedMonth: string) {
  const allowed = new Set([
    addMonths(selectedMonth, -1),
    selectedMonth,
    addMonths(selectedMonth, 1)
  ]);
  const months = Object.fromEntries(
    Object.entries(state.months).filter(([monthKey]) => allowed.has(monthKey))
  );

  allowed.forEach((monthKey) => {
    months[monthKey] ??= { monthKey, scheduled: [] };
  });

  return { ...state, months };
}

export function findScheduledActivity(state: PlannerState, activityId: string) {
  return Object.values(state.months)
    .flatMap((month) => month.scheduled)
    .find((activity) => activity.id === activityId);
}

export function isRecurringScheduledActivity(
  activity: ScheduledActivity,
  state: PlannerState
) {
  if (activity.isRecurring || activity.recurrenceId) return true;
  const template = state.activityTemplates.find(
    (candidate) => candidate.id === activity.templateId
  );
  return Boolean(template?.isRecurring);
}

export function isFutureRecurringMatch(
  candidate: ScheduledActivity,
  target: ScheduledActivity,
  state: PlannerState
) {
  if (candidate.id === target.id) return true;
  if (candidate.date < target.date) return false;

  if (target.recurrenceId) {
    return candidate.recurrenceId === target.recurrenceId;
  }

  if (!target.templateId || candidate.templateId !== target.templateId) {
    return false;
  }

  const template = state.activityTemplates.find(
    (activity) => activity.id === target.templateId
  );
  const isRecurring = candidate.isRecurring || candidate.recurrenceId || template?.isRecurring;
  return (
    Boolean(isRecurring) &&
    dateFromKey(candidate.date).getDay() === dateFromKey(target.date).getDay()
  );
}

