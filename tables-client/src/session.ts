import { THEME_IDS, type Account, type ThemeId } from "@devils-toys/shared";

/**
 * What the signed-in account may do here. The server enforces all three; this is
 * only so the page does not offer a control that would be refused.
 */
export interface Permissions {
  /** Author sets and tables for this instance. */
  canEdit: boolean;
  /** Also retire or merge tags, and produce a bundle for the repository. */
  canAdminister: boolean;
}

export function permissionsFor(account: Account | undefined): Permissions {
  return {
    canEdit: Boolean(account && account.role !== "player"),
    canAdminister: account?.role === "admin"
  };
}

export function roleNotice(account: Account | undefined) {
  if (!account) return "";
  if (account.role === "player") return "Read-only. Sign in as a GM to edit tables.";
  if (account.role === "gm") return "You can author tables for this instance.";
  return "";
}

const themeKey = "devils-tables-theme";

export function storedTheme(): ThemeId {
  const stored = localStorage.getItem(themeKey);
  return THEME_IDS.includes(stored as ThemeId) ? (stored as ThemeId) : "grim";
}

export function storeTheme(theme: ThemeId) {
  localStorage.setItem(themeKey, theme);
}
