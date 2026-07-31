import { describe, expect, it } from "vitest";
import { db } from "./db.js";
import {
  CALENDAR_STRICT_TIME_EGG_ID,
  CALENDAR_STRICT_TIME_EGG_MESSAGE,
  MAP_NOTATION_ROAD_EGG_ID,
  MAP_NOTATION_ROAD_EGG_MESSAGE,
  claimRoomEasterEgg
} from "./easter-eggs.js";

describe("room easter eggs", () => {
  it("claims an easter egg only once per room", () => {
    db.prepare(
      "INSERT INTO accounts (id, username, password_hash, account_role) VALUES (1, 'Warden', 'hash', 'gm')"
    ).run();
    db.prepare(
      "INSERT INTO rooms (id, name, system, theme, created_by) VALUES (1, 'Campaign', 'cairn', 'used', 1)"
    ).run();

    expect(claimRoomEasterEgg(1, CALENDAR_STRICT_TIME_EGG_ID)).toBe(true);
    expect(claimRoomEasterEgg(1, CALENDAR_STRICT_TIME_EGG_ID)).toBe(false);
    expect(claimRoomEasterEgg(1, MAP_NOTATION_ROAD_EGG_ID)).toBe(true);
    expect(claimRoomEasterEgg(1, MAP_NOTATION_ROAD_EGG_ID)).toBe(false);
  });

  it("keeps the strict-time quotation exact", () => {
    expect(CALENDAR_STRICT_TIME_EGG_MESSAGE).toBe(
      '"YOU CAN NOT HAVE A MEANINGFUL CAMPAIGN IF STRICT TIME RECORDS ARE NOT KEPT."\n- Gary Gygax'
    );
  });

  it("keeps the map-notation quotation exact", () => {
    expect(MAP_NOTATION_ROAD_EGG_MESSAGE).toBe(
      "\"It's a dangerous business, Frodo, going out your door. " +
        "You step onto the road, and if you don't keep your feet, " +
        "there's no knowing where you might be swept off to.\"\n" +
        "- J.R.R. Tolkien"
    );
  });
});
