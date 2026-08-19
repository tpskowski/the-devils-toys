import assert from "node:assert/strict";
import { runSmoke } from "./harness.mjs";

/** The one-pixel PNG the other media tests upload; the server reads its bytes, not its name. */
const png = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cff0000004010100ad5d4db10000000049454e44ae426082",
  "hex"
);

/**
 * Optional rules, and the one behaviour the first of them switches on.
 *
 * The two are tested together on purpose: tags are not a feature a room simply
 * has, they are what a rule turns on, and the interesting cases are all at that
 * join — a room that has never been asked, a rule switched on and off again, and
 * a system that declares no rules at all.
 */
await runSmoke("Tags smoke test", async ({ request, json, setup, login, redeem, connect, waitFor, upload }) => {
  const admin = await setup("TagAdmin", "tag-admin-password");
  await request(
    "/api/accounts",
    {
      method: "POST",
      headers: admin.headers,
      body: JSON.stringify({ username: "TagGM", password: "tag-gm-password", role: "gm" })
    },
    201
  );
  const gm = await login("TagGM", "tag-gm-password");

  const room = (
    await request(
      "/api/rooms",
      { method: "POST", headers: gm.headers, body: JSON.stringify({ name: "Tag Table", system: "toybox" }) },
      201
    )
  ).room;
  const plain = (
    await request(
      "/api/rooms",
      { method: "POST", headers: gm.headers, body: JSON.stringify({ name: "Plain Table", system: "plainbox" }) },
      201
    )
  ).room;

  // --- What a system offers, and where a new room stands on it ---

  const status = await request("/api/status", { headers: gm.headers });
  const toybox = status.systems.find((system) => system.id === "toybox");
  assert.deepEqual(
    toybox.optionalRules.map((rule) => rule.id),
    ["tags"],
    "Toybox declares one optional rule, and the status payload carries it so a switch can be labelled."
  );
  assert.equal(toybox.optionalRules[0].feature, "tags");
  assert.deepEqual(
    status.systems.find((system) => system.id === "plainbox").optionalRules,
    [],
    "A system that offers no optional rules says so with an empty list rather than an absent field."
  );

  assert.deepEqual(room.rules, { tags: false }, "A new room starts where the system's own default put it.");
  assert.deepEqual(plain.rules, {}, "A room on a system with no optional rules has none to stand on.");

  // --- The feature is withheld until the rule is on ---

  const off = await request(`/api/rooms/${room.id}/tags`, { headers: gm.headers });
  assert.equal(off.enabled, false, "A room whose rule is off reports that rather than failing.");
  const npc = (
    await request(
      `/api/rooms/${room.id}/npcs`,
      { method: "POST", headers: gm.headers, body: JSON.stringify({ name: "The Broker", notes: "" }) },
      201
    )
  ).npc;
  await json(
    `/api/rooms/${room.id}/tags/npc/${npc.id}`,
    { method: "PUT", headers: gm.headers, body: JSON.stringify({ tags: ["Villain"] }) },
    404
  );

  // --- Switching it on ---

  await json(
    `/api/rooms/${room.id}`,
    { method: "PATCH", headers: gm.headers, body: JSON.stringify({ rules: { tags: true } }) },
    204
  );
  const rooms = await request("/api/rooms", { headers: gm.headers });
  assert.deepEqual(
    rooms.rooms.find((entry) => entry.id === room.id).rules,
    { tags: true },
    "The room's own setting is what every room payload reports."
  );

  // A rule the system never declared is refused by name rather than dropped.
  const refused = await json(
    `/api/rooms/${room.id}`,
    { method: "PATCH", headers: gm.headers, body: JSON.stringify({ rules: { hexcrawl: true } }) },
    400
  );
  assert.match(refused.body.error, /hexcrawl/);

  // --- Tagging, and hearing about it ---

  const watcher = await connect(gm.cookie, room.id);
  const written = await request(`/api/rooms/${room.id}/tags/npc/${npc.id}`, {
    method: "PUT",
    headers: gm.headers,
    body: JSON.stringify({ tags: ["Villain", " villain ", "Inner   Ring"] })
  });
  assert.deepEqual(
    written.tags,
    ["Villain", "Inner Ring"],
    "The words are kept as typed, the spacing tidied, and a repeat in another case dropped."
  );
  await waitFor(watcher.events, "tags-updated", "the room hearing that its tags changed");

  const scene = (
    await upload(`/api/rooms/${room.id}/media`, gm.cookie, {
      kind: "scene",
      file: new File([png], "dock.png", { type: "image/png" })
    })
  ).body.media;
  await request(`/api/rooms/${room.id}/tags/scene/${scene.id}`, {
    method: "PUT",
    headers: gm.headers,
    body: JSON.stringify({ tags: ["Dock"] })
  });

  const seen = await request(`/api/rooms/${room.id}/tags`, { headers: gm.headers });
  assert.deepEqual(seen.tags.npc[String(npc.id)], ["Villain", "Inner Ring"]);
  assert.deepEqual(seen.tags.scene[String(scene.id)], ["Dock"]);
  assert.deepEqual(
    seen.vocabulary,
    ["Dock", "Inner Ring", "Villain"],
    "A room's vocabulary is read back out of the tags in use, alphabetically."
  );

  // --- What a player is shown ---

  const invitation = await request(
    `/api/rooms/${room.id}/invitations`,
    { method: "POST", headers: gm.headers, body: JSON.stringify({ username: "TagPlayer" }) },
    201
  );
  const player = await redeem(invitation.invitation.token, "tag-player-password");
  const character = (
    await request(
      `/api/rooms/${room.id}/characters`,
      { method: "POST", headers: player.headers, body: JSON.stringify({ name: "Vex" }) },
      201
    )
  ).character;
  await request(`/api/rooms/${room.id}/tags/character/${character.id}`, {
    method: "PUT",
    headers: player.headers,
    body: JSON.stringify({ tags: ["Face"] })
  });

  const asPlayer = await request(`/api/rooms/${room.id}/tags`, { headers: player.headers });
  assert.deepEqual(
    asPlayer.tags.character[String(character.id)],
    ["Face"],
    "A player sees their own character's tags."
  );
  assert.deepEqual(asPlayer.tags.npc, {}, "The cast is the GM's, and so are the words on it.");
  assert.deepEqual(asPlayer.tags.scene, {}, "An unrevealed scene is not described to the table either.");
  assert.deepEqual(asPlayer.vocabulary, ["Face"], "The vocabulary is read from what they were sent, so it leaks none.");

  await json(
    `/api/rooms/${room.id}/tags/npc/${npc.id}`,
    { method: "PUT", headers: player.headers, body: JSON.stringify({ tags: ["Nonsense"] }) },
    403
  );

  // --- Switching it off again ---

  await json(
    `/api/rooms/${room.id}`,
    { method: "PATCH", headers: gm.headers, body: JSON.stringify({ rules: { tags: false } }) },
    204
  );
  assert.equal(
    (await request(`/api/rooms/${room.id}/tags`, { headers: gm.headers })).enabled,
    false,
    "Switched off, the room has no tags to show."
  );
  await json(
    `/api/rooms/${room.id}`,
    { method: "PATCH", headers: gm.headers, body: JSON.stringify({ rules: { tags: true } }) },
    204
  );
  assert.deepEqual(
    (await request(`/api/rooms/${room.id}/tags`, { headers: gm.headers })).tags.npc[String(npc.id)],
    ["Villain", "Inner Ring"],
    "The words were switched off rather than thrown away, and come back with the rule."
  );

  // --- And a room whose system offers nothing ---

  const plainTags = await request(`/api/rooms/${plain.id}/tags`, { headers: gm.headers });
  assert.equal(plainTags.enabled, false, "A system with no tags rule has no tags, and nothing to switch.");
});
