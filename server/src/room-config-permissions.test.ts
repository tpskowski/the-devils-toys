import { beforeEach, describe, expect, it } from "vitest";
import type { AuthAccount } from "./auth.js";
import { db } from "./db.js";
import { configurableRoom, configurableRooms, roomAccessRole, roomConfigAccess } from "./room-config-permissions.js";
import { installToybox } from "./test-fixture.js";

installToybox();

function account(id: number, username: string, role: AuthAccount["role"]): AuthAccount {
  return { id, username, role, isAdmin: role === "admin" };
}

const admin = account(1, "Admin", "admin");
const owningGm = account(2, "OwningGM", "gm");
const otherGm = account(3, "OtherGM", "gm");
const player = account(4, "Player", "player");

let ownedRoom = 0;
let otherRoom = 0;
let archivedRoom = 0;

beforeEach(() => {
  db.exec("DELETE FROM memberships; DELETE FROM rooms; DELETE FROM accounts;");
  for (const person of [admin, owningGm, otherGm, player])
    db.prepare(
      "INSERT INTO accounts (id, username, password_hash, is_admin, account_role) VALUES (?, ?, '', ?, ?)"
    ).run(person.id, person.username, person.isAdmin ? 1 : 0, person.role);

  const createRoom = (name: string, createdBy: number, archived: number) =>
    Number(
      db
        .prepare("INSERT INTO rooms (name, system, theme, archived, created_by) VALUES (?, 'toybox', 'grim', ?, ?)")
        .run(name, archived, createdBy).lastInsertRowid
    );
  ownedRoom = createRoom("Owned", owningGm.id, 0);
  otherRoom = createRoom("Other", otherGm.id, 0);
  archivedRoom = createRoom("Archived", owningGm.id, 1);

  const join = (roomId: number, accountId: number, role: "gm" | "player") =>
    db.prepare("INSERT INTO memberships (room_id, account_id, role) VALUES (?, ?, ?)").run(roomId, accountId, role);
  join(ownedRoom, owningGm.id, "gm");
  join(ownedRoom, player.id, "player");
  join(archivedRoom, owningGm.id, "gm");
  join(otherRoom, otherGm.id, "gm");
  // The one case a membership role alone would get wrong: a GM-level account
  // sitting in someone else's room as a player.
  join(otherRoom, owningGm.id, "player");
});

describe("who may configure a room", () => {
  it("lets a GM configure the rooms they are GM of", () => {
    expect(roomConfigAccess(owningGm, ownedRoom)).toBe("gm");
    expect(roomConfigAccess(owningGm, archivedRoom)).toBe("gm");
  });

  it("refuses a GM a room they are only a player in", () => {
    expect(roomConfigAccess(owningGm, otherRoom)).toBeUndefined();
  });

  it("refuses a player every room, including their own", () => {
    expect(roomConfigAccess(player, ownedRoom)).toBeUndefined();
    expect(roomConfigAccess(player, otherRoom)).toBeUndefined();
  });

  it("lets an admin configure any room without belonging to it", () => {
    expect(roomConfigAccess(admin, ownedRoom)).toBe("admin");
    expect(roomConfigAccess(admin, otherRoom)).toBe("admin");
    expect(roomConfigAccess(admin, archivedRoom)).toBe("admin");
  });

  it("refuses a room that does not exist, to everyone", () => {
    const missing = archivedRoom + 1000;
    expect(roomConfigAccess(admin, missing)).toBeUndefined();
    expect(roomConfigAccess(owningGm, missing)).toBeUndefined();
  });

  it("refuses an id that is not a room id", () => {
    for (const id of [0, -1, 1.5, Number.NaN]) {
      expect(roomConfigAccess(admin, id)).toBeUndefined();
      expect(roomConfigAccess(owningGm, id)).toBeUndefined();
    }
  });
});

describe("the rooms the selector lists", () => {
  it("gives a GM their own rooms, archived ones included and marked", () => {
    const rooms = configurableRooms(owningGm);
    expect(rooms.map((room) => room.name)).toEqual(["Owned", "Archived"]);
    expect(rooms.every((room) => room.access === "gm")).toBe(true);
    expect(rooms.find((room) => room.name === "Archived")?.archived).toBe(true);
  });

  it("does not list a room a GM is only a player in", () => {
    expect(configurableRooms(owningGm).map((room) => room.name)).not.toContain("Other");
  });

  it("gives an admin every room", () => {
    const rooms = configurableRooms(admin);
    expect(rooms.map((room) => room.name).sort()).toEqual(["Archived", "Other", "Owned"]);
    expect(rooms.every((room) => room.access === "admin")).toBe(true);
  });

  it("gives a player nothing", () => {
    expect(configurableRooms(player)).toEqual([]);
  });

  it("orders live rooms before archived ones", () => {
    expect(configurableRooms(admin).map((room) => room.archived)).toEqual([false, false, true]);
  });
});

describe("the role a room's own routes see", () => {
  it("gives a member their membership role", () => {
    expect(roomAccessRole(owningGm, ownedRoom)).toBe("gm");
    expect(roomAccessRole(player, ownedRoom)).toBe("player");
  });

  it("keeps a GM a player in someone else's room", () => {
    // The case a role check alone gets wrong, and the reason this is not just
    // "is the account a GM": being GM-level does not carry across rooms.
    expect(roomAccessRole(owningGm, otherRoom)).toBe("player");
  });

  it("treats an admin who is not a member as the room's GM", () => {
    expect(roomAccessRole(admin, ownedRoom)).toBe("gm");
    expect(roomAccessRole(admin, otherRoom)).toBe("gm");
  });

  it("treats an admin who plays in a room as its GM there too", () => {
    // Deliberate: an admin reaches every room, and one answer that holds on
    // every screen beats a narrower one that changes with the caller.
    db.prepare("INSERT INTO memberships (room_id, account_id, role) VALUES (?, ?, 'player')").run(otherRoom, admin.id);
    expect(roomAccessRole(admin, otherRoom)).toBe("gm");
  });

  it("gives a player no more than their membership anywhere", () => {
    expect(roomAccessRole(player, ownedRoom)).toBe("player");
    expect(roomAccessRole(player, otherRoom)).toBeUndefined();
  });

  it("gives nobody a role in a room that does not exist", () => {
    expect(roomAccessRole(admin, archivedRoom + 1000)).toBeUndefined();
    expect(roomAccessRole(player, archivedRoom + 1000)).toBeUndefined();
  });
});

describe("one configurable room", () => {
  it("carries the room's feature switches and the footing it was reached on", () => {
    db.prepare("UPDATE rooms SET calendar_enabled = 1, music_enabled = 1 WHERE id = ?").run(ownedRoom);
    expect(configurableRoom(owningGm, ownedRoom)).toMatchObject({
      id: ownedRoom,
      name: "Owned",
      system: "toybox",
      calendarEnabled: true,
      musicEnabled: true,
      mapNotationEnabled: false,
      access: "gm"
    });
    expect(configurableRoom(admin, ownedRoom)?.access).toBe("admin");
  });

  it("is undefined wherever access is", () => {
    expect(configurableRoom(player, ownedRoom)).toBeUndefined();
    expect(configurableRoom(owningGm, otherRoom)).toBeUndefined();
  });
});
