import { describe, expect, it } from "vitest";
import {
  calendarDateAt,
  calendarDayIndex,
  calendarDayIsPast,
  calendarDayProgress,
  calendarEventNever,
  calendarEventPeriod,
  calendarEventsOn,
  calendarFirstWeekday,
  calendarForRole,
  calendarNowMessage,
  type CalendarEvent
} from "@devils-toys/shared";
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

function event(overrides: Partial<CalendarEvent> & Pick<CalendarEvent, "id" | "cadence" | "day">): CalendarEvent {
  return { name: overrides.id, intervalDays: 7, durationDays: 1, hidden: false, ...overrides };
}

/** The ids running on a day, so a test reads as the calendar page does. */
function running(calendar: Parameters<typeof calendarEventsOn>[0], month: number, day: number) {
  return calendarEventsOn(calendar, calendar.year, month, day).map(({ event: on, dayOfRun }) => `${on.id}:${dayOfRun}`);
}

describe("calendar events over days", () => {
  it("reverses a day offset back into the date it came from", () => {
    const calendar = defaultCalendar();
    for (const [year, month, day] of [
      [1, 0, 1],
      [1, 11, 30],
      [7, 4, 17]
    ]) {
      expect(calendarDateAt(calendar, calendarDayIndex(calendar, year, month, day))).toEqual({ year, month, day });
    }
  });

  it("puts a one-day event on its own day and nothing around it", () => {
    const calendar = { ...defaultCalendar(), events: [event({ id: "feast", cadence: "holiday", month: 0, day: 9 })] };
    expect(running(calendar, 0, 8)).toEqual([]);
    expect(running(calendar, 0, 9)).toEqual(["feast:1"]);
    expect(running(calendar, 0, 10)).toEqual([]);
  });

  it("runs a multi-day event across every day of its length", () => {
    const calendar = {
      ...defaultCalendar(),
      events: [event({ id: "fair", cadence: "holiday", month: 0, day: 9, durationDays: 3 })]
    };
    expect(running(calendar, 0, 8)).toEqual([]);
    expect(running(calendar, 0, 9)).toEqual(["fair:1"]);
    expect(running(calendar, 0, 10)).toEqual(["fair:2"]);
    expect(running(calendar, 0, 11)).toEqual(["fair:3"]);
    expect(running(calendar, 0, 12)).toEqual([]);
  });

  it("carries a run that began in the month before into the month it ends in", () => {
    const calendar = {
      ...defaultCalendar(),
      events: [event({ id: "thaw", cadence: "holiday", month: 0, day: 29, durationDays: 4 })]
    };
    expect(running(calendar, 0, 30)).toEqual(["thaw:2"]);
    expect(running(calendar, 1, 1)).toEqual(["thaw:3"]);
    expect(running(calendar, 1, 2)).toEqual(["thaw:4"]);
    expect(running(calendar, 1, 3)).toEqual([]);
  });

  it("draws an event still running from two starts once, on the nearer of them", () => {
    // Market day is every seventh day and lasts nine, so from the second market
    // on it is always running from both. It belongs on the page once.
    const calendar = {
      ...defaultCalendar(),
      events: [event({ id: "market", cadence: "weekly", day: 1, durationDays: 9 })]
    };
    expect(running(calendar, 0, 1)).toEqual(["market:1"]);
    expect(running(calendar, 0, 8)).toEqual(["market:1"]);
    expect(running(calendar, 0, 9)).toEqual(["market:2"]);
  });

  it("keeps a weekly event on every one of the weekdays it falls on", () => {
    const calendar = { ...defaultCalendar(), events: [event({ id: "watch", cadence: "weekly", day: 3 })] };
    expect(running(calendar, 0, 3)).toEqual(["watch:1"]);
    expect(running(calendar, 0, 10)).toEqual(["watch:1"]);
    expect(running(calendar, 0, 17)).toEqual(["watch:1"]);
  });

  it("keeps an event whose length cannot be read, on the one day it started", () => {
    // What an older server does to a calendar it is sent: it drops the fields
    // it has never heard of. The event must still be on the page.
    const stripped = { id: "vigil", name: "Vigil", cadence: "weekly", day: 1 } as unknown as CalendarEvent;
    const calendar = { ...defaultCalendar(), events: [stripped] };
    expect(running(calendar, 0, 1)).toEqual(["vigil:1"]);
    expect(running(calendar, 0, 2)).toEqual([]);
  });

  it("runs a biweekly event of a full week on, and the week after off", () => {
    const calendar = {
      ...defaultCalendar(),
      events: [event({ id: "vigil", cadence: "biweekly", startYear: 1, month: 0, day: 1, durationDays: 7 })]
    };
    expect(running(calendar, 0, 1)).toEqual(["vigil:1"]);
    expect(running(calendar, 0, 7)).toEqual(["vigil:7"]);
    expect(running(calendar, 0, 8)).toEqual([]);
    expect(running(calendar, 0, 14)).toEqual([]);
    expect(running(calendar, 0, 15)).toEqual(["vigil:1"]);
  });

  it("reads an event saved before it could run for days or be hidden as a plain single day", () => {
    const legacy = defaultCalendar() as unknown as Record<string, unknown>;
    legacy.events = [{ id: "feast", name: "Feast", cadence: "holiday", month: 0, day: 4 }];

    expect(readCalendar(JSON.stringify(legacy)).events).toEqual([
      {
        id: "feast",
        name: "Feast",
        cadence: "holiday",
        month: 0,
        day: 4,
        intervalDays: 7,
        durationDays: 1,
        hidden: false
      }
    ]);
  });
});

