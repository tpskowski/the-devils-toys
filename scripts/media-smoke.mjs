import assert from "node:assert/strict";
import { runSmoke } from "./harness.mjs";

const png = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cff0000004010100ad5d4db10000000049454e44ae426082",
  "hex"
);
const largePng = Buffer.concat([png, Buffer.alloc(1024 * 1024)]);

await runSmoke(
  "Map, Scene, image Reference, and Markdown Reference smoke test",
  async ({ base, json, setup, redeem, upload, connect, waitFor, serverOutput }) => {
    const media = (roomId, cookie, kind, file, expected = 201) =>
      upload(`/api/rooms/${roomId}/media`, cookie, { kind, file }, expected);

    const gm = await setup("MediaGM", "media-test-password");
    const gmCookie = gm.cookie;
    const gmJson = gm.headers;
    const room = await json(
      "/api/rooms",
      {
        method: "POST",
        headers: gmJson,
        body: JSON.stringify({ name: "Media Table", system: "toybox" })
      },
      201
    );
    const roomId = room.body.room.id;
    const invitation = await json(
      `/api/rooms/${roomId}/invitations`,
      {
        method: "POST",
        headers: gmJson,
        body: JSON.stringify({ username: "MediaPlayer" })
      },
      201
    );
    const player = await redeem(invitation.body.invitation.token, "media-player-password");
    const playerCookie = player.cookie;
    const playerJson = player.headers;

    const mapUpload = await media(
      roomId,
      gmCookie,
      "map",
      new File([png], "ruined-complex.png", { type: "image/png" })
    );
    const sceneUpload = await media(
      roomId,
      gmCookie,
      "scene",
      new File([png], "foggy-road.png", { type: "image/png" })
    );
    const referenceUpload = await media(
      roomId,
      gmCookie,
      "reference",
      new File([png], "strange-map.png", { type: "image/png" })
    );
    const markdownSource = "# Mission Brief\n\n| Signal | Status |\n| --- | --- |\n| Black relay | Active |\n";
    const markdownUpload = await media(
      roomId,
      gmCookie,
      "reference",
      new File([markdownSource], "mission-brief.md", { type: "text/markdown" })
    );
    const map = mapUpload.body.media;
    const scene = sceneUpload.body.media;
    const reference = referenceUpload.body.media;
    const markdownReference = markdownUpload.body.media;
    assert.equal(map.visible, false);
    assert.equal(scene.visible, false);
    assert.equal(reference.visible, false);
    assert.equal(markdownReference.visible, false);

    const largeSceneUpload = await media(
      roomId,
      gmCookie,
      "scene",
      new File([largePng], "large-scene.png", { type: "image/png" })
    );
    await media(roomId, gmCookie, "reference", new File([largePng], "large-reference.png", { type: "image/png" }), 413);

    await media(roomId, gmCookie, "scene", new File([png], "animated.gif", { type: "image/gif" }), 415);
    await media(roomId, gmCookie, "scene", new File(["not an image"], "spoof.png", { type: "image/png" }), 415);
    await media(
      roomId,
      gmCookie,
      "reference",
      new File([Buffer.from([0xff, 0xfe, 0x00])], "invalid.md", { type: "text/markdown" }),
      415
    );
    await media(roomId, gmCookie, "map", new File(["# Not a map"], "not-a-map.md", { type: "text/markdown" }), 400);
    await media(roomId, playerCookie, "scene", new File([png], "forbidden.png", { type: "image/png" }), 403);

    const renamedMap = await json(`/api/rooms/${roomId}/media/${map.id}`, {
      method: "PATCH",
      headers: gmJson,
      body: JSON.stringify({ displayName: "The Ruined Complex" })
    });
    assert.equal(renamedMap.body.media.displayName, "The Ruined Complex");
    assert.equal(renamedMap.body.media.filename, "ruined-complex.png");
    await json(
      `/api/rooms/${roomId}/media/${map.id}`,
      { method: "PATCH", headers: playerJson, body: JSON.stringify({ displayName: "Forbidden rename" }) },
      403
    );

    let playerMedia = await json(`/api/rooms/${roomId}/media`, { headers: { cookie: playerCookie } });
    assert.equal(playerMedia.body.map, null);
    assert.equal(playerMedia.body.scene, null);
    assert.deepEqual(playerMedia.body.references, []);
    assert.deepEqual(playerMedia.body.library, []);
    let gmMedia = await json(`/api/rooms/${roomId}/media`, { headers: { cookie: gmCookie } });
    assert.equal(gmMedia.body.library.find((item) => item.id === map.id).displayName, "The Ruined Complex");
    assert.deepEqual(gmMedia.body.library.map((item) => item.kind).sort(), [
      "map",
      "reference",
      "reference",
      "scene",
      "scene"
    ]);
    assert.deepEqual(gmMedia.body.revealedReferenceIds, []);
    await json(`/api/media/${reference.id}/file`, { headers: { cookie: playerCookie } }, 404);
    await json(`/api/media/${map.id}/file`, { headers: { cookie: playerCookie } }, 404);

    await json(
      `/api/rooms/${roomId}/media/${map.id}/visibility`,
      { method: "PATCH", headers: playerJson, body: JSON.stringify({ visible: true }) },
      403
    );
    await json(
      `/api/rooms/${roomId}/media/${map.id}/visibility`,
      { method: "PATCH", headers: gmJson, body: JSON.stringify({ visible: true }) },
      204
    );
    playerMedia = await json(`/api/rooms/${roomId}/media`, { headers: { cookie: playerCookie } });
    assert.equal(playerMedia.body.map, null);
    assert.deepEqual(
      playerMedia.body.library.map((item) => item.id),
      [map.id]
    );
    assert.equal((await fetch(`${base}${map.url}`, { headers: { cookie: playerCookie } })).status, 200);
    await json(
      `/api/rooms/${roomId}/media/${map.id}/visibility`,
      { method: "PATCH", headers: gmJson, body: JSON.stringify({ visible: false }) },
      204
    );
    await json(`/api/media/${map.id}/file`, { headers: { cookie: playerCookie } }, 404);

    await json(
      `/api/rooms/${roomId}/map`,
      { method: "PATCH", headers: gmJson, body: JSON.stringify({ mediaId: map.id }) },
      204
    );
    await json(
      `/api/rooms/${roomId}/scene`,
      { method: "PATCH", headers: gmJson, body: JSON.stringify({ mediaId: scene.id }) },
      204
    );
    playerMedia = await json(`/api/rooms/${roomId}/media`, { headers: { cookie: playerCookie } });
    assert.equal(playerMedia.body.scene.id, scene.id);
    assert.equal(playerMedia.body.map.id, map.id);
    assert.equal(playerMedia.body.map.visible, true);
    assert.equal(playerMedia.body.scene.visible, true);
    assert.deepEqual(
      playerMedia.body.library.map((item) => item.id),
      [scene.id, map.id]
    );
    const sceneFile = await fetch(`${base}${scene.url}`, { headers: { cookie: playerCookie } });
    const mapFile = await fetch(`${base}${map.url}`, { headers: { cookie: playerCookie } });
    assert.equal(mapFile.status, 200);
    assert.equal(mapFile.headers.get("content-type"), "image/png");
    const sceneError = sceneFile.status === 200 ? "" : await sceneFile.text();
    assert.equal(sceneFile.status, 200, `${sceneError} ${serverOutput()}`);
    assert.equal(sceneFile.headers.get("content-type"), "image/png");

    await json(
      `/api/rooms/${roomId}/references/${reference.id}/reveal`,
      { method: "POST", headers: { cookie: gmCookie } },
      204
    );
    playerMedia = await json(`/api/rooms/${roomId}/media`, { headers: { cookie: playerCookie } });
    await json(
      `/api/rooms/${roomId}/references/${markdownReference.id}/reveal`,
      { method: "POST", headers: { cookie: gmCookie } },
      204
    );
    playerMedia = await json(`/api/rooms/${roomId}/media`, { headers: { cookie: playerCookie } });
    assert.deepEqual(
      playerMedia.body.references.map((item) => item.id),
      [markdownReference.id, reference.id]
    );
    gmMedia = await json(`/api/rooms/${roomId}/media`, { headers: { cookie: gmCookie } });
    assert.deepEqual(gmMedia.body.revealedReferenceIds, [markdownReference.id, reference.id]);
    const markdownFile = await fetch(`${base}${markdownReference.url}`, { headers: { cookie: playerCookie } });
    assert.equal(markdownFile.status, 200);
    assert.match(markdownFile.headers.get("content-type") ?? "", /^text\/markdown/);
    assert.equal(await markdownFile.text(), markdownSource);

    const gmLive = await connect(gmCookie, roomId);
    const playerLive = await connect(playerCookie, roomId);
    await waitFor(playerLive.events, (event) => event.type === "presence", "room join");
    playerLive.socket.send(JSON.stringify({ type: "scene-ping", x: 0.25, y: 0.75 }));
    const ping = await waitFor(gmLive.events, (event) => event.type === "scene-ping", "Scene ping");
    assert.equal(ping.ping.username, "MediaPlayer");
    assert.equal(ping.ping.x, 0.25);

    await json(
      `/api/rooms/${roomId}/media/${reference.id}/visibility`,
      { method: "PATCH", headers: gmJson, body: JSON.stringify({ visible: false }) },
      204
    );
    playerMedia = await json(`/api/rooms/${roomId}/media`, { headers: { cookie: playerCookie } });
    assert.deepEqual(
      playerMedia.body.references.map((item) => item.id),
      [markdownReference.id]
    );
    gmMedia = await json(`/api/rooms/${roomId}/media`, { headers: { cookie: gmCookie } });
    assert.deepEqual(gmMedia.body.revealedReferenceIds, [markdownReference.id]);
    assert.equal(gmMedia.body.library.find((item) => item.id === reference.id).visible, false);
    await json(`/api/media/${reference.id}/file`, { headers: { cookie: playerCookie } }, 404);
    assert.equal((await fetch(`${base}${reference.url}`, { headers: { cookie: gmCookie } })).status, 200);

    await json(
      `/api/rooms/${roomId}/media/${largeSceneUpload.body.media.id}`,
      { method: "DELETE", headers: { cookie: gmCookie } },
      204
    );
    await json(`/api/rooms/${roomId}/media/${reference.id}`, { method: "DELETE", headers: { cookie: gmCookie } }, 204);
    await json(
      `/api/rooms/${roomId}/media/${markdownReference.id}`,
      { method: "DELETE", headers: { cookie: gmCookie } },
      204
    );
    await json(`/api/media/${reference.id}/file`, { headers: { cookie: gmCookie } }, 404);
  },
  { env: { DEVILS_TOYS_SCENE_IMAGE_LIMIT_MB: "2", DEVILS_TOYS_REFERENCE_IMAGE_LIMIT_MB: "1" } }
);
