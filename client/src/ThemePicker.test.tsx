import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { THEME_IDS, type ThemeId } from "@devils-toys/shared";
import { ThemePicker } from "./ThemePicker";

const names = Object.fromEntries(THEME_IDS.map((theme) => [theme, `Name for ${theme}`])) as Record<ThemeId, string>;

describe("ThemePicker", () => {
  it("renders a text-free palette row for the selected theme and every option", () => {
    const html = renderToStaticMarkup(createElement(ThemePicker, { value: "heroic", names, onChange() {} }));

    expect(html.match(/class="theme-palette /g)).toHaveLength(THEME_IDS.length + 1);
    for (const theme of THEME_IDS) {
      expect(html).toContain(`class="theme-palette theme-${theme}"`);
      expect(html).not.toContain(`>Name for ${theme}<`);
    }
  });
});
