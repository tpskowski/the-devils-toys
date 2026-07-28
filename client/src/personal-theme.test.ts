import { describe, expect, it } from "vitest";
import { effectiveTheme, personalThemeKey, readPersonalTheme, writePersonalTheme } from "./personal-theme";

function fakeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key)
  };
}

const refusing = {
  getItem() {
    throw new Error("storage disabled");
  },
  setItem() {
    throw new Error("storage disabled");
  },
  removeItem() {
    throw new Error("storage disabled");
  }
};

describe("a player's own theme for a room", () => {
  it("reads a stored theme back", () => {
    expect(readPersonalTheme(fakeStorage({ [personalThemeKey(7)]: "shinji" }), 7)).toBe("shinji");
  });

  it("keeps every room's choice apart", () => {
    const storage = fakeStorage();
    writePersonalTheme(storage, 1, "grim");
    writePersonalTheme(storage, 2, "digital");
    expect(readPersonalTheme(storage, 1)).toBe("grim");
    expect(readPersonalTheme(storage, 2)).toBe("digital");
    expect(readPersonalTheme(storage, 3)).toBeUndefined();
  });

  it("clears one room without disturbing another", () => {
    const storage = fakeStorage();
    writePersonalTheme(storage, 1, "grim");
    writePersonalTheme(storage, 2, "digital");
    writePersonalTheme(storage, 1, undefined);
    expect(storage.values.has(personalThemeKey(1))).toBe(false);
    expect(readPersonalTheme(storage, 2)).toBe("digital");
  });

  it("treats nothing stored as no preference", () => {
    expect(readPersonalTheme(fakeStorage(), 1)).toBeUndefined();
    expect(readPersonalTheme(undefined, 1)).toBeUndefined();
  });

  it("ignores a value that is not a theme the application ships", () => {
    expect(readPersonalTheme(fakeStorage({ [personalThemeKey(1)]: "evangelion" }), 1)).toBeUndefined();
  });

  it("survives a browser that refuses storage", () => {
    expect(readPersonalTheme(refusing, 1)).toBeUndefined();
    expect(() => writePersonalTheme(refusing, 1, "digital")).not.toThrow();
  });
});

describe("which theme a room is shown in", () => {
  it("uses the room's theme when the player has no preference", () => {
    expect(effectiveTheme("used", undefined)).toBe("used");
  });

  it("lets the player's choice win", () => {
    expect(effectiveTheme("used", "shinji")).toBe("shinji");
  });

  it("falls back to the default theme outside a room", () => {
    expect(effectiveTheme(undefined, undefined)).toBe("heroic");
  });
});
