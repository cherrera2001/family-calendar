import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

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

// App-level settings from environment (e.g. Portainer env vars)
app.get('/api/app', (_req, res) => {
  res.json({
    title: process.env.CALENDAR_TITLE || 'Herrera House',
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
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save config' });
  }
});

// Normalize calendar URL: webcal:// -> https:// so fetch() can use it
function normalizeCalendarUrl(url) {
  if (!url || typeof url !== 'string') return url;
  const trimmed = url.trim();
  if (trimmed.toLowerCase().startsWith('webcal://')) {
    return 'https://' + trimmed.slice(9);
  }
  return trimmed;
}

// Proxy iCal feeds (many calendar URLs don't allow CORS)
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
      console.error('ical proxy: response is not iCal', { url, contentType: response.headers.get('content-type'), isHtml, preview });
      return res.status(502).json({
        error: 'Calendar URL did not return valid iCal data',
        detail: isHtml
          ? 'The server returned an HTML page (e.g. login or error). Use the public “iCal” or “Calendar” link from iCloud.com, not a page URL.'
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
});
