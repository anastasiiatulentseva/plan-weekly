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
  Wrench,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { createId, toDateKey, monthKeyFromDate, dateFromKey, monthDateFromKey, addDays, addMonths, startOfMondayWeek, isSameMonth, isWeekend, isToday, getWeekDays, getMonthWeeks, getFirstWeekStartForMonth, clampWeekToMonth, getMonthLabel, getWeekdayDateLabel, remapDateByWeekPattern, isTimeRangeValid, getScheduleDatesForTemplate, isNavigableMonth, ensureRollingMonths, findScheduledActivity, isRecurringScheduledActivity, isFutureRecurringMatch } from "../shared/planner";
import type { ViewMode, PrintMode, AppMode, OpenMenu, IconMenu, DeleteScope, Person, ActivityTemplate, ScheduledActivity, MonthPlan, PlannerState, PersistedPlanner } from "../shared/planner";
import { api, usePlanner } from "../client/usePlanner";

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
const activityDragType = 'application/x-plan-by-week-activity';
type ActivityDragPayload = { kind: 'template' | 'scheduled'; id: string };
function parseActivityDragPayload(value: string): ActivityDragPayload | null {
  try {
    const payload: unknown = JSON.parse(value);
    if (payload && typeof payload === 'object' && 'kind' in payload && 'id' in payload &&
      (payload.kind === 'template' || payload.kind === 'scheduled') && typeof payload.id === 'string') {
      return { kind: payload.kind, id: payload.id };
    }
  } catch { /* Ignore unrelated drags. */ }
  return null;
}

