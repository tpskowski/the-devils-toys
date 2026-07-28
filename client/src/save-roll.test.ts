import { describe, expect, it } from "vitest";
import { saveAbilityForStatKey, saveSetupForAttribute } from "./save-roll";

describe("character attribute save setup", () => {
  it("maps the three character attributes to save abilities", () => {
    expect(saveAbilityForStatKey("strCurrent")).toBe("STR");
    expect(saveAbilityForStatKey("dexCurrent")).toBe("DEX");
    expect(saveAbilityForStatKey("wilCurrent")).toBe("WIL");
  });

  it("uses the current attribute score as the save target", () => {
    expect(saveSetupForAttribute("strCurrent", 12)).toEqual({ ability: "STR", target: 12 });
    expect(saveSetupForAttribute("dexCurrent", "9")).toEqual({ ability: "DEX", target: 9 });
  });

  it("does not offer saves for other stats or invalid targets", () => {
    expect(saveSetupForAttribute("hpCurrent", 6)).toBeUndefined();
    expect(saveSetupForAttribute("armorCurrent", 2)).toBeUndefined();
    expect(saveSetupForAttribute("wilCurrent", "")).toBeUndefined();
    expect(saveSetupForAttribute("wilCurrent", 0)).toBeUndefined();
    expect(saveSetupForAttribute("wilCurrent", 21)).toBeUndefined();
  });
});
