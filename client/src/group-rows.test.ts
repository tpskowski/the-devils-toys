import { describe, expect, it } from "vitest";
import { flattenRow, splitRow, type GroupSheetRow } from "./group-rows";

const row: GroupSheetRow = {
  id: 12,
  name: "Vetch",
  sheet: { hpCurrent: 3, hpMax: 4, gear: ["Shiv"] },
  sortOrder: 1,
  imageUrl: "/api/rooms/1/group/hirelings/12/image?v=stored.png",
  revision: 4,
  updatedAt: "2026-08-02 10:00:00"
};

describe("a roster row on the sheet", () => {
  it("puts the sheet's fields beside the row's own", () => {
    expect(flattenRow(row)).toEqual({
      id: 12,
      name: "Vetch",
      imageUrl: "/api/rooms/1/group/hirelings/12/image?v=stored.png",
      revision: 4,
      hpCurrent: 3,
      hpMax: 4,
      gear: ["Shiv"]
    });
  });

  it("takes the row's own fields back out when saving, so none of them reach the sheet", () => {
    expect(splitRow(flattenRow(row))).toEqual({
      name: "Vetch",
      sheet: { hpCurrent: 3, hpMax: 4, gear: ["Shiv"] }
    });
  });

  it("survives a round trip with a field that has since been edited", () => {
    const edited = { ...flattenRow(row), hpCurrent: 1, name: "Vetch the Lucky" };
    expect(splitRow(edited)).toEqual({
      name: "Vetch the Lucky",
      sheet: { hpCurrent: 1, hpMax: 4, gear: ["Shiv"] }
    });
  });

  it("does not carry the row's own fields into the sheet even when they are handed back", () => {
    const sheet = splitRow({ ...flattenRow(row), sortOrder: 9, updatedAt: "later" } as never).sheet;
    for (const key of ["sortOrder", "updatedAt", "revision", "imageUrl", "id"]) expect(sheet).not.toHaveProperty(key);
  });

  it("treats a row with no picture as having none rather than as having an empty one", () => {
    expect(flattenRow({ ...row, imageUrl: null }).imageUrl).toBeNull();
  });
});
