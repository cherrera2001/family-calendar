import { useState, useEffect } from 'react';
import type { CalendarConfig } from './types';
import { geocodeCity } from './hooks/useWeather';
import './Settings.css';

const PRESET_COLORS = [
  '#58a6ff',
  '#3fb950',
  '#d29922',
  '#db6d28',
  '#f85149',
  '#a371f7',
  '#bc8cff',
  '#79c0ff',
];

const REFRESH_OPTIONS = [1, 2, 5, 10, 15, 30, 60] as const;
const DEFAULT_REFRESH = 5;

function generateId(): string {
  return Math.random().toString(36).slice(2, 11);
}

interface SettingsProps {
  config: CalendarConfig[];
  onSave: (config: CalendarConfig[]) => void;
  onClose: () => void;
  location: { lat: number; lon: number; city?: string };
  onLocationChange: (lat: number, lon: number, city?: string) => void;
}

export function Settings({ config, onSave, onClose, location, onLocationChange }: SettingsProps) {
  const [calendars, setCalendars] = useState<CalendarConfig[]>([]);
  const [lat, setLat] = useState(String(location.lat));
  const [lon, setLon] = useState(String(location.lon));
  const [city, setCity] = useState(location.city ?? '');
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [cityLoading, setCityLoading] = useState(false);
  const [cityError, setCityError] = useState<string | null>(null);

  useEffect(() => {
    setCalendars(config.length ? [...config] : []);
    setLat(String(location.lat));
    setLon(String(location.lon));
    setCity(location.city ?? '');
  }, [config, location]);

  const useDeviceLocation = () => {
    if (!navigator.geolocation) {
      setLocationError('Location is not supported by this device');
      return;
    }
    setLocationError(null);
    setLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setLat(String(latitude));
        setLon(String(longitude));
        setCity(''); // device location doesn't set city name
        setCityError(null);
        onLocationChange(latitude, longitude);
        setLocationLoading(false);
      },
      (err) => {
        setLocationLoading(false);
        if (err.code === 1) {
          setLocationError('Location permission denied');
        } else if (err.code === 2) {
          setLocationError('Location unavailable');
        } else {
          setLocationError('Could not get location');
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
    );
  };

  const useCityLocation = async () => {
    const name = city.trim();
    if (name.length < 2) {
      setCityError('Enter at least 2 characters');
      return;
    }
    setCityError(null);
    setCityLoading(true);
    try {
      const result = await geocodeCity(name);
      if (result) {
        setLat(String(result.lat));
        setLon(String(result.lon));
        setCity(result.name); // use API's display name
        onLocationChange(result.lat, result.lon, result.name);
      } else {
        setCityError('City not found');
      }
    } catch {
      setCityError('Could not look up city');
    } finally {
      setCityLoading(false);
    }
  };

  const addCalendar = () => {
    setCalendars((prev) => [
      ...prev,
      {
        id: generateId(),
        name: '',
        url: '',
        color: PRESET_COLORS[prev.length % PRESET_COLORS.length],
        refreshMinutes: DEFAULT_REFRESH,
      },
    ]);
  };

  const updateCalendar = (id: string, patch: Partial<CalendarConfig>) => {
    setCalendars((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
    );
  };

  const removeCalendar = (id: string) => {
    setCalendars((prev) => prev.filter((c) => c.id !== id));
  };

  const handleSave = () => {
    const valid = calendars.filter((c) => c.name.trim() && c.url.trim());
    onSave(valid);
    const latNum = parseFloat(lat);
    const lonNum = parseFloat(lon);
    if (!Number.isNaN(latNum) && !Number.isNaN(lonNum)) {
      onLocationChange(latNum, lonNum, city.trim() || undefined);
    }
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <section className="settings-section">
          <h3>Calendars</h3>
          <p className="settings-hint">
            Add iCal subscription URLs (e.g. from Google Calendar, Outlook, or any .ics link).
          </p>
          {calendars.map((cal) => (
            <div key={cal.id} className="calendar-block">
              <div className="calendar-row">
                <input
                  type="color"
                  value={cal.color}
                  onChange={(e) => updateCalendar(cal.id, { color: e.target.value })}
                  className="color-picker"
                  title="Color"
                />
                <input
                  type="text"
                  placeholder="Calendar name"
                  value={cal.name}
                  onChange={(e) => updateCalendar(cal.id, { name: e.target.value })}
                  className="input name-input"
                />
                <input
                  type="text"
                  placeholder="https://… or webcal://… calendar URL"
                  value={cal.url}
                  onChange={(e) => updateCalendar(cal.id, { url: e.target.value })}
                  className="input url-input"
                />
                <button
                  type="button"
                  className="remove-btn"
                  onClick={() => removeCalendar(cal.id)}
                  aria-label="Remove"
                >
                  Remove
                </button>
              </div>
              <div className="calendar-row calendar-row-refresh">
                <label className="refresh-label">
                  <span>Refresh</span>
                  <select
                    className="input refresh-select"
                    value={cal.refreshMinutes ?? DEFAULT_REFRESH}
                    onChange={(e) =>
                      updateCalendar(cal.id, {
                        refreshMinutes: Number(e.target.value),
                      })
                    }
                    title="How often to refresh this calendar"
                  >
                    {REFRESH_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {m === 1 ? '1 min' : `${m} min`}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          ))}
          <button type="button" className="add-btn" onClick={addCalendar}>
            + Add calendar
          </button>
        </section>

        <section className="settings-section">
          <h3>Weather location</h3>
          <p className="settings-hint">
            Use your device location, search by city, or enter latitude and longitude.
          </p>
          <div className="location-buttons">
            <button
              type="button"
              className="location-btn"
              onClick={useDeviceLocation}
              disabled={locationLoading}
            >
              {locationLoading ? 'Getting…' : 'Use my location'}
            </button>
          </div>
          {locationError && (
            <p className="location-error">{locationError}</p>
          )}
          <div className="city-row">
            <label>
              <span>City</span>
              <input
                type="text"
                placeholder="e.g. London, New York"
                value={city}
                onChange={(e) => { setCity(e.target.value); setCityError(null); }}
                className="input city-input"
              />
            </label>
            <button
              type="button"
              className="location-btn"
              onClick={useCityLocation}
              disabled={cityLoading || !city.trim()}
            >
              {cityLoading ? 'Looking up…' : 'Use this city'}
            </button>
          </div>
          {cityError && (
            <p className="location-error">{cityError}</p>
          )}
          <div className="location-row">
            <label>
              <span>Latitude</span>
              <input
                type="number"
                step="any"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                className="input"
              />
            </label>
            <label>
              <span>Longitude</span>
              <input
                type="number"
                step="any"
                value={lon}
                onChange={(e) => setLon(e.target.value)}
                className="input"
              />
            </label>
          </div>
        </section>

        <div className="settings-footer">
          <button type="button" className="cancel-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="save-btn" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
