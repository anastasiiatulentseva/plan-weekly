import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "plan-by-week:v1";

type ViewMode = "week" | "month";

type Person = {
  id: string;
  name: string;
  color: string;
};

type ActivityTemplate = {
  id: string;
  title: string;
  personIds: string[];
  color: string;
  notes?: string;
};

type ScheduledActivity = {
  id: string;
  templateId?: string;
  title: string;
  personIds: string[];
  date: string;
  startTime: string;
  endTime: string;
  notes?: string;
  color: string;
};

type MonthPlan = {
  monthKey: string;
  scheduled: ScheduledActivity[];
};

type PlannerState = {
  people: Person[];
  activityTemplates: ActivityTemplate[];
  months: Record<string, MonthPlan>;
};

type PersistedPlanner = {
  state: PlannerState;
  selectedMonth: string;
  selectedWeekStart: string;
  viewMode: ViewMode;
};

const peoplePalette = ["#4f8f78", "#cc6b5a", "#6d78bd", "#b7784f", "#7f6e9f"];
const activityPalette = ["#e9b44c", "#58a4b0", "#9d6b53", "#6c9a8b", "#b56d7a"];

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthKeyFromDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
}

function dateFromKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function monthDateFromKey(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month - 1, 1);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(monthKey: string, amount: number) {
  const date = monthDateFromKey(monthKey);
  date.setMonth(date.getMonth() + amount);
  return monthKeyFromDate(date);
}

function startOfMondayWeek(date: Date) {
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(date, offset);
}

function getMonthLabel(monthKey: string) {
  return new Intl.DateTimeFormat("en-IE", {
    month: "long",
    year: "numeric"
  }).format(monthDateFromKey(monthKey));
}

function emptyState(): PlannerState {
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

function ensureRollingMonths(state: PlannerState, selectedMonth: string) {
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

function loadPlanner(): PersistedPlanner {
  const selectedMonth = monthKeyFromDate(new Date());
  const selectedWeekStart = toDateKey(startOfMondayWeek(new Date()));

  if (typeof window === "undefined") {
    return {
      state: emptyState(),
      selectedMonth,
      selectedWeekStart,
      viewMode: "week"
    };
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {
      state: ensureRollingMonths(emptyState(), selectedMonth),
      selectedMonth,
      selectedWeekStart,
      viewMode: "week"
    };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedPlanner>;
    const safeMonth = parsed.selectedMonth ?? selectedMonth;
    return {
      state: ensureRollingMonths(parsed.state ?? emptyState(), safeMonth),
      selectedMonth: safeMonth,
      selectedWeekStart: parsed.selectedWeekStart ?? selectedWeekStart,
      viewMode: parsed.viewMode === "month" ? "month" : "week"
    };
  } catch {
    return {
      state: ensureRollingMonths(emptyState(), selectedMonth),
      selectedMonth,
      selectedWeekStart,
      viewMode: "week"
    };
  }
}

export default function PlannerApp() {
  const [planner, setPlanner] = useState<PersistedPlanner>(() => loadPlanner());

  const monthLabel = useMemo(
    () => getMonthLabel(planner.selectedMonth),
    [planner.selectedMonth]
  );

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(planner));
  }, [planner]);

  return (
    <main className="planner-shell">
      <section className="planner-hero">
        <div>
          <p className="eyebrow">Local planner</p>
          <h1>Plan by Week</h1>
          <p className="hero-copy">
            A light weekly and monthly activity planner for people, routines,
            and printable plans.
          </p>
        </div>
        <div className="month-card" aria-label="Selected month">
          <span>{monthLabel}</span>
          <strong>{planner.viewMode === "week" ? "Week view" : "Month view"}</strong>
        </div>
      </section>

      <section className="planner-workspace" aria-label="Planner workspace">
        <aside className="side-panel">
          <h2>People</h2>
          <p className="empty-note">People setup arrives in Phase 2.</p>
        </aside>

        <section className="calendar-surface">
          <div className="calendar-placeholder">
            <h2>{monthLabel}</h2>
            <p>
              Calendar navigation, week/month views, drag scheduling, cloning,
              and print controls will build on this foundation.
            </p>
          </div>
        </section>

        <aside className="side-panel">
          <h2>Activities</h2>
          <p className="empty-note">Reusable activities arrive in Phase 2.</p>
        </aside>
      </section>
    </main>
  );
}

export type {
  ActivityTemplate,
  MonthPlan,
  PersistedPlanner,
  Person,
  PlannerState,
  ScheduledActivity,
  ViewMode
};

export {
  activityPalette,
  addDays,
  addMonths,
  createId,
  dateFromKey,
  ensureRollingMonths,
  getMonthLabel,
  monthDateFromKey,
  monthKeyFromDate,
  peoplePalette,
  startOfMondayWeek,
  toDateKey
};
