import { ROOM_CONFIG_SECTIONS, type RoomConfigSectionId } from "@devils-toys/shared";

/**
 * Room Config has an address of its own so it can be opened in its own tab, in
 * the same shape the standalone rules reference already uses: one path, with the
 * room carried as a query parameter rather than in the path, so a link built
 * without a room is still a valid link.
 */
export const roomConfigBasePath = "/config";

export function roomConfigPath(roomId?: number, section?: RoomConfigSectionId) {
  const base = roomId === undefined ? roomConfigBasePath : `${roomConfigBasePath}?room=${encodeURIComponent(roomId)}`;
  return section ? `${base}#${section}` : base;
}

/** Whether this address is the panel rather than the game. */
export function isRoomConfigPath(pathname: string) {
  return /^\/config\/?$/.test(pathname);
}

/**
 * The room a panel address names, or undefined for the selector. A parameter
 * that is not a room id is treated as absent rather than as an error: the panel
 * can always fall back to asking which room, and a broken link should land
 * somewhere useful.
 */
export function roomIdFromConfigSearch(search: string) {
  const value = new URLSearchParams(search).get("room");
  if (value === null) return;
  const roomId = Number(value);
  return Number.isInteger(roomId) && roomId > 0 ? roomId : undefined;
}

/** The section a fragment names, if it names one this build has. */
export function sectionFromHash(hash: string): RoomConfigSectionId | undefined {
  const slug = hash.replace(/^#/, "");
  return ROOM_CONFIG_SECTIONS.find((section) => section === slug);
}

/** Where the panel remembers which section a room was left on. */
export function sectionStorageKey(roomId: number) {
  return `devils-toys:room-config-section:${roomId}`;
}
