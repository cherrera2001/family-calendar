import { useState, useEffect, useMemo } from 'react';
import { useCalendars } from './hooks/useCalendars';
import { useWeather, weatherLabel, getStoredLocation, setStoredLocation } from './hooks/useWeather';
import { Settings } from './Settings';
import { DailyAgenda } from './DailyAgenda';
import { getDailyBackgroundUrl } from './utils/dailyBackground';
import { useAccentFromImage } from './utils/accentFromImage';
import { toLocalDateKey } from './utils/ical';
import type { CalendarConfig } from './types';
import './App.css';

const DAY_COUNT = 5;

function dayNameForDateKey(key: string): string {
  const d = new Date(key + 'T12:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatDateKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

const DEFAULT_TITLE = 'Herrera House';
const KEEP_SCREEN_ON_KEY = 'hallway-calendar-keep-screen-on';

function getStoredKeepScreenOn(): boolean {
  try {
    return localStorage.getItem(KEEP_SCREEN_ON_KEY) === 'true';
  } catch {
    return false;
  }
}

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [location, setLocation] = useState(getStoredLocation);
  const [appTitle, setAppTitle] = useState(DEFAULT_TITLE);
  const [keepScreenOn, setKeepScreenOn] = useState(getStoredKeepScreenOn);

  const handleKeepScreenOnChange = (value: boolean) => {
    setKeepScreenOn(value);
    try {
      localStorage.setItem(KEEP_SCREEN_ON_KEY, value ? 'true' : 'false');
    } catch {}
  };

  // Screen Wake Lock: keep iPad/device screen on when option is enabled (e.g. hallway display)
  useEffect(() => {
    if (!keepScreenOn) return;
    const nav = navigator as WakeLockNavigator;
    if (!nav.wakeLock) return;
    let sentinel: WakeLockSentinel | null = null;

    const requestLock = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        sentinel = await nav.wakeLock!.request('screen');
      } catch (_) {}
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') requestLock();
    };

    requestLock();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      sentinel?.release().catch(() => {});
    };
  }, [keepScreenOn]);

  useEffect(() => {
    let reloadTimeoutId: ReturnType<typeof setTimeout> | null = null;
    fetch('/api/app')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.title) setAppTitle(data.title);
        const mins = data?.refreshPageMinutes;
        if (typeof mins === 'number' && mins > 0) {
          reloadTimeoutId = setTimeout(() => window.location.reload(), mins * 60 * 1000);
        }
      })
      .catch(() => {});
    return () => {
      if (reloadTimeoutId != null) clearTimeout(reloadTimeoutId);
    };
  }, []);

  const {
    config,
    updateConfig,
    days,
    weekDateKeys,
    weekStart,
    weekStartStr,
    loading,
    error,
    goToPrevWeek,
    goToNextWeek,
    goToThisWeek,
  } = useCalendars();
  const { days: weatherDays, loading: weatherLoading } = useWeather(location);

  // Daily background: based on today's weather when available; date seed for midnight refresh
  const [dateSeed, setDateSeed] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      setDateSeed((prev) => (today !== prev ? today : prev));
    };
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);
  const todayWeatherCode = useMemo(
    () => weatherDays.find((d) => d.date === dateSeed)?.code,
    [weatherDays, dateSeed]
  );
  const dailyBgUrl = getDailyBackgroundUrl(dateSeed, todayWeatherCode);
  useAccentFromImage(dailyBgUrl);

  const todayKey = useMemo(() => toLocalDateKey(new Date()), []);
  const [selectedDay, setSelectedDay] = useState<string>(() => todayKey);

  useEffect(() => {
    if (!weekDateKeys.length) return;
    if (weekDateKeys.includes(selectedDay)) return;
    setSelectedDay(weekDateKeys.includes(todayKey) ? todayKey : weekDateKeys[0]);
  }, [weekDateKeys, selectedDay, todayKey]);

  const agendaEvents = days.get(selectedDay) ?? [];

  const isThisWeek = (() => {
    const now = new Date();
    const ws = new Date(weekStart);
    ws.setHours(0, 0, 0, 0);
    const we = new Date(ws);
    we.setDate(we.getDate() + DAY_COUNT - 1);
    we.setHours(23, 59, 59, 999);
    return now >= ws && now <= we;
  })();

  const handleLocationChange = (lat: number, lon: number, city?: string) => {
    setStoredLocation(lat, lon, city);
    setLocation({ lat, lon, city });
  };

  return (
    <div className="app">
      <div
        className="app-bg"
        style={{ backgroundImage: `url(${dailyBgUrl})` }}
        aria-hidden
      />
      <div className="app-content">
      <header className="header">
        <div className="header-left">
          <button type="button" className="nav-btn" onClick={goToPrevWeek} aria-label="Previous week">
            ‹
          </button>
          <button type="button" className="nav-btn" onClick={goToNextWeek} aria-label="Next week">
            ›
          </button>
          <button
            type="button"
            className={`this-week-btn ${isThisWeek ? 'active' : ''}`}
            onClick={goToThisWeek}
          >
            This week
          </button>
        </div>
        <h1 className="title">{appTitle}</h1>
        <div className="header-right">
          {error && <span className="header-error">{error}</span>}
          <button
            type="button"
            className="settings-btn"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
          >
            ⚙
          </button>
        </div>
      </header>

      <section className="weather-bar">
        {weatherLoading ? (
          <div className="weather-loading">Loading weather…</div>
        ) : (
          weatherDays.map((day) => (
            <div key={day.date} className="weather-day">
              <span className="weather-date">{formatDateKey(day.date)}</span>
              <span className="weather-temp">
                {Math.round(day.tempMax)}° / {Math.round(day.tempMin)}°
              </span>
              <span className="weather-desc">{weatherLabel(day.code)}</span>
            </div>
          ))
        )}
      </section>

      <main className="main">
        {loading && config.length > 0 && (
          <div className="loading-overlay">
            <span>Updating calendars…</span>
          </div>
        )}
        <DailyAgenda dateKey={selectedDay} events={agendaEvents} />
        <div className="week-grid">
          <div className="week-header">
            {weekDateKeys.map((dateKey) => (
              <button
                key={dateKey}
                type="button"
                className={`day-header ${dateKey === selectedDay ? 'day-header-selected' : ''}`}
                onClick={() => setSelectedDay(dateKey)}
              >
                <span className="day-name">{dayNameForDateKey(dateKey)}</span>
                <span className="day-date">{formatDateKey(dateKey)}</span>
              </button>
            ))}
          </div>
          <div className="week-body">
            {weekDateKeys.map((dateKey) => (
              <div key={dateKey} className="day-column">
                {(days.get(dateKey) || []).map((ev) => (
                  <div
                    key={ev.id}
                    className="event-card"
                    style={{ borderLeftColor: ev.color }}
                  >
                    <span className="event-time">
                      {ev.allDay ? 'All day' : `${formatTime(ev.start)}${ev.end ? ` – ${formatTime(ev.end)}` : ''}`}
                    </span>
                    <span className="event-title">{ev.title}</span>
                    {ev.location && <span className="event-location">{ev.location}</span>}
                    <span className="event-calendar" style={{ color: ev.color }}>
                      {ev.calendarName}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </main>

      {settingsOpen && (
        <Settings
          config={config}
          onSave={(next: CalendarConfig[]) => {
            updateConfig(next);
            setSettingsOpen(false);
          }}
          onClose={() => setSettingsOpen(false)}
          location={location}
          onLocationChange={handleLocationChange}
          keepScreenOn={keepScreenOn}
          onKeepScreenOnChange={handleKeepScreenOnChange}
        />
      )}
      </div>
    </div>
  );
}
