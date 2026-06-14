import { useState, useCallback, useEffect } from 'react';
import type { CalendarConfig, CalendarEvent } from '../types';
import { filterEventsForWeek, groupEventsByDay, getWeekDateKeys } from '../utils/ical';

const STORAGE_KEY = 'hallway-calendar-config';
const EVENTS_POLL_MS = 60 * 1000; // poll /api/events every minute

export function loadConfig(): CalendarConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (_) {}
  return [];
}

export function saveConfig(config: CalendarConfig[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

async function fetchConfigFromServer(): Promise<CalendarConfig[] | null> {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

async function saveConfigToServer(config: CalendarConfig[]): Promise<boolean> {
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Start of the 5-day window: today at midnight. */
function getWeekStart(d: Date): Date {
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  return start;
}

type RawEvent = Omit<CalendarEvent, 'start' | 'end'> & { start: string; end: string };

async function fetchEvents(): Promise<{ events: CalendarEvent[]; errors: Record<string, string> }> {
  const res = await fetch('/api/events');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const events: CalendarEvent[] = (data.events as RawEvent[] || []).map((ev) => ({
    ...ev,
    // All-day dates arrive as YYYY-MM-DD (no time component) to avoid UTC
    // timezone shifts when the server runs in a different timezone (e.g. UTC on NAS).
    // Parse them as local noon so getDate() is correct in any UTC offset.
    start: ev.start.length === 10 ? new Date(ev.start + 'T12:00:00') : new Date(ev.start),
    end: ev.end.length === 10 ? new Date(ev.end + 'T12:00:00') : new Date(ev.end),
  }));
  return { events, errors: data.errors || {} };
}

export function useCalendars() {
  const [config, setConfig] = useState<CalendarConfig[]>(loadConfig);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState<Date>(() => getWeekStart(new Date()));

  // Load config from server on mount; only overwrite local when server has data
  useEffect(() => {
    let cancelled = false;
    fetchConfigFromServer()
      .then((serverConfig) => {
        if (cancelled) return;
        if (serverConfig != null && serverConfig.length > 0) {
          setConfig(serverConfig);
          saveConfig(serverConfig);
        } else {
          const local = loadConfig();
          if (local.length > 0) {
            saveConfigToServer(local);
          }
        }
      })
      .finally(() => {
        if (!cancelled) setConfigLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { events: fetched, errors } = await fetchEvents();
      setEvents(fetched);
      const errorMessages = Object.entries(errors)
        .map(([, msg]) => msg)
        .join('; ');
      if (errorMessages) setError(errorMessages);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('Failed to fetch events', e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch events once config is loaded, then poll every minute
  useEffect(() => {
    if (!configLoaded) return;
    fetchAll();
    const timer = setInterval(fetchAll, EVENTS_POLL_MS);
    return () => clearInterval(timer);
  }, [configLoaded, fetchAll]);

  const updateConfig = useCallback((next: CalendarConfig[]) => {
    setConfig(next);
    saveConfig(next);
    saveConfigToServer(next);
  }, []);

  const visibleCalendarIds = new Set(config.filter((c) => c.showOnDisplay !== false).map((c) => c.id));
  const visibleEvents = events.filter((ev) => visibleCalendarIds.has(ev.calendarId));
  const filteredEvents = filterEventsForWeek(visibleEvents, weekStart);
  const weekDateKeys = getWeekDateKeys(weekStart);
  const days = groupEventsByDay(filteredEvents, weekDateKeys);
  const weekStartStr = weekStart.toISOString().slice(0, 10);

  const goToPrevWeek = useCallback(() => {
    setWeekStart((d) => {
      const n = new Date(d);
      n.setDate(n.getDate() - 5);
      return n;
    });
  }, []);

  const goToNextWeek = useCallback(() => {
    setWeekStart((d) => {
      const n = new Date(d);
      n.setDate(n.getDate() + 5);
      return n;
    });
  }, []);

  const goToThisWeek = useCallback(() => {
    setWeekStart(getWeekStart(new Date()));
  }, []);

  return {
    config,
    updateConfig,
    events: filteredEvents,
    days,
    weekDateKeys,
    weekStart,
    weekStartStr,
    loading,
    error,
    refetch: fetchAll,
    goToPrevWeek,
    goToNextWeek,
    goToThisWeek,
  };
}
