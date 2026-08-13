import { describe, expect, it } from "vitest";
import { builtinSystems } from "./builtin-systems.js";
import { gameSystemSchema } from "./system-schema.js";

/** A valid system to mutate, so each rejection test differs in exactly one way. */
const valid = () => JSON.parse(JSON.stringify(builtinSystems.monolith)) as Record<string, unknown>;

const firstIssue = (value: unknown) => {
  const result = gameSystemSchema.safeParse(value);
  expect(result.success).toBe(false);
  return result.error!.issues[0];
};

describe("the system schema", () => {
  // The test the schema exists for. Every compiled system is a GameSystem that
  // works, so a schema that rejects one is wrong about the type rather than
  // about the system — and a schema that quietly drops a field it does not know
  // would let a bundle lose it. Strict objects plus this test is what keeps the
  // two in step.
  it("accepts every compiled system, field for field", () => {
    for (const [id, definition] of Object.entries(builtinSystems)) {
      const result = gameSystemSchema.safeParse(JSON.parse(JSON.stringify(definition)));
      expect(
        result.success,
        `${id}: ${result.error?.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`
      ).toBe(true);
      expect(result.data).toEqual(JSON.parse(JSON.stringify(definition)));
    }
  });

  it("keeps every field it was given, so a bundle cannot lose one in transit", () => {
    const parsed = gameSystemSchema.parse(valid());
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(valid()).sort());
  });

  it("refuses a key it does not know, rather than dropping it", () => {
    const issue = firstIssue({ ...valid(), sheetLayout: "two-column" });
    expect(issue.code).toBe("unrecognized_keys");
  });

  it("refuses a misspelled key inside a nested definition", () => {
    const system = valid();
    (system.npcStatblock as Record<string, unknown>).hitPointKey = "hp";
    expect(firstIssue(system).code).toBe("unrecognized_keys");
  });

  it("refuses an id that is not a usable slug", () => {
    for (const id of ["Monolith2", "9lives", "m", "monolith 2", "monolith/2", ""])
      expect(gameSystemSchema.safeParse({ ...valid(), id }).success).toBe(false);
    for (const id of ["monolith-2", "cairn2", "thirteenth-age"])
      expect(gameSystemSchema.safeParse({ ...valid(), id }).success).toBe(true);
  });

  it("refuses a theme this build does not ship", () => {
    expect(gameSystemSchema.safeParse({ ...valid(), defaultTheme: "neon" }).success).toBe(false);
  });

  it("refuses a system with no source document", () => {
    expect(firstIssue({ ...valid(), sourceDocuments: [] }).message).toContain("at least one source document");
  });

  it("requires a source document to state its licence", () => {
    const system = valid();
    const [source] = system.sourceDocuments as Record<string, unknown>[];
    delete source.license;
    expect(gameSystemSchema.safeParse(system).success).toBe(false);
  });

  it("refuses a warning rule of a kind it has no evaluator for", () => {
    const system = valid();
    system.warningRules = [{ kind: "script", source: "sheet.hp < 0", message: "no" }];
    expect(gameSystemSchema.safeParse(system).success).toBe(false);
  });

  it("refuses a function anywhere, which is the whole point", () => {
    // Not reachable through JSON, but the schema is what stands between an
    // uploaded file and the registry, so it should say no to this shape too.
    const system = valid();
    system.warningRules = [() => ["always"]];
    expect(gameSystemSchema.safeParse(system).success).toBe(false);
    expect(gameSystemSchema.safeParse({ ...valid(), characterSheet: () => ({}) }).success).toBe(false);
  });

  it("accepts each warning rule the built-ins actually use", () => {
    const system = valid();
    system.warningRules = [
      { kind: "range", key: "corruption", min: 1, max: 30, message: "out of range" },
      { kind: "flag", key: "deprived", equals: true, message: "deprived" },
      { kind: "list-occupancy", listKey: "augmentations", tiers: [{ atLeast: 6, message: "half" }] },
      {
        kind: "compare",
        key: "readied",
        against: "str",
        operator: ">",
        scale: 0.5,
        message: "heavy",
        beyond: { offset: 2, message: "far too heavy" }
      }
    ];
    expect(gameSystemSchema.safeParse(system).success).toBe(true);
  });

  it("refuses a statblock with no fields, which nothing could edit", () => {
    const system = valid();
    (system.npcStatblock as Record<string, unknown>).fields = [];
    expect(gameSystemSchema.safeParse(system).success).toBe(false);
  });

  it("accepts both statblock readers by name and neither by any other", () => {
    for (const parser of ["inline", "labelled"]) {
      const system = valid();
      (system.npcStatblock as Record<string, unknown>).parser = parser;
      expect(gameSystemSchema.safeParse(system).success).toBe(true);
    }
    const system = valid();
    (system.npcStatblock as Record<string, unknown>).parser = "cwn";
    expect(gameSystemSchema.safeParse(system).success).toBe(false);
  });
});
