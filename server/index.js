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

// Proxy iCal feeds (many calendar URLs don't allow CORS)
app.get('/api/ical', async (req, res) => {
  const url = req.query.url;
  if (!url) {
    return res.status(400).json({ error: 'Missing url query parameter' });
  }
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'HallwayCalendar/1.0' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    res.set('Content-Type', 'text/calendar');
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
