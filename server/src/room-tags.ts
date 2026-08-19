import express from "express";
import { z } from "zod";
import {
  emptyRoomTags,
  isTagSubject,
  MAX_TAG_LENGTH,
  MAX_TAGS_PER_SUBJECT,
  normalizeTags,
  tagVocabulary,
  type RoomTags,
  type TagSubject
} from "@devils-toys/shared";
import type { AuthedRequest } from "./auth.js";
import { requireAuth } from "./auth.js";
import { all, db, one } from "./db.js";
import { findAccessibleCharacter, findVisibleCharacter } from "./characters.js";
import { broadcastRoom } from "./realtime.js";
import { roomAccessRole } from "./room-config-permissions.js";
import { roomHasFeature } from "./system-rules.js";

/**
 * Tags on the things in a room: characters, NPCs, hirelings, and the library.
 *
 * They are the room's own words rather than a vocabulary anyone administers,
 * which is the whole difference between these and the table editor's tags. A
 * room's vocabulary is read back out of the tags in use, so a table settles on
 * one by using it rather than by publishing it.
 *
 * A room only has tags when its system's optional rules say so, and that gate is
 * here rather than in the client: a room whose rule is off has no tag routes at
 * all, so nothing can be written that the room would never show.
 */
export const roomTagRouter = express.Router();

/** The column a subject's id lives in. The others are null; the table's CHECK enforces it. */
const subjectColumn: Record<TagSubject, string> = {
  character: "character_id",
  npc: "npc_id",
  hireling: "hireling_id",
  scene: "media_id"
};

interface TagRow {
  subject: TagSubject;
  subject_id: number;
  tag: string;
}

const selectTags = `SELECT subject,
    COALESCE(character_id, npc_id, hireling_id, media_id) AS subject_id, tag
  FROM room_tags WHERE room_id = ?`;

function collect(rows: TagRow[], enabled: boolean): RoomTags {
  const room = emptyRoomTags(enabled);
  for (const row of rows) {
    const held = (room.tags[row.subject][String(row.subject_id)] ??= []);
    held.push(row.tag);
  }
  room.vocabulary = tagVocabulary(rows.map((row) => row.tag));
  return room;
}

/** What one subject carries, in the order it was given. */
export function tagsOn(roomId: number, subject: TagSubject, subjectId: number): string[] {
  return all<{ tag: string }>(
    `SELECT tag FROM room_tags WHERE room_id = ? AND subject = ? AND ${subjectColumn[subject]} = ?
     ORDER BY sort_order, id`,
    roomId,
    subject,
    subjectId
  ).map((row) => row.tag);
}

/**
 * Every tag in the room, as much of it as this account may see.
 *
 * A GM sees all of it. A player sees the tags on characters they can already
 * see, on the party's hirelings, and on the library entries revealed to them —
 * and none of the NPC tags, because the NPC catalogue is the GM's alone and its
 * tags would describe a cast the table has not met.
 */
export function readRoomTags(accountId: number, roomId: number, role: "gm" | "player"): RoomTags {
  if (!roomHasFeature(roomId, "tags")) return emptyRoomTags(false);
  const rows = all<TagRow>(`${selectTags} ORDER BY sort_order, id`, roomId);
  if (role === "gm") return collect(rows, true);
  return collect(
    rows.filter((row) => {
      if (row.subject === "npc") return false;
      if (row.subject === "character") return Boolean(findVisibleCharacter(accountId, roomId, row.subject_id));
      if (row.subject === "scene")
        return Boolean(one("SELECT 1 FROM media WHERE id = ? AND room_id = ? AND visible = 1", row.subject_id, roomId));
      return true;
    }),
    true
  );
}

/** That the room owns the thing being tagged. A tag on something else is refused rather than orphaned. */
function roomOwns(roomId: number, subject: Exclude<TagSubject, "character">, subjectId: number) {
  if (subject === "npc")
    return Boolean(one("SELECT 1 FROM custom_npcs WHERE id = ? AND room_id = ?", subjectId, roomId));
  if (subject === "hireling")
    return Boolean(one("SELECT 1 FROM group_hirelings WHERE id = ? AND room_id = ?", subjectId, roomId));
  return Boolean(one("SELECT 1 FROM media WHERE id = ? AND room_id = ?", subjectId, roomId));
}

