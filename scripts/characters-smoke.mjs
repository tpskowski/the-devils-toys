import assert from "node:assert/strict";
import { runSmoke } from "./harness.mjs";

const portraitPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

await runSmoke("Character ownership smoke test", async ({ base, request, setup, redeem, upload }) => {
  const gm = await setup("CharacterGM", "character-test-password");
  const gmHeaders = gm.headers;

  const room = await request(
    "/api/rooms",
    { method: "POST", headers: gmHeaders, body: JSON.stringify({ name: "Character Table", system: "toybox" }) },
    201
  );
  const secondRoom = await request(
    "/api/rooms",
    { method: "POST", headers: gmHeaders, body: JSON.stringify({ name: "Other Table", system: "toybox" }) },
    201
  );
  const otherSystemRoom = await request(
    "/api/rooms",
    { method: "POST", headers: gmHeaders, body: JSON.stringify({ name: "Other System Table", system: "plainbox" }) },
    201
  );

  const invitation = await request(
    `/api/rooms/${room.room.id}/invitations`,
    { method: "POST", headers: gmHeaders, body: JSON.stringify({ username: "CharacterPlayer" }) },
    201
  );
  const player = await redeem(invitation.invitation.token, "character-player-password");
  const playerCookie = player.cookie;
  const playerHeaders = player.headers;
  const redemption = player.body;

  await request(
    `/api/rooms/${secondRoom.room.id}/members`,
    { method: "POST", headers: gmHeaders, body: JSON.stringify({ accountId: redemption.account.id }) },
    201
  );
  await request(
    `/api/rooms/${otherSystemRoom.room.id}/members`,
    { method: "POST", headers: gmHeaders, body: JSON.stringify({ accountId: redemption.account.id }) },
    201
  );
  const gmCharacter = await request(
    `/api/rooms/${room.room.id}/characters`,
    {
      method: "POST",
      headers: gmHeaders,
      body: JSON.stringify({ name: "Lantern Keeper", sheet: { notes: "Visible, but read-only to players." } })
    },
    201
  );
  await request(`/api/rooms/${room.room.id}/active-character`, {
    method: "PATCH",
    headers: gmHeaders,
    body: JSON.stringify({ characterId: gmCharacter.character.id })
  });
  const activePeerView = await request(`/api/rooms/${room.room.id}/characters`, { headers: playerHeaders });
  assert.ok(
    activePeerView.characters.some(
      (character) => character.id === gmCharacter.character.id && character.name === "Lantern Keeper"
    )
  );
  await request(
    `/api/rooms/${room.room.id}/characters/${gmCharacter.character.id}`,
    { method: "PATCH", headers: playerHeaders, body: JSON.stringify({ name: "Cannot edit this" }) },
    404
  );
  const roomWithActiveGm = await request(`/api/rooms/${room.room.id}`, { headers: playerHeaders });
  const activeGmMember = roomWithActiveGm.members.find((member) => member.username === "CharacterGM");
  assert.equal(activeGmMember.activeCharacterId, gmCharacter.character.id);
  assert.equal(activeGmMember.displayName, "Lantern Keeper (CharacterGM)");

  const pooled = await request(
    `/api/rooms/${room.room.id}/characters`,
    {
      method: "POST",
      headers: gmHeaders,
      body: JSON.stringify({ name: "The Foundling", unassigned: true, sheet: { armor: 4 } })
    },
    201
  );
  assert.equal(pooled.character.ownerAccountId, null);
  assert.match(pooled.character.warnings[0], /armor/i);

  await request(
    `/api/rooms/${room.room.id}/characters/${pooled.character.id}`,
    { method: "PATCH", headers: playerHeaders, body: JSON.stringify({ name: "Not Yet Mine" }) },
    404
  );
  const claimed = await request(`/api/rooms/${room.room.id}/characters/${pooled.character.id}/claim`, {
    method: "POST",
    headers: playerHeaders
  });
  assert.equal(claimed.character.ownerAccountId, redemption.account.id);
  assert.equal(claimed.activeCharacterId, pooled.character.id);

  const updated = await request(`/api/rooms/${room.room.id}/characters/${pooled.character.id}`, {
    method: "PATCH",
    headers: playerHeaders,
    body: JSON.stringify({
      name: "Ash",
      sheet: {
        armor: 4,
        deprived: true,
        hpCurrent: 5,
        hpMax: 3,
        inventory: Array.from({ length: 10 }, (_, index) => `Item ${index + 1}`)
      }
    })
  });
  assert.equal(updated.character.warnings.length, 4);

  const ashMessage = await request(
    `/api/rooms/${room.room.id}/messages`,
    { method: "POST", headers: playerHeaders, body: JSON.stringify({ body: "Ash is ready." }) },
    201
  );
  assert.equal(ashMessage.message.username, "CharacterPlayer");
  assert.equal(ashMessage.message.displayName, "Ash (CharacterPlayer)");
  const ashRoom = await request(`/api/rooms/${room.room.id}`, { headers: playerHeaders });
  const ashMember = ashRoom.members.find((member) => member.accountId === redemption.account.id);
  assert.equal(ashMember.username, "CharacterPlayer");
  assert.equal(ashMember.displayName, "Ash (CharacterPlayer)");
  const ashHistory = await request(`/api/rooms/${room.room.id}/messages`, { headers: playerHeaders });
  assert.equal(
    ashHistory.messages.find((message) => message.id === ashMessage.message.id).displayName,
    "Ash (CharacterPlayer)"
  );

  const portraitUpload = await upload(
    `/api/rooms/${room.room.id}/characters/${pooled.character.id}/portrait`,
    playerCookie,
    { file: new File([portraitPng], "ash.png", { type: "image/png" }) }
  );
  assert.match(portraitUpload.body.character.portraitUrl, /portrait\?v=/);
  const portraitFile = await fetch(`${base}${portraitUpload.body.character.portraitUrl}`, {
    headers: { cookie: playerCookie }
  });
  assert.equal(portraitFile.status, 200);
  assert.match(portraitFile.headers.get("content-type") ?? "", /^image\/png/);

  const personal = await request(
    `/api/rooms/${room.room.id}/characters`,
    { method: "POST", headers: playerHeaders, body: JSON.stringify({ name: "Bracken" }) },
    201
  );
  const switched = await request(`/api/rooms/${room.room.id}/active-character`, {
    method: "PATCH",
    headers: playerHeaders,
    body: JSON.stringify({ characterId: personal.character.id })
  });
  assert.equal(switched.activeCharacterId, personal.character.id);

  const brackenRoom = await request(`/api/rooms/${room.room.id}`, { headers: playerHeaders });
  const brackenMember = brackenRoom.members.find((member) => member.accountId === redemption.account.id);
  assert.equal(brackenMember.displayName, "Bracken (CharacterPlayer)");

  const compatible = await request(`/api/rooms/${secondRoom.room.id}/characters`, { headers: playerHeaders });
  assert.deepEqual(compatible.characters.map((character) => character.name).sort(), ["Ash", "Bracken"]);
  const compatibleAsh = compatible.characters.find((character) => character.name === "Ash");
  assert.match(compatibleAsh.portraitUrl, new RegExp(`/rooms/${secondRoom.room.id}/characters/`));
  const compatiblePortrait = await fetch(`${base}${compatibleAsh.portraitUrl}`, {
    headers: { cookie: playerCookie }
  });
  assert.equal(compatiblePortrait.status, 200);
  const removedPortrait = await request(`/api/rooms/${secondRoom.room.id}/characters/${pooled.character.id}/portrait`, {
    method: "DELETE",
    headers: playerHeaders
  });
  assert.equal(removedPortrait.character.portraitUrl, null);
  const incompatible = await request(`/api/rooms/${otherSystemRoom.room.id}/characters`, { headers: playerHeaders });
  assert.equal(incompatible.characters.length, 0);

  const gmView = await request(`/api/rooms/${room.room.id}/characters`, { headers: gmHeaders });
  assert.ok(gmView.characters.some((character) => character.name === "Ash" && character.activeBy.length === 0));
  assert.ok(
    gmView.characters.some(
      (character) => character.name === "Bracken" && character.activeBy[0]?.displayName === "Bracken (CharacterPlayer)"
    )
  );

  const unassigned = await request(`/api/rooms/${room.room.id}/characters/${personal.character.id}/unassign`, {
    method: "POST",
    headers: gmHeaders
  });
  assert.equal(unassigned.character.ownerAccountId, null);
  const afterUnassign = await request(`/api/rooms/${room.room.id}/characters`, { headers: playerHeaders });
  assert.equal(afterUnassign.activeCharacterId, null);
  assert.ok(
    afterUnassign.characters.some((character) => character.id === personal.character.id && !character.ownerAccountId)
  );

  const unassignedRoom = await request(`/api/rooms/${room.room.id}`, { headers: playerHeaders });
  const unassignedMember = unassignedRoom.members.find((member) => member.accountId === redemption.account.id);
  assert.equal(unassignedMember.displayName, "CharacterPlayer");

  const forbiddenActivation = await request(
    `/api/rooms/${room.room.id}/active-character`,
    { method: "PATCH", headers: playerHeaders, body: JSON.stringify({ characterId: personal.character.id }) },
    403
  );
  assert.match(forbiddenActivation.error, /own compatible/i);
});
