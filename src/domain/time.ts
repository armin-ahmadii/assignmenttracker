import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

const DAY_MS = 86_400_000;

export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** Calendar day of `date` in `tz`, as `YYYY-MM-DD`. */
export function dayKey(date: Date | string | number, tz: string): string {
  return formatInTimeZone(toDate(date), tz, 'yyyy-MM-dd');
}

/** Days since the epoch for a `YYYY-MM-DD` key; zone-free, so differences are exact calendar days. */
export function dayNumber(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function keyFromDayNumber(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function addDaysToKey(key: string, days: number): string {
  return keyFromDayNumber(dayNumber(key) + days);
}

/** Calendar days from `from` to `to`, both read in `tz`. */
export function calendarDaysBetween(from: Date, to: Date, tz: string): number {
  return dayNumber(dayKey(to, tz)) - dayNumber(dayKey(from, tz));
}

/** Weekday (0 = Sunday) of a `YYYY-MM-DD` key. */
export function weekdayOfKey(key: string): number {
  return new Date(dayNumber(key) * DAY_MS).getUTCDay();
}

/** Wall-clock date + time in `tz` → UTC instant. */
export function zonedToUtc(dateKey: string, time: string, tz: string): Date {
  return fromZonedTime(`${dateKey}T${time}:00`, tz);
}

/** "9:00 am", "11:59 pm" */
export function formatTime(date: Date | string, tz: string): string {
  return formatInTimeZone(toDate(date), tz, 'h:mm aaa');
}

/** `HH:mm` wall-clock time of an instant in `tz`, for time inputs. */
export function timeKey(date: Date | string, tz: string): string {
  return formatInTimeZone(toDate(date), tz, 'HH:mm');
}

export function formatDay(date: Date | string, tz: string, pattern = 'EEE, MMM d'): string {
  return formatInTimeZone(toDate(date), tz, pattern);
}

/** Format a `YYYY-MM-DD` key without any zone shifting. */
export function formatDayKey(key: string, pattern = 'EEE, MMM d'): string {
  return formatInTimeZone(new Date(dayNumber(key) * DAY_MS), 'UTC', pattern);
}

function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

export const END_OF_DAY = '23:59';
