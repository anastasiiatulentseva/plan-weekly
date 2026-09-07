import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyState, getMonthWeeks, toDateKey } from '../shared/planner';
import type { ActivityTemplate, Person, PersistedPlanner, ScheduledActivity } from '../shared/planner';
import { extractPreferences, legacyKey, preferencesKey } from '../shared/preferences';

export class RequestError extends Error {
  constructor(public status: number, public data: { code?: string; latest?: ScheduledActivity | null }) { super(data.code ?? 'Request failed'); }
}
export async function api(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(`/api/${path}`, { method, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15_000),
    ...(method === 'GET' ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }),
  });
  const data = await response.json();
  if (!response.ok) throw new RequestError(response.status, data);
  return data;
}
function savedPreferences() {
  try { return JSON.parse(localStorage.getItem(preferencesKey) ?? localStorage.getItem(legacyKey) ?? '{}'); }
  catch { return {}; }
}
export function usePlanner() {
  const [planner, setPlanner] = useState<PersistedPlanner>(() => ({ state: emptyState(), ...extractPreferences({}) }));
  const [auth, setAuth] = useState<'loading' | 'member' | 'required'>('loading');
  const [status, setStatus] = useState('Loading calendar…');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [conflictLatest, setConflictLatest] = useState<ScheduledActivity | null>(null);
  const stateRef = useRef(planner);
  stateRef.current = planner;
  const mounted = useRef(false);
  const busy = useRef(false);
  const querySequence = useRef(0);
  const migrated = useRef(false);
  const pendingRetry = useRef<null | (() => Promise<boolean>)>(null);
  const refresh = useCallback(async () => {
    const sequence = ++querySequence.current;
    const month = stateRef.current.selectedMonth;
    const days = getMonthWeeks(month).flat();
    try {
      const data = await api(`planner?from=${toDateKey(days[0])}&to=${toDateKey(days[days.length - 1])}`) as {
        people: Person[]; activityTemplates: ActivityTemplate[]; scheduled: ScheduledActivity[]; calendarRevision: number;
      };
      if (!mounted.current || sequence !== querySequence.current || month !== stateRef.current.selectedMonth) return;
      setPlanner(current => {
        const months: PersistedPlanner['state']['months'] = {};
        for (const activity of data.scheduled) {
          const key = activity.date.slice(0, 7);
          (months[key] ??= { monthKey: key, scheduled: [] }).scheduled.push(activity);
        }
        return { ...current, state: { people: data.people, activityTemplates: data.activityTemplates, months } };
      });
      if (!migrated.current) {
        try {
          localStorage.setItem(preferencesKey, JSON.stringify(extractPreferences(stateRef.current)));
          localStorage.removeItem(legacyKey);
        } catch { /* Storage may be disabled; calendar remains usable. */ }
        migrated.current = true;
      }
      setAuth('member'); setStatus('Connected');
    } catch (error) {
      if (!mounted.current || sequence !== querySequence.current) return;
      if (error instanceof RequestError && error.status === 401) { setAuth('required'); setStatus('An invitation is required to open this calendar.'); }
      else setStatus(navigator.onLine ? 'Reconnecting… Calendar could not be loaded.' : 'Offline — editing is unavailable.');
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const preferences = extractPreferences(savedPreferences());
    stateRef.current = { ...stateRef.current, ...preferences };
    setPlanner(stateRef.current);
    void (async () => {
      const token = new URLSearchParams(location.hash.slice(1)).get('join');
      if (token) {
        try {
          await api('session', 'POST', { token });
          history.replaceState(null, '', location.pathname + location.search);
        } catch {
          if (mounted.current) { setAuth('required'); setStatus('Unable to join. Check your invitation link or try again shortly.'); }
          return;
        }
      }
      await refresh();
    })();
    return () => { mounted.current = false; querySequence.current++; };
  }, [refresh]);
  useEffect(() => {
    if (auth !== 'member') return;
    if (!busy.current) void refresh();
    try { localStorage.setItem(preferencesKey, JSON.stringify(extractPreferences(planner))); } catch {}
  }, [planner.selectedMonth, planner.selectedWeekStart, planner.viewMode, auth, refresh]);
  useEffect(() => {
    if (auth !== 'member') return;
    const events = new EventSource('/api/events');
    const update = () => { if (!busy.current) void refresh(); };
    events.addEventListener('ready', update);
    events.addEventListener('revision', update);
    events.onerror = () => { setStatus(navigator.onLine ? 'Reconnecting…' : 'Offline — editing is unavailable.'); update(); };
    const online = () => { setStatus('Reconnecting…'); update(); };
    const offline = () => setStatus('Offline — editing is unavailable.');
    window.addEventListener('online', online); window.addEventListener('offline', offline);
    // Also recovers after a DB outage while the SSE transport itself stayed healthy.
    const timer = setInterval(update, 30_000);
    return () => { events.close(); clearInterval(timer); window.removeEventListener('online', online); window.removeEventListener('offline', offline); };
  }, [auth, refresh]);
  async function mutate(path: string, method: string, body: unknown, optimistic?: (current: PersistedPlanner) => PersistedPlanner): Promise<boolean> {
    if (busy.current || auth !== 'member') return false;
    if (!navigator.onLine) { setNotice('Offline — changes were not sent. Your draft is preserved.'); return false; }
    busy.current = true; querySequence.current++; setSaving(true); setNotice(''); pendingRetry.current = null;
    const before = stateRef.current.state;
    if (optimistic) setPlanner(optimistic);
    try {
      await api(path, method, body);
      await refresh();
      return true;
    } catch (error) {
      setPlanner(current => ({ ...current, state: before }));
      if (error instanceof RequestError && error.status === 409) {
        if (path.startsWith('scheduled/')) setConflictLatest(error.data.latest ?? null);
        setNotice('Conflict: this record changed or was deleted. Reload latest, or review your draft before retrying.');
      } else {
        setNotice('Save failed. Your draft is preserved. Reloading the saved calendar.');
        // Only explicit retries; preserve the original key after a lost response.
        pendingRetry.current = () => mutate(path, method, body, optimistic);
      }
      await refresh();
      return false;
    } finally { busy.current = false; setSaving(false); }
  }
  async function leave() {
    if (await mutate('session', 'DELETE', {})) {
      setPlanner(current => ({ ...current, state: emptyState() })); setAuth('required'); setNotice('');
    }
  }
  return { planner, setPlanner, auth, status, notice, setNotice, saving, mutate, refresh, leave, conflictLatest,
    retry: () => pendingRetry.current?.(), canRetry: Boolean(pendingRetry.current) };
}
