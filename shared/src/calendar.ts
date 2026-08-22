import type { CalendarEvent, CalendarEventCadence, RoomCalendar } from "./index.js";

/** Zero-based day offset from the start of year 1 in this calendar's configured structure. */
export function calendarDayIndex(calendar: RoomCalendar, year: number, month: number, day: number) {
  const daysPerYear = calendar.monthNames.length * calendar.daysPerMonth;
  return (year - 1) * daysPerYear + month * calendar.daysPerMonth + day - 1;
}

export function calendarFirstWeekday(calendar: RoomCalendar, year: number, month: number) {
  const offset = calendarDayIndex(calendar, year, month, 1) % calendar.daysPerWeek;
  return (offset + calendar.daysPerWeek) % calendar.daysPerWeek;
}

/** The date a zero-based day offset falls on: the inverse of `calendarDayIndex`. */
export function calendarDateAt(calendar: RoomCalendar, index: number) {
  const daysPerYear = calendar.monthNames.length * calendar.daysPerMonth;
  const yearsElapsed = Math.floor(index / daysPerYear);
  const withinYear = index - yearsElapsed * daysPerYear;
  return {
    year: yearsElapsed + 1,
    month: Math.floor(withinYear / calendar.daysPerMonth),
    day: (withinYear % calendar.daysPerMonth) + 1
  };
}

/** The cadences a GM chooses between, in the order they are offered. */
export const CALENDAR_CADENCES: { value: CalendarEventCadence; label: string }[] = [
  { value: "once", label: "One-time" },
  { value: "holiday", label: "Holiday (yearly)" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every other week" },
  { value: "monthly", label: "Monthly" },
  { value: "interval", label: "Every X days" }
];

/**
 * How many days apart the occurrences of a counted event are. Every other week
 * is two of this calendar's own weeks rather than fourteen days: a five-day
 * week makes it ten, which is what "every other week" means to a room playing
 * on one.
 */
export function calendarEventPeriod(calendar: RoomCalendar, event: CalendarEvent) {
  if (event.cadence === "biweekly") return Math.max(1, 2 * calendar.daysPerWeek);
  const interval = Math.floor(event.intervalDays);
  return Number.isFinite(interval) ? Math.min(400, Math.max(1, interval)) : 1;
}

/** Whether an event counts its cycle from a date rather than falling on a named day. */
export function calendarEventIsCounted(event: CalendarEvent) {
  return event.cadence === "biweekly" || event.cadence === "interval";
}

/** The day offset a counted event's cycle passes through. */
export function calendarEventAnchor(calendar: RoomCalendar, event: CalendarEvent) {
  return calendarDayIndex(calendar, event.startYear ?? 1, event.month ?? 0, event.day);
}

/** Whether an event's run begins on the day at this offset, before its length is considered. */
function eventBeginsAt(calendar: RoomCalendar, event: CalendarEvent, index: number) {
  if (event.cadence === "once") {
    const date = calendarDateAt(calendar, index);
    return event.day === date.day && (event.month ?? 0) === date.month && (event.startYear ?? 1) === date.year;
  }
  if (calendarEventIsCounted(event)) {
    // Counted in both directions from the anchor, so a cycle anchored to next
    // year is already running this one rather than starting out of nothing.
    const period = calendarEventPeriod(calendar, event);
    const since = index - calendarEventAnchor(calendar, event);
    return ((since % period) + period) % period === 0;
  }
  if (event.cadence === "weekly") {
    const week = calendar.daysPerWeek;
    return event.day === (((index % week) + week) % week) + 1;
  }
  const date = calendarDateAt(calendar, index);
  if (event.cadence === "monthly") return event.day === date.day;
  return event.day === date.day && (event.month ?? 0) === date.month;
}

/**
 * How many days an event runs. A length that cannot be read as a number counts
 * as a single day: an event saved by a build that had no such field, or by one
 * that dropped it in passing, belongs on its own day rather than on none at all.
 */
export function calendarEventDays(event: CalendarEvent) {
  const days = Math.floor(event.durationDays);
  return Number.isFinite(days) ? Math.min(400, Math.max(1, days)) : 1;
}

/**
 * Why an event can never happen, where it never can. An event is placed by the
 * day it falls on — of the week for a weekly one, of the month otherwise — so a
 * day past the end of that span matches nothing and the event is simply absent.
 * Worth saying out loud rather than leaving to be noticed: the calendar has
 * nowhere to draw it, and a silent absence reads as a fault in the calendar.
 * A week or a month shortened under events already written does this too.
 */
export function calendarEventNever(calendar: RoomCalendar, event: CalendarEvent) {
  const weekly = event.cadence === "weekly";
  const span = weekly ? calendar.daysPerWeek : calendar.daysPerMonth;
  if (event.day >= 1 && event.day <= span) return undefined;
  return `A ${weekly ? "week" : "month"} is ${span} days long, so there is no day ${event.day} for this to fall on. It never happens.`;
}

/** One day of an event that is running, and how far into its run that day is. */
export interface CalendarEventOccurrence {
  event: CalendarEvent;
  /** One-based day within the run: 1 on the day it starts, its length on the last. */
  dayOfRun: number;
}

/**
 * The events running on a day. An event is placed by where its run *started*,
 * so a three-day festival appears on all three of its days — including the ones
 * that fall in the month after it began.
 */
export function calendarEventsOn(
  calendar: RoomCalendar,
  year: number,
  month: number,
  day: number
): CalendarEventOccurrence[] {
  const index = calendarDayIndex(calendar, year, month, day);
  const running: CalendarEventOccurrence[] = [];
  for (const event of calendar.events) {
    // Counted backwards from the day itself, so an event long enough to still
    // be running from an earlier start is drawn once, on the nearer of the two.
    const days = calendarEventDays(event);
    for (let elapsed = 0; elapsed < days; elapsed += 1) {
      if (eventBeginsAt(calendar, event, index - elapsed)) {
        running.push({ event, dayOfRun: elapsed + 1 });
        break;
      }
    }
  }
  return running;
}

/**
 * The calendar as a given reader may see it. A hidden event is the GM's own
 * note about what is coming, so it is taken out before the calendar leaves the
 * server rather than sent to a player and drawn over.
 */
export function calendarForRole(calendar: RoomCalendar, role: "gm" | "player"): RoomCalendar {
  if (role === "gm") return calendar;
  return { ...calendar, events: calendar.events.filter((event) => !event.hidden) };
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

/** Advance exactly one configured part of the day, rolling dates as needed. */
export function advanceCalendar(value: RoomCalendar): RoomCalendar {
  const calendar = { ...value };
  if (calendar.segment + 1 < calendar.segmentsPerDay) {
    calendar.segment += 1;
    return calendar;
  }

  calendar.segment = 0;
  calendar.day += 1;
  if (calendar.day > calendar.daysPerMonth) {
    calendar.day = 1;
    calendar.month += 1;
    if (calendar.month >= calendar.monthNames.length) {
      calendar.month = 0;
      calendar.year += 1;
    }
  }
  return calendar;
}
