export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storageKey(roomId: number, viewerId: number) {
  return `devils-toys:starship-expansion:${viewerId}:${roomId}`;
}

export function readStarshipExpansion(storage: StorageLike | undefined, roomId: number, viewerId: number) {
  if (!storage) return {};
  try {
    const parsed: unknown = JSON.parse(storage.getItem(storageKey(roomId, viewerId)) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([id, expanded]) => (typeof expanded === "boolean" ? [[id, expanded]] : []))
    ) as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function writeStarshipExpansion(
  storage: StorageLike | undefined,
  roomId: number,
  viewerId: number,
  expansion: Record<string, boolean>
) {
  try {
    storage?.setItem(storageKey(roomId, viewerId), JSON.stringify(expansion));
  } catch {
    // Storage preferences are optional; the default-expanded behavior remains usable.
  }
}
