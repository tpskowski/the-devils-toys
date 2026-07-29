import { describe, expect, it } from "vitest";
import { parseGroupObligations } from "./group-obligations";

describe("group obligations", () => {
  it("reads distinct optional obligation fields", () => {
    expect(
      parseGroupObligations({
        obligations: [
          { id: "debt-1", name: "Docking fees", owedTo: "Union Bank", amount: "8,000C", details: "Due next jump" }
        ]
      })
    ).toEqual([
      {
        id: "debt-1",
        name: "Docking fees",
        owedTo: "Union Bank",
        amount: "8,000C",
        details: "Due next jump"
      }
    ]);
  });

  it("preserves the legacy group debt as obligation details", () => {
    expect(parseGroupObligations({ groupDebt: "Owed to Orison Corp" })).toEqual([
      { id: "legacy-group-debt", name: "", owedTo: "", amount: "", details: "Owed to Orison Corp" }
    ]);
  });

  it("keeps older saved obligations compatible when they have no name", () => {
    expect(parseGroupObligations({ obligations: [{ id: "debt-1", amount: "100C" }] })[0]?.name).toBe("");
  });

  it("treats a saved empty obligations list as authoritative", () => {
    expect(parseGroupObligations({ obligations: [], groupDebt: "Old debt" })).toEqual([]);
  });
});
