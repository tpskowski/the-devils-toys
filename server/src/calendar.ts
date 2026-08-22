import { z } from "zod";
import type { RoomCalendar } from "@devils-toys/shared";
export { advanceCalendar } from "@devils-toys/shared";

const calendarEventSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(100),
  cadence: z.enum(["once", "holiday", "weekly", "biweekly", "monthly", "interval"]),
  day: z.number().int().min(1).max(400),
  month: z.number().int().min(0).max(99).optional(),
  startYear: z.number().int().min(-99999).max(99999).optional(),
  intervalDays: z.number().int().min(1).max(400),
  durationDays: z.number().int().min(1).max(400),
  hidden: z.boolean()
});

/**
 * An event as it was written before one could run for days, be kept from the
 * players, or count its cycle from a date.
 *
 * A biweekly event used to fall on a weekday, on whichever alternating weeks
 * counting from year one happened to produce. It now counts from a date, so one
 * written the old way is given the anchor that reproduces exactly the series it
 * already had: the first day of the calendar that its old rule fired on, which
 * is day `weekday` of the opening month. Both readings then agree on every day
 * for ever, and the GM can move the anchor to choose a different phase — the
 * thing the old rule gave them no way to say.
 */
function calendarEventInput(value: unknown, daysPerWeek: number) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const event = value as Record<string, unknown>;
  const legacyBiweekly = event.cadence === "biweekly" && !("startYear" in event);
  return {
    ...event,
    // Day is left exactly as it was: read as a day of the opening month it
    // lands on the same offset the weekday rule fired on first, so the series
    // is unchanged. A weekday that was past the end of the week — and so never
    // happened at all — becomes an ordinary day of the month, and starts.
    ...(legacyBiweekly ? { startYear: 1, month: 0 } : {}),
    ...("intervalDays" in event ? {} : { intervalDays: daysPerWeek }),
    ...("durationDays" in event ? {} : { durationDays: 1 }),
    ...("hidden" in event ? {} : { hidden: false })
  };
}

/**
 * A calendar written by an older build read as one this build understands. It
 * matters more here than elsewhere: a calendar that fails to parse is replaced
 * by the default, so a field a room never had would cost it every month it
 * named and every holiday on it.
 *
 * Older calendars used the number of segment names as the number of parts in a
 * day. Preserve that intent while moving the count into its own setting.
 */
export function calendarInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const segmentNames = Array.isArray(record.segmentNames) ? record.segmentNames : [];
  const daysPerWeek = typeof record.daysPerWeek === "number" && record.daysPerWeek >= 1 ? record.daysPerWeek : 7;
  return {
    ...record,
    ...("segmentsPerDay" in record ? {} : { segmentsPerDay: Math.max(1, segmentNames.length) }),
    ...("revision" in record ? {} : { revision: 0 }),
    ...(Array.isArray(record.events)
      ? { events: record.events.map((event) => calendarEventInput(event, daysPerWeek)) }
      : {})
  };
}

export const calendarSchema = z.object({
  revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  year: z.number().int().min(-99999).max(99999),
  month: z.number().int().min(0).max(99),
  day: z.number().int().min(1).max(400),
  segmentsPerDay: z.number().int().min(1).max(100),
  segment: z.number().int().min(0).max(99),
  daysPerWeek: z.number().int().min(1).max(20),
  daysPerMonth: z.number().int().min(1).max(400),
  dayNames: z.array(z.string().trim().min(1).max(40)).min(1).max(20),
  monthNames: z.array(z.string().trim().min(1).max(40)).min(1).max(100),
  segmentNames: z.array(z.string().trim().min(1).max(40)).max(100),
  events: z.array(calendarEventSchema).max(500)
});

export function defaultCalendar(): RoomCalendar {
  return {
    revision: 0,
    year: 1,
    month: 0,
    day: 1,
    segmentsPerDay: 1,
    segment: 0,
    daysPerWeek: 7,
    daysPerMonth: 30,
    dayNames: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    monthNames: [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December"
    ],
    segmentNames: [],
    events: []
  };
}

export function normalizeCalendar(calendar: RoomCalendar): RoomCalendar {
  return {
    ...calendar,
    month: calendar.month % calendar.monthNames.length,
    day: Math.min(calendar.day, calendar.daysPerMonth),
    segment: calendar.segment % calendar.segmentsPerDay
  };
}

export function readCalendar(value: string | null): RoomCalendar {
  if (!value) return defaultCalendar();
  try {
    const parsed = calendarSchema.safeParse(calendarInput(JSON.parse(value)));
    return parsed.success ? normalizeCalendar(parsed.data) : defaultCalendar();
  } catch {
    return defaultCalendar();
  }
}
