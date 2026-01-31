import { useState, useEffect } from 'react';
import type { WeatherDay } from '../types';

const STORAGE_KEY = 'hallway-calendar-weather-location';
const defaultLat = 51.5074;
const defaultLon = -0.1278;

export interface StoredLocation {
  lat: number;
  lon: number;
  city?: string;
}

export function getStoredLocation(): StoredLocation {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (typeof data.lat === 'number' && typeof data.lon === 'number') {
        return {
          lat: data.lat,
          lon: data.lon,
          city: typeof data.city === 'string' ? data.city : undefined,
        };
      }
    }
  } catch (_) {}
  return { lat: defaultLat, lon: defaultLon };
}

export function setStoredLocation(lat: number, lon: number, city?: string) {
  const data: StoredLocation = { lat, lon };
  if (city?.trim()) data.city = city.trim();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// Canadian province / territory codes -> ISO country code
const CANADA_PROVINCES = new Set(['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT']);
// US state codes (common 2-letter) -> ISO country code
const US_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME',
  'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA',
  'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
]);

function parseCityInput(input: string): { city: string; countryCode?: string } {
  const trimmed = input.trim();
  const commaIdx = trimmed.indexOf(',');
  if (commaIdx === -1) return { city: trimmed };
  const city = trimmed.slice(0, commaIdx).trim();
  const region = trimmed.slice(commaIdx + 1).trim().toUpperCase();
  if (!region || !city) return { city: trimmed };
  if (CANADA_PROVINCES.has(region)) return { city, countryCode: 'CA' };
  if (US_STATES.has(region)) return { city, countryCode: 'US' };
  return { city: trimmed };
}

async function fetchGeocoding(name: string, countryCode?: string): Promise<{ results: unknown[] }> {
  const params = new URLSearchParams({ name, count: '5' });
  if (countryCode) params.set('countryCode', countryCode);
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
  const data = await res.json();
  return data;
}

/** Geocode a city name to lat/lon using Open-Meteo (free, no API key). */
export async function geocodeCity(
  cityName: string
): Promise<{ lat: number; lon: number; name: string } | null> {
  const parsed = parseCityInput(cityName);
  const { city, countryCode } = parsed;
  if (city.length < 2) return null;

  // Try with parsed city + country first (e.g. "Calgary" + CA for "Calgary, AB")
  let data = await fetchGeocoding(city, countryCode);
  let results = data.results;
  // If no results and we had a comma, try full string without country
  if ((!Array.isArray(results) || results.length === 0) && cityName !== city) {
    data = await fetchGeocoding(cityName.trim(), undefined);
    results = data.results;
  }
  // If still nothing, try city only without country
  if (!Array.isArray(results) || results.length === 0) {
    data = await fetchGeocoding(city, undefined);
    results = data.results;
  }

  if (!Array.isArray(results) || results.length === 0) return null;
  const first = results[0] as { latitude: number; longitude: number; name?: string };
  return {
    lat: Number(first.latitude),
    lon: Number(first.longitude),
    name: first.name ?? city,
  };
}

export function useWeather(locationOverride?: StoredLocation | null) {
  const [days, setDays] = useState<WeatherDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loc = locationOverride ?? getStoredLocation();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&daily=temperature_2m_max,temperature_2m_min,weathercode&timezone=auto&forecast_days=7`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(data.reason || 'Unknown error');
          return;
        }
        const daily = data.daily;
        const result: WeatherDay[] = (daily.time as string[]).slice(0, 7).map((date: string, i: number) => ({
          date,
          tempMax: (daily.temperature_2m_max as number[])[i] ?? 0,
          tempMin: (daily.temperature_2m_min as number[])[i] ?? 0,
          code: (daily.weathercode as number[])[i] ?? 0,
        }));
        setDays(result);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message || 'Failed to load weather');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [loc.lat, loc.lon]);

  return { days, loading, error };
}

// WMO weather code -> short label
export function weatherLabel(code: number): string {
  const map: Record<number, string> = {
    0: 'Clear',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Foggy',
    48: 'Foggy',
    51: 'Drizzle',
    53: 'Drizzle',
    55: 'Drizzle',
    61: 'Rain',
    63: 'Rain',
    65: 'Heavy rain',
    71: 'Snow',
    73: 'Snow',
    75: 'Heavy snow',
    77: 'Snow',
    80: 'Showers',
    81: 'Showers',
    82: 'Heavy showers',
    85: 'Snow showers',
    86: 'Snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm',
    99: 'Thunderstorm',
  };
  return map[code] ?? 'Unknown';
}
