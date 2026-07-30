import { describe, expect, it } from "vitest";
import { readStarshipExpansion, writeStarshipExpansion, type StorageLike } from "./starship-expansion";

function memoryStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
}

describe("starship expansion preferences", () => {
  it("keeps preferences separate by viewer and room", () => {
    const storage = memoryStorage();
    writeStarshipExpansion(storage, 4, 7, { kestrel: false });
    expect(readStarshipExpansion(storage, 4, 7)).toEqual({ kestrel: false });
    expect(readStarshipExpansion(storage, 4, 8)).toEqual({});
    expect(readStarshipExpansion(storage, 5, 7)).toEqual({});
  });

  it("ignores malformed and non-boolean values", () => {
    const storage = memoryStorage();
    storage.setItem("devils-toys:starship-expansion:7:4", JSON.stringify({ kestrel: false, bad: "yes" }));
    expect(readStarshipExpansion(storage, 4, 7)).toEqual({ kestrel: false });
  });
});
