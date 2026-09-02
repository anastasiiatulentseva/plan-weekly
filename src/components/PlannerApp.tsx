import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Pencil,
  GripVertical,
  Plus,
  Printer,
  Trash2,
  UserRoundPlus
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "plan-by-week:v1";

type ViewMode = "week" | "month";
type PrintMode = "week" | "month";

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

function isSameMonth(date: Date, monthKey: string) {
  return monthKeyFromDate(date) === monthKey;
}

function getWeekDays(weekStartKey: string) {
  const weekStart = dateFromKey(weekStartKey);
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

function getMonthWeeks(monthKey: string) {
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

function getFirstWeekStartForMonth(monthKey: string) {
  return toDateKey(startOfMondayWeek(monthDateFromKey(monthKey)));
}

function clampWeekToMonth(weekStartKey: string, monthKey: string) {
  const weeks = getMonthWeeks(monthKey).map((week) => toDateKey(week[0]));
  return weeks.includes(weekStartKey) ? weekStartKey : weeks[0];
}

function getMonthLabel(monthKey: string) {
  return new Intl.DateTimeFormat("en-IE", {
    month: "long",
    year: "numeric"
  }).format(monthDateFromKey(monthKey));
}

function remapDateByWeekPattern(dateKey: string, sourceMonth: string, targetMonth: string) {
  const sourceWeeks = getMonthWeeks(sourceMonth);
  const targetWeeks = getMonthWeeks(targetMonth);
  const sourceDate = dateFromKey(dateKey);
  const sourceWeekIndex = sourceWeeks.findIndex((week) =>
    week.some((day) => toDateKey(day) === dateKey)
  );
  const sourceDayIndex = sourceDate.getDay() === 0 ? 6 : sourceDate.getDay() - 1;
  const targetWeek = targetWeeks[Math.min(sourceWeekIndex, targetWeeks.length - 1)];
  const targetDate = targetWeek[sourceDayIndex];

  if (isSameMonth(targetDate, targetMonth)) {
    return toDateKey(targetDate);
  }

  const candidates = targetWeeks
    .map((week) => week[sourceDayIndex])
    .filter((date) => isSameMonth(date, targetMonth));

  return toDateKey(candidates[candidates.length - 1] ?? targetDate);
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
  const [personName, setPersonName] = useState("");
  const [activityTitle, setActivityTitle] = useState("");
  const [activityNotes, setActivityNotes] = useState("");
  const [activityPeople, setActivityPeople] = useState<string[]>([]);
  const [activityColor, setActivityColor] = useState(activityPalette[0]);
  const [editingActivityId, setEditingActivityId] = useState<string | null>(null);
  const [printMode, setPrintMode] = useState<PrintMode | null>(null);

  const monthLabel = useMemo(
    () => getMonthLabel(planner.selectedMonth),
    [planner.selectedMonth]
  );
  const visibleMonth = useMemo(
    () => planner.state.months[planner.selectedMonth]?.scheduled ?? [],
    [planner.selectedMonth, planner.state.months]
  );
  const monthWeeks = useMemo(
    () => getMonthWeeks(planner.selectedMonth),
    [planner.selectedMonth]
  );
  const selectedWeekStart = useMemo(
    () => clampWeekToMonth(planner.selectedWeekStart, planner.selectedMonth),
    [planner.selectedMonth, planner.selectedWeekStart]
  );
  const selectedWeekDays = useMemo(
    () => getWeekDays(selectedWeekStart),
    [selectedWeekStart]
  );
  const selectedWeekIndex = monthWeeks.findIndex(
    (week) => toDateKey(week[0]) === selectedWeekStart
  );
  const canGoPreviousWeek = selectedWeekIndex > 0;
  const canGoNextWeek = selectedWeekIndex >= 0 && selectedWeekIndex < monthWeeks.length - 1;
  const editingActivity = useMemo(() => {
    if (!editingActivityId) return null;
    return Object.values(planner.state.months)
      .flatMap((month) => month.scheduled)
      .find((activity) => activity.id === editingActivityId);
  }, [editingActivityId, planner.state.months]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(planner));
  }, [planner]);

  useEffect(() => {
    if (!printMode) return;

    const clearPrintMode = () => setPrintMode(null);
    window.addEventListener("afterprint", clearPrintMode);
    const printTimer = window.setTimeout(() => window.print(), 50);

    return () => {
      window.clearTimeout(printTimer);
      window.removeEventListener("afterprint", clearPrintMode);
    };
  }, [printMode]);

  function addPerson(event: { preventDefault: () => void }) {
    event.preventDefault();
    const name = personName.trim();
    if (!name) return;

    setPlanner((current) => {
      const color = peoplePalette[current.state.people.length % peoplePalette.length];
      return {
        ...current,
        state: {
          ...current.state,
          people: [
            ...current.state.people,
            {
              id: createId("person"),
              name,
              color
            }
          ]
        }
      };
    });
    setPersonName("");
  }

  function toggleActivityPerson(personId: string) {
    setActivityPeople((current) =>
      current.includes(personId)
        ? current.filter((id) => id !== personId)
        : [...current, personId]
    );
  }

  function addActivity(event: { preventDefault: () => void }) {
    event.preventDefault();
    const title = activityTitle.trim();
    if (!title) return;

    setPlanner((current) => ({
      ...current,
      state: {
        ...current.state,
        activityTemplates: [
          ...current.state.activityTemplates,
          {
            id: createId("activity"),
            title,
            personIds: activityPeople,
            color: activityColor,
            notes: activityNotes.trim() || undefined
          }
        ]
      }
    }));
    setActivityTitle("");
    setActivityNotes("");
    setActivityPeople([]);
    setActivityColor(activityPalette[0]);
  }

  function deleteActivityTemplate(activityId: string) {
    setPlanner((current) => ({
      ...current,
      state: {
        ...current.state,
        activityTemplates: current.state.activityTemplates.filter(
          (activity) => activity.id !== activityId
        )
      }
    }));
  }

  function setMonthScheduled(
    state: PlannerState,
    monthKey: string,
    scheduled: ScheduledActivity[]
  ) {
    return {
      ...state,
      months: {
        ...state.months,
        [monthKey]: {
          monthKey,
          scheduled
        }
      }
    };
  }

  function beginActivityDrag(
    event: { dataTransfer: DataTransfer },
    activityId: string
  ) {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", activityId);
  }

  function allowDrop(event: {
    preventDefault: () => void;
    currentTarget: HTMLElement;
  }) {
    event.preventDefault();
    event.currentTarget.classList.add("drop-ready");
  }

  function leaveDrop(event: { currentTarget: HTMLElement }) {
    event.currentTarget.classList.remove("drop-ready");
  }

  function dropActivity(
    event: {
      preventDefault: () => void;
      currentTarget: HTMLElement;
      dataTransfer: DataTransfer;
    },
    dateKey: string
  ) {
    event.preventDefault();
    event.currentTarget.classList.remove("drop-ready");
    if (!isSameMonth(dateFromKey(dateKey), planner.selectedMonth)) return;

    const templateId = event.dataTransfer.getData("text/plain");
    const template = planner.state.activityTemplates.find(
      (activity) => activity.id === templateId
    );
    if (!template) return;

    const scheduled: ScheduledActivity = {
      id: createId("scheduled"),
      templateId: template.id,
      title: template.title,
      personIds: template.personIds,
      date: dateKey,
      startTime: "09:00",
      endTime: "10:00",
      notes: template.notes,
      color: template.color
    };
    const targetMonth = monthKeyFromDate(dateFromKey(dateKey));

    setPlanner((current) => {
      const month = current.state.months[targetMonth] ?? {
        monthKey: targetMonth,
        scheduled: []
      };
      const nextState = setMonthScheduled(current.state, targetMonth, [
        ...month.scheduled,
        scheduled
      ]);

      return {
        ...current,
        state: ensureRollingMonths(nextState, current.selectedMonth)
      };
    });
    setEditingActivityId(scheduled.id);
  }

  function updateScheduledActivity(
    activityId: string,
    patch: Partial<ScheduledActivity>
  ) {
    setPlanner((current) => {
      const allMonths = Object.fromEntries(
        Object.entries(current.state.months).map(([monthKey, month]) => [
          monthKey,
          {
            ...month,
            scheduled: month.scheduled.filter((activity) => activity.id !== activityId)
          }
        ])
      );
      const existing = Object.values(current.state.months)
        .flatMap((month) => month.scheduled)
        .find((activity) => activity.id === activityId);

      if (!existing) return current;

      const updated = { ...existing, ...patch };
      const targetMonth = monthKeyFromDate(dateFromKey(updated.date));
      const target = allMonths[targetMonth] ?? {
        monthKey: targetMonth,
        scheduled: []
      };

      return {
        ...current,
        state: ensureRollingMonths({
          ...current.state,
          months: {
            ...allMonths,
            [targetMonth]: {
              monthKey: targetMonth,
              scheduled: [...target.scheduled, updated].sort((a, b) =>
                `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`)
              )
            }
          }
        }, current.selectedMonth)
      };
    });
  }

  function toggleScheduledPerson(activityId: string, personId: string) {
    const activity = Object.values(planner.state.months)
      .flatMap((month) => month.scheduled)
      .find((scheduled) => scheduled.id === activityId);
    if (!activity) return;
    updateScheduledActivity(activityId, {
      personIds: activity.personIds.includes(personId)
        ? activity.personIds.filter((id) => id !== personId)
        : [...activity.personIds, personId]
    });
  }

  function deleteScheduledActivity(activityId: string) {
    setPlanner((current) => ({
      ...current,
      state: {
        ...current.state,
        months: Object.fromEntries(
          Object.entries(current.state.months).map(([monthKey, month]) => [
            monthKey,
            {
              ...month,
              scheduled: month.scheduled.filter(
                (activity) => activity.id !== activityId
              )
            }
          ])
        )
      }
    }));
    if (editingActivityId === activityId) {
      setEditingActivityId(null);
    }
  }

  function personById(personId: string) {
    return planner.state.people.find((person) => person.id === personId);
  }

  function changeMonth(amount: number) {
    setPlanner((current) => {
      const selectedMonth = addMonths(current.selectedMonth, amount);
      const selectedWeekStart = getFirstWeekStartForMonth(selectedMonth);
      return {
        ...current,
        selectedMonth,
        selectedWeekStart,
        state: ensureRollingMonths(current.state, selectedMonth)
      };
    });
  }

  function setViewMode(viewMode: ViewMode) {
    setPlanner((current) => ({
      ...current,
      viewMode
    }));
  }

  function changeWeek(amount: number) {
    setPlanner((current) => {
      const weeks = getMonthWeeks(current.selectedMonth).map((week) => toDateKey(week[0]));
      const safeWeek = clampWeekToMonth(current.selectedWeekStart, current.selectedMonth);
      const currentIndex = weeks.indexOf(safeWeek);
      const nextIndex = Math.min(Math.max(currentIndex + amount, 0), weeks.length - 1);
      return {
        ...current,
        selectedWeekStart: weeks[nextIndex]
      };
    });
  }

  function activitiesForDate(dateKey: string) {
    return visibleMonth
      .filter((activity) => activity.date === dateKey)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  function cloneToNextMonth() {
    setPlanner((current) => {
      const sourceMonth = current.selectedMonth;
      const targetMonth = addMonths(sourceMonth, 1);
      const sourceActivities =
        current.state.months[sourceMonth]?.scheduled.filter((activity) =>
          isSameMonth(dateFromKey(activity.date), sourceMonth)
        ) ?? [];
      const targetPlan = current.state.months[targetMonth] ?? {
        monthKey: targetMonth,
        scheduled: []
      };
      const cloned = sourceActivities.map((activity) => ({
        ...activity,
        id: createId("scheduled"),
        date: remapDateByWeekPattern(activity.date, sourceMonth, targetMonth)
      }));
      const nextState = setMonthScheduled(current.state, targetMonth, [
        ...targetPlan.scheduled,
        ...cloned
      ]);

      return {
        ...current,
        state: ensureRollingMonths(nextState, sourceMonth)
      };
    });
  }

  function dayLabel(date: Date) {
    return new Intl.DateTimeFormat("en-IE", {
      weekday: "short",
      day: "numeric"
    }).format(date);
  }

  function compactDayLabel(date: Date) {
    return new Intl.DateTimeFormat("en-IE", {
      weekday: "short",
      day: "numeric",
      month: "short"
    }).format(date);
  }

  function renderPrintActivity(activity: ScheduledActivity) {
    return (
      <article
        className="print-activity"
        key={activity.id}
        style={{ borderLeftColor: activity.color }}
      >
        <strong>{activity.title}</strong>
        <span>
          {activity.startTime} - {activity.endTime}
        </span>
        <span>
          {activity.personIds.length === 0
            ? "Everyone"
            : activity.personIds
                .map((personId) => personById(personId)?.name)
                .filter(Boolean)
                .join(", ")}
        </span>
        {activity.notes ? <p>{activity.notes}</p> : null}
      </article>
    );
  }

  function renderPrintDay(date: Date, compact = false) {
    const dateKey = toDateKey(date);
    const activities = activitiesForDate(dateKey);

    return (
      <section
        className={
          isSameMonth(date, planner.selectedMonth)
            ? "print-day"
            : "print-day print-outside-month"
        }
        key={dateKey}
      >
        <header>{compact ? date.getDate() : compactDayLabel(date)}</header>
        <div className="print-activity-list">
          {activities.length === 0 ? (
            <span className="print-empty">No activities</span>
          ) : (
            activities.map(renderPrintActivity)
          )}
        </div>
      </section>
    );
  }

  function renderPrintSheet() {
    if (!printMode) return null;
    const title =
      printMode === "week"
        ? `${compactDayLabel(selectedWeekDays[0])} - ${compactDayLabel(
            selectedWeekDays[6]
          )}`
        : monthLabel;

    return (
      <section className="print-sheet" aria-label={`${printMode} print layout`}>
        <header className="print-header">
          <div>
            <p>Plan by Week</p>
            <h1>{title}</h1>
          </div>
          <div className="print-people">
            {planner.state.people.length === 0 ? (
              <span>All people</span>
            ) : (
              planner.state.people.map((person) => (
                <span key={person.id}>
                  <span
                    aria-hidden="true"
                    className="color-dot"
                    style={{ backgroundColor: person.color }}
                  />
                  {person.name}
                </span>
              ))
            )}
          </div>
        </header>

        {printMode === "week" ? (
          <div className="print-week-grid">
            {selectedWeekDays.map((date) => renderPrintDay(date))}
          </div>
        ) : (
          <div className="print-month-grid">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
              <span className="print-weekday" key={label}>
                {label}
              </span>
            ))}
            {monthWeeks.flat().map((date) => renderPrintDay(date, true))}
          </div>
        )}
      </section>
    );
  }

  function renderScheduledActivity(activity: ScheduledActivity) {
    return (
      <article
        className="scheduled-card"
        key={activity.id}
        style={{ borderLeftColor: activity.color }}
      >
        <button
          className="scheduled-main"
          onClick={() => setEditingActivityId(activity.id)}
          type="button"
        >
          <strong>{activity.title}</strong>
          <span>
            <Clock3 aria-hidden="true" size={12} />
            {activity.startTime} - {activity.endTime}
          </span>
          <span className="scheduled-people">
            {activity.personIds.length === 0
              ? "Everyone"
              : activity.personIds
                  .map((personId) => personById(personId)?.name)
                  .filter(Boolean)
                  .join(", ")}
          </span>
        </button>
        <div className="scheduled-actions">
          <button
            aria-label={`Edit ${activity.title}`}
            className="icon-button"
            onClick={() => setEditingActivityId(activity.id)}
            type="button"
          >
            <Pencil aria-hidden="true" size={14} />
          </button>
          <button
            aria-label={`Delete ${activity.title}`}
            className="icon-button"
            onClick={() => deleteScheduledActivity(activity.id)}
            type="button"
          >
            <Trash2 aria-hidden="true" size={14} />
          </button>
        </div>
      </article>
    );
  }

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
          <CalendarDays aria-hidden="true" size={22} />
          <span>{monthLabel}</span>
          <strong>{planner.viewMode === "week" ? "Week view" : "Month view"}</strong>
        </div>
      </section>

      <section className="planner-toolbar" aria-label="Calendar controls">
        <div className="month-nav">
          <button
            aria-label="Previous month"
            className="secondary-button"
            onClick={() => changeMonth(-1)}
            type="button"
          >
            <ChevronLeft aria-hidden="true" size={18} />
          </button>
          <div>
            <p className="panel-kicker">Selected month</p>
            <strong>{monthLabel}</strong>
          </div>
          <button
            aria-label="Next month"
            className="secondary-button"
            onClick={() => changeMonth(1)}
            type="button"
          >
            <ChevronRight aria-hidden="true" size={18} />
          </button>
        </div>

        <div className="segmented-control" aria-label="Calendar view">
          <button
            aria-pressed={planner.viewMode === "week"}
            onClick={() => setViewMode("week")}
            type="button"
          >
            Week
          </button>
          <button
            aria-pressed={planner.viewMode === "month"}
            onClick={() => setViewMode("month")}
            type="button"
          >
            Month
          </button>
        </div>

        <div className="print-actions">
          <button className="ghost-button" onClick={cloneToNextMonth} type="button">
            <Copy aria-hidden="true" size={17} />
            Clone next month
          </button>
          <button
            className="ghost-button"
            onClick={() => setPrintMode("week")}
            type="button"
          >
            <Printer aria-hidden="true" size={17} />
            Print week
          </button>
          <button
            className="ghost-button"
            onClick={() => setPrintMode("month")}
            type="button"
          >
            <Printer aria-hidden="true" size={17} />
            Print month
          </button>
        </div>
      </section>

      <section className="planner-workspace" aria-label="Planner workspace">
        <aside className="side-panel">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Roster</p>
              <h2>People</h2>
            </div>
            <UserRoundPlus aria-hidden="true" size={18} />
          </div>

          <form className="stacked-form" onSubmit={addPerson}>
            <label htmlFor="person-name">Name</label>
            <div className="inline-entry">
              <input
                id="person-name"
                value={personName}
                onChange={(event) => setPersonName(event.target.value)}
                placeholder="Add a person"
              />
              <button aria-label="Add person" type="submit">
                <Plus aria-hidden="true" size={18} />
              </button>
            </div>
          </form>

          <div className="chip-list" aria-label="Created people">
            {planner.state.people.length === 0 ? (
              <p className="empty-note">Add people to color-code activities.</p>
            ) : (
              planner.state.people.map((person) => (
                <span className="person-chip" key={person.id}>
                  <span
                    aria-hidden="true"
                    className="color-dot"
                    style={{ backgroundColor: person.color }}
                  />
                  {person.name}
                </span>
              ))
            )}
          </div>
        </aside>

        <section className="calendar-surface">
          {planner.viewMode === "week" ? (
            <div className="calendar-view">
              <div className="calendar-view-header">
                <div>
                  <p className="panel-kicker">Week {selectedWeekIndex + 1}</p>
                  <h2>
                    {dayLabel(selectedWeekDays[0])} - {dayLabel(selectedWeekDays[6])}
                  </h2>
                </div>
                <div className="week-nav">
                  <button
                    aria-label="Previous week"
                    className="secondary-button"
                    disabled={!canGoPreviousWeek}
                    onClick={() => changeWeek(-1)}
                    type="button"
                  >
                    <ChevronLeft aria-hidden="true" size={18} />
                  </button>
                  <button
                    aria-label="Next week"
                    className="secondary-button"
                    disabled={!canGoNextWeek}
                    onClick={() => changeWeek(1)}
                    type="button"
                  >
                    <ChevronRight aria-hidden="true" size={18} />
                  </button>
                </div>
              </div>
              <div className="week-grid">
                {selectedWeekDays.map((date) => {
                  const dateKey = toDateKey(date);
                  const activities = activitiesForDate(dateKey);
                  const isInSelectedMonth = isSameMonth(date, planner.selectedMonth);
                  return (
                    <section
                      className={
                        isInSelectedMonth ? "day-cell" : "day-cell outside-month"
                      }
                      key={dateKey}
                      onDragLeave={isInSelectedMonth ? leaveDrop : undefined}
                      onDragOver={isInSelectedMonth ? allowDrop : undefined}
                      onDrop={
                        isInSelectedMonth
                          ? (event) => dropActivity(event, dateKey)
                          : undefined
                      }
                    >
                      <header>
                        <span>{dayLabel(date)}</span>
                      </header>
                      <div className="scheduled-list">
                        {activities.map(renderScheduledActivity)}
                      </div>
                      {activities.length === 0 ? (
                        <div className="day-empty">Drop activities here</div>
                      ) : null}
                    </section>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="calendar-view">
              <div className="calendar-view-header">
                <div>
                  <p className="panel-kicker">Month view</p>
                  <h2>{monthLabel}</h2>
                </div>
              </div>
              <div className="month-grid">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
                  <span className="weekday-heading" key={label}>
                    {label}
                  </span>
                ))}
                {monthWeeks.flat().map((date) => {
                  const dateKey = toDateKey(date);
                  const activities = activitiesForDate(dateKey);
                  const isInSelectedMonth = isSameMonth(date, planner.selectedMonth);
                  return (
                    <section
                      className={
                        isInSelectedMonth
                          ? "month-day day-cell"
                          : "month-day day-cell outside-month"
                      }
                      key={dateKey}
                      onDragLeave={isInSelectedMonth ? leaveDrop : undefined}
                      onDragOver={isInSelectedMonth ? allowDrop : undefined}
                      onDrop={
                        isInSelectedMonth
                          ? (event) => dropActivity(event, dateKey)
                          : undefined
                      }
                    >
                      <header>
                        <span>{date.getDate()}</span>
                      </header>
                      <div className="scheduled-list">
                        {activities.map(renderScheduledActivity)}
                      </div>
                      {activities.length === 0 ? (
                        <div className="day-empty">Drop</div>
                      ) : null}
                    </section>
                  );
                })}
              </div>
            </div>
          )}

          {editingActivity ? (
            <section className="editor-panel" aria-label="Edit scheduled activity">
              <div className="panel-heading">
                <div>
                  <p className="panel-kicker">Scheduled copy</p>
                  <h2>Edit activity</h2>
                </div>
                <button
                  className="ghost-button"
                  onClick={() => setEditingActivityId(null)}
                  type="button"
                >
                  Done
                </button>
              </div>

              <div className="editor-grid">
                <label>
                  Title
                  <input
                    value={editingActivity.title}
                    onChange={(event) =>
                      updateScheduledActivity(editingActivity.id, {
                        title: event.target.value
                      })
                    }
                  />
                </label>
                <label>
                  Date
                  <input
                    type="date"
                    value={editingActivity.date}
                    onChange={(event) =>
                      updateScheduledActivity(editingActivity.id, {
                        date: event.target.value
                      })
                    }
                  />
                </label>
                <label>
                  Start
                  <input
                    type="time"
                    value={editingActivity.startTime}
                    onChange={(event) =>
                      updateScheduledActivity(editingActivity.id, {
                        startTime: event.target.value
                      })
                    }
                  />
                </label>
                <label>
                  End
                  <input
                    type="time"
                    value={editingActivity.endTime}
                    onChange={(event) =>
                      updateScheduledActivity(editingActivity.id, {
                        endTime: event.target.value
                      })
                    }
                  />
                </label>
                <label className="editor-wide">
                  Notes
                  <textarea
                    rows={3}
                    value={editingActivity.notes ?? ""}
                    onChange={(event) =>
                      updateScheduledActivity(editingActivity.id, {
                        notes: event.target.value || undefined
                      })
                    }
                  />
                </label>
                <fieldset className="editor-wide">
                  <legend>People</legend>
                  <div className="person-options">
                    {planner.state.people.length === 0 ? (
                      <p className="empty-note">No people created yet.</p>
                    ) : (
                      planner.state.people.map((person) => (
                        <label className="check-chip" key={person.id}>
                          <input
                            checked={editingActivity.personIds.includes(person.id)}
                            onChange={() =>
                              toggleScheduledPerson(editingActivity.id, person.id)
                            }
                            type="checkbox"
                          />
                          <span
                            aria-hidden="true"
                            className="color-dot"
                            style={{ backgroundColor: person.color }}
                          />
                          {person.name}
                        </label>
                      ))
                    )}
                  </div>
                </fieldset>
              </div>
            </section>
          ) : null}
        </section>

        <aside className="side-panel">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Drag templates</p>
              <h2>Activities</h2>
            </div>
            <GripVertical aria-hidden="true" size={18} />
          </div>

          <form className="stacked-form activity-form" onSubmit={addActivity}>
            <label htmlFor="activity-title">Activity</label>
            <input
              id="activity-title"
              value={activityTitle}
              onChange={(event) => setActivityTitle(event.target.value)}
              placeholder="Swimming, piano, playdate..."
            />

            <label htmlFor="activity-notes">Notes</label>
            <textarea
              id="activity-notes"
              value={activityNotes}
              onChange={(event) => setActivityNotes(event.target.value)}
              placeholder="Optional details"
              rows={3}
            />

            <fieldset>
              <legend>People</legend>
              <div className="person-options">
                {planner.state.people.length === 0 ? (
                  <p className="empty-note">Add people first if this belongs to someone.</p>
                ) : (
                  planner.state.people.map((person) => (
                    <label className="check-chip" key={person.id}>
                      <input
                        checked={activityPeople.includes(person.id)}
                        onChange={() => toggleActivityPerson(person.id)}
                        type="checkbox"
                      />
                      <span
                        aria-hidden="true"
                        className="color-dot"
                        style={{ backgroundColor: person.color }}
                      />
                      {person.name}
                    </label>
                  ))
                )}
              </div>
            </fieldset>

            <fieldset>
              <legend>Activity color</legend>
              <div className="swatch-row">
                {activityPalette.map((color) => (
                  <button
                    aria-label={`Use color ${color}`}
                    className={color === activityColor ? "swatch selected" : "swatch"}
                    key={color}
                    onClick={() => setActivityColor(color)}
                    style={{ backgroundColor: color }}
                    type="button"
                  />
                ))}
              </div>
            </fieldset>

            <button className="primary-action" type="submit">
              <Plus aria-hidden="true" size={18} />
              Add activity
            </button>
          </form>

          <div className="activity-list" aria-label="Reusable activities">
            {planner.state.activityTemplates.length === 0 ? (
              <p className="empty-note">Create reusable activities to drag onto days.</p>
            ) : (
              planner.state.activityTemplates.map((activity) => (
                <article
                  className="activity-card"
                  draggable
                  key={activity.id}
                  onDragStart={(event) => beginActivityDrag(event, activity.id)}
                  style={{ borderLeftColor: activity.color }}
                >
                  <div>
                    <h3>{activity.title}</h3>
                    <div className="mini-chip-list">
                      {activity.personIds.length === 0 ? (
                        <span className="muted-label">Everyone</span>
                      ) : (
                        activity.personIds.map((personId) => {
                          const person = personById(personId);
                          if (!person) return null;
                          return (
                            <span className="mini-chip" key={personId}>
                              <span
                                aria-hidden="true"
                                className="color-dot"
                                style={{ backgroundColor: person.color }}
                              />
                              {person.name}
                            </span>
                          );
                        })
                      )}
                    </div>
                    {activity.notes ? <p>{activity.notes}</p> : null}
                  </div>
                  <button
                    aria-label={`Delete ${activity.title}`}
                    className="icon-button"
                    onClick={() => deleteActivityTemplate(activity.id)}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={16} />
                  </button>
                </article>
              ))
            )}
          </div>
        </aside>
      </section>
      {renderPrintSheet()}
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
  PrintMode,
  ViewMode
};

export {
  activityPalette,
  addDays,
  addMonths,
  clampWeekToMonth,
  createId,
  dateFromKey,
  ensureRollingMonths,
  getFirstWeekStartForMonth,
  getMonthWeeks,
  getWeekDays,
  getMonthLabel,
  isSameMonth,
  monthDateFromKey,
  monthKeyFromDate,
  peoplePalette,
  remapDateByWeekPattern,
  startOfMondayWeek,
  toDateKey
};
