import { useState, useCallback, useEffect } from 'react';
import type { CalendarConfig, CalendarEvent } from '../types';
import { parseICS, filterEventsForWeek, groupEventsByDay, getWeekDateKeys } from '../utils/ical';

const STORAGE_KEY = 'hallway-calendar-config';
const DEFAULT_REFRESH_MINUTES = 5;
const MIN_REFRESH = 1;
const MAX_REFRESH = 60;

export function getRefreshMinutes(cal: CalendarConfig): number {
  const n = cal.refreshMinutes;
  if (typeof n === 'number' && n >= MIN_REFRESH && n <= MAX_REFRESH) return n;
  return DEFAULT_REFRESH_MINUTES;
}

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

function getWeekStart(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

async function fetchOneCalendar(
  cal: CalendarConfig
): Promise<CalendarEvent[]> {
  const url = `/api/ical?url=${encodeURIComponent(cal.url)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  return parseICS(text, cal.id, cal.name, cal.color);
}

export function useCalendars() {
  const [config, setConfig] = useState<CalendarConfig[]>(loadConfig);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [eventsByCalendar, setEventsByCalendar] = useState<Record<string, CalendarEvent[]>>({});
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
    if (config.length === 0) {
      setEventsByCalendar({});
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const updates: Record<string, CalendarEvent[]> = {};
    for (const cal of config) {
      try {
        const parsed = await fetchOneCalendar(cal);
        updates[cal.id] = parsed;
      } catch (e) {
        console.error('Failed to fetch calendar', cal.name, e);
        setError((prev) => (prev ? `${prev}; ${cal.name} failed` : `Failed: ${cal.name}`));
      }
    }
    setEventsByCalendar((prev) => {
      const next: Record<string, CalendarEvent[]> = {};
      for (const cal of config) {
        next[cal.id] = updates[cal.id] ?? prev[cal.id] ?? [];
      }
      return next;
    });
    setLoading(false);
  }, [config]);

  const fetchCalendar = useCallback(async (cal: CalendarConfig) => {
    try {
      const parsed = await fetchOneCalendar(cal);
      setEventsByCalendar((prev) => ({ ...prev, [cal.id]: parsed }));
    } catch (e) {
      console.error('Failed to fetch calendar', cal.name, e);
      setError((prev) => (prev ? `${prev}; ${cal.name} failed` : `Failed: ${cal.name}`));
    }
  }, []);

  useEffect(() => {
    if (!configLoaded) return;
    fetchAll();
  }, [configLoaded, fetchAll]);

  useEffect(() => {
    if (config.length === 0) return;
    const timers: ReturnType<typeof setInterval>[] = [];
    for (const cal of config) {
      const ms = getRefreshMinutes(cal) * 60 * 1000;
      const t = setInterval(() => fetchCalendar(cal), ms);
      timers.push(t);
    }
    return () => timers.forEach(clearInterval);
  }, [config, fetchCalendar]);

  const events = Object.values(eventsByCalendar).flat();

  const updateConfig = useCallback((next: CalendarConfig[]) => {
    setConfig(next);
    saveConfig(next);
    saveConfigToServer(next);
  }, []);

  const filteredEvents = filterEventsForWeek(events, weekStart);
  const weekDateKeys = getWeekDateKeys(weekStart);
  const days = groupEventsByDay(filteredEvents, weekDateKeys);
  const weekStartStr = weekStart.toISOString().slice(0, 10);

  const goToPrevWeek = useCallback(() => {
    setWeekStart((d) => {
      const n = new Date(d);
      n.setDate(n.getDate() - 7);
      return n;
    });
  }, []);

  const goToNextWeek = useCallback(() => {
    setWeekStart((d) => {
      const n = new Date(d);
      n.setDate(n.getDate() + 7);
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
