import { describe, expect, it } from "vitest";
import { calendarDayIsPast, calendarDayProgress, calendarFirstWeekday, calendarNowMessage } from "@devils-toys/shared";
import { advanceCalendar, defaultCalendar, normalizeCalendar, readCalendar } from "./calendar.js";

describe("room calendar day segments", () => {
  it("defaults to one segment and advances one full day per click", () => {
    const calendar = defaultCalendar();
    expect(calendar.segmentsPerDay).toBe(1);
    expect(advanceCalendar(calendar)).toMatchObject({ day: 2, segment: 0 });
  });

  it("advances through each configured segment before advancing the day", () => {
    const calendar = { ...defaultCalendar(), segmentsPerDay: 3 };
    const second = advanceCalendar(calendar);
    const third = advanceCalendar(second);
    const tomorrow = advanceCalendar(third);

    expect(second).toMatchObject({ day: 1, segment: 1 });
    expect(third).toMatchObject({ day: 1, segment: 2 });
    expect(tomorrow).toMatchObject({ day: 2, segment: 0 });
  });

  it("rolls the final segment across month and year boundaries", () => {
    const calendar = {
      ...defaultCalendar(),
      year: 8,
      month: 11,
      day: 30,
      segmentsPerDay: 3,
      segment: 2
    };
    expect(advanceCalendar(calendar)).toMatchObject({ year: 9, month: 0, day: 1, segment: 0 });
  });

  it("normalizes the current segment when the GM lowers the segment count", () => {
    expect(normalizeCalendar({ ...defaultCalendar(), segmentsPerDay: 2, segment: 2 }).segment).toBe(0);
  });

  it("preserves segment behavior from calendars saved before the count setting existed", () => {
    const legacy = defaultCalendar() as unknown as Record<string, unknown>;
    delete legacy.segmentsPerDay;
    delete legacy.revision;
    legacy.segmentNames = ["Morning", "Afternoon", "Night"];

    expect(readCalendar(JSON.stringify(legacy))).toMatchObject({
      revision: 0,
      segmentsPerDay: 3,
      segmentNames: ["Morning", "Afternoon", "Night"]
    });
  });

  it("identifies past days across month and year boundaries", () => {
    const calendar = { ...defaultCalendar(), year: 2, month: 1, day: 4 };
    expect(calendarDayIsPast(calendar, 2, 1, 3)).toBe(true);
    expect(calendarDayIsPast(calendar, 2, 1, 4)).toBe(false);
    expect(calendarDayIsPast(calendar, 1, 11, 30)).toBe(true);
    expect(calendarDayIsPast(calendar, 2, 2, 1)).toBe(false);
  });

  it("accounts for the selected year when positioning a month", () => {
    const calendar = { ...defaultCalendar(), daysPerWeek: 7, daysPerMonth: 30, monthNames: ["One", "Two"] };
    expect(calendarFirstWeekday(calendar, 1, 0)).toBe(0);
    expect(calendarFirstWeekday(calendar, 2, 0)).toBe(4);
  });

  it("reports fractional progress through the current day", () => {
    expect(calendarDayProgress({ ...defaultCalendar(), segmentsPerDay: 2, segment: 1 })).toBe(0.5);
    expect(calendarDayProgress({ ...defaultCalendar(), segmentsPerDay: 3, segment: 1 })).toBeCloseTo(1 / 3);
    expect(calendarDayProgress({ ...defaultCalendar(), segmentsPerDay: 4, segment: 3 })).toBe(0.75);
  });

  it("formats the advanced date and segment for chat", () => {
    expect(calendarNowMessage({ ...defaultCalendar(), day: 2 })).toBe("It is now January 2nd, 1.");
    expect(
      calendarNowMessage({
        ...defaultCalendar(),
        year: 2534,
        month: 7,
        day: 26,
        segmentsPerDay: 3,
        segment: 1,
        segmentNames: ["morning", "midday", "night"]
      })
    ).toBe("It is now midday, August 26th, 2534.");
  });

  it("uses correct ordinal suffixes and a fallback for unnamed segments", () => {
    expect(
      calendarNowMessage({
        ...defaultCalendar(),
        year: 42,
        day: 11,
        segmentsPerDay: 4,
        segment: 2
      })
    ).toBe("It is now segment 3 of 4, January 11th, 42.");
    expect(calendarNowMessage({ ...defaultCalendar(), day: 21 })).toBe("It is now January 21st, 1.");
  });
});
