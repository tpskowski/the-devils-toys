import type { RoomCalendar } from "./index.js";

/** Zero-based day offset from the start of year 1 in this calendar's configured structure. */
export function calendarDayIndex(calendar: RoomCalendar, year: number, month: number, day: number) {
  const daysPerYear = calendar.monthNames.length * calendar.daysPerMonth;
  return (year - 1) * daysPerYear + month * calendar.daysPerMonth + day - 1;
}

export function calendarFirstWeekday(calendar: RoomCalendar, year: number, month: number) {
  const offset = calendarDayIndex(calendar, year, month, 1) % calendar.daysPerWeek;
  return (offset + calendar.daysPerWeek) % calendar.daysPerWeek;
}

export function calendarDayIsPast(calendar: RoomCalendar, year: number, month: number, day: number) {
  return (
    calendarDayIndex(calendar, year, month, day) <
    calendarDayIndex(calendar, calendar.year, calendar.month, calendar.day)
  );
}

/** Fraction of the current day that has elapsed, from zero through less than one. */
export function calendarDayProgress(calendar: RoomCalendar) {
  if (calendar.segmentsPerDay <= 1) return 0;
  return Math.max(0, Math.min(1, calendar.segment / calendar.segmentsPerDay));
}

export function calendarSegmentLabel(calendar: RoomCalendar, segment = calendar.segment) {
  const position = `${segment + 1} of ${calendar.segmentsPerDay}`;
  const name = calendar.segmentNames[segment];
  return name ? `${name} · ${position}` : `Segment ${position}`;
}

function ordinal(value: number) {
  const remainder = value % 100;
  if (remainder >= 11 && remainder <= 13) return `${value}th`;
  if (value % 10 === 1) return `${value}st`;
  if (value % 10 === 2) return `${value}nd`;
  if (value % 10 === 3) return `${value}rd`;
  return `${value}th`;
}

export function calendarNowMessage(calendar: RoomCalendar) {
  const date = `${calendar.monthNames[calendar.month]} ${ordinal(calendar.day)}, ${calendar.year}`;
  if (calendar.segmentsPerDay <= 1) return `It is now ${date}.`;
  const segment =
    calendar.segmentNames[calendar.segment] ?? `segment ${calendar.segment + 1} of ${calendar.segmentsPerDay}`;
  return `It is now ${segment}, ${date}.`;
}
