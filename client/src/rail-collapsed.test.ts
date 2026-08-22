import { describe, expect, it } from "vitest";
import { railCollapsedKey, readRailCollapsed, writeRailCollapsed } from "./rail-collapsed";

function fakeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value)
  };
}

const refusing = {
  getItem() {
    throw new Error("storage disabled");
  },
  setItem() {
    throw new Error("storage disabled");
  }
};

describe("where a player left the navigation rail in a room", () => {
  it("reads both answers back", () => {
    const storage = fakeStorage();
    writeRailCollapsed(storage, 7, true);
    expect(readRailCollapsed(storage, 7)).toBe(true);
    writeRailCollapsed(storage, 7, false);
    expect(readRailCollapsed(storage, 7)).toBe(false);
  });

  it("keeps every room's choice apart", () => {
    const storage = fakeStorage();
    writeRailCollapsed(storage, 1, false);
    writeRailCollapsed(storage, 2, true);
    expect(readRailCollapsed(storage, 1)).toBe(false);
    expect(readRailCollapsed(storage, 2)).toBe(true);
    expect(readRailCollapsed(storage, 3)).toBeUndefined();
  });

  it("treats nothing stored as no preference, which is what the default is for", () => {
    expect(readRailCollapsed(fakeStorage(), 1)).toBeUndefined();
    expect(readRailCollapsed(undefined, 1)).toBeUndefined();
  });

  it("ignores a value it did not write", () => {
    expect(readRailCollapsed(fakeStorage({ [railCollapsedKey(1)]: "true" }), 1)).toBeUndefined();
  });

  it("survives a browser that refuses storage", () => {
    expect(readRailCollapsed(refusing, 1)).toBeUndefined();
    expect(() => writeRailCollapsed(refusing, 1, true)).not.toThrow();
  });
});
