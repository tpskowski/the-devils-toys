import { describe, expect, it } from "vitest";
import {
  isRoomConfigPath,
  roomConfigPath,
  roomIdFromConfigSearch,
  sectionFromHash,
  sectionStorageKey
} from "./room-config";

describe("room config addresses", () => {
  it("links to the selector when there is no room", () => {
    expect(roomConfigPath()).toBe("/config");
  });

  it("carries the room and the section when there are both", () => {
    expect(roomConfigPath(12)).toBe("/config?room=12");
    expect(roomConfigPath(12, "npcs")).toBe("/config?room=12#npcs");
    expect(roomConfigPath(undefined, "library")).toBe("/config#library");
  });

  it("recognises its own path and nothing else", () => {
    expect(isRoomConfigPath("/config")).toBe(true);
    expect(isRoomConfigPath("/config/")).toBe(true);
    expect(isRoomConfigPath("/")).toBe(false);
    expect(isRoomConfigPath("/rules/cairn")).toBe(false);
    expect(isRoomConfigPath("/configuration")).toBe(false);
    expect(isRoomConfigPath("/config/npcs")).toBe(false);
  });

  it("reads the room out of the query", () => {
    expect(roomIdFromConfigSearch("?room=7")).toBe(7);
    expect(roomIdFromConfigSearch("?room=7&other=1")).toBe(7);
  });

  it("treats a room parameter that is not a room id as absent", () => {
    for (const search of ["", "?room=", "?room=0", "?room=-3", "?room=1.5", "?room=nine", "?other=1"])
      expect(roomIdFromConfigSearch(search)).toBeUndefined();
  });

  it("accepts only section names this build has", () => {
    expect(sectionFromHash("#npcs")).toBe("npcs");
    expect(sectionFromHash("hirelings")).toBe("hirelings");
    expect(sectionFromHash("#nowhere")).toBeUndefined();
    expect(sectionFromHash("")).toBeUndefined();
  });

  it("remembers a section per room", () => {
    expect(sectionStorageKey(3)).not.toBe(sectionStorageKey(4));
  });
});