export default function PlannerApp() {
  const { planner, setPlanner, auth, status, notice, setNotice, saving, mutate, refresh, leave, retry, canRetry, conflictLatest } = usePlanner();
  const [draft, setDraft] = useState<ScheduledActivity | null>(null);
  const [templateDraft, setTemplateDraft] = useState<ActivityTemplate | null>(null);
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

  const currentMonth = useMemo(() => monthKeyFromDate(new Date()), []);
  const monthLabel = useMemo(
    () => getMonthLabel(planner.selectedMonth),
    [planner.selectedMonth]
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
  const activityTimeRangeIsValid = isTimeRangeValid(
    activityStartTime || undefined,
    activityEndTime || undefined
  );
  const canAddActivity = activityTitle.trim().length > 0 && activityTimeRangeIsValid;
  const canGoPreviousMonth = isNavigableMonth(addMonths(planner.selectedMonth, -1), currentMonth);
  const canGoNextMonth = isNavigableMonth(addMonths(planner.selectedMonth, 1), currentMonth);
  const canGoPreviousWeek = selectedWeekIndex > 0;
  const canGoNextWeek = selectedWeekIndex >= 0 && selectedWeekIndex < monthWeeks.length - 1;
  const canSaveTemplate = Boolean(templateDraft?.title.trim() && isTimeRangeValid(templateDraft.startTime, templateDraft.endTime));
  const latestTemplate = templateDraft ? planner.state.activityTemplates.find(activity => activity.id === templateDraft.id) : null;
  const templateDraftIsStale = Boolean(templateDraft && (!latestTemplate || latestTemplate.version !== templateDraft.version));
  const editingActivity = draft;
  const visibleActivity = editingActivityId ? findScheduledActivity(planner.state, editingActivityId) : null;
  const latestActivity = conflictLatest?.id === editingActivityId && (!visibleActivity || conflictLatest.version > visibleActivity.version) ? conflictLatest : visibleActivity;
  const draftIsStale = Boolean(draft && (!latestActivity || draft.version !== latestActivity.version));
  function openEditor(id: string) {
    const activity = findScheduledActivity(planner.state, id);
    if (activity) { setTemplateDraft(null); setDraft(structuredClone(activity)); setEditingActivityId(id); setOpenIconMenu(null); setNotice(''); }
  }
  async function saveDraft() {
    if (!draft) return;
    const { id, version, templateId, recurrenceId, ...fields } = draft;
    const ok = await mutate('scheduled/' + id, 'PATCH', { ...fields, expectedVersion: version }, current => replaceScheduled(current, { ...draft, version: version + 1 }));
    if (ok) { setDraft(null); setEditingActivityId(null); setOpenIconMenu(null); }
  }
  function openTemplateEditor(activity: ActivityTemplate) {
    setDraft(null);
    setEditingActivityId(null);
    setTemplateDraft(structuredClone(activity));
    setOpenIconMenu(null);
    setNotice('');
  }
  function updateTemplateDraft(patch: Partial<ActivityTemplate>) {
    setTemplateDraft(current => current ? { ...current, ...patch } : current);
  }
  function toggleTemplatePerson(personId: string) {
    setTemplateDraft(current => current ? {
      ...current,
      personIds: current.personIds.includes(personId)
        ? current.personIds.filter(id => id !== personId)
        : [...current.personIds, personId]
    } : current);
  }
  async function saveTemplateDraft() {
    if (!templateDraft || !canSaveTemplate) return;
    const { id, version, ...fields } = templateDraft;
    const updated = { ...templateDraft, title: templateDraft.title.trim(), notes: templateDraft.notes?.trim() || undefined, version: version + 1 };
    const ok = await mutate('templates/' + id, 'PATCH', { ...fields, title: updated.title, notes: updated.notes, expectedVersion: version },
      current => ({ ...current, state: { ...current.state, activityTemplates: current.state.activityTemplates.map(template => template.id === id ? updated : template) } }));
    if (ok) { setTemplateDraft(null); setOpenIconMenu(null); }
  }
  function replaceScheduled(current: PersistedPlanner, activity: ScheduledActivity) {
    const months = Object.fromEntries(Object.entries(current.state.months).map(([key, month]) => [key, { ...month, scheduled: month.scheduled.filter(a => a.id !== activity.id) }]));
    const key = activity.date.slice(0, 7);
    (months[key] ??= { monthKey: key, scheduled: [] }).scheduled.push(activity);
    return { ...current, state: { ...current.state, months } };
  }
  const pendingRecurringDeleteActivity = useMemo(() => {
    if (!pendingRecurringDeleteId) return null;
    return findScheduledActivity(planner.state, pendingRecurringDeleteId);
  }, [pendingRecurringDeleteId, planner.state.months]);


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
    const name = personName.trim(); if (!name) return;
    const input = { name, icon: personIcon, idempotencyKey: crypto.randomUUID() };
    void mutate('people', 'POST', input, current => ({ ...current, state: { ...current.state, people: [...current.state.people, { ...input, id: createId('pending'), version: 1 }] } })).then(ok => { if (ok) { setPersonName(''); setPersonIcon(personIconGallery[0]); } });
  }

  function toggleActivityPerson(personId: string) {
    setActivityPeople((current) =>
      current.includes(personId)
        ? current.filter((id) => id !== personId)
        : [...current, personId]
    );
  }

  function deletePerson(personId: string) {
    const person = planner.state.people.find(p => p.id === personId); if (!person) return;
    void mutate('people/' + personId, 'DELETE', { expectedVersion: person.version }, current => ({ ...current, state: { ...current.state, people: current.state.people.filter(p => p.id !== personId) } })).then(ok => { if (ok) setActivityPeople(ids => ids.filter(id => id !== personId)); });
  }

  function addActivity(event: { preventDefault: () => void }) {
    event.preventDefault();
    if (!canAddActivity) return;
    const input = { title: activityTitle.trim(), personIds: activityPeople, color: activityColor, icon: activityIcon, isRecurring: activityIsRecurring, startTime: activityStartTime || undefined, endTime: activityEndTime || undefined, notes: activityNotes.trim() || undefined, idempotencyKey: crypto.randomUUID() };
    void mutate('templates', 'POST', input, current => ({ ...current, state: { ...current.state, activityTemplates: [...current.state.activityTemplates, { ...input, id: createId('pending'), version: 1 }] } })).then(ok => {
      if (ok) { setActivityTitle(''); setActivityNotes(''); setActivityPeople([]); setActivityColor(activityPalette[0]); setActivityIcon(activityIconGallery[0]); setActivityStartTime(''); setActivityEndTime(''); setActivityIsRecurring(false); }
    });
  }

  function deleteActivityTemplate(activityId: string) {
    const template = planner.state.activityTemplates.find(a => a.id === activityId); if (!template) return;
    void mutate('templates/' + activityId, 'DELETE', { expectedVersion: template.version }, current => ({ ...current, state: { ...current.state, activityTemplates: current.state.activityTemplates.filter(a => a.id !== activityId) } }));
    if (templateDraft?.id === activityId) setTemplateDraft(null);
  }

  function beginActivityDrag(
    event: { dataTransfer: DataTransfer },
    activityId: string
  ) {
    if (!isEditMode) return;
    event.dataTransfer.effectAllowed = "copy";
    const payload = JSON.stringify({ kind: 'template', id: activityId } satisfies ActivityDragPayload);
    event.dataTransfer.setData(activityDragType, payload);
    event.dataTransfer.setData("text/plain", payload);
  }

  function beginScheduledActivityDrag(event: { dataTransfer: DataTransfer }, activityId: string) {
    if (!isEditMode) return;
    event.dataTransfer.effectAllowed = 'move';
    const payload = JSON.stringify({ kind: 'scheduled', id: activityId } satisfies ActivityDragPayload);
    event.dataTransfer.setData(activityDragType, payload);
    event.dataTransfer.setData('text/plain', payload);
  }

  function allowDrop(event: {
    preventDefault: () => void;
    currentTarget: HTMLElement;
    dataTransfer: DataTransfer;
  }) {
    if (!isEditMode) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = event.dataTransfer.effectAllowed === "copy" ? "copy" : "move";
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

    const payload = parseActivityDragPayload(event.dataTransfer.getData(activityDragType));
    if (payload?.kind === 'template') scheduleTemplateOnDate(payload.id, dateKey);
    if (payload?.kind === 'scheduled') moveScheduledActivityToDate(payload.id, dateKey);
  }

  function scheduleTemplateOnDate(templateId: string, dateKey: string) {
    if (!isEditMode || !isSameMonth(dateFromKey(dateKey), planner.selectedMonth)) return;
    const template = planner.state.activityTemplates.find(a => a.id === templateId); if (!template) return;
    const recurrenceId = template.isRecurring ? createId('pending-series') : undefined;
    const optimistic = getScheduleDatesForTemplate(template, dateKey, planner.selectedMonth).map(date => ({ ...template, id: createId('pending'), version: 1, templateId, date, recurrenceId }));
    void mutate('scheduled', 'POST', { templateId, date: dateKey, selectedMonth: planner.selectedMonth, idempotencyKey: crypto.randomUUID() }, current => optimistic.reduce(replaceScheduled, current));
  }

  function moveScheduledActivityToDate(activityId: string, dateKey: string) {
    if (!isEditMode || !isSameMonth(dateFromKey(dateKey), planner.selectedMonth)) return;
    const activity = findScheduledActivity(planner.state, activityId);
    if (!activity || activity.date === dateKey) return;
    const { id, version, templateId, recurrenceId, ...fields } = activity;
    void mutate('scheduled/' + id, 'PATCH', { ...fields, date: dateKey, expectedVersion: version },
      current => replaceScheduled(current, { ...activity, date: dateKey, version: version + 1 }));
  }

  function updateScheduledActivity(activityId: string, patch: Partial<ScheduledActivity>) {
    setDraft(current => current?.id === activityId ? { ...current, ...patch } : current);
  }

  function toggleScheduledPerson(activityId: string, personId: string) {
    if (!draft || draft.id !== activityId) return;
    updateScheduledActivity(activityId, { personIds: draft.personIds.includes(personId) ? draft.personIds.filter(id => id !== personId) : [...draft.personIds, personId] });
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

  function deleteScheduledActivity(activityId: string, deleteScope: DeleteScope = 'single') {
    const target = findScheduledActivity(planner.state, activityId); if (!target) return;
    void mutate('scheduled/' + activityId, 'DELETE', { expectedVersion: target.version, scope: deleteScope, idempotencyKey: crypto.randomUUID() }, current => ({ ...current, state: { ...current.state, months: Object.fromEntries(Object.entries(current.state.months).map(([key, month]) => [key, { ...month, scheduled: month.scheduled.filter(a => deleteScope === 'future' ? !isFutureRecurringMatch(a, target, current.state) : a.id !== activityId) }])) } })).then(ok => { if (ok && editingActivityId === activityId) { setEditingActivityId(null); setDraft(null); } });
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
      if (!isNavigableMonth(selectedMonth)) return current;
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
    const monthKey = monthKeyFromDate(dateFromKey(dateKey));
    return (planner.state.months[monthKey]?.scheduled ?? [])
      .filter((activity) => activity.date === dateKey)
      .sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
  }

  function cloneToNextMonth() {
    const source = planner.selectedMonth, target = addMonths(source, 1);
    if (!isNavigableMonth(target)) return;
    const copies = (planner.state.months[source]?.scheduled ?? []).map(a => ({ ...a, id: createId('pending'), version: 1, date: remapDateByWeekPattern(a.date, source, target) }));
    void mutate('clone', 'POST', { source, target, idempotencyKey: crypto.randomUUID() }, current => copies.reduce(replaceScheduled, current));
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
      `print-${mode}-sheet`,
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
        draggable={isEditMode}
        key={activity.id}
        onDragStart={(event) => beginScheduledActivityDrag(event, activity.id)}
        style={{ borderLeftColor: activity.color }}
      >
        {isEditMode ? (
          <button
            className="scheduled-main"
            onClick={() => openEditor(activity.id)}
            type="button"
          >
            {cardContent}
          </button>
        ) : (
          <div className="scheduled-main">{cardContent}</div>
        )}
        {isEditMode ? (
          <div className="tile-actions">
            <button
              aria-label={`Edit ${activity.title}`}
              className="tile-action tile-action-edit"
              onClick={() => openEditor(activity.id)}
              type="button"
            >
              <Pencil aria-hidden="true" size={13} />
            </button>
            <button
              aria-label={`Delete ${activity.title}`}
              className="tile-action tile-action-delete"
              onClick={() => requestScheduledActivityDelete(activity.id)}
              type="button"
            >
              <Trash2 aria-hidden="true" size={13} />
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
        draggable={isEditMode}
        key={activity.id}
        onDragStart={(event) => beginActivityDrag(event, activity.id)}
        style={{ borderLeftColor: activity.color }}
      >
        <div className="activity-card-main">
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
        <div className="tile-actions">
          <button
            aria-label={`Edit reusable ${activity.title}`}
            className="tile-action tile-action-edit"
            onClick={() => openTemplateEditor(activity)}
            type="button"
          >
            <Pencil aria-hidden="true" size={13} />
          </button>
          <button
            aria-label={`Delete ${activity.title}`}
            className="tile-action tile-action-delete"
            onClick={() => deleteActivityTemplate(activity.id)}
            type="button"
          >
            <Trash2 aria-hidden="true" size={13} />
          </button>
        </div>
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
      setDraft(null);
      setTemplateDraft(null);
    }
  }

  function printCurrentView() {
    setOpenMenu(null);
    window.print();
  }

  if (auth !== 'member') return <main className="planner-shell"><h1>Plan by Week</h1><p role="status">{status}</p><button type="button" onClick={() => location.reload()}>Try again</button></main>;

  return (
    <main inert={saving || undefined} aria-busy={saving} className={`planner-shell ${isEditMode ? "edit-mode" : "view-mode"}`}>
      <div className="sync-status" role="status">{saving ? 'Saving…' : status}</div>
      {notice ? <div className="sync-notice" role="alert">{notice} {canRetry ? <button type="button" onClick={() => void retry()}>Retry save</button> : null}<button type="button" onClick={() => void refresh()}>Refresh calendar</button></div> : null}
      {isEditMode ? (
        <section className="planner-hero">
          <div>
            <p className="eyebrow">Family planner</p>
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
            disabled={!canGoPreviousMonth}
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
            disabled={!canGoNextMonth}
            onClick={() => changeMonth(1)}
            type="button"
          >
            <ChevronRight aria-hidden="true" size={18} />
          </button>
        </div>

        <div className="toolbar-actions">
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
                <button role="menuitem" type="button" onClick={() => { void api('invite').then(data => navigator.clipboard.writeText(data.url)).then(() => setNotice('Family invite link copied.')).catch(() => setNotice('Could not copy the invitation link.')); }}>Copy family invite link</button>
                <button role="menuitem" type="button" onClick={() => { setDraft(null); void leave(); }}>Leave this calendar</button>
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
            <div className="modal-backdrop">
            <section className="editor-modal" aria-label="Edit activity" aria-modal="true" role="dialog">
              <div className="panel-heading editor-modal-heading">
                <div>
                  <p className="panel-kicker">Scheduled copy</p>
                  <h2>Edit activity</h2>
                </div>
                <button
                  aria-label="Close activity editor"
                  className="modal-close-button"
                  onClick={() => { setDraft(null); setEditingActivityId(null); setOpenIconMenu(null); }}
                  type="button"
                >
                  <X aria-hidden="true" size={18} />
                </button>
              </div>

              {draftIsStale ? <div className="sync-notice" role="alert">
                {latestActivity ? 'This activity changed on another device. Your draft has been kept.' : 'This activity was deleted or moved outside the visible range. Your draft has been kept.'}
                <button type="button" onClick={() => { setDraft(latestActivity ? structuredClone(latestActivity) : null); if (!latestActivity) setEditingActivityId(null); setNotice(''); }}>Reload latest</button>
                {latestActivity ? <><details><summary>Latest saved activity</summary><p>{latestActivity.title} · {latestActivity.date} · {latestActivity.startTime ?? 'Any time'}–{latestActivity.endTime ?? ''}</p><p>{latestActivity.notes}</p><p>People: {latestActivity.personIds.map(id => personById(id)?.name ?? id).join(', ') || 'None'}</p></details><button type="button" onClick={() => { setDraft(current => current ? { ...current, version: latestActivity.version } : current); setNotice('Review your draft, then choose Save to apply it to the latest version.'); }}>Review and retry</button></> : null}
              </div> : null}
              <div className="editor-grid">
                <label className="editor-field">Date<input aria-label="Scheduled date" type="date" value={editingActivity.date} onChange={event => updateScheduledActivity(editingActivity.id, { date: event.target.value })} /></label>
                <div className="editor-field editor-title-field">
                  <label htmlFor="scheduled-activity-title">Title</label>
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
                      aria-label="Title"
                      id="scheduled-activity-title"
                      value={editingActivity.title}
                      onChange={(event) =>
                        updateScheduledActivity(editingActivity.id, {
                          title: event.target.value
                        })
                      }
                    />
                  </div>
                </div>
                <div className="time-entry editor-time-entry">
                  <label className="time-field">
                    <span>From</span>
                    <input
                      aria-label="Scheduled start time"
                      max={editingActivity.endTime}
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
                      min={editingActivity.startTime}
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
                  {editingActivity.personIds.filter(id => !personById(id)).map(id => <label className="check-chip" key={id}><input type="checkbox" checked onChange={() => toggleScheduledPerson(editingActivity.id, id)} />Removed person — uncheck to remove this assignment</label>)}
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
                <fieldset className="editor-wide">
                  <legend>Activity color</legend>
                  <div className="swatch-row">
                    {activityPalette.map(color => (
                      <button aria-label={`Use color ${color}`} aria-pressed={editingActivity.color === color}
                        className={editingActivity.color === color ? "swatch selected" : "swatch"} key={color}
                        onClick={() => updateScheduledActivity(editingActivity.id, { color })}
                        style={{ backgroundColor: color }} type="button" />
                    ))}
                  </div>
                </fieldset>
              </div>
              <div className="editor-modal-actions">
                <button className="secondary-action" onClick={() => { setDraft(null); setEditingActivityId(null); setOpenIconMenu(null); }} type="button">Cancel</button>
                <button className="primary-action" disabled={!editingActivity.title.trim() || !isTimeRangeValid(editingActivity.startTime, editingActivity.endTime) || draftIsStale}
                  onClick={() => void saveDraft()} type="button">Save changes</button>
              </div>
            </section>
            </div>
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
                required
              />
            </div>

            <div className="time-entry">
              <label className="time-field">
                <span>From</span>
                <input
                  aria-invalid={!activityTimeRangeIsValid}
                  aria-label="Optional start time"
                  max={activityEndTime || undefined}
                  type="time"
                  value={activityStartTime}
                  onChange={(event) => setActivityStartTime(event.target.value)}
                />
              </label>
              <label className="time-field">
                <span>To</span>
                <input
                  aria-invalid={!activityTimeRangeIsValid}
                  aria-label="Optional end time"
                  min={activityStartTime || undefined}
                  type="time"
                  value={activityEndTime}
                  onChange={(event) => setActivityEndTime(event.target.value)}
                />
              </label>
            </div>
            {!activityTimeRangeIsValid ? (
              <p className="form-error">End time must not be before start time.</p>
            ) : null}

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

            <button className="primary-action" disabled={!canAddActivity} type="submit">
              <Plus aria-hidden="true" size={18} />
              Add activity
            </button>
          </form>

        </aside>
        ) : null}
      </section>
      {isEditMode && templateDraft ? (
        <div className="modal-backdrop">
          <section aria-label="Edit reusable activity" aria-modal="true" className="editor-modal" role="dialog">
            <div className="panel-heading editor-modal-heading">
              <div>
                <p className="panel-kicker">Ready to drag</p>
                <h2>Edit reusable activity</h2>
              </div>
              <button aria-label="Close reusable activity editor" className="modal-close-button" onClick={() => setTemplateDraft(null)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <p className="editor-help">Changes apply to future placements. Already scheduled cards keep their details.</p>
            {templateDraftIsStale ? (
              <div className="sync-notice" role="alert">
                This reusable activity changed on another device.
                <button type="button" onClick={() => setTemplateDraft(latestTemplate ? structuredClone(latestTemplate) : null)}>Reload latest</button>
              </div>
            ) : null}
            <div className="editor-grid">
              <div className="editor-field editor-title-field">
                <label htmlFor="template-activity-title">Title</label>
                <div className="input-with-icon">
                  {renderIconPicker({ id: "template", label: "Reusable activity icon", value: templateDraft.icon ?? activityIconGallery[0], icons: activityIconGallery,
                    onChange: icon => updateTemplateDraft({ icon }) })}
                  <input aria-label="Reusable activity title" id="template-activity-title" value={templateDraft.title} onChange={event => updateTemplateDraft({ title: event.target.value })} />
                </div>
              </div>
              <div className="time-entry editor-time-entry">
                <label className="time-field">
                  <span>From</span>
                  <input aria-label="Reusable activity start time" type="time" value={templateDraft.startTime ?? ""}
                    onChange={event => updateTemplateDraft({ startTime: event.target.value || undefined })} />
                </label>
                <label className="time-field">
                  <span>To</span>
                  <input aria-label="Reusable activity end time" type="time" value={templateDraft.endTime ?? ""}
                    onChange={event => updateTemplateDraft({ endTime: event.target.value || undefined })} />
                </label>
              </div>
              <label className="check-chip full-width-check editor-wide">
                <input type="checkbox" checked={Boolean(templateDraft.isRecurring)}
                  onChange={event => updateTemplateDraft({ isRecurring: event.target.checked })} />
                Recurring on same weekday
              </label>
              <label className="editor-field editor-wide">
                Notes
                <textarea rows={3} value={templateDraft.notes ?? ""} onChange={event => updateTemplateDraft({ notes: event.target.value || undefined })} />
              </label>
              <fieldset className="editor-wide">
                <legend>People</legend>
                <div className="person-options">
                  {planner.state.people.map(person => (
                    <label className="check-chip" key={person.id}>
                      <input type="checkbox" checked={templateDraft.personIds.includes(person.id)} onChange={() => toggleTemplatePerson(person.id)} />
                      {person.icon ? <span aria-hidden="true" className="emoji-mark">{person.icon}</span> : null}
                      {person.name}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="editor-wide">
                <legend>Activity color</legend>
                <div className="swatch-row">
                  {activityPalette.map(color => (
                    <button aria-label={`Use color ${color}`} aria-pressed={templateDraft.color === color} className={templateDraft.color === color ? "swatch selected" : "swatch"}
                      key={color} onClick={() => updateTemplateDraft({ color })} style={{ backgroundColor: color }} type="button" />
                  ))}
                </div>
              </fieldset>
            </div>
            <div className="editor-modal-actions">
              <button className="secondary-action" onClick={() => setTemplateDraft(null)} type="button">Cancel</button>
              <button className="primary-action" disabled={!canSaveTemplate || templateDraftIsStale} onClick={() => void saveTemplateDraft()} type="button">Save changes</button>
            </div>
          </section>
        </div>
      ) : null}
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
  getScheduleDatesForTemplate,
  isNavigableMonth,
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
