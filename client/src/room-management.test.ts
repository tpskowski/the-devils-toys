import { describe, expect, it } from "vitest";
import {
  playsInRoom,
  roomCastSummary,
  roomDeletionArmed,
  seatableGms,
  type ManagedRoomRecord
} from "./room-management";

const room = (over: Partial<ManagedRoomRecord> = {}): ManagedRoomRecord => ({
  id: 1,
  name: "The Moss-Covered Door",
  system: "toybox",
  theme: "grim",
  archived: false,
  gm: { id: 7, username: "marrow-keeper" },
  players: [{ id: 9, username: "bracken" }],
  ...over
});

describe("arming a room's deletion", () => {
  it("takes the room's name, whatever whitespace came with it", () => {
    expect(roomDeletionArmed("  The Moss-Covered Door ", "The Moss-Covered Door")).toBe(true);
  });

  it("stays disarmed for anything else, including nothing at all", () => {
    expect(roomDeletionArmed("the moss-covered door", "The Moss-Covered Door")).toBe(false);
    expect(roomDeletionArmed("", "The Moss-Covered Door")).toBe(false);
    expect(roomDeletionArmed("", "")).toBe(false);
  });
});

describe("what a room's row says", () => {
  it("names its GM and counts its table", () => {
    expect(roomCastSummary(room())).toBe("marrow-keeper · 1 player");
    expect(roomCastSummary(room({ players: [] }))).toBe("marrow-keeper · 0 players");
  });

  it("says so when nobody runs it", () => {
    expect(roomCastSummary(room({ gm: null }))).toBe("No GM · 1 player");
  });
});

describe("the room's cast", () => {
  it("knows who already plays in it", () => {
    expect(playsInRoom(room(), 9)).toBe(true);
    expect(playsInRoom(room(), 7)).toBe(false);
  });
});

describe("who may be offered the GM chair", () => {
  const candidates = [
    { id: 7, username: "marrow-keeper", role: "gm" as const },
    { id: 8, username: "admin", role: "admin" as const },
    { id: 9, username: "bracken", role: "player" as const }
  ];

  it("leaves out player accounts the server would refuse", () => {
    expect(seatableGms(candidates, room()).map((candidate) => candidate.id)).toEqual([7, 8]);
  });

  it("keeps whoever holds the chair, so the control can still show them", () => {
    const held = room({ gm: { id: 9, username: "bracken" } });
    expect(seatableGms(candidates, held).map((candidate) => candidate.id)).toEqual([7, 8, 9]);
  });
});
