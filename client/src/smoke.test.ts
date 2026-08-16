import { describe, expect, it } from "vitest";
import { BUILTIN_SYSTEM_IDS, THEME_IDS } from "@devils-toys/shared";

describe("client system options", () => {
  it("ships every theme and no game system", () => {
    // A theme is the application's; a system is not. The client learns which
    // systems a server has from `/api/status`, never from a list compiled in.
    expect(BUILTIN_SYSTEM_IDS).toEqual([]);
    expect(THEME_IDS).toEqual(["heroic", "digital", "used", "grim", "shinji", "production-type"]);
  });
});
