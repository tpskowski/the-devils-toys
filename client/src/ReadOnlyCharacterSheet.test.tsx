import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CharacterSheetDefinition } from "@devils-toys/shared";
import { ReadOnlyCharacterSheet, type ReadOnlyCharacter } from "./ReadOnlyCharacterSheet";

const definition: CharacterSheetDefinition = {
  sections: [
    {
      id: "attributes",
      label: "Attributes",
      layout: "paired-current-max",
      fields: [
        { key: "strCurrent", label: "STR current", kind: "number", roll: { kind: "save", label: "STR" } },
        { key: "strMax", label: "STR maximum", kind: "number" }
      ]
    },
    {
      id: "notes",
      label: "Notes",
      fields: [
        { key: "deprived", label: "Deprived", kind: "checkbox" },
        { key: "notes", label: "Notes", kind: "textarea" },
        { key: "talents", label: "Talents", kind: "entries" }
      ]
    }
  ],
  lists: [{ key: "inventory", label: "Inventory", slots: ["Slot 1", "Slot 2"] }]
};

const character: ReadOnlyCharacter = {
  id: 4,
  ownerAccountId: 9,
  ownerUsername: "sam",
  name: "Orchid",
  sheet: {
    strCurrent: 8,
    strMax: 10,
    deprived: false,
    notes: "Keeps watch.",
    talents: [{ title: "Patchwork", text: "Can repair field equipment." }],
    inventory: ["Medkit", ""]
  },
  portraitUrl: null,
  warnings: [],
  activeBy: [{ accountId: 9, username: "sam", displayName: "sam as Orchid" }]
};

describe("read-only character sheet", () => {
  it("renders sheet values without edit or roll controls", () => {
    const html = renderToStaticMarkup(
      <ReadOnlyCharacterSheet character={character} definition={definition} system="cairn" />
    );

    expect(html).toContain("Orchid");
    expect(html).toContain("Keeps watch.");
    expect(html).toContain("Patchwork");
    expect(html).toContain("Medkit");
    expect(html).not.toMatch(/<(button|input|textarea|select)\b/);
    expect(html).not.toContain("Roll STR");
  });
});
