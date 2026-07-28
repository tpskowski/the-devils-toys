import { describe, expect, it } from "vitest";
import { appendEntry, entryName, readEntries, removeEntry, singularLabel, updateEntry } from "./character-entries";

describe("character sheet entry fields", () => {
  it("reads stored entries and ignores malformed items", () => {
    const stored = [{ title: "Machine Speech", text: "Read machine dialects." }, { title: "Nerve" }, null, 7];

    expect(readEntries(stored)).toEqual([
      { title: "Machine Speech", text: "Read machine dialects." },
      { title: "Nerve", text: "" }
    ]);
  });

  it("carries a sheet written before the field became a list into one untitled entry", () => {
    expect(readEntries("Reads machine dialects on sight.")).toEqual([
      { title: "", text: "Reads machine dialects on sight." }
    ]);
    expect(readEntries("   ")).toEqual([]);
    expect(readEntries(undefined)).toEqual([]);
  });

  it("adds, edits, and removes entries without mutating the stored array", () => {
    const entries = [{ title: "Nerve", text: "Steady under fire." }];

    expect(appendEntry(entries)).toEqual([
      { title: "Nerve", text: "Steady under fire." },
      { title: "", text: "" }
    ]);
    expect(updateEntry(entries, 0, { title: "Cold Nerve" })).toEqual([
      { title: "Cold Nerve", text: "Steady under fire." }
    ]);
    expect(removeEntry(entries, 0)).toEqual([]);
    expect(entries).toEqual([{ title: "Nerve", text: "Steady under fire." }]);
  });

  it("names an entry for assistive technology even before it is titled", () => {
    expect(entryName({ title: " Nerve ", text: "" }, 0, "Talent")).toBe("Nerve");
    expect(entryName({ title: "   ", text: "" }, 2, "Talent")).toBe("Untitled talent 3");
  });

  it("derives a singular row label from the field label", () => {
    expect(singularLabel("Talents")).toBe("Talent");
    expect(singularLabel("Gear")).toBe("Gear");
  });
});
