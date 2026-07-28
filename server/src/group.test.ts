import { describe, expect, it } from "vitest";
import { groupStateSchema, parseGroupState } from "./group.js";

describe("group state", () => {
  it("keeps valid shared fields and repairs malformed stored JSON", () => {
    expect(parseGroupState('{"groupDebt":"10k","starship":{"name":"Desdemona"}}')).toEqual({
      groupDebt: "10k",
      starship: { name: "Desdemona" }
    });
    expect(parseGroupState("not-json")).toEqual({});
    expect(parseGroupState("[]")).toEqual({});
  });

  it("accepts object documents and rejects oversized data", () => {
    expect(groupStateSchema.safeParse({ groupDebt: "10k" }).success).toBe(true);
    expect(groupStateSchema.safeParse({ notes: "x".repeat(250_001) }).success).toBe(false);
  });
});
