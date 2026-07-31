import { db } from "./db.js";

export const CALENDAR_STRICT_TIME_EGG_ID = "calendar-strict-time-records";
export const CALENDAR_STRICT_TIME_EGG_MESSAGE =
  '"YOU CAN NOT HAVE A MEANINGFUL CAMPAIGN IF STRICT TIME RECORDS ARE NOT KEPT."\n- Gary Gygax';

// Map-notation easter egg for the shared room-surprise registry.
export const MAP_NOTATION_ROAD_EGG_ID = "map-notation-dangerous-business";
export const MAP_NOTATION_ROAD_EGG_MESSAGE =
  "\"It's a dangerous business, Frodo, going out your door. " +
  "You step onto the road, and if you don't keep your feet, " +
  "there's no knowing where you might be swept off to.\"\n" +
  "- J.R.R. Tolkien";

/**
 * Easter-egg ledger: stable IDs make each surprise a once-per-room event and
 * leave one shared place to register the additional easter eggs planned later.
 */
export function claimRoomEasterEgg(roomId: number, eggId: string) {
  const result = db
    .prepare("INSERT OR IGNORE INTO room_easter_eggs (room_id, egg_id) VALUES (?, ?)")
    .run(roomId, eggId);
  return Boolean(result.changes);
}
