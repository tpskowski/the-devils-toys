import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RoomSummary } from "@devils-toys/shared";
import { RoomSettings } from "./App";

function renderSettings(wikiEnabled: boolean) {
  const room: RoomSummary = {
    id: 1,
    name: "Table",
    system: "toybox",
    systemName: "Toybox",
    theme: "heroic",
    role: "gm",
    archived: false,
    calendarEnabled: false,
    mapNotationEnabled: false,
    musicEnabled: false,
    wikiEnabled,
    rules: {}
  };
  return renderToStaticMarkup(
    createElement(RoomSettings, {
      room,
      optionalRules: [],
      isAdmin: true,
      onChanged() {},
      onDeleted() {},
      onThemePreview() {},
      onClose() {}
    })
  );
}

describe("room Wiki setting", () => {
  it("shows the room's saved Wiki state in its settings toggle", () => {
    const enabled = renderSettings(true);
    const disabled = renderSettings(false);
    const wikiToggle = /<strong>Wiki<\/strong>[\s\S]*?<input type="checkbox"([^>]*)\/>/;

    expect(enabled.match(wikiToggle)?.[1]).toContain("checked");
    expect(disabled.match(wikiToggle)?.[1]).not.toContain("checked");
  });
});
