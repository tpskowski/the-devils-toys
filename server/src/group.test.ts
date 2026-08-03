import { beforeEach, describe, expect, it } from "vitest";
import { all, db, one } from "./db.js";
import { groupStateSchema, parseGroupState } from "./group.js";
import { nextSortOrder, publicHireling, reorderRows, staleWrite, type SheetRow } from "./group-rows.js";

let roomId = 0;

beforeEach(() => {
  db.exec("DELETE FROM group_hirelings; DELETE FROM group_assets; DELETE FROM group_obligations;");
  db.exec("DELETE FROM rooms; DELETE FROM accounts;");
  db.prepare("INSERT INTO accounts (id, username, password_hash, account_role) VALUES (1, 'GM', '', 'gm')").run();
  roomId = Number(
    db.prepare("INSERT INTO rooms (name, system, theme, created_by) VALUES ('Table', 'monolith', 'grim', 1)").run()
      .lastInsertRowid
  );
});

function addHireling(name: string, sheet: Record<string, unknown> = {}) {
  return Number(
    db
      .prepare("INSERT INTO group_hirelings (room_id, name, sort_order, sheet_json) VALUES (?, ?, ?, ?)")
      .run(roomId, name, nextSortOrder("group_hirelings", roomId), JSON.stringify(sheet)).lastInsertRowid
  );
}

describe("the group's own fields", () => {
  it("keeps valid shared fields and repairs malformed stored JSON", () => {
    expect(parseGroupState('{"creed":"Owe nothing"}')).toEqual({ creed: "Owe nothing" });
    expect(parseGroupState("not-json")).toEqual({});
    expect(parseGroupState("[]")).toEqual({});
  });

  it("accepts object documents and rejects oversized data", () => {
    expect(groupStateSchema.safeParse({ creed: "Owe nothing" }).success).toBe(true);
    expect(groupStateSchema.safeParse({ notes: "x".repeat(250_001) }).success).toBe(false);
  });
});

describe("the roster as rows", () => {
  it("gives each row its own identity and its own sheet", () => {
    const id = addHireling("Vetch", { hpCurrent: 3, hpMax: 4 });
    const row = one<SheetRow>("SELECT * FROM group_hirelings WHERE id = ?", id)!;
    expect(publicHireling(row)).toMatchObject({ id, name: "Vetch", sheet: { hpCurrent: 3, hpMax: 4 } });
  });

  it("has no picture until one is given, and addresses it by its stored name", () => {
    const id = addHireling("Vetch");
    expect(publicHireling(one<SheetRow>("SELECT * FROM group_hirelings WHERE id = ?", id)!).imageUrl).toBeNull();
    db.prepare("UPDATE group_hirelings SET portrait_stored_name = 'stored.png' WHERE id = ?").run(id);
    // The stored name is in the address so a replaced picture is never served
    // from a cache under the name of the one it replaced.
    expect(publicHireling(one<SheetRow>("SELECT * FROM group_hirelings WHERE id = ?", id)!).imageUrl).toBe(
      `/api/rooms/${roomId}/group/hirelings/${id}/image?v=stored.png`
    );
  });

  it("puts a new row after everything already there", () => {
    addHireling("First");
    addHireling("Second");
    expect(nextSortOrder("group_hirelings", roomId)).toBe(2);
  });

  it("reorders by the list it is given and leaves the rest after it", () => {
    const first = addHireling("First");
    const second = addHireling("Second");
    const third = addHireling("Third");
    reorderRows("group_hirelings", roomId, [third, first]);
    expect(
      all<{ name: string }>("SELECT name FROM group_hirelings WHERE room_id = ? ORDER BY sort_order", roomId).map(
        (row) => row.name
      )
    ).toEqual(["Third", "First", "Second"]);
    expect(second).toBeGreaterThan(0);
  });

  it("ignores an id from another room rather than refusing the whole reorder", () => {
    const otherRoom = Number(
      db.prepare("INSERT INTO rooms (name, system, theme, created_by) VALUES ('Other', 'cairn', 'grim', 1)").run()
        .lastInsertRowid
    );
    const mine = addHireling("Mine");
    const theirs = Number(
      db.prepare("INSERT INTO group_hirelings (room_id, name, sort_order) VALUES (?, 'Theirs', 0)").run(otherRoom)
        .lastInsertRowid
    );
    reorderRows("group_hirelings", roomId, [theirs, mine]);
    expect(one<{ sort_order: number }>("SELECT sort_order FROM group_hirelings WHERE id = ?", mine)!.sort_order).toBe(
      0
    );
    expect(one<{ sort_order: number }>("SELECT sort_order FROM group_hirelings WHERE id = ?", theirs)!.sort_order).toBe(
      0
    );
  });

  it("judges a stale write per row, so an unstated one is always allowed", () => {
    const row = { revision: 4 };
    expect(staleWrite(row, undefined)).toBe(false);
    expect(staleWrite(row, null)).toBe(false);
    expect(staleWrite(row, 4)).toBe(false);
    expect(staleWrite(row, 3)).toBe(true);
    // Revision 0 is a row nobody has written yet, not a missing answer.
    expect(staleWrite({ revision: 1 }, 0)).toBe(true);
  });

  it("counts revisions rather than comparing timestamps, which a second cannot separate", () => {
    const id = addHireling("Vetch");
    const revisionOf = () => one<SheetRow>("SELECT * FROM group_hirelings WHERE id = ?", id)!.revision;
    expect(revisionOf()).toBe(0);
    // Two writes inside the same second: `updated_at` cannot tell them apart,
    // because CURRENT_TIMESTAMP is whole seconds.
    const bump = db.prepare(
      "UPDATE group_hirelings SET name = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    );
    bump.run("One", id);
    const after = one<SheetRow>("SELECT * FROM group_hirelings WHERE id = ?", id)!;
    bump.run("Two", id);
    const later = one<SheetRow>("SELECT * FROM group_hirelings WHERE id = ?", id)!;
    expect(later.revision).toBe(after.revision + 1);
    expect(staleWrite(later, after.revision)).toBe(true);
  });

  it("goes with the room, because the row belongs to it", () => {
    addHireling("Vetch");
    db.prepare("DELETE FROM rooms WHERE id = ?").run(roomId);
    expect(all("SELECT id FROM group_hirelings WHERE room_id = ?", roomId)).toEqual([]);
  });
});
