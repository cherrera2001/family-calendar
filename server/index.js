import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import ICAL from 'ical.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3001;

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

app.use(cors());
app.use(express.json());

function readConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    }
  } catch (err) {
    console.error('readConfig error:', err.message);
  }
  return [];
}

function writeConfig(config) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  } catch (err) {
    console.error('writeConfig error:', err.message);
    throw err;
  }
}

// Normalize calendar URL: webcal:// -> https:// so fetch() can use it
function normalizeCalendarUrl(url) {
  if (!url || typeof url !== 'string') return url;
  const trimmed = url.trim();
  if (trimmed.toLowerCase().startsWith('webcal://')) {
    return 'https://' + trimmed.slice(9);
  }
  return trimmed;
}

// ── iCal parsing (same logic as src/utils/ical.ts) ──────────────────────────

const RECURRENCE_EXPAND_DAYS_PAST = 7;
const RECURRENCE_EXPAND_DAYS_FUTURE = 90;

function fixBrokenLineFolding(icsText) {
  const lines = [];
  const re = /\r\n|\n|\r/g;
  let lastIndex = 0;
  let m;
  while ((m = re.exec(icsText)) !== null) {
    const line = icsText.slice(lastIndex, m.index);
    lastIndex = m.index + m[0].length;
    const trimmed = line.trimStart();
    const isContinuation = line.length > 0 && (line[0] === ' ' || line[0] === '\t');
    const looksLikeProperty = /[;:]/.test(trimmed);
    if (!looksLikeProperty && !isContinuation && trimmed.length > 0 && lines.length > 0) {
      lines[lines.length - 1] += '\\n' + trimmed;
    } else {
      lines.push(line);
    }
  }
  if (lastIndex < icsText.length) lines.push(icsText.slice(lastIndex));
  return lines.join('\r\n');
}

function normalizeICSText(s) {
  if (s.length > 0 && s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  s = fixBrokenLineFolding(s);
  s = s.trimEnd();
  if (/BEGIN:VCALENDAR/i.test(s) && !/END:VCALENDAR\s*$/im.test(s)) {
    s = s + '\r\nEND:VCALENDAR';
  }
  return s;
}

function pushEvent(events, event, start, end, calendarId, calendarName, color, occurrenceId) {
  const summary = (event.summary || '').trim() || '(No title)';
  const uid = event.uid || `${start.getTime()}-${summary}`;
  const id = occurrenceId ? `${calendarId}-${uid}-${occurrenceId}` : `${calendarId}-${uid}`;
  const location = (event.location || '').trim();
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

function parseICSEvents(comp, calendarId, calendarName, color) {
  const events = [];
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
        if (!event.startDate) continue;

        if (event.isRecurring()) {
          const iter = event.iterator();
          let occ;
          const maxOccurrences = 500;
          let count = 0;
          while (count < maxOccurrences && (occ = iter.next())) {
            count++;
            const occTime = occ.toJSDate ? occ.toJSDate() : occ;
            const occTimeMs = occTime instanceof Date ? occTime.getTime() : new Date(occTime).getTime();
            if (occTimeMs > rangeEndTime) break;
            if (occTimeMs < rangeStartTime) continue;
            const details = event.getOccurrenceDetails(occ);
            const start = details.startDate.toJSDate();
            const end = details.endDate.toJSDate();
            pushEvent(events, details.item || event, start, end, calendarId, calendarName, color, String(occTimeMs));
          }
        } else {
          const start = event.startDate.toJSDate();
          const end = event.endDate.toJSDate();
          pushEvent(events, event, start, end, calendarId, calendarName, color);
        }
      } catch (e) {
        console.warn('parseICS: skipped malformed VEVENT', e.message);
      }
    }
  } catch (e) {
    console.error('parseICS error', e);
  }
  return events;
}

function parseICS(icsText, calendarId, calendarName, color) {
  const normalized = normalizeICSText(icsText);
  if (!/BEGIN:VCALENDAR/i.test(normalized)) {
    throw new Error('Response is not a calendar (expected BEGIN:VCALENDAR)');
  }
  let jCal;
  try {
    jCal = ICAL.parse(normalized);
  } catch (e) {
    throw new Error('Calendar parse failed: ' + e.message);
  }
  const comp = new ICAL.Component(jCal);
  return parseICSEvents(comp, calendarId, calendarName, color);
}

// ── Background calendar polling ──────────────────────────────────────────────

// calendarId -> { events: CalendarEvent[], rawICS: string, lastFetched: Date, error: string|null }
const calendarCache = new Map();
// calendarId -> intervalId
const calendarTimers = new Map();