describe("an event counted from a date", () => {
  it("puts every other week two of this calendar's weeks apart, not fourteen days", () => {
    const fortnight = event({ id: "n", cadence: "biweekly", day: 1 });
    expect(calendarEventPeriod({ ...defaultCalendar(), daysPerWeek: 5 }, fortnight)).toBe(10);
    expect(calendarEventPeriod(defaultCalendar(), fortnight)).toBe(14);
  });

  it("runs every other week from the day the GM anchored it to", () => {
    const calendar = {
      ...defaultCalendar(),
      events: [event({ id: "night", cadence: "biweekly", startYear: 1, month: 0, day: 11, durationDays: 7 })]
    };
    const on = Array.from({ length: 30 }, (_, i) => i + 1).filter((day) => running(calendar, 0, day).length);
    // Days 1 to 3 are the tail of the cycle before this one, which began in the
    // month before: the run is placed by where it started, not by where it is.
    expect(on).toEqual([1, 2, 3, 11, 12, 13, 14, 15, 16, 17, 25, 26, 27, 28, 29, 30]);
  });

  it("moves the whole cycle when the anchor moves, which the old rule could not do", () => {
    const anchored = (day: number) => {
      const events = [event({ id: "n", cadence: "biweekly", startYear: 1, month: 0, day })];
      const calendar = { ...defaultCalendar(), events };
      return Array.from({ length: 30 }, (_, i) => i + 1).filter((d) => running(calendar, 0, d).length);
    };
    expect(anchored(4)).toEqual([4, 18]);
    expect(anchored(11)).toEqual([11, 25]);
  });

  it("counts backwards from an anchor the game has not reached yet", () => {
    const calendar = {
      ...defaultCalendar(),
      events: [event({ id: "later", cadence: "biweekly", startYear: 2, month: 0, day: 1 })]
    };
    // The anchor is a day the cycle passes through rather than the day it
    // begins, so the same fortnights are already running the year before it.
    const on = Array.from({ length: 30 }, (_, i) => i + 1).filter((day) => running(calendar, 0, day).length);
    expect(on).toEqual([11, 25]);
  });

  it("repeats every X days for an interval event", () => {
    const calendar = {
      ...defaultCalendar(),
      events: [event({ id: "tithe", cadence: "interval", startYear: 1, month: 0, day: 5, intervalDays: 10 })]
    };
    const on = Array.from({ length: 30 }, (_, i) => i + 1).filter((day) => running(calendar, 0, day).length);
    expect(on).toEqual([5, 15, 25]);
  });

  it("carries an interval cycle across the end of a month and a year", () => {
    const calendar = {
      ...defaultCalendar(),
      events: [event({ id: "tithe", cadence: "interval", startYear: 1, month: 11, day: 25, intervalDays: 10 })]
    };
    expect(running(calendar, 11, 25)).toEqual(["tithe:1"]);
    expect(calendarEventsOn(calendar, 2, 0, 5).map((o) => o.event.id)).toEqual(["tithe"]);
  });

  it("keeps a biweekly event written before it counted from a date on the very same days", () => {
    const legacy = defaultCalendar() as unknown as Record<string, unknown>;
    legacy.events = [{ id: "watch", name: "Watch", cadence: "biweekly", day: 3 }];
    const migrated = readCalendar(JSON.stringify(legacy));
    expect(migrated.events[0]).toMatchObject({ cadence: "biweekly", startYear: 1, month: 0, day: 3 });

    // The rule it used to be placed by: this weekday, on alternating weeks.
    const oldRule = (day: number) => {
      const index = calendarDayIndex(migrated, 1, 0, day);
      return index % 7 === 2 && Math.floor(index / 7) % 2 === 0;
    };
    for (let day = 1; day <= 30; day += 1) expect(running(migrated, 0, day).length > 0).toBe(oldRule(day));
  });

  it("starts a biweekly event whose weekday was past the end of the week", () => {
    // The event that never happened: day 15 of a seven-day week. Read as a day
    // of the month it is an ordinary anchor, so it runs instead of vanishing.
    const legacy = defaultCalendar() as unknown as Record<string, unknown>;
    legacy.events = [{ id: "night", name: "Night", cadence: "biweekly", day: 15, durationDays: 7 }];
    const migrated = readCalendar(JSON.stringify(legacy));
    expect(calendarEventNever(migrated, migrated.events[0])).toBeUndefined();
    expect(running(migrated, 0, 15)).toEqual(["night:1"]);
    expect(running(migrated, 0, 29)).toEqual(["night:1"]);
  });
});

