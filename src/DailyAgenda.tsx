import { useState, useEffect, useRef, useCallback } from 'react';
import type { CalendarEvent } from './types';
import './DailyAgenda.css';

const HOUR_START = 6;
const HOUR_END = 24; // 6am–midnight (24 = end of 11:30pm slot)
const ROW_HEIGHT_PX = 32;
const SLOTS_PER_HOUR = 2;
const BOUNCE_BACK_MS = 20_000;
const NOW_VIEW_OFFSET_RATIO = 0.25; // keep now line at 25% from top when focusing

/** Continuous slot number: 7:30 = 19.5, 9:00 = 21. */
function timeToSlot(d: Date): number {
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

function isToday(dateKey: string): boolean {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return dateKey === `${y}-${m}-${day}`;
}

/** Top position in px for a given time within the agenda timeline (6–24). */
function timeToTopPx(slot: number): number {
  const clamped = Math.max(HOUR_START, Math.min(HOUR_END, slot));
  return (clamped - HOUR_START) * SLOTS_PER_HOUR * ROW_HEIGHT_PX;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatSlotLabel(slot: number): string {
  const hour = Math.floor(slot);
  const isHalf = slot % 1 !== 0;
  if (hour === 12) return isHalf ? '12:30pm' : '12pm';
  if (hour < 12) return isHalf ? `${hour}:30am` : `${hour}am`;
  if (hour === 24) return '12am';
  const h = hour - 12;
  return isHalf ? `${h}:30pm` : `${h}pm`;
}

function formatAgendaDate(dateKey: string): string {
  const d = new Date(dateKey + 'T12:00:00');
  const today = new Date();
  const isToday =
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();
  if (isToday) return 'Today';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

interface DailyAgendaProps {
  dateKey: string;
  events: CalendarEvent[];
}

export function DailyAgenda({ dateKey, events }: DailyAgendaProps) {
  const allDay = events.filter((e) => e.allDay);
  const timed = events.filter((e) => !e.allDay);

  const slots: number[] = [];
  for (let h = HOUR_START; h < HOUR_END; h++) {
    slots.push(h);
    slots.push(h + 0.5);
  }

  const totalHeightPx = (HOUR_END - HOUR_START) * SLOTS_PER_HOUR * ROW_HEIGHT_PX;

  const [nowTopPx, setNowTopPx] = useState<number | null>(() => {
    if (!isToday(dateKey)) return null;
    return timeToTopPx(timeToSlot(new Date()));
  });

  useEffect(() => {
    if (!isToday(dateKey)) {
      setNowTopPx(null);
      return;
    }
    const update = () => setNowTopPx(timeToTopPx(timeToSlot(new Date())));
    update();
    const id = setInterval(update, 60_000); // update every minute
    return () => clearInterval(id);
  }, [dateKey]);

  const timelineRef = useRef<HTMLDivElement>(null);
  const bounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevDateKeyRef = useRef(dateKey);
  const [showScrollbar, setShowScrollbar] = useState(false);

  const scrollToNow = useCallback(() => {
    const el = timelineRef.current;
    if (!el || nowTopPx == null) return;
    const { clientHeight, scrollHeight } = el;
    const targetScrollTop = nowTopPx - clientHeight * NOW_VIEW_OFFSET_RATIO;
    const clamped = Math.max(0, Math.min(scrollHeight - clientHeight, targetScrollTop));
    el.scrollTo({ top: clamped, behavior: 'smooth' });
  }, [nowTopPx]);

  // When switching to today: scroll to keep current time in view (once per switch)
  useEffect(() => {
    if (!isToday(dateKey) || nowTopPx == null) return;
    const justSwitchedToToday = prevDateKeyRef.current !== dateKey;
    prevDateKeyRef.current = dateKey;
    if (justSwitchedToToday) {
      const id = requestAnimationFrame(() => scrollToNow());
      return () => cancelAnimationFrame(id);
    }
  }, [dateKey, nowTopPx, scrollToNow]);

  // Scroll handler: show scrollbar, schedule bounce-back
  const handleScroll = useCallback(() => {
    setShowScrollbar(true);
    if (bounceTimeoutRef.current) clearTimeout(bounceTimeoutRef.current);
    bounceTimeoutRef.current = setTimeout(() => {
      bounceTimeoutRef.current = null;
      if (isToday(dateKey) && nowTopPx != null) scrollToNow();
      setShowScrollbar(false);
    }, BOUNCE_BACK_MS);
  }, [dateKey, nowTopPx, scrollToNow]);

  useEffect(() => {
    return () => {
      if (bounceTimeoutRef.current) clearTimeout(bounceTimeoutRef.current);
    };
  }, []);

  function eventTopPx(d: Date): number {
    return timeToTopPx(timeToSlot(d));
  }

  function eventHeightPx(start: Date, end: Date): number {
    const startSlot = timeToSlot(start);
    const endSlot = timeToSlot(end);
    const durationHours = Math.max(0.5, endSlot - startSlot); // at least half an hour
    return durationHours * SLOTS_PER_HOUR * ROW_HEIGHT_PX;
  }

  return (
    <aside className="daily-agenda">
      <h2 className="agenda-title">{formatAgendaDate(dateKey)}</h2>

      {allDay.length > 0 && (
        <div className="agenda-section agenda-allday">
          <div className="agenda-hour-label">All day</div>
          <div className="agenda-hour-events">
            {allDay.map((ev) => (
              <div
                key={ev.id}
                className="agenda-event"
                style={{ borderLeftColor: ev.color }}
              >
                <span className="agenda-event-title">{ev.title}</span>
                {ev.location && (
                  <span className="agenda-event-location">{ev.location}</span>
                )}
                <span className="agenda-event-calendar" style={{ color: ev.color }}>
                  {ev.calendarName}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div
        ref={timelineRef}
        className={`agenda-timeline${showScrollbar ? ' agenda-timeline-scrolled' : ''}`}
        style={{ height: totalHeightPx }}
        onScroll={handleScroll}
      >
        {nowTopPx != null && nowTopPx >= 0 && nowTopPx <= totalHeightPx && (
          <div
            className="agenda-now-line"
            style={{ top: nowTopPx }}
            aria-hidden
          />
        )}
        <div
          className="agenda-timeline-grid"
          style={{ height: totalHeightPx }}
          aria-hidden
        >
          {slots.map((slot) => (
            <div
              key={slot}
              className={slot % 1 === 0 ? 'agenda-grid-line-solid' : 'agenda-grid-line-dashed'}
              style={{ height: ROW_HEIGHT_PX }}
            />
          ))}
        </div>
        <div className="agenda-timeline-labels">
          {slots.map((slot) => (
            <div key={slot} className="agenda-hour-row" style={{ minHeight: ROW_HEIGHT_PX }}>
              <div className="agenda-hour-label">{formatSlotLabel(slot)}</div>
            </div>
          ))}
        </div>
        <div
          className="agenda-timeline-events"
          style={{ height: totalHeightPx }}
        >
          {timed.map((ev) => (
            <div
              key={ev.id}
              className="agenda-event agenda-event-span"
              style={{
                borderLeftColor: ev.color,
                top: eventTopPx(ev.start),
                height: eventHeightPx(ev.start, ev.end),
              }}
            >
              <span className="agenda-event-time">
                {formatTime(ev.start)}
                {ev.end ? ` – ${formatTime(ev.end)}` : ''}
              </span>
              <span className="agenda-event-title">{ev.title}</span>
              {ev.location && (
                <span className="agenda-event-location">{ev.location}</span>
              )}
              <span className="agenda-event-calendar" style={{ color: ev.color }}>
                {ev.calendarName}
              </span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
