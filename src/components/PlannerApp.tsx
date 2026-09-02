import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Eye,
  Pencil,
  Plus,
  Printer,
  Settings,
  Trash2,
  Wrench
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "plan-by-week:v1";

type ViewMode = "week" | "month";
type PrintMode = "week" | "month";
type AppMode = "view" | "edit";
type OpenMenu = "settings" | null;
type IconMenu = "person" | "activity" | "editor" | null;
type DeleteScope = "single" | "future";

type Person = {
  id: string;
  name: string;
  icon?: string;
};

type ActivityTemplate = {
  id: string;
  title: string;
  personIds: string[];
  color: string;
  icon?: string;
  isRecurring?: boolean;
  startTime?: string;
  endTime?: string;
  notes?: string;
};

type ScheduledActivity = {
  id: string;
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

const activityPalette = [
  "#0ea5e9",
  "#10b981",
  "#8b5cf6",
  "#ec4899",
  "#84cc16",
  "#f59e0b",
  "#ef4444",
  "#14b8a6",
  "#6366f1",
  "#64748b"
];
const personIconGallery = [
  "💛",
  "💖",
  "⭐",
  "🌈",
  "🐶",
  "🐱",
  "🐻",
  "🦊",
  "🐼",
  "🦁",
  "🦄",
  "🐝",
  "🦋",
  "💪",
  "🦸",
  "🏃",
  "🧘",
  "🤸",
  "🧠",
  "☀️"
];
const activityIconGallery = [
  "⚽",
  "🏀",
  "🏈",
  "⚾",
  "🎾",
  "🏐",
  "🏉",
  "🏓",
  "🏸",
  "🥊",
  "🥋",
  "🏋️‍♀️",
  "🏋️‍♂️",
  "🤸‍♀️",
  "🏊‍♀️",
  "🚴‍♀️",
  "🧘‍♀️",
  "🏃‍♀️",
  "⛸️",
  "🛼"
];

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

function isWeekend(date: Date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function isToday(date: Date) {
  return toDateKey(date) === toDateKey(new Date());
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

function getWeekdayDateLabel(date: Date) {
  const weekday = new Intl.DateTimeFormat("en-IE", { weekday: "short" }).format(date);
  const day = new Intl.DateTimeFormat("en-IE", { day: "numeric" }).format(date);
  const month = new Intl.DateTimeFormat("en-IE", { month: "short" }).format(date);
  return `${weekday}, ${day} ${month}`;
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

function findScheduledActivity(state: PlannerState, activityId: string) {
  return Object.values(state.months)
    .flatMap((month) => month.scheduled)
    .find((activity) => activity.id === activityId);
}

function isRecurringScheduledActivity(
  activity: ScheduledActivity,
  state: PlannerState
) {
  if (activity.isRecurring || activity.recurrenceId) return true;
  const template = state.activityTemplates.find(
    (candidate) => candidate.id === activity.templateId
  );
  return Boolean(template?.isRecurring);
}

function isFutureRecurringMatch(
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
  const [personIcon, setPersonIcon] = useState(personIconGallery[0]);
  const [activityTitle, setActivityTitle] = useState("");
  const [activityNotes, setActivityNotes] = useState("");
  const [activityPeople, setActivityPeople] = useState<string[]>([]);
  const [activityColor, setActivityColor] = useState(activityPalette[0]);
  const [activityIcon, setActivityIcon] = useState(activityIconGallery[0]);
  const [activityStartTime, setActivityStartTime] = useState("");
  const [activityEndTime, setActivityEndTime] = useState("");
  const [activityIsRecurring, setActivityIsRecurring] = useState(false);
  const [editingActivityId, setEditingActivityId] = useState<string | null>(null);
  const [appMode, setAppMode] = useState<AppMode>("view");
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const [openIconMenu, setOpenIconMenu] = useState<IconMenu>(null);
  const [pendingRecurringDeleteId, setPendingRecurringDeleteId] = useState<string | null>(null);
  const isEditMode = appMode === "edit";

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
    return findScheduledActivity(planner.state, editingActivityId);
  }, [editingActivityId, planner.state.months]);
  const pendingRecurringDeleteActivity = useMemo(() => {
    if (!pendingRecurringDeleteId) return null;
    return findScheduledActivity(planner.state, pendingRecurringDeleteId);
  }, [pendingRecurringDeleteId, planner.state.months]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(planner));
  }, [planner]);

  useEffect(() => {
    if (!openIconMenu) return;

    const closeIconMenu = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".icon-picker")) {
        return;
      }
      setOpenIconMenu(null);
    };

    document.addEventListener("pointerdown", closeIconMenu);
    return () => document.removeEventListener("pointerdown", closeIconMenu);
  }, [openIconMenu]);

  function addPerson(event: { preventDefault: () => void }) {
    event.preventDefault();
    const name = personName.trim();
    if (!name) return;

    setPlanner((current) => ({
      ...current,
      state: {
        ...current.state,
        people: [
          ...current.state.people,
          {
            id: createId("person"),
            name,
            icon: personIcon
          }
        ]
      }
    }));
    setPersonName("");
    setPersonIcon(personIconGallery[0]);
  }

  function toggleActivityPerson(personId: string) {
    setActivityPeople((current) =>
      current.includes(personId)
        ? current.filter((id) => id !== personId)
        : [...current, personId]
    );
  }

  function deletePerson(personId: string) {
    setActivityPeople((current) => current.filter((id) => id !== personId));
    setPlanner((current) => {
      const months = Object.fromEntries(
        Object.entries(current.state.months).map(([monthKey, month]) => [
          monthKey,
          {
            ...month,
            scheduled: month.scheduled.map((activity) => ({
              ...activity,
              personIds: activity.personIds.filter((id) => id !== personId)
            }))
          }
        ])
      );

      return {
        ...current,
        state: {
          ...current.state,
          people: current.state.people.filter((person) => person.id !== personId),
          activityTemplates: current.state.activityTemplates.map((activity) => ({
            ...activity,
            personIds: activity.personIds.filter((id) => id !== personId)
          })),
          months
        }
      };
    });
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
            icon: activityIcon,
            isRecurring: activityIsRecurring,
            startTime: activityStartTime || undefined,
            endTime: activityEndTime || undefined,
            notes: activityNotes.trim() || undefined
          }
        ]
      }
    }));
    setActivityTitle("");
    setActivityNotes("");
    setActivityPeople([]);
    setActivityColor(activityPalette[0]);
    setActivityIcon(activityIconGallery[0]);
    setActivityStartTime("");
    setActivityEndTime("");
    setActivityIsRecurring(false);
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
    if (!isEditMode) return;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", activityId);
  }

  function allowDrop(event: {
    preventDefault: () => void;
    currentTarget: HTMLElement;
  }) {
    if (!isEditMode) return;
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

    const datesToSchedule = template.isRecurring
      ? monthWeeks
          .flat()
          .filter(
            (date) =>
              isSameMonth(date, planner.selectedMonth) &&
              date.getDay() === dateFromKey(dateKey).getDay()
          )
          .map(toDateKey)
      : [dateKey];
    const recurrenceId = template.isRecurring ? createId("recurrence") : undefined;
    const scheduled = datesToSchedule.map((targetDate) => ({
      id: createId("scheduled"),
      templateId: template.id,
      recurrenceId,
      isRecurring: template.isRecurring || undefined,
      title: template.title,
      personIds: template.personIds,
      date: targetDate,
      startTime: template.startTime,
      endTime: template.endTime,
      notes: template.notes,
      color: template.color,
      icon: template.icon
    }));
    const targetMonth = monthKeyFromDate(dateFromKey(dateKey));

    setPlanner((current) => {
      const month = current.state.months[targetMonth] ?? {
        monthKey: targetMonth,
        scheduled: []
      };
      const nextState = setMonthScheduled(current.state, targetMonth, [
        ...month.scheduled,
        ...scheduled
      ].sort((a, b) =>
        `${a.date}${a.startTime ?? ""}`.localeCompare(
          `${b.date}${b.startTime ?? ""}`
        )
      ));

      return {
        ...current,
        state: ensureRollingMonths(nextState, current.selectedMonth)
      };
    });
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
                `${a.date}${a.startTime ?? ""}`.localeCompare(
                  `${b.date}${b.startTime ?? ""}`
                )
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

  function requestScheduledActivityDelete(activityId: string) {
    const activity = findScheduledActivity(planner.state, activityId);
    if (!activity) return;

    if (isRecurringScheduledActivity(activity, planner.state)) {
      setPendingRecurringDeleteId(activityId);
      return;
    }

    deleteScheduledActivity(activityId);
  }

  function deleteScheduledActivity(
    activityId: string,
    deleteScope: DeleteScope = "single"
  ) {
    setPlanner((current) => {
      const target = findScheduledActivity(current.state, activityId);
      if (!target) return current;

      return {
        ...current,
        state: {
          ...current.state,
          months: Object.fromEntries(
            Object.entries(current.state.months).map(([monthKey, month]) => [
              monthKey,
              {
                ...month,
                scheduled: month.scheduled.filter((activity) =>
                  deleteScope === "future"
                    ? !isFutureRecurringMatch(activity, target, current.state)
                    : activity.id !== activityId
                )
              }
            ])
          )
        }
      };
    });
    if (editingActivityId === activityId) {
      setEditingActivityId(null);
    }
    setPendingRecurringDeleteId(null);
  }

  function personById(personId: string) {
    return planner.state.people.find((person) => person.id === personId);
  }

  function personLabel(personId: string) {
    const person = personById(personId);
    if (!person) return "";
    return person.icon ? `${person.icon} ${person.name}` : person.name;
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
      .sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
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
    return getWeekdayDateLabel(date);
  }

  function compactDayLabel(date: Date) {
    return new Intl.DateTimeFormat("en-IE", {
      weekday: "short",
      day: "numeric",
      month: "short"
    }).format(date);
  }

  function activityTimeLabel(activity: {
    startTime?: string;
    endTime?: string;
  }) {
    if (activity.startTime && activity.endTime) {
      return `${activity.startTime} - ${activity.endTime}`;
    }
    return activity.startTime || activity.endTime || "";
  }

  function renderPrintActivity(activity: ScheduledActivity) {
    const timeLabel = activityTimeLabel(activity);

    return (
      <article
        className="print-activity"
        key={activity.id}
        style={{ borderLeftColor: activity.color }}
      >
        <strong className="activity-heading">
          {activity.icon ? (
            <span aria-hidden="true" className="emoji-mark">
              {activity.icon}
            </span>
          ) : null}
          {activity.title}
        </strong>
        {timeLabel ? <span>{timeLabel}</span> : null}
        <span>
          {activity.personIds.length === 0
            ? "Everyone"
            : activity.personIds
                .map(personLabel)
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
    const className = [
      "print-day",
      isWeekend(date) ? "weekend-day" : "",
      isSameMonth(date, planner.selectedMonth) ? "" : "print-outside-month"
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <section className={className} key={dateKey}>
        <header>{compact ? date.getDate() : compactDayLabel(date)}</header>
        <div className="print-activity-list">
          {activities.map(renderPrintActivity)}
        </div>
      </section>
    );
  }

  function renderPrintSheet(mode: PrintMode) {
    const title =
      mode === "week"
        ? `${compactDayLabel(selectedWeekDays[0])} - ${compactDayLabel(
            selectedWeekDays[6]
          )}`
        : monthLabel;
    const className = [
      "print-sheet",
      planner.viewMode === mode ? "active-print-sheet" : ""
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <section className={className} aria-label={`${mode} print layout`}>
        <header className="print-header">
          <div>
            <p>Plan by Week</p>
            <h1>{title}</h1>
          </div>
          {planner.state.people.length > 0 ? (
            <div className="print-people">
              {planner.state.people.map((person) => (
                <span key={person.id}>
                  {person.icon ? (
                    <span aria-hidden="true" className="emoji-mark">
                      {person.icon}
                    </span>
                  ) : null}
                  {person.name}
                </span>
              ))}
            </div>
          ) : null}
        </header>

        {mode === "week" ? (
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
    const timeLabel = activityTimeLabel(activity);
    const cardContent = (
      <>
        <strong className="activity-heading">
          {activity.icon ? (
            <span aria-hidden="true" className="emoji-mark">
              {activity.icon}
            </span>
          ) : null}
          {activity.title}
        </strong>
        {timeLabel ? (
          <span>
            <Clock3 aria-hidden="true" size={12} />
            {timeLabel}
          </span>
        ) : null}
        <span className="scheduled-people">
          {activity.personIds.length === 0
            ? "Everyone"
            : activity.personIds
                .map(personLabel)
                .filter(Boolean)
                .join(", ")}
        </span>
      </>
    );

    return (
      <article
        className="scheduled-card"
        key={activity.id}
        style={{ borderLeftColor: activity.color }}
      >
        {isEditMode ? (
          <button
            className="scheduled-main"
            onClick={() => setEditingActivityId(activity.id)}
            type="button"
          >
            {cardContent}
          </button>
        ) : (
          <div className="scheduled-main">{cardContent}</div>
        )}
        {isEditMode ? (
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
              onClick={() => requestScheduledActivityDelete(activity.id)}
              type="button"
            >
              <Trash2 aria-hidden="true" size={14} />
            </button>
          </div>
        ) : null}
      </article>
    );
  }

  function renderActivityTemplate(activity: ActivityTemplate) {
    const timeLabel = activityTimeLabel(activity);

    return (
      <article
        className="activity-card"
        draggable
        key={activity.id}
        onDragStart={(event) => beginActivityDrag(event, activity.id)}
        style={{ borderLeftColor: activity.color }}
      >
        <div>
          <h3 className="activity-heading">
            {activity.icon ? (
              <span aria-hidden="true" className="emoji-mark">
                {activity.icon}
              </span>
            ) : null}
            {activity.title}
          </h3>
          <div className="mini-chip-list">
            {activity.personIds.length === 0 ? (
              <span className="muted-label">Everyone</span>
            ) : (
              activity.personIds.map((personId) => {
                const person = personById(personId);
                if (!person) return null;
                return (
                  <span className="mini-chip" key={personId}>
                    {person.icon ? (
                      <span aria-hidden="true" className="emoji-mark">
                        {person.icon}
                      </span>
                    ) : null}
                    {person.name}
                  </span>
                );
              })
            )}
            {activity.isRecurring ? (
              <span className="muted-label">Recurring</span>
            ) : null}
            {timeLabel ? <span className="muted-label">{timeLabel}</span> : null}
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
    );
  }

  function renderIconPicker({
    id,
    label,
    value,
    icons,
    onChange
  }: {
    id: Exclude<IconMenu, null>;
    label: string;
    value: string;
    icons: string[];
    onChange: (icon: string) => void;
  }) {
    const isOpen = openIconMenu === id;

    return (
      <div className="icon-picker">
        <button
          aria-expanded={isOpen}
          aria-label={label}
          aria-haspopup="listbox"
          className="icon-picker-button"
          onClick={() => setOpenIconMenu((current) => (current === id ? null : id))}
          type="button"
        >
          <span aria-hidden="true">{value}</span>
        </button>
        {isOpen ? (
          <div className="icon-picker-popover" role="listbox" aria-label={label}>
            {icons.map((icon) => (
              <button
                aria-label={`Use ${icon}`}
                aria-selected={value === icon}
                className="icon-picker-option"
                key={icon}
                onClick={() => {
                  onChange(icon);
                  setOpenIconMenu(null);
                }}
                role="option"
                type="button"
              >
                {icon}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  function chooseAppMode(mode: AppMode) {
    setAppMode(mode);
    setOpenMenu(null);
    if (mode === "view") {
      setEditingActivityId(null);
    }
  }

  function printCurrentView() {
    setOpenMenu(null);
    window.print();
  }

  return (
    <main className={`planner-shell ${isEditMode ? "edit-mode" : "view-mode"}`}>
      {isEditMode ? (
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
      ) : null}

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
          <div className="month-nav-label">
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

        <div className="toolbar-actions">
          {!isEditMode ? (
            <div className="menu-cluster">
              <button
                aria-label={`Print selected ${planner.viewMode}`}
                className="icon-menu-button"
                onClick={printCurrentView}
                type="button"
              >
                <Printer aria-hidden="true" size={18} />
              </button>
            </div>
          ) : null}

          <div className="menu-cluster">
            <button
              aria-expanded={openMenu === "settings"}
              aria-haspopup="menu"
              aria-label="Planner options"
              className="icon-menu-button"
              onClick={() =>
                setOpenMenu((current) =>
                  current === "settings" ? null : "settings"
                )
              }
              type="button"
            >
              <Settings aria-hidden="true" size={18} />
            </button>
            {openMenu === "settings" ? (
              <div className="toolbar-menu align-right" role="menu">
                <button
                  aria-pressed={appMode === "view"}
                  onClick={() => chooseAppMode("view")}
                  role="menuitem"
                  type="button"
                >
                  <Eye aria-hidden="true" size={15} />
                  View mode
                </button>
                <button
                  aria-pressed={appMode === "edit"}
                  onClick={() => chooseAppMode("edit")}
                  role="menuitem"
                  type="button"
                >
                  <Wrench aria-hidden="true" size={15} />
                  Edit mode
                </button>
                {isEditMode ? (
                  <button
                    onClick={() => {
                      cloneToNextMonth();
                      setOpenMenu(null);
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <Copy aria-hidden="true" size={15} />
                    Clone next month
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section
        className={isEditMode ? "planner-workspace" : "planner-workspace calendar-only"}
        aria-label="Planner workspace"
      >
        {isEditMode ? (
          <aside className="side-panel people-panel">
          <div className="panel-heading">
            <div>
              <h2>People</h2>
            </div>
          </div>

          <form className="stacked-form" onSubmit={addPerson}>
            <div className="inline-entry person-entry">
              {renderIconPicker({
                id: "person",
                label: "Person icon",
                value: personIcon,
                icons: personIconGallery,
                onChange: setPersonIcon
              })}
              <input
                aria-label="Person name"
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
              <p className="empty-note">Add people to assign activities.</p>
            ) : (
              planner.state.people.map((person) => (
                <span className="person-chip" key={person.id}>
                  {person.icon ? (
                    <span aria-hidden="true" className="emoji-mark">
                      {person.icon}
                    </span>
                  ) : null}
                  {person.name}
                  <button
                    aria-label={`Remove ${person.name}`}
                    className="chip-remove-button"
                    onClick={() => deletePerson(person.id)}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={13} />
                  </button>
                </span>
              ))
            )}
          </div>
        </aside>
        ) : null}

        <section className="calendar-surface calendar-panel">
          {isEditMode ? (
            <section className="drag-tray" aria-label="Ready to drag activities">
              <p className="panel-kicker">Ready to drag</p>
              <div className="activity-list calendar-activity-list">
                {planner.state.activityTemplates.length === 0 ? (
                  <p className="empty-note">Create reusable activities below.</p>
                ) : (
                  planner.state.activityTemplates.map(renderActivityTemplate)
                )}
              </div>
            </section>
          ) : null}

          {planner.viewMode === "week" ? (
            <div className="calendar-view">
              <div className="calendar-view-header">
                <div>
                  <p className="panel-kicker week-heading">
                    Week {selectedWeekIndex + 1}, {dayLabel(selectedWeekDays[0])} -{" "}
                    {dayLabel(selectedWeekDays[6])}
                  </p>
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
                  const className = [
                    "day-cell",
                    isWeekend(date) ? "weekend-day" : "",
                    isToday(date) ? "current-day" : "",
                    isInSelectedMonth ? "" : "outside-month"
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <section
                      className={className}
                      key={dateKey}
                      onDragLeave={isEditMode && isInSelectedMonth ? leaveDrop : undefined}
                      onDragOver={isEditMode && isInSelectedMonth ? allowDrop : undefined}
                      onDrop={
                        isEditMode && isInSelectedMonth
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
                        <div className="day-empty">
                          {isEditMode ? "Drop activities here" : "No activities"}
                        </div>
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
                  const className = [
                    "month-day",
                    "day-cell",
                    isWeekend(date) ? "weekend-day" : "",
                    isToday(date) ? "current-day" : "",
                    isInSelectedMonth ? "" : "outside-month"
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <section
                      className={className}
                      key={dateKey}
                      onDragLeave={isEditMode && isInSelectedMonth ? leaveDrop : undefined}
                      onDragOver={isEditMode && isInSelectedMonth ? allowDrop : undefined}
                      onDrop={
                        isEditMode && isInSelectedMonth
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
                        <div className="day-empty">
                          {isEditMode ? "Drop" : "No activities"}
                        </div>
                      ) : null}
                    </section>
                  );
                })}
              </div>
            </div>
          )}

          {isEditMode && pendingRecurringDeleteActivity ? (
            <section
              aria-label="Delete recurring activity"
              className="delete-confirm-panel"
              role="dialog"
            >
              <div>
                <p className="panel-kicker">Recurring activity</p>
                <h2>Delete {pendingRecurringDeleteActivity.title}?</h2>
                <p>
                  Remove only this copy, or this and future copies from the saved months.
                </p>
              </div>
              <div className="delete-confirm-actions">
                <button
                  className="ghost-button"
                  onClick={() => setPendingRecurringDeleteId(null)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="ghost-button"
                  onClick={() => deleteScheduledActivity(pendingRecurringDeleteActivity.id)}
                  type="button"
                >
                  Only this
                </button>
                <button
                  className="danger-button"
                  onClick={() =>
                    deleteScheduledActivity(pendingRecurringDeleteActivity.id, "future")
                  }
                  type="button"
                >
                  This and future
                </button>
              </div>
            </section>
          ) : null}

          {isEditMode && editingActivity ? (
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
                  Save
                </button>
              </div>

              <div className="editor-grid">
                <label className="editor-field editor-title-field">
                  Title
                  <div className="input-with-icon">
                    {renderIconPicker({
                      id: "editor",
                      label: "Activity icon",
                      value: editingActivity.icon ?? activityIconGallery[0],
                      icons: activityIconGallery,
                      onChange: (icon) =>
                        updateScheduledActivity(editingActivity.id, {
                          icon
                        })
                    })}
                    <input
                      value={editingActivity.title}
                      onChange={(event) =>
                        updateScheduledActivity(editingActivity.id, {
                          title: event.target.value
                        })
                      }
                    />
                  </div>
                </label>
                <div className="time-entry editor-time-entry">
                  <label className="time-field">
                    <span>From</span>
                    <input
                      aria-label="Scheduled start time"
                      type="time"
                      value={editingActivity.startTime ?? ""}
                      onChange={(event) =>
                        updateScheduledActivity(editingActivity.id, {
                          startTime: event.target.value || undefined
                        })
                      }
                    />
                  </label>
                  <label className="time-field">
                    <span>To</span>
                    <input
                      aria-label="Scheduled end time"
                      type="time"
                      value={editingActivity.endTime ?? ""}
                      onChange={(event) =>
                        updateScheduledActivity(editingActivity.id, {
                          endTime: event.target.value || undefined
                        })
                      }
                    />
                  </label>
                </div>
                <label className="editor-field editor-wide">
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
                          {person.icon ? (
                            <span aria-hidden="true" className="emoji-mark">
                              {person.icon}
                            </span>
                          ) : null}
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

        {isEditMode ? (
          <aside className="side-panel activities-panel">
          <div className="panel-heading">
            <div>
              <h2>Activities</h2>
            </div>
          </div>

          <form className="stacked-form activity-form" onSubmit={addActivity}>
            <div className="inline-entry activity-title-entry">
              {renderIconPicker({
                id: "activity",
                label: "Activity icon",
                value: activityIcon,
                icons: activityIconGallery,
                onChange: setActivityIcon
              })}
              <input
                aria-label="Activity name"
                id="activity-title"
                value={activityTitle}
                onChange={(event) => setActivityTitle(event.target.value)}
                placeholder="Gym, football..."
              />
            </div>

            <div className="time-entry">
              <label className="time-field">
                <span>From</span>
                <input
                  aria-label="Optional start time"
                  type="time"
                  value={activityStartTime}
                  onChange={(event) => setActivityStartTime(event.target.value)}
                />
              </label>
              <label className="time-field">
                <span>To</span>
                <input
                  aria-label="Optional end time"
                  type="time"
                  value={activityEndTime}
                  onChange={(event) => setActivityEndTime(event.target.value)}
                />
              </label>
            </div>

            <label className="check-chip full-width-check">
              <input
                checked={activityIsRecurring}
                onChange={(event) => setActivityIsRecurring(event.target.checked)}
                type="checkbox"
              />
              Recurring on same weekday
            </label>

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
                      {person.icon ? (
                        <span aria-hidden="true" className="emoji-mark">
                          {person.icon}
                        </span>
                      ) : null}
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

            <textarea
              aria-label="Activity notes"
              id="activity-notes"
              value={activityNotes}
              onChange={(event) => setActivityNotes(event.target.value)}
              placeholder="Optional details"
              rows={3}
            />

            <button className="primary-action" type="submit">
              <Plus aria-hidden="true" size={18} />
              Add activity
            </button>
          </form>

        </aside>
        ) : null}
      </section>
      {renderPrintSheet("week")}
      {renderPrintSheet("month")}
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
  AppMode,
  ViewMode
};

export {
  activityIconGallery,
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
  isToday,
  isWeekend,
  monthDateFromKey,
  monthKeyFromDate,
  personIconGallery,
  remapDateByWeekPattern,
  startOfMondayWeek,
  toDateKey
};