describe("an event that can never happen", () => {
  const calendar = defaultCalendar();

  it("says so for a weekday past the end of the week, and draws nothing", () => {
    // The real one: a biweekly event given a day of the month by mistake. Its
    // day is checked against the week, which has no fifteenth day.
    const night = event({ id: "night", cadence: "weekly", day: 15, durationDays: 7 });
    expect(calendarEventNever(calendar, night)).toBe(
      "A week is 7 days long, so there is no day 15 for this to fall on. It never happens."
    );
    const month = { ...calendar, events: [night] };
    expect(Array.from({ length: 30 }, (_, i) => running(month, 0, i + 1).length)).toEqual(Array(30).fill(0));
  });

  it("says so for a day past the end of the month", () => {
    expect(calendarEventNever(calendar, event({ id: "late", cadence: "monthly", day: 31 }))).toContain("no day 31");
  });

  it("catches an event a shortened week left with nowhere to fall", () => {
    const wide = { ...calendar, daysPerWeek: 10 };
    const ninth = event({ id: "tenday", cadence: "weekly", day: 9 });
    expect(calendarEventNever(wide, ninth)).toBeUndefined();
    expect(calendarEventNever({ ...wide, daysPerWeek: 7 }, ninth)).toContain("no day 9");
  });

  it("stays quiet about every event that does happen", () => {
    for (const cadence of ["holiday", "weekly", "biweekly", "monthly", "interval"] as const) {
      const day = cadence === "weekly" ? 7 : 30;
      expect(calendarEventNever(calendar, event({ id: cadence, cadence, day }))).toBeUndefined();
    }
  });
});

describe("calendar events a player may see", () => {
  const calendar = {
    ...defaultCalendar(),
    events: [
      event({ id: "market", cadence: "weekly", day: 1 }),
      event({ id: "ambush", cadence: "holiday", month: 0, day: 12, hidden: true })
    ]
  };

  it("gives the GM the calendar whole", () => {
    expect(calendarForRole(calendar, "gm").events.map((on) => on.id)).toEqual(["market", "ambush"]);
  });

  it("takes a hidden event out of a player's calendar rather than marking it", () => {
    expect(calendarForRole(calendar, "player").events.map((on) => on.id)).toEqual(["market"]);
  });

  it("leaves the calendar it was given untouched", () => {
    calendarForRole(calendar, "player");
    expect(calendar.events).toHaveLength(2);
  });
});
