import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runSmoke } from "./harness.mjs";

await runSmoke("Production smoke test", async ({ base, dataDir, json, setup, redeem }) => {
  const gm = await setup("SmokeGM", "smoke-test-password");
  const headers = gm.headers;
  const room = await json(
    "/api/rooms",
    {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Smoke Table", system: "cairn" })
    },
    201
  );
  assert.equal(room.body.room.theme, "heroic");
  const rulesResponse = await fetch(`${base}/api/rooms/${room.body.room.id}/rules`, { headers });
  assert.equal(rulesResponse.status, 200);
  const standaloneRulesPage = await fetch(`${base}/rules/cairn?room=${room.body.room.id}`, { headers });
  assert.equal(standaloneRulesPage.status, 200);
  assert.match(
    await standaloneRulesPage.text(),
    /<div id="root"><\/div>/,
    "The production server should return the app shell for a per-system rules path"
  );
  assert.match(rulesResponse.headers.get("content-type") ?? "", /text\/markdown/);
  const rulesText = await rulesResponse.text();
  assert.ok(rulesText.length > 40_000, "The complete Cairn rules should be available from a workspace start.");
  assert.match(rulesText, /# Cairn/);

  const roll = await json(
    `/api/rooms/${room.body.room.id}/messages`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ body: "/roll 2d6+1" })
    },
    201
  );
  const invitation = await json(
    `/api/rooms/${room.body.room.id}/invitations`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ username: "SmokePlayer" })
    },
    201
  );
  assert.equal(invitation.body.invitation.status, "pending");
  assert.equal(invitation.body.invitation.token.length > 30, true);

  const inviteDetail = await json(`/api/invitations/${invitation.body.invitation.token}`);
  assert.equal(inviteDetail.body.invitation.roomName, "Smoke Table");
  assert.equal(inviteDetail.body.invitation.status, "pending");

  const player = await redeem(invitation.body.invitation.token, "player-chosen-password");
  const playerCookie = player.cookie;
  const playerRooms = await json("/api/rooms", { headers: { cookie: playerCookie } });
  assert.equal(playerRooms.body.rooms[0].id, room.body.room.id);
  assert.equal(playerRooms.body.rooms[0].role, "player");

  await json(
    `/api/invitations/${invitation.body.invitation.token}/redeem`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "another-password" })
    },
    410
  );

  const revoked = await json(
    `/api/rooms/${room.body.room.id}/invitations`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ username: "RevokedPlayer" })
    },
    201
  );
  await json(
    `/api/rooms/${room.body.room.id}/invitations/${revoked.body.invitation.id}`,
    { method: "DELETE", headers },
    204
  );
  const revokedDetail = await json(`/api/invitations/${revoked.body.invitation.token}`);
  assert.equal(revokedDetail.body.invitation.status, "revoked");
  await json(
    `/api/invitations/${revoked.body.invitation.token}/redeem`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "cannot-use-this" })
    },
    410
  );

  const directAccount = await json(
    "/api/accounts",
    {
      method: "POST",
      headers,
      body: JSON.stringify({ username: "DirectPlayer", password: "direct-player-password" })
    },
    201
  );
  const memberOptions = await json(`/api/rooms/${room.body.room.id}/member-options`, { headers });
  assert.ok(memberOptions.body.accounts.some((account) => account.id === directAccount.body.account.id));

  const addedMember = await json(
    `/api/rooms/${room.body.room.id}/members`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ accountId: directAccount.body.account.id })
    },
    201
  );
  assert.equal(addedMember.body.member.role, "player");
  const roomDetail = await json(`/api/rooms/${room.body.room.id}`, { headers });
  assert.ok(roomDetail.body.members.some((member) => member.accountId === directAccount.body.account.id));

  const directLogin = await json("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "DirectPlayer", password: "direct-player-password" })
  });
  const directCookie = directLogin.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(directCookie);
  await json(
    `/api/rooms/${room.body.room.id}/members/${directAccount.body.account.id}`,
    { method: "DELETE", headers },
    204
  );
  await json(`/api/rooms/${room.body.room.id}`, { headers: { cookie: directCookie } }, 404);

  const disposable = await json(
    "/api/rooms",
    {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Disposable Table", system: "monolith" })
    },
    201
  );
  const disposableId = disposable.body.room.id;
  await json(`/api/rooms/${disposableId}`, { method: "PATCH", headers, body: JSON.stringify({ archived: true }) }, 204);
  const archivedRooms = await json("/api/rooms", { headers });
  assert.equal(archivedRooms.body.rooms.find((item) => item.id === disposableId).archived, true);
  await json(
    `/api/rooms/${disposableId}`,
    { method: "PATCH", headers, body: JSON.stringify({ archived: false }) },
    204
  );

  await json(`/api/rooms/${disposableId}`, { method: "DELETE", headers: { cookie: playerCookie } }, 403);
  await json(`/api/rooms/${disposableId}`, { method: "DELETE", headers }, 204);
  await json(`/api/rooms/${disposableId}`, { headers }, 404);

  await json(`/api/rooms/${room.body.room.id}/messages`, { method: "DELETE", headers: { cookie: playerCookie } }, 403);
  await json(`/api/rooms/${room.body.room.id}/messages`, { method: "DELETE", headers }, 204);
  const clearedMessages = await json(`/api/rooms/${room.body.room.id}/messages`, { headers });
  assert.equal(clearedMessages.body.messages.length, 0);

  await json(
    `/api/accounts/${gm.account.id}/password`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: playerCookie },
      body: JSON.stringify({ password: "players-cannot-reset-gms" })
    },
    403
  );
  await json(
    `/api/accounts/${player.account.id}/password`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ password: "recovered-player-password" })
    },
    204
  );
  await json("/api/me", { headers: { cookie: playerCookie } }, 401);
  await json(
    "/api/login",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "SmokePlayer", password: "player-chosen-password" })
    },
    401
  );
  const recoveredLogin = await json("/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "SmokePlayer", password: "recovered-player-password" })
  });
  assert.equal(recoveredLogin.body.account.username, "SmokePlayer");

  const invitePage = await fetch(`${base}/invite/${invitation.body.invitation.token}`);
  assert.equal(invitePage.status, 200);
  assert.match(await invitePage.text(), /id="root"/);
  assert.equal(roll.body.message.kind, "roll");
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /id="root"/);
  const log = await readFile(path.join(dataDir, "logs", "server.log"), "utf8");
  assert.match(log, /"message":"The Devil's Toys is ready"/);
});
