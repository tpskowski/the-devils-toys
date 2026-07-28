import assert from "node:assert/strict";
import { runSmoke } from "./harness.mjs";

const mp3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(128)]);

await runSmoke(
  "Synchronized audio smoke test",
  async ({ base, json, setup, redeem, upload, connect, waitFor, sleep }) => {
    const track = (roomId, cookie, file, expected = 201) =>
      upload(`/api/rooms/${roomId}/audio`, cookie, { file }, expected);

    const gm = await setup("AudioGM", "audio-test-password");
    const gmCookie = gm.cookie;
    const gmJson = gm.headers;
    const room = await json(
      "/api/rooms",
      {
        method: "POST",
        headers: gmJson,
        body: JSON.stringify({ name: "Audio Table", system: "monolith" })
      },
      201
    );
    const roomId = room.body.room.id;
    const invitation = await json(
      `/api/rooms/${roomId}/invitations`,
      { method: "POST", headers: gmJson, body: JSON.stringify({ username: "AudioPlayer" }) },
      201
    );
    const player = await redeem(invitation.body.invitation.token, "audio-player-password");
    const playerCookie = player.cookie;
    const playerJson = player.headers;

    const uploaded = await track(roomId, gmCookie, new File([mp3], "derelict-signal.mp3", { type: "audio/mpeg" }));
    const first = uploaded.body.track;
    await track(roomId, gmCookie, new File([mp3], "not-mp3.wav", { type: "audio/wav" }), 415);
    await track(roomId, gmCookie, new File(["not mp3"], "spoof.mp3", { type: "audio/mpeg" }), 415);
    await track(roomId, playerCookie, new File([mp3], "forbidden.mp3", { type: "audio/mpeg" }), 403);

    const playerAudio = await json(`/api/rooms/${roomId}/audio`, { headers: { cookie: playerCookie } });
    assert.deepEqual(
      playerAudio.body.tracks.map((item) => item.id),
      [first.id]
    );
    assert.equal((await fetch(`${base}${first.url}`, { headers: { cookie: playerCookie } })).status, 200);
    await json(
      `/api/rooms/${roomId}/audio/playback`,
      {
        method: "PATCH",
        headers: playerJson,
        body: JSON.stringify({ trackId: first.id, playing: true, position: 0 })
      },
      403
    );

    const { events: playerEvents } = await connect(playerCookie, roomId);
    await json(`/api/rooms/${roomId}/audio/playback`, {
      method: "PATCH",
      headers: gmJson,
      body: JSON.stringify({ trackId: first.id, playing: true, position: 12 })
    });
    const playbackEvent = await waitFor(playerEvents, "audio-playback");
    assert.equal(playbackEvent.playback.trackId, first.id);
    assert.equal(playbackEvent.playback.playing, true);

    await sleep(1100);
    const lateJoin = await json(`/api/rooms/${roomId}/audio`, { headers: { cookie: playerCookie } });
    assert.ok(
      lateJoin.body.playback.position >= 13,
      `Expected derived position, got ${lateJoin.body.playback.position}`
    );

    await json(`/api/rooms/${roomId}/audio/${first.id}`, { method: "DELETE", headers: { cookie: gmCookie } }, 204);
    const afterDelete = await json(`/api/rooms/${roomId}/audio`, { headers: { cookie: playerCookie } });
    assert.equal(afterDelete.body.playback.trackId, null);
    assert.equal((await fetch(`${base}${first.url}`, { headers: { cookie: gmCookie } })).status, 404);
  }
);
