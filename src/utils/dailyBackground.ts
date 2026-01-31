/**
 * Returns a background image URL based on today's weather when available.
 * Uses Picsum Photos with a seed (date + weather code) so the same image shows
 * for the same day and weather, and images load reliably without API keys.
 */

function weatherCodeToSeedSuffix(code: number): string {
  if (code === 0 || code === 1) return 'clear';
  if (code === 2) return 'clouds';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 55) return 'drizzle';
  if ((code >= 61 && code <= 65) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return 'snow';
  if (code >= 95 && code <= 99) return 'storm';
  return 'clouds';
}

/**
 * Get background image URL from today's date and optional weather code.
 * Seed = date + weather so image is stable per day and varies by weather.
 */
export function getDailyBackgroundUrl(
  dateStr: string,
  weatherCode?: number
): string {
  const seed =
    weatherCode !== undefined
      ? `${dateStr}-${weatherCodeToSeedSuffix(weatherCode)}`
      : dateStr;
  return `https://picsum.photos/seed/${seed}/1920/1080`;
}
