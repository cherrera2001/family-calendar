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

// Expand recurring events up to this many days ahead (and a bit in the past)
const RECURRENCE_EXPAND_DAYS_PAST = 7;
const RECURRENCE_EXPAND_DAYS_FUTURE = 90;

function icalTimeToDate(icalTime: { toJSDate: () => Date }): Date {
  return icalTime.toJSDate();
}

function pushEvent(
  events: CalendarEvent[],
  event: ICAL.Event,
  start: Date,
  end: Date,
  calendarId: string,
  calendarName: string,
  color: string,
  occurrenceId?: string
) {
  const summary = event.summary?.trim() || '(No title)';
  const uid = event.uid || `${start.getTime()}-${summary}`;
  const id = occurrenceId ? `${calendarId}-${uid}-${occurrenceId}` : `${calendarId}-${uid}`;
  const location = event.location?.trim();
  events.push({
    id,
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

/**
 * iCal requires continuation lines to start with space/tab. iCloud sometimes
 * puts raw newlines inside values (e.g. LOCATION), producing lines with no ";"
 * or ":" that ical.js rejects. Merge those into the previous line as \n.
 */
function fixBrokenLineFolding(icsText: string): string {
  const lines: string[] = [];
  const re = /\r\n|\n|\r/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(icsText)) !== null) {
    const line = icsText.slice(lastIndex, m.index);
    lastIndex = m.index + m[0].length;
    const trimmed = line.trimStart();
    const isContinuation = line.length > 0 && (line[0] === ' ' || line[0] === '\t');
    const looksLikeProperty = /[;:]/.test(trimmed);
    if (!looksLikeProperty && !isContinuation && trimmed.length > 0 && lines.length > 0) {
      // Broken continuation (e.g. "Calgaty Alberta" after LOCATION:...)
      lines[lines.length - 1] += '\\n' + trimmed;
    } else {
      lines.push(line);
    }
  }
  if (lastIndex < icsText.length) lines.push(icsText.slice(lastIndex));
  return lines.join('\r\n');
}

/** Normalize ICS text before parsing: strip BOM, fix folding, ensure END:VCALENDAR. */
function normalizeICSText(icsText: string): string {
  let s = icsText;
  if (s.length > 0 && s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  s = fixBrokenLineFolding(s);
  s = s.trimEnd();
  if (/BEGIN:VCALENDAR/i.test(s) && !/END:VCALENDAR\s*$/im.test(s)) {
    s = s + '\r\nEND:VCALENDAR';
  }
  return s;
}

export function parseICS(
  icsText: string,
  calendarId: string,
  calendarName: string,
  color: string
): CalendarEvent[] {
  const normalized = normalizeICSText(icsText);

  // Reject obvious non-ICS (e.g. HTML error page)
  if (!/BEGIN:VCALENDAR/i.test(normalized)) {
    const preview = normalized.slice(0, 200).replace(/\s+/g, ' ');
    throw new Error(
      'Response is not a calendar (expected BEGIN:VCALENDAR). ' +
        (preview.startsWith('<') ? 'Server may have returned HTML.' : '') +
        ' Preview: ' + (preview.slice(0, 80) || '(empty)')
    );
  }

  let jCal: ReturnType<typeof ICAL.parse>;
  try {
    jCal = ICAL.parse(normalized);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('parseICS: ICAL.parse failed', msg, 'Preview:', normalized.slice(0, 300));
    throw new Error('Calendar parse failed: ' + msg);
  }

  const comp = new ICAL.Component(jCal);
  return parseICSEvents(comp, calendarId, calendarName, color);
}

function parseICSEvents(
  comp: ICAL.Component,
  calendarId: string,
  calendarName: string,
  color: string
): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  try {
    const vevents = comp.getAllSubcomponents('vevent');

    const rangeEnd = new Date();
    rangeEnd.setDate(rangeEnd.getDate() + RECURRENCE_EXPAND_DAYS_FUTURE);
    const rangeStart = new Date();
    rangeStart.setDate(rangeStart.getDate() - RECURRENCE_EXPAND_DAYS_PAST);
    const rangeEndTime = rangeEnd.getTime();
    const rangeStartTime = rangeStart.getTime();

    for (const vevent of vevents) {
      try {
        if (vevent.hasProperty('recurrence-id')) continue;
        const event = new ICAL.Event(vevent);

        // Skip events missing DTSTART (e.g. truncated iCloud responses)
        if (!event.startDate) continue;

        if (event.isRecurring()) {
          const iter = event.iterator();
          let occ: { toJSDate: () => Date } | null;
          const maxOccurrences = 500;
          let count = 0;
          while (count < maxOccurrences && (occ = iter.next())) {
            count++;
            const occTime = occ.toJSDate ? occ.toJSDate() : (occ as unknown as Date);
            const occTimeMs = occTime instanceof Date ? occTime.getTime() : new Date(occTime).getTime();
            if (occTimeMs > rangeEndTime) break;
            if (occTimeMs < rangeStartTime) continue;
            const details = event.getOccurrenceDetails(occ);
            const start = icalTimeToDate(details.startDate);
            const end = icalTimeToDate(details.endDate);
            pushEvent(events, details.item || event, start, end, calendarId, calendarName, color, String(occTimeMs));
          }
        } else {
          const start = event.startDate.toJSDate();
          const end = event.endDate.toJSDate();
          pushEvent(events, event, start, end, calendarId, calendarName, color);
        }
      } catch (e) {
        console.warn('parseICS: skipped malformed VEVENT', e);
      }
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
