import {
  CalendarDays,
  GripVertical,
  Plus,
  Trash2,
  UserRoundPlus
} from "lucide-react";
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
  const [personName, setPersonName] = useState("");
  const [activityTitle, setActivityTitle] = useState("");
  const [activityNotes, setActivityNotes] = useState("");
  const [activityPeople, setActivityPeople] = useState<string[]>([]);
  const [activityColor, setActivityColor] = useState(activityPalette[0]);

  const monthLabel = useMemo(
    () => getMonthLabel(planner.selectedMonth),
    [planner.selectedMonth]
  );

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(planner));
  }, [planner]);

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

  function personById(personId: string) {
    return planner.state.people.find((person) => person.id === personId);
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
          <div className="calendar-placeholder">
            <h2>{monthLabel}</h2>
            <p>
              Calendar navigation, week/month views, drag scheduling, cloning,
              and print controls will build on this foundation.
            </p>
          </div>
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
