import ICAL from 'ical.js';
import type { CalendarEvent } from '../types';

function toDate(icalTime: { year: number; month: number; day: number; hour: number; minute: number; second: number }): Date {
  return new Date(icalTime.year, icalTime.month - 1, icalTime.day, icalTime.hour, icalTime.minute, icalTime.second);
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/** YYYY-MM-DD in local time (for consistent day keys across timezones). */
export function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const WEEKDAY_COUNT = 5; // Mon–Fri

function endOfWeekdays(start: Date): Date {
  const out = new Date(start);
  out.setDate(out.getDate() + WEEKDAY_COUNT);
  out.setHours(23, 59, 59, 999);
  return out;
}

export function parseICS(
  icsText: string,
  calendarId: string,
  calendarName: string,
  color: string
): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  try {
    const jCal = ICAL.parse(icsText);
    const comp = new ICAL.Component(jCal);
    const vevents = comp.getAllSubcomponents('vevent');

    for (const vevent of vevents) {
      const event = new ICAL.Event(vevent);
      const start = event.startDate.toJSDate();
      const end = event.endDate.toJSDate();
      const summary = event.summary?.trim() || '(No title)';
      const uid = event.uid || `${start.getTime()}-${summary}`;
      const location = event.location?.trim();

      events.push({
        id: `${calendarId}-${uid}`,
        title: summary,
        start,
        end,
        allDay: event.startDate.isDate,
        calendarId,
        calendarName,
        color,
        location: location || undefined,
      });
    }
  } catch (e) {
    console.error('parseICS error', e);
  }
  return events;
}

export function filterEventsForWeek(
  events: CalendarEvent[],
  weekStart: Date
): CalendarEvent[] {
  const start = startOfDay(weekStart);
  const end = endOfWeekdays(start);
  return events.filter((ev) => {
    const evEnd = ev.end.getTime();
    const evStart = ev.start.getTime();
    return evEnd > start.getTime() && evStart < end.getTime();
  });
}

/**
 * Group events by day using the exact date keys provided (ensures grid alignment).
 */
export function groupEventsByDay(
  events: CalendarEvent[],
  dateKeys: string[]
): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const key of dateKeys) {
    map.set(key, []);
  }
  for (const ev of events) {
    const dayKey = toLocalDateKey(ev.start);
    if (map.has(dayKey)) {
      map.get(dayKey)!.push(ev);
    }
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => a.start.getTime() - b.start.getTime());
  }
  return map;
}

/** Build the 5 weekday date keys (Mon–Fri) from week start for a single source of truth. */
export function getWeekDateKeys(weekStart: Date): string[] {
  const keys: string[] = [];
  const start = new Date(weekStart);
  start.setHours(0, 0, 0, 0);
  for (let i = 0; i < WEEKDAY_COUNT; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    keys.push(toLocalDateKey(d));
  }
  return keys;
}
