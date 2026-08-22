/**
 * Whether a player keeps the navigation rail out of the way in one room. Like
 * their choice of theme it is stored in the browser and never sent to the
 * server: the rail is how an account moves between its own tables, so where it
 * stands is that browser's business and each room keeps its own answer.
 *
 * A player opens a room to play in it rather than to move between rooms, so
 * theirs starts collapsed and the scene gets the width. Nothing is recorded
 * until they say otherwise, which is what lets that default change later
 * without overruling anybody who has already chosen.
 */
export function railCollapsedKey(roomId: number) {
  return `devils-toys:rail-collapsed:${roomId}`;
}

/** Anything unreadable or unrecognised means "no preference", not an error. */
export function readRailCollapsed(storage: Pick<Storage, "getItem"> | undefined, roomId: number): boolean | undefined {
  try {
    const stored = storage?.getItem(railCollapsedKey(roomId));
    if (stored === "collapsed") return true;
    if (stored === "open") return false;
    return undefined;
  } catch {
    return undefined;
  }
}

export function writeRailCollapsed(storage: Pick<Storage, "setItem"> | undefined, roomId: number, collapsed: boolean) {
  try {
    storage?.setItem(railCollapsedKey(roomId), collapsed ? "collapsed" : "open");
  } catch {
    // A browser refusing storage must not stop the rail moving for this visit.
  }
}
