import { WikiWorkspace } from "./WikiWorkspace";

/** Room Config is GM-only, so it reuses the room notebook rather than growing
 * a second implementation for administration and sharing. */
export function RoomConfigWiki({ roomId, revision }: { roomId: number; revision: number }) {
  return <WikiWorkspace roomId={roomId} isGm revision={revision} embedded />;
}
