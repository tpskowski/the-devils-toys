import { THEME_IDS, type RoomRole, type ThemeId } from "@devils-toys/shared";

/**
 * A player's own choice of theme for one room. It is stored in the browser and
 * never sent to the server: the GM's theme stays the room's theme for everybody
 * else, and each room keeps its own look.
 */
export function personalThemeKey(roomId: number) {
  return `devils-toys:personal-theme:${roomId}`;
}

/** Anything unreadable or unrecognised means "no preference", not an error. */
export function readPersonalTheme(storage: Pick<Storage, "getItem"> | undefined, roomId: number): ThemeId | undefined {
  try {
    const stored = storage?.getItem(personalThemeKey(roomId));
    return THEME_IDS.find((theme) => theme === stored);
  } catch {
    return undefined;
  }
}

/** A room GM always sees the shared room theme, even if this browser has an old player preference. */
export function readPersonalThemeForRole(
  role: RoomRole | undefined,
  storage: Pick<Storage, "getItem"> | undefined,
  roomId: number | undefined
): ThemeId | undefined {
  return role === "player" && roomId !== undefined ? readPersonalTheme(storage, roomId) : undefined;
}

export function writePersonalTheme(
  storage: Pick<Storage, "setItem" | "removeItem"> | undefined,
  roomId: number,
  theme: ThemeId | undefined
) {
  try {
    if (theme) storage?.setItem(personalThemeKey(roomId), theme);
    else storage?.removeItem(personalThemeKey(roomId));
  } catch {
    // A browser refusing storage must not stop the theme applying for this visit.
  }
}

/** A player's choice wins over the room's theme; without one the room decides. */
export function effectiveTheme(roomTheme: ThemeId | undefined, personal: ThemeId | undefined): ThemeId {
  return personal ?? roomTheme ?? "heroic";
}
