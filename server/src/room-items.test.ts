import { beforeEach, describe, expect, it } from "vitest";
import { itemId } from "@devils-toys/shared";
import { characterItemsFor } from "./character-items.js";
import { db } from "./db.js";
import {
  applyRoomOverlay,
  isRoomItemId,
  itemBelongsToRoom,
  readRoomItem,
  restoreForRoom,
  retireForRoom,
  roomItemId,
  writeRoomItem
} from "./room-items.js";
import { installToybox } from "./test-fixture.js";

installToybox();

let roomId = 0;

beforeEach(() => {
  db.exec("DELETE FROM room_items; DELETE FROM room_retired_items; DELETE FROM rooms; DELETE FROM accounts;");
  db.prepare("INSERT INTO accounts (id, username, password_hash, account_role) VALUES (1, 'GM', '', 'gm')").run();
  roomId = Number(
    db.prepare("INSERT INTO rooms (name, system, theme, created_by) VALUES ('Table', 'toybox', 'grim', 1)").run()
      .lastInsertRowid
  );
});

const listKey = () => Object.keys(characterItemsFor("toybox"))[0];

describe("a room's own gear", () => {
  it("leaves the system's catalogue exactly as it is when there is no room", () => {
    expect(characterItemsFor("toybox")).toEqual(applyRoomOverlay(characterItemsFor("toybox"), undefined));
  });

  it("adds an item to the list it names", () => {
    const key = listKey();
    const item = readRoomItem("toybox", roomId, {
      listKey: key,
      name: "Bone Saw",
      spec: "D6",
      detail: "",
      cost: "5",
      category: ""
    });
    writeRoomItem(roomId, 1, key, item);
    const resolved = characterItemsFor("toybox", roomId);
    expect(resolved[key].map((entry) => entry.name)).toContain("Bone Saw");
    expect(characterItemsFor("toybox")[key].map((entry) => entry.name)).not.toContain("Bone Saw");
  });

  it("takes a retired entry out of the pickers and leaves the system's catalogue alone", () => {
    const key = listKey();
    const victim = characterItemsFor("toybox")[key][0];
    retireForRoom(roomId, victim.id);
    expect(characterItemsFor("toybox", roomId)[key].map((entry) => entry.id)).not.toContain(victim.id);
    // The book's own catalogue is untouched, which is what makes this per-room.
    expect(characterItemsFor("toybox")[key].map((entry) => entry.id)).toContain(victim.id);
    // And another room never asked for it to go.
    const other = Number(
      db.prepare("INSERT INTO rooms (name, system, theme, created_by) VALUES ('Other', 'toybox', 'grim', 1)").run()
        .lastInsertRowid
    );
    expect(characterItemsFor("toybox", other)[key].map((entry) => entry.id)).toContain(victim.id);
  });

  it("restores a retired entry", () => {
    const key = listKey();
    const victim = characterItemsFor("toybox")[key][0];
    retireForRoom(roomId, victim.id);
    expect(restoreForRoom(roomId, victim.id)).toBe(true);
    expect(characterItemsFor("toybox", roomId)[key].map((entry) => entry.id)).toContain(victim.id);
    expect(restoreForRoom(roomId, victim.id)).toBe(false);
  });

  it("mints ids the system's own scheme cannot produce, so the two can never collide", () => {
    const mine = roomItemId(roomId, "Bone Saw", "D6");
    expect(isRoomItemId(mine)).toBe(true);
    expect(itemBelongsToRoom(roomId, mine)).toBe(true);
    expect(itemBelongsToRoom(roomId + 1, mine)).toBe(false);
    const fromBook = itemId("toybox", "Bone Saw", "D6");
    expect(mine).not.toBe(fromBook.base);
    expect(mine).not.toBe(fromBook.qualified);
    // Nothing the book can name starts with this room's prefix.
    expect(fromBook.qualified.startsWith("room:")).toBe(false);
  });

  it("reads a room's weapon on the same terms the book's weapons are read", () => {
    const key = listKey();
    const weapon = readRoomItem("toybox", roomId, {
      listKey: key,
      name: "Bone Saw",
      spec: "D6, bulky",
      detail: "",
      cost: "5",
      category: ""
    });
    expect(weapon).toMatchObject({ weapon: true, damage: "D6", bulky: true });
    expect(weapon.traits).toContain("bulky");
    expect(weapon.label).toBe("Bone Saw (D6, bulky)");

    // A die that counts something is not damage, exactly as the book's parser has it.
    const notAWeapon = readRoomItem("toybox", roomId, {
      listKey: key,
      name: "Field Rations",
      spec: "3 uses",
      detail: "",
      cost: "1",
      category: ""
    });
    expect(notAWeapon.weapon).toBe(false);
    expect(notAWeapon.damage).toBeUndefined();
  });

  it("retires a room's own item too, not only the book's", () => {
    const key = listKey();
    const item = readRoomItem("toybox", roomId, {
      listKey: key,
      name: "Bone Saw",
      spec: "",
      detail: "",
      cost: "",
      category: ""
    });
    writeRoomItem(roomId, 1, key, item);
    retireForRoom(roomId, item.id);
    expect(characterItemsFor("toybox", roomId)[key].map((entry) => entry.id)).not.toContain(item.id);
  });

  it("goes with the room, because the rows belong to it", () => {
    const key = listKey();
    const item = readRoomItem("toybox", roomId, {
      listKey: key,
      name: "Bone Saw",
      spec: "",
      detail: "",
      cost: "",
      category: ""
    });
    writeRoomItem(roomId, 1, key, item);
    retireForRoom(roomId, characterItemsFor("toybox")[key][0].id);
    db.prepare("DELETE FROM rooms WHERE id = ?").run(roomId);
    expect(db.prepare("SELECT id FROM room_items WHERE room_id = ?").all(roomId)).toEqual([]);
    expect(db.prepare("SELECT item_id FROM room_retired_items WHERE room_id = ?").all(roomId)).toEqual([]);
  });
});
