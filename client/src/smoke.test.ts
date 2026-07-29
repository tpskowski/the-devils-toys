import { describe, expect, it } from "vitest";
import { SYSTEM_IDS, THEME_IDS } from "@devils-toys/shared";

describe("client system options", () => {
  it("ships both game systems and every theme", () => {
    expect(SYSTEM_IDS).toEqual(["cairn", "monolith", "cwn"]);
    expect(THEME_IDS).toEqual(["heroic", "digital", "used", "grim", "shinji"]);
  });
});
