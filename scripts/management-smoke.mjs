import assert from "node:assert/strict";
import { runSmoke } from "./harness.mjs";

await runSmoke("Management planning smoke test", async ({ request, setup, login }) => {
  const admin = await setup("ManagementAdmin", "management-admin-password");
  const adminHeaders = admin.headers;

  const adminRoom = await request(
    "/api/rooms",
    {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ name: "Admin Monolith", system: "toybox" })
    },
    201
  );
  const gmAccount = await request(
    "/api/accounts",
    {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ username: "PlanningGM", password: "planning-gm-password", role: "gm" })
    },
    201
  );
  assert.equal(gmAccount.account.role, "gm");

  const gmSession = await login("PlanningGM", "planning-gm-password");
  const gmHeaders = gmSession.headers;
  const gmRoom = await request(
    "/api/rooms",
    {
      method: "POST",
      headers: gmHeaders,
      body: JSON.stringify({ name: "GM Cairn", system: "toybox" })
    },
    201
  );

  const gmLedger = await request("/api/management", { headers: gmHeaders });
  assert.deepEqual(
    gmLedger.rooms.map((room) => room.id),
    [gmRoom.room.id],
    "A GM must only see rooms they manage."
  );
  await request(
    "/api/management/players",
    {
      method: "POST",
      headers: gmHeaders,
      body: JSON.stringify({ username: "ForbiddenGM", password: "forbidden-gm-password", role: "gm" })
    },
    403
  );

  const player = await request(
    "/api/management/players",
    {
      method: "POST",
      headers: gmHeaders,
      body: JSON.stringify({ username: "PreparedPlayer", password: "prepared-player-password" })
    },
    201
  );
  assert.deepEqual(player.player.rooms, []);
  const playerSession = await login("PreparedPlayer", "prepared-player-password");
  const playerCookie = playerSession.cookie;
  await request("/api/management", { headers: { cookie: playerCookie } }, 403);
  await request(
    "/api/rooms",
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie: playerCookie },
      body: JSON.stringify({ name: "Forbidden Player Room", system: "toybox" })
    },
    403
  );

  await request(
    `/api/management/players/${player.player.id}/rooms/${adminRoom.room.id}`,
    { method: "PUT", headers: gmHeaders },
    403
  );
  await request(
    `/api/management/players/${player.player.id}/rooms/${gmRoom.room.id}`,
    { method: "PUT", headers: gmHeaders },
    204
  );
  const assignedLedger = await request("/api/management", { headers: gmHeaders });
  assert.equal(assignedLedger.players.find((item) => item.id === player.player.id).rooms[0].id, gmRoom.room.id);

  const character = await request(
    "/api/management/characters",
    {
      method: "POST",
      headers: gmHeaders,
      body: JSON.stringify({ name: "Unplaced Warden", system: "toybox", ownerAccountId: null, roomId: null })
    },
    201
  );
  assert.equal(character.character.ownerAccountId, null);
  assert.equal(character.character.roomId, null);

  const placed = await request(`/api/management/characters/${character.character.id}`, {
    method: "PATCH",
    headers: gmHeaders,
    body: JSON.stringify({ ownerAccountId: player.player.id, roomId: gmRoom.room.id })
  });
  assert.equal(placed.character.ownerAccountId, player.player.id);
  assert.equal(placed.character.roomId, gmRoom.room.id);

  await request(
    `/api/management/characters/${character.character.id}`,
    {
      method: "PATCH",
      headers: gmHeaders,
      body: JSON.stringify({ roomId: adminRoom.room.id })
    },
    403
  );

  const playerCharacters = await request(`/api/rooms/${gmRoom.room.id}/characters`, {
    headers: { cookie: playerCookie }
  });
  assert.deepEqual(
    playerCharacters.characters.map((item) => item.name),
    ["Unplaced Warden"],
    "A placed character must be visible to its owner."
  );

  await request(
    `/api/management/players/${player.player.id}/password`,
    {
      method: "PATCH",
      headers: gmHeaders,
      body: JSON.stringify({ password: "prepared-player-reset" })
    },
    204
  );
  await request("/api/me", { headers: { cookie: playerCookie } }, 401);
  await login("PreparedPlayer", "prepared-player-reset");

  const adminLedger = await request("/api/management", { headers: adminHeaders });
  assert.ok(adminLedger.rooms.some((room) => room.id === gmRoom.room.id));
  assert.ok(adminLedger.characters.some((item) => item.id === character.character.id));

  await request(`/api/management/characters/${character.character.id}`, { method: "DELETE", headers: gmHeaders }, 204);
  const finalLedger = await request("/api/management", { headers: gmHeaders });
  assert.equal(finalLedger.characters.length, 0);

  await request(
    `/api/management/players/${gmAccount.account.id}/role`,
    { method: "PATCH", headers: adminHeaders, body: JSON.stringify({ role: "player" }) },
    409
  );
  await request(
    `/api/management/players/${gmAccount.account.id}/role`,
    {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({ role: "player", confirmRoomTransfer: true })
    },
    204
  );
  const downgradedAccount = await request("/api/me", { headers: gmHeaders });
  assert.equal(downgradedAccount.account.role, "player");
  const downgradedRooms = await request("/api/rooms", { headers: gmHeaders });
  assert.equal(downgradedRooms.rooms.find((room) => room.id === gmRoom.room.id).role, "player");
  const transferredRoom = await request(`/api/rooms/${gmRoom.room.id}`, { headers: adminHeaders });
  assert.equal(transferredRoom.room.role, "gm");
  await request("/api/management", { headers: gmHeaders }, 403);
});
