import { useCallback, useEffect, useMemo, useState } from "react";
import { emptyRoomTags, tagsFor, type RoomTags, type TagSubject } from "@devils-toys/shared";
import { api } from "./api";

/**
 * A room's tags, for whichever panel is showing something that can carry them.
 *
 * One request per panel rather than one shared store: the character sheet, the
 * NPC panel, and Room Config are separate trees — Room Config is a separate
 * page — and the payload is a handful of words. Whether the room has tags at
 * all comes back with them, so a panel asks once and draws nothing rather than
 * having to know what its system declared.
 */
export interface RoomTagState {
  /** False where the room's system has no tags rule, or has it switched off. */
  enabled: boolean;
  vocabulary: string[];
  tagsOn: (subject: TagSubject, id: number | string) => string[];
  save: (subject: TagSubject, id: number, tags: string[]) => Promise<string[]>;
  reload: () => Promise<void>;
}

export function useRoomTags(roomId: number, revision = 0): RoomTagState {
  const [tags, setTags] = useState<RoomTags>(emptyRoomTags(false));

  const reload = useCallback(async () => {
    try {
      setTags(await api<RoomTags>(`/api/rooms/${roomId}/tags`));
    } catch {
      // A room that cannot be read is a room with no tags to show. Whatever went
      // wrong belongs to whichever panel was reading the room itself.
      setTags(emptyRoomTags(false));
    }
  }, [roomId]);

  useEffect(() => {
    void reload();
  }, [reload, revision]);

  const save = useCallback(
    async (subject: TagSubject, id: number, next: string[]) => {
      const result = await api<{ tags: string[] }>(`/api/rooms/${roomId}/tags/${subject}/${id}`, {
        method: "PUT",
        body: JSON.stringify({ tags: next })
      });
      // Take the server's reading rather than the words as typed: it is what
      // tidied the spacing, dropped the repeats, and holds the vocabulary.
      await reload();
      return result.tags;
    },
    [roomId, reload]
  );

  // Held steady between renders so a panel can filter its own rows against it
  // inside a `useMemo` without that memo being rebuilt on every keystroke.
  return useMemo(
    () => ({
      enabled: tags.enabled,
      vocabulary: tags.vocabulary,
      tagsOn: (subject: TagSubject, id: number | string) => tagsFor(tags, subject, id),
      save,
      reload
    }),
    [tags, save, reload]
  );
}
