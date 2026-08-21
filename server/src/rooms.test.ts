import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { config } from "./config.js";
import { all, db, one } from "./db.js";
import { assignRoomGm, createRoom, deleteRoom } from "./rooms.js";
import { installToybox } from "./test-fixture.js";

installToybox();

const OUTGOING = 1;
const INCOMING = 2;
const PLAYER = 3;

beforeEach(() => {
  db.exec("DELETE FROM media; DELETE FROM group_hirelings; DELETE FROM memberships; DELETE FROM rooms;");
  db.exec("DELETE FROM characters; DELETE FROM accounts;");
  for (const [id, username, role] of [
    [OUTGOING, "Outgoing", "gm"],
    [INCOMING, "Incoming", "gm"],
    [PLAYER, "Player", "player"]
  ] as const)
    db.prepare(
      "INSERT INTO accounts (id, username, password_hash, is_admin, account_role) VALUES (?, ?, '', 0, ?)"
    ).run(id, username, role);
});

const make = (name = "The Tomb") => createRoom({ name, system: "toybox", theme: "grim", gmAccountId: OUTGOING });

const membership = (roomId: number, accountId: number) =>
  one<{ role: string; active_character_id: number | null }>(
    "SELECT role, active_character_id FROM memberships WHERE room_id = ? AND account_id = ?",
    roomId,
    accountId
  );

describe("making a room", () => {
  it("seats its GM and gives it the state row every room is read through", () => {
    const roomId = make();

    expect(one<{ created_by: number }>("SELECT created_by FROM rooms WHERE id = ?", roomId)?.created_by).toBe(OUTGOING);
    expect(membership(roomId, OUTGOING)?.role).toBe("gm");
    expect(one("SELECT room_id FROM room_state WHERE room_id = ?", roomId)).toBeTruthy();
  });

  it("leaves nothing behind when the room cannot be written", () => {
    expect(() =>
      createRoom({ name: "Nowhere", system: "no-such-system", theme: "grim", gmAccountId: OUTGOING })
    ).toThrow();
    expect(all("SELECT id FROM rooms")).toHaveLength(0);
  });
});

describe("handing a room to another GM", () => {
  it("seats the incoming GM, keeps the outgoing one at the table as a player, and moves the room with the chair", () => {
    const roomId = make();

    expect(assignRoomGm(roomId, INCOMING)).toEqual({ replaced: [OUTGOING] });
    expect(membership(roomId, INCOMING)?.role).toBe("gm");
    expect(membership(roomId, OUTGOING)?.role).toBe("player");
    expect(one<{ created_by: number }>("SELECT created_by FROM rooms WHERE id = ?", roomId)?.created_by).toBe(INCOMING);
  });

  it("puts down the character an incoming GM was playing", () => {
    const roomId = make();
    const characterId = Number(
      db
        .prepare("INSERT INTO characters (system, owner_account_id, name) VALUES ('toybox', ?, 'Bracken')")
        .run(INCOMING).lastInsertRowid
    );
    db.prepare(
      "INSERT INTO memberships (room_id, account_id, role, active_character_id) VALUES (?, ?, 'player', ?)"
    ).run(roomId, INCOMING, characterId);

    assignRoomGm(roomId, INCOMING);

    expect(membership(roomId, INCOMING)).toEqual({ role: "gm", active_character_id: null });
  });

  it("does nothing to a room its GM already runs", () => {
    const roomId = make();

    expect(assignRoomGm(roomId, OUTGOING)).toEqual({ replaced: [] });
    expect(membership(roomId, OUTGOING)?.role).toBe("gm");
  });
});

describe("deleting a room", () => {
  /** A file below the uploads directory, in the shape an upload leaves one. */
  function upload(storedName: string) {
    const uploads = path.join(config.dataDir, "uploads");
    fs.mkdirSync(uploads, { recursive: true });
    fs.writeFileSync(path.join(uploads, storedName), "x");
    return path.join(uploads, storedName);
  }

  it("takes its memberships and its uploaded files with it", () => {
    const roomId = make();
    db.prepare("INSERT INTO memberships (room_id, account_id, role) VALUES (?, ?, 'player')").run(roomId, PLAYER);
    const scene = upload("the-keep.png");
    const portrait = upload("linkboy.png");
    db.prepare(
      `INSERT INTO media (room_id, uploaded_by, kind, category, filename, stored_name, mime_type, size)
       VALUES (?, ?, 'scene', 'map', 'the-keep.png', 'the-keep.png', 'image/png', 1)`
    ).run(roomId, OUTGOING);
    db.prepare(
      "INSERT INTO group_hirelings (room_id, name, portrait_stored_name) VALUES (?, 'Linkboy', 'linkboy.png')"
    ).run(roomId);

    expect(deleteRoom(roomId)).toBe(true);
    expect(one("SELECT id FROM rooms WHERE id = ?", roomId)).toBeUndefined();
    expect(all("SELECT room_id FROM memberships WHERE room_id = ?", roomId)).toHaveLength(0);
    expect(fs.existsSync(scene)).toBe(false);
    expect(fs.existsSync(portrait)).toBe(false);
  });

  it("reports a room that was not there rather than pretending it deleted one", () => {
    expect(deleteRoom(9999)).toBe(false);
  });
});
