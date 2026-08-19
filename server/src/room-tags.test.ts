import { beforeEach, describe, expect, it } from "vitest";
import { emptyRoomTags, normalizeTag, normalizeTags, tagVocabulary, tagsMatch } from "@devils-toys/shared";
import { db } from "./db.js";
import { readRoomTags, tagsOn, writeTags } from "./room-tags.js";
import { setRoomRules } from "./system-rules.js";
import { installToybox } from "./test-fixture.js";

installToybox();

let roomId = 0;
let characterId = 0;
let npcId = 0;
let sceneId = 0;

beforeEach(() => {
  db.exec(
    "DELETE FROM room_tags; DELETE FROM room_system_rules; DELETE FROM media; DELETE FROM custom_npcs;" +
      " DELETE FROM characters; DELETE FROM memberships; DELETE FROM rooms; DELETE FROM accounts;"
  );
  db.prepare("INSERT INTO accounts (id, username, password_hash, account_role) VALUES (1, 'GM', '', 'gm')").run();
  db.prepare(
    "INSERT INTO accounts (id, username, password_hash, account_role) VALUES (2, 'Player', '', 'player')"
  ).run();
  roomId = Number(
    db.prepare("INSERT INTO rooms (name, system, theme, created_by) VALUES ('Table', 'toybox', 'grim', 1)").run()
      .lastInsertRowid
  );
  db.prepare("INSERT INTO memberships (room_id, account_id, role) VALUES (?, 1, 'gm')").run(roomId);
  db.prepare("INSERT INTO memberships (room_id, account_id, role) VALUES (?, 2, 'player')").run(roomId);
  characterId = Number(
    db.prepare("INSERT INTO characters (system, owner_account_id, name) VALUES ('toybox', 2, 'Vex')").run()
      .lastInsertRowid
  );
  npcId = Number(
    db.prepare("INSERT INTO custom_npcs (room_id, created_by, name) VALUES (?, 1, 'The Broker')").run(roomId)
      .lastInsertRowid
  );
  sceneId = Number(
    db
      .prepare(
        `INSERT INTO media (room_id, uploaded_by, kind, category, filename, stored_name, mime_type, size, visible)
         VALUES (?, 1, 'scene', 'scene', 'dock.png', 'dock.png', 'image/png', 10, 0)`
      )
      .run(roomId).lastInsertRowid
  );
  setRoomRules(roomId, "toybox", { tags: true });
});

describe("what a tag is", () => {
  it("keeps the words as typed and tidies the spacing", () => {
    expect(normalizeTag("  Inner   Ring  ")).toBe("Inner Ring");
  });

  it("caps a tag at a label's length", () => {
    expect(normalizeTag("x".repeat(60))).toHaveLength(32);
  });

  it("drops repeats however they were capitalised, keeping the first spelling", () => {
    expect(normalizeTags(["Villain", "villain", " VILLAIN ", "", "  "])).toEqual(["Villain"]);
  });

  it("reads a vocabulary out of the tags in use, alphabetically and without repeats", () => {
    expect(tagVocabulary(["villain", "Dock", "VILLAIN", "arc-two"])).toEqual(["arc-two", "Dock", "villain"]);
  });

  it("matches a search regardless of case, and never on an empty one", () => {
    expect(tagsMatch(["Inner Ring"], "inner")).toBe(true);
    expect(tagsMatch(["Inner Ring"], "  ")).toBe(false);
  });
});

describe("tags in a room", () => {
  it("puts words on a character and reads them back in order", () => {
    writeTags(roomId, "character", characterId, ["Villain", "Arc Two"], 1);
    expect(tagsOn(roomId, "character", characterId)).toEqual(["Villain", "Arc Two"]);
  });

  it("replaces what a subject carries rather than adding to it", () => {
    writeTags(roomId, "character", characterId, ["Villain"], 1);
    writeTags(roomId, "character", characterId, ["Ally"], 1);
    expect(tagsOn(roomId, "character", characterId)).toEqual(["Ally"]);
  });

  it("tags each kind of subject separately", () => {
    writeTags(roomId, "npc", npcId, ["Villain"], 1);
    writeTags(roomId, "scene", sceneId, ["Dock"], 1);
    expect(tagsOn(roomId, "npc", npcId)).toEqual(["Villain"]);
    expect(tagsOn(roomId, "scene", sceneId)).toEqual(["Dock"]);
    expect(tagsOn(roomId, "character", characterId)).toEqual([]);
  });

  it("loses a subject's tags with the subject", () => {
    writeTags(roomId, "npc", npcId, ["Villain"], 1);
    db.prepare("DELETE FROM custom_npcs WHERE id = ?").run(npcId);
    expect(tagsOn(roomId, "npc", npcId)).toEqual([]);
  });

  it("gives a GM the whole room and its vocabulary", () => {
    writeTags(roomId, "character", characterId, ["Villain"], 1);
    writeTags(roomId, "npc", npcId, ["Broker"], 1);
    const seen = readRoomTags(1, roomId, "gm");
    expect(seen.enabled).toBe(true);
    expect(seen.tags.character[String(characterId)]).toEqual(["Villain"]);
    expect(seen.tags.npc[String(npcId)]).toEqual(["Broker"]);
    expect(seen.vocabulary).toEqual(["Broker", "Villain"]);
  });

  it("keeps the cast and the unrevealed library from a player", () => {
    writeTags(roomId, "character", characterId, ["Villain"], 1);
    writeTags(roomId, "npc", npcId, ["Broker"], 1);
    writeTags(roomId, "scene", sceneId, ["Dock"], 1);
    const seen = readRoomTags(2, roomId, "player");
    expect(seen.tags.character[String(characterId)]).toEqual(["Villain"]);
    expect(seen.tags.npc).toEqual({});
    expect(seen.tags.scene).toEqual({});
    // And the vocabulary is read from what they were sent, so it cannot leak
    // the words on things they cannot see.
    expect(seen.vocabulary).toEqual(["Villain"]);
  });

  it("shows a player the tags on a revealed scene", () => {
    writeTags(roomId, "scene", sceneId, ["Dock"], 1);
    db.prepare("UPDATE media SET visible = 1 WHERE id = ?").run(sceneId);
    expect(readRoomTags(2, roomId, "player").tags.scene[String(sceneId)]).toEqual(["Dock"]);
  });

  it("has nothing at all in a room whose system has the rule switched off", () => {
    writeTags(roomId, "character", characterId, ["Villain"], 1);
    setRoomRules(roomId, "toybox", { tags: false });
    expect(readRoomTags(1, roomId, "gm")).toEqual(emptyRoomTags(false));
    // Switched off rather than thrown away: the words come back with the rule.
    setRoomRules(roomId, "toybox", { tags: true });
    expect(readRoomTags(1, roomId, "gm").tags.character[String(characterId)]).toEqual(["Villain"]);
  });
});