async function fetchAndCacheCalendar(cal) {
  const url = normalizeCalendarUrl(cal.url);
  console.log(`[calendar] Fetching ${cal.name} (${cal.id})`);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'HallwayCalendar/1.0',
        'Accept': 'text/calendar, application/calendar+json, */*',
      },
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    let text = await response.text();
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const trimmed = text.trim();
    if (!trimmed || !/BEGIN:VCALENDAR/i.test(trimmed)) {
      const isHtml = /^\s*</.test(trimmed) || /<!DOCTYPE|<\/html>/i.test(trimmed);
      throw new Error(isHtml
        ? 'Server returned an HTML page (e.g. login or error page). Use the public iCal link from your calendar provider.'
        : 'Server did not return a valid iCal feed.');
    }
    const events = parseICS(text, cal.id, cal.name, cal.color);
    calendarCache.set(cal.id, { events, rawICS: text, lastFetched: new Date(), error: null });
    console.log(`[calendar] ${cal.name}: ${events.length} events cached`);
  } catch (err) {
    console.error(`[calendar] Failed to fetch ${cal.name}:`, err.message);
    const prev = calendarCache.get(cal.id);
    calendarCache.set(cal.id, {
      events: prev?.events || [],
      rawICS: prev?.rawICS || '',
      lastFetched: new Date(),
      error: err.message,
    });
  }
}

function startPolling(config) {
  // Stop all existing timers
  for (const timer of calendarTimers.values()) clearInterval(timer);
  calendarTimers.clear();

  // Remove cached calendars no longer in config
  const configIds = new Set(config.map((c) => c.id));
  for (const id of calendarCache.keys()) {
    if (!configIds.has(id)) calendarCache.delete(id);
  }

  for (const cal of config) {
    // Fetch immediately, then on interval
    fetchAndCacheCalendar(cal);
    const refreshMinutes = (typeof cal.refreshMinutes === 'number' && cal.refreshMinutes >= 1) ? cal.refreshMinutes : 5;
    const ms = refreshMinutes * 60 * 1000;
    const timer = setInterval(() => fetchAndCacheCalendar(cal), ms);
    calendarTimers.set(cal.id, timer);
  }
}

// ── API endpoints ────────────────────────────────────────────────────────────

// App-level settings from environment
app.get('/api/app', (_req, res) => {
  const refreshPageMinutes = process.env.REFRESH_PAGE_MINUTES
    ? parseInt(process.env.REFRESH_PAGE_MINUTES, 10)
    : 0;
  res.json({
    title: process.env.CALENDAR_TITLE || 'Herrera House',
    refreshPageMinutes: refreshPageMinutes > 0 ? refreshPageMinutes : 0,
  });
});

// Persist calendar config (shared across devices hitting this server)
app.get('/api/config', (req, res) => {
  try {
    const config = readConfig();
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read config' });
  }
});

app.post('/api/config', (req, res) => {
  const config = req.body;
  if (!Array.isArray(config)) {
    return res.status(400).json({ error: 'Body must be an array' });
  }
  try {
    writeConfig(config);
    startPolling(config);
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save config' });
  }
});

// All parsed events from all cached calendars (for the UI)
app.get('/api/events', (_req, res) => {
  const events = [];
  const errors = {};
  for (const [id, cached] of calendarCache) {
    for (const ev of cached.events) {
      events.push({
        ...ev,
        start: ev.start.toISOString(),
        end: ev.end.toISOString(),
      });
    }
    if (cached.error) errors[id] = cached.error;
  }
  res.json({ events, errors, lastUpdated: new Date().toISOString() });
});

// Merged iCal feed — subscribe to this from any calendar app
app.get('/api/ical/feed', (_req, res) => {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Family Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const cached of calendarCache.values()) {
    if (!cached.rawICS) continue;
    const vevents = cached.rawICS.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/gi) || [];
    lines.push(...vevents);
  }

  lines.push('END:VCALENDAR');

  res.set('Content-Type', 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="family-calendar.ics"');
  res.send(lines.join('\r\n'));
});

// Proxy a single raw iCal URL (kept for Settings "test" flow during calendar add)
app.get('/api/ical', async (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl) {
    return res.status(400).json({ error: 'Missing url query parameter' });
  }
  const url = normalizeCalendarUrl(rawUrl);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'HallwayCalendar/1.0',
        'Accept': 'text/calendar, application/calendar+json, */*',
      },
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    let text = await response.text();
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const trimmed = text.trim();
    if (!trimmed || !/BEGIN:VCALENDAR/i.test(trimmed)) {
      const preview = trimmed.slice(0, 300);
      const isHtml = /^\s*</.test(trimmed) || /<!DOCTYPE|<\/html>/i.test(trimmed);
      console.error('ical proxy: response is not iCal', { url, isHtml, preview });
      return res.status(502).json({
        error: 'Calendar URL did not return valid iCal data',
        detail: isHtml
          ? 'The server returned an HTML page (e.g. login or error). Use the public "iCal" or "Calendar" link from iCloud.com, not a page URL.'
          : 'The server did not return a calendar. Use the public calendar link from your calendar provider.',
      });
    }
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.send(text);
  } catch (err) {
    console.error('ical proxy error:', err.message);
    res.status(502).json({ error: 'Failed to fetch calendar', detail: err.message });
  }
});

// Serve built frontend in production (when dist exists)
const dist = path.join(__dirname, '..', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(dist, 'index.html'), (err) => {
      if (err) next(err);
    });
  });
}

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  // Start background polling for all configured calendars
  startPolling(readConfig());
});
