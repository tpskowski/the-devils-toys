import { beforeEach, describe, expect, it } from "vitest";
import {
  effectiveRules,
  hasRuleFeature,
  movedRules,
  switchableRules,
  type SystemOptionalRule
} from "@devils-toys/shared";
import { db } from "./db.js";
import { roomHasFeature, roomRules, setRoomRules, storedRoomRules, systemRules } from "./system-rules.js";
import { installToybox } from "./test-fixture.js";

installToybox();

let roomId = 0;

beforeEach(() => {
  db.exec("DELETE FROM room_system_rules; DELETE FROM rooms; DELETE FROM accounts;");
  db.prepare("INSERT INTO accounts (id, username, password_hash, account_role) VALUES (1, 'GM', '', 'gm')").run();
  roomId = Number(
    db.prepare("INSERT INTO rooms (name, system, theme, created_by) VALUES ('Table', 'toybox', 'grim', 1)").run()
      .lastInsertRowid
  );
});

const offered: SystemOptionalRule[] = [
  { id: "tags", label: "Tags", feature: "tags", default: false },
  { id: "labels", label: "Labels", feature: "tags", default: true }
];

const demanded: SystemOptionalRule[] = [{ id: "tags", label: "Tags", feature: "tags", default: true, required: true }];

describe("where a room stands on its system's optional rules", () => {
  it("starts every rule where the system put it", () => {
    expect(effectiveRules(offered, {})).toEqual({ tags: false, labels: true });
  });

  it("takes the room's own setting over the default", () => {
    expect(effectiveRules(offered, { tags: true, labels: false })).toEqual({ tags: true, labels: false });
  });

  it("keeps a required rule on however the room was recorded", () => {
    expect(effectiveRules(demanded, { tags: false })).toEqual({ tags: true });
  });

  it("drops a setting recorded against a rule the system no longer declares", () => {
    expect(effectiveRules(offered, { retired: true })).toEqual({ tags: false, labels: true });
  });

  it("offers no switch for a rule the system requires", () => {
    expect(switchableRules(demanded)).toEqual([]);
    expect(switchableRules(offered).map((rule) => rule.id)).toEqual(["tags", "labels"]);
  });

  it("sends back only the switches a panel actually moved", () => {
    const room = effectiveRules(offered, {});
    expect(movedRules(offered, room, room)).toEqual({});
    expect(movedRules(offered, room, { ...room, tags: true })).toEqual({ tags: true });
  });

  it("counts a switch put back where it started as not moved", () => {
    // Saving the theme with every switch untouched must record nothing, or a
    // rule nobody touched stops following the default the system may change.
    const room = effectiveRules(offered, { tags: true });
    expect(movedRules(offered, room, { tags: true, labels: true })).toEqual({});
    expect(movedRules(offered, room, { tags: false, labels: true })).toEqual({ tags: false });
  });

  it("never moves a rule the system requires, whatever a panel sends", () => {
    expect(movedRules(demanded, { tags: true }, { tags: false })).toEqual({});
  });

  it("has a feature when any rule naming it is on", () => {
    expect(hasRuleFeature(offered, { labels: false }, "tags")).toBe(false);
    expect(hasRuleFeature(offered, {}, "tags")).toBe(true);
    expect(hasRuleFeature([], {}, "tags")).toBe(false);
  });
});

describe("a room's recorded settings", () => {
  it("reads the fixture's own rules back with nothing recorded", () => {
    expect(systemRules("toybox").map((rule) => rule.id)).toEqual(["tags"]);
    expect(storedRoomRules(roomId)).toEqual({});
    expect(roomRules(roomId, "toybox")).toEqual({ tags: false });
    expect(roomHasFeature(roomId, "tags")).toBe(false);
  });

  it("switches a rule on and off again", () => {
    expect(setRoomRules(roomId, "toybox", { tags: true })).toBeUndefined();
    expect(roomHasFeature(roomId, "tags")).toBe(true);
    setRoomRules(roomId, "toybox", { tags: false });
    // Recorded as off rather than forgotten, so a default that changes later
    // does not quietly switch it back on.
    expect(storedRoomRules(roomId)).toEqual({ tags: false });
    expect(roomHasFeature(roomId, "tags")).toBe(false);
  });

  it("refuses a rule the system never declared, and writes nothing", () => {
    expect(setRoomRules(roomId, "toybox", { hexcrawl: true })?.error).toContain("hexcrawl");
    expect(storedRoomRules(roomId)).toEqual({});
  });

  it("moves neither rule when one of the two is refused", () => {
    expect(setRoomRules(roomId, "toybox", { tags: true, hexcrawl: true })?.error).toContain("hexcrawl");
    expect(storedRoomRules(roomId)).toEqual({});
  });

  it("has no feature at all in a room that does not exist", () => {
    expect(roomHasFeature(roomId + 500, "tags")).toBe(false);
  });
});
