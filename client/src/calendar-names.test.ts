import { describe, expect, it } from "vitest";
import { splitCalendarNames } from "./CalendarModal";

describe("calendar name lists", () => {
  it("uses commas consistently and trims only the outside of each name", () => {
    expect(splitCalendarNames("  First Watch, High Summer  ,  Deep Night ")).toEqual([
      "First Watch",
      "High Summer",
      "Deep Night"
    ]);
  });

  it("ignores empty entries while a GM types another comma-separated name", () => {
    expect(splitCalendarNames("Monday, Tuesday,   ,")).toEqual(["Monday", "Tuesday"]);
  });
});
