import { z } from "zod";
import type { RoomCalendar } from "@devils-toys/shared";
export { advanceCalendar } from "@devils-toys/shared";

const calendarEventSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(100),
  cadence: z.enum(["holiday", "weekly", "biweekly", "monthly"]),
  day: z.number().int().min(1).max(400),
  month: z.number().int().min(0).max(99).optional()
});

/**
 * Older calendars used the number of segment names as the number of parts in a
 * day. Preserve that intent while moving the count into its own setting.
 */
export function calendarInput(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value) || "segmentsPerDay" in value) return value;
  const record = value as Record<string, unknown>;
  const segmentNames = Array.isArray(record.segmentNames) ? record.segmentNames : [];
  return { ...record, segmentsPerDay: Math.max(1, segmentNames.length) };
}

export const calendarSchema = z.object({
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