/**
 * Whether this account may put words on this thing.
 *
 * A GM tags anything their room holds. A player tags the characters they could
 * already edit and nothing else: the hirelings, the cast, and the library are
 * the GM's to describe. A character belongs to a player rather than to a room,
 * so what makes it this room's is that the room can see it — which is the same
 * question the character routes already answer.
 */
function mayTag(accountId: number, roomId: number, role: "gm" | "player", subject: TagSubject, subjectId: number) {
  if (subject === "character")
    return Boolean(
      role === "gm"
        ? findVisibleCharacter(accountId, roomId, subjectId)
        : findAccessibleCharacter(accountId, roomId, subjectId)
    );
  return role === "gm" && roomOwns(roomId, subject, subjectId);
}

/**
 * Replaces what a subject carries with what was sent, in one transaction.
 *
 * Written whole rather than a tag at a time: the editor sends the list it is
 * showing, so a tag another person removed while this one was typing loses to
 * whoever saved last rather than coming back on its own.
 */
export function writeTags(
  roomId: number,
  subject: TagSubject,
  subjectId: number,
  tags: readonly string[],
  accountId: number
): string[] {
  const kept = normalizeTags(tags);
  const column = subjectColumn[subject];
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`DELETE FROM room_tags WHERE room_id = ? AND subject = ? AND ${column} = ?`).run(
      roomId,
      subject,
      subjectId
    );
    const write = db.prepare(
      `INSERT INTO room_tags (room_id, subject, ${column}, tag, sort_order, created_by) VALUES (?, ?, ?, ?, ?, ?)`
    );
    kept.forEach((tag, index) => write.run(roomId, subject, subjectId, tag, index, accountId));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return kept;
}

/** The room and the writer's role in it, refused where the room has no tags. */
function tagContext(req: AuthedRequest, res: express.Response) {
  const roomId = Number(req.params.roomId);
  const role = roomAccessRole(req.account!, roomId);
  if (!role) {
    res.status(404).json({ error: "Room not found." });
    return;
  }
  if (!roomHasFeature(roomId, "tags")) {
    res.status(404).json({ error: "This room does not use tags." });
    return;
  }
  return { roomId, role };
}

roomTagRouter.get("/rooms/:roomId/tags", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  const role = roomAccessRole(req.account!, roomId);
  if (!role) return res.status(404).json({ error: "Room not found." });
  // Answered rather than refused where the room has tags switched off, so a
  // client asks once and draws nothing rather than treating an ordinary room as
  // a failure.
  res.json(readRoomTags(req.account!.id, roomId, role));
});

roomTagRouter.put("/rooms/:roomId/tags/:subject/:subjectId", requireAuth, (req: AuthedRequest, res) => {
  const context = tagContext(req, res);
  if (!context) return;
  const subject = String(req.params.subject);
  const subjectId = Number(req.params.subjectId);
  if (!isTagSubject(subject) || !Number.isInteger(subjectId))
    return res.status(400).json({ error: "That is not something a tag goes on." });
  // Generous limits rather than exact ones: what is over-long or repeated is
  // tidied by `normalizeTags` on the way in, and only a request that is not a
  // list of tags at all is a mistake worth a message.
  const parsed = z
    .object({ tags: z.array(z.string().max(MAX_TAG_LENGTH * 4)).max(MAX_TAGS_PER_SUBJECT * 4) })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Send the tags this should carry." });
  if (!mayTag(req.account!.id, context.roomId, context.role, subject, subjectId))
    return res.status(403).json({ error: "That is not yours to tag." });
  const tags = writeTags(context.roomId, subject, subjectId, parsed.data.tags, req.account!.id);
  broadcastRoom(context.roomId, { type: "tags-updated" });
  res.json({ subject, subjectId, tags });
});
