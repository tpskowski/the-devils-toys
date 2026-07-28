import assert from "node:assert/strict";
import { runSmoke } from "./harness.mjs";

await runSmoke("NPC catalog and custom NPC smoke test", async ({ json, setup, redeem, connect, waitFor }) => {
  const gm = await setup("NpcGM", "npc-test-password");
  const gmCookie = gm.cookie;
  const gmJson = gm.headers;

  const cairn = await json(
    "/api/rooms",
    {
      method: "POST",
      headers: gmJson,
      body: JSON.stringify({ name: "Cairn NPC Table", system: "cairn" })
    },
    201
  );
  const cairnRoomId = cairn.body.room.id;
  const monolith = await json(
    "/api/rooms",
    {
      method: "POST",
      headers: gmJson,
      body: JSON.stringify({ name: "Monolith NPC Table", system: "monolith" })
    },
    201
  );

  const cairnCatalog = await json(`/api/rooms/${cairnRoomId}/npcs`, { headers: { cookie: gmCookie } });
  assert.deepEqual(
    cairnCatalog.body.catalog.map((npc) => npc.name),
    ["Root Goblin", "Hooded Men", "Cobblehounds", "Wood Troll", "Frost Elf", "Boggart"]
  );
  assert.ok(cairnCatalog.body.catalog[0].markdown.includes("4 HP, 8 STR, 14 DEX"));

  const monolithCatalog = await json(`/api/rooms/${monolith.body.room.id}/npcs`, {
    headers: { cookie: gmCookie }
  });
  assert.deepEqual(
    monolithCatalog.body.catalog.map((npc) => npc.name),
    ["Street Scummer", "Gang Enforcer", "Space Pirate Captain", "Large Battle Droid", "Feathered Void-Squid"]
  );

  const invitation = await json(
    `/api/rooms/${cairnRoomId}/invitations`,
    { method: "POST", headers: gmJson, body: JSON.stringify({ username: "NpcPlayer" }) },
    201
  );
  const player = await redeem(invitation.body.invitation.token, "npc-player-password");
  const playerCookie = player.cookie;
  const playerJson = player.headers;

  await json(`/api/rooms/${cairnRoomId}/npcs`, { headers: { cookie: playerCookie } }, 403);
  await json(
    `/api/rooms/${cairnRoomId}/npcs`,
    {
      method: "POST",
      headers: playerJson,
      body: JSON.stringify({ name: "Forbidden", notes: "Players cannot create NPCs." })
    },
    403
  );

  const { events } = await connect(gmCookie, cairnRoomId);
  const created = await json(
    `/api/rooms/${cairnRoomId}/npcs`,
    {
      method: "POST",
      headers: gmJson,
      body: JSON.stringify({ name: "Moss Knight", notes: "8 HP, rusted greatsword (d8)" })
    },
    201
  );
  const npcId = created.body.npc.id;
  await waitFor(events, "npcs-updated");

  let custom = await json(`/api/rooms/${cairnRoomId}/npcs`, { headers: { cookie: gmCookie } });
  assert.equal(custom.body.custom[0].name, "Moss Knight");
  assert.equal(custom.body.custom[0].notes, "8 HP, rusted greatsword (d8)");

  await json(
    `/api/rooms/${cairnRoomId}/npcs/${npcId}`,
    {
      method: "PATCH",
      headers: gmJson,
      body: JSON.stringify({ name: "Moss Knight Captain", notes: "10 HP, rusted greatsword (d10)" })
    },
    204
  );
  custom = await json(`/api/rooms/${cairnRoomId}/npcs`, { headers: { cookie: gmCookie } });
  assert.equal(custom.body.custom[0].name, "Moss Knight Captain");

  await json(`/api/rooms/${cairnRoomId}/npcs/${npcId}`, { method: "DELETE", headers: { cookie: gmCookie } }, 204);
  custom = await json(`/api/rooms/${cairnRoomId}/npcs`, { headers: { cookie: gmCookie } });
  assert.equal(custom.body.custom.length, 0);
});
