import { describe, expect, it } from "vitest";
import { db, one } from "./db.js";
import { pauseRoomAudio, roomMusicEnabled } from "./audio.js";
import { installToybox } from "./test-fixture.js";

installToybox();

function seedRoom(id: number, enabled: boolean) {
  db.prepare("INSERT INTO accounts (id, username, password_hash, account_role) VALUES (?, ?, 'hash', 'gm')").run(
    id,
    `gm-${id}`
  );
  db.prepare(
    "INSERT INTO rooms (id, name, system, theme, music_enabled, created_by) VALUES (?, ?, 'toybox', 'heroic', ?, ?)"
  ).run(id, `Room ${id}`, enabled ? 1 : 0, id);
  db.prepare("INSERT INTO room_state (room_id) VALUES (?)").run(id);
}

describe("optional room music", () => {
  it("is unavailable until the room setting is enabled", () => {
    seedRoom(1, false);

    expect(roomMusicEnabled(1)).toBe(false);
    db.prepare("UPDATE rooms SET music_enabled = 1 WHERE id = 1").run();
    expect(roomMusicEnabled(1)).toBe(true);
  });

  it("stops active playback when the feature is disabled", () => {
    seedRoom(2, true);
    db.prepare("UPDATE room_state SET audio_json = ? WHERE room_id = 2").run(
      JSON.stringify({
        trackId: 42,
        playing: true,
        position: 7,
        repeat: "all",
        shuffle: true,
        updatedAt: new Date().toISOString()
      })
    );

    pauseRoomAudio(2);

    const stored = JSON.parse(
      one<{ audio_json: string }>("SELECT audio_json FROM room_state WHERE room_id = 2")!.audio_json
    );
    expect(stored).toMatchObject({ trackId: 42, playing: false, repeat: "all", shuffle: true });
    expect(stored.position).toBeGreaterThanOrEqual(7);
  });
});
