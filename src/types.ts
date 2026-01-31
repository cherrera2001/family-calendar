export interface CalendarConfig {
  id: string;
  name: string;
  url: string;
  color: string;
  /** Refresh interval in minutes. Default 5 if not set. */
  refreshMinutes?: number;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  calendarId: string;
  calendarName: string;
  color: string;
  location?: string;
}

export interface DayEvents {
  date: string; // YYYY-MM-DD
  events: CalendarEvent[];
}

export interface WeatherDay {
  date: string;
  tempMax: number;
  tempMin: number;
  code: number;
  summary?: string;
}
