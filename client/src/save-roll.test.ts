import { describe, expect, it } from "vitest";
import { saveSetupForField } from "./save-roll";

const physicalSave = {
  key: "physicalSave",
  label: "Physical save",
  kind: "number" as const,
  roll: { kind: "save" as const, label: "Physical" }
};

describe("character save setup", () => {
  it("uses field metadata and the recorded target", () => {
    expect(saveSetupForField(physicalSave, 12)).toEqual({ label: "Physical", target: 12 });
    expect(saveSetupForField(physicalSave, "9")).toEqual({ label: "Physical", target: 9 });
  });

  it("does not offer saves for unconfigured fields or invalid targets", () => {
    expect(saveSetupForField({ key: "hp", label: "HP", kind: "number" }, 6)).toBeUndefined();
    expect(saveSetupForField(physicalSave, "")).toBeUndefined();
    expect(saveSetupForField(physicalSave, 0)).toBeUndefined();
    expect(saveSetupForField(physicalSave, 21)).toBeUndefined();
  });
});
