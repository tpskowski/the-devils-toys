import assert from "node:assert/strict";
import { runSmoke } from "./harness.mjs";

await runSmoke("Room item overlay smoke test", async ({ request, json, setup, login, redeem }) => {
  const admin = await setup("ItemAdmin", "item-admin-password");
  await request(
    "/api/accounts",
    {
      method: "POST",
      headers: admin.headers,
      body: JSON.stringify({ username: "ItemGM", password: "item-gm-password", role: "gm" })
    },
    201
  );
  const gm = await login("ItemGM", "item-gm-password");
  const makeRoom = (name) =>
    request(
      "/api/rooms",
      { method: "POST", headers: gm.headers, body: JSON.stringify({ name, system: "monolith" }) },
      201
    );
  const room = (await makeRoom("The Hold")).room;
  const twin = (await makeRoom("The Other Hold")).room;
  const cairn = (
    await request(
      "/api/rooms",
      { method: "POST", headers: gm.headers, body: JSON.stringify({ name: "Elsewhere", system: "cairn" }) },
      201
    )
  ).room;

  const catalogue = (id, headers = gm.headers) => request(`/api/rooms/${id}/items`, { headers });
  const sheetCatalogue = async (id) =>
    (await request(`/api/rooms/${id}/characters`, { headers: gm.headers })).itemCatalogue;

  const listKey = (await catalogue(room.id)).lists[0].key;
  const before = await sheetCatalogue(room.id);
  const beforeCount = before[listKey].length;

  // --- Adding: it reaches the sheet's own picker, and only this room's ---

  const added = (
    await request(
      `/api/rooms/${room.id}/items`,
      {
        method: "POST",
        headers: gm.headers,
        body: JSON.stringify({ listKey, name: "Bone Saw", spec: "D6, bulky", cost: "5", detail: "", category: "" })
      },
      201
    )
  ).item;
  assert.ok(added.id.startsWith(`room:${room.id}:`), "A room item's id is namespaced with its room.");
  assert.equal(added.weapon, true, "It is read as a weapon on the book's own terms.");
  assert.equal(added.damage, "D6");
  assert.ok(added.traits.includes("bulky"));

  const afterAdd = await sheetCatalogue(room.id);
  assert.equal(afterAdd[listKey].length, beforeCount + 1, "The room's item is in the sheet's picker.");
  assert.ok(afterAdd[listKey].some((item) => item.id === added.id));
  assert.equal(
    (await sheetCatalogue(twin.id))[listKey].length,
    beforeCount,
    "Another room running the same system is untouched."
  );

  // The same name twice is refused rather than silently replacing the first.
  await json(
    `/api/rooms/${room.id}/items`,
    {
      method: "POST",
      headers: gm.headers,
      body: JSON.stringify({ listKey, name: "Bone Saw", spec: "D6, bulky", cost: "5", detail: "", category: "" })
    },
    409
  );

  // --- Retiring: out of the picker here, nowhere else, and the book untouched ---

  const fromBook = before[listKey][0];
  await json(
    `/api/rooms/${room.id}/items/${encodeURIComponent(fromBook.id)}/retire`,
    { method: "POST", headers: gm.headers },
    204
  );
  const afterRetire = await sheetCatalogue(room.id);
  assert.ok(!afterRetire[listKey].some((item) => item.id === fromBook.id), "It is gone from this room's picker.");
  assert.ok(
    (await sheetCatalogue(twin.id))[listKey].some((item) => item.id === fromBook.id),
    "The book still offers it to every other room."
  );

  const retiredList = (await catalogue(room.id)).retired;
  assert.ok(
    retiredList.some((entry) => entry.item.id === fromBook.id),
    "The panel can still see what it retired."
  );
  await json(
    `/api/rooms/${room.id}/items/${encodeURIComponent(fromBook.id)}/restore`,
    { method: "POST", headers: gm.headers },
    204
  );
  assert.ok(
    (await sheetCatalogue(room.id))[listKey].some((item) => item.id === fromBook.id),
    "Restoring puts it back."
  );

  // --- Customising is copy-and-retire in one write ---

  const customised = (
    await request(
      `/api/rooms/${room.id}/items/${encodeURIComponent(fromBook.id)}/customise`,
      { method: "POST", headers: gm.headers },
      201
    )
  ).item;
  const afterCustomise = await sheetCatalogue(room.id);
  assert.ok(
    !afterCustomise[listKey].some((item) => item.id === fromBook.id),
    "The book's version is out of the picker…"
  );
  assert.ok(
    afterCustomise[listKey].some((item) => item.id === customised.id),
    "…and the room's copy is in it."
  );
  assert.equal(customised.name, fromBook.name, "The copy starts as what it was copied from.");

  // --- Renaming moves the id, and does not leave the old entry behind ---

  const renamed = (
    await request(`/api/rooms/${room.id}/items/${encodeURIComponent(added.id)}`, {
      method: "PATCH",
      headers: gm.headers,
      body: JSON.stringify({
        listKey,
        name: "Bone Saw of Ruin",
        spec: "D6, bulky",
        cost: "5",
        detail: "",
        category: ""
      })
    })
  ).item;
  const afterRename = await sheetCatalogue(room.id);
  assert.ok(!afterRename[listKey].some((item) => item.id === added.id), "The old id is gone.");
  assert.ok(
    afterRename[listKey].some((item) => item.id === renamed.id),
    "The new one is there."
  );

  // A rename onto a name another entry already slugs to is refused, rather than
  // upserting over that entry.
  const rival = (
    await request(
      `/api/rooms/${room.id}/items`,
      {
        method: "POST",
        headers: gm.headers,
        body: JSON.stringify({ listKey, name: "Rope", spec: "", cost: "1", detail: "", category: "" })
      },
      201
    )
  ).item;
  await json(
    `/api/rooms/${room.id}/items/${encodeURIComponent(renamed.id)}`,
    {
      method: "PATCH",
      headers: gm.headers,
      body: JSON.stringify({ listKey, name: "rope", spec: "", cost: "1", detail: "", category: "" })
    },
    409
  );
  assert.ok(
    (await sheetCatalogue(room.id))[listKey].some((item) => item.id === rival.id),
    "The entry that already held that id is still there."
  );

  // A list this system's sheet does not have is refused on edit as on create.
  await json(
    `/api/rooms/${room.id}/items/${encodeURIComponent(renamed.id)}`,
    {
      method: "PATCH",
      headers: gm.headers,
      body: JSON.stringify({
        listKey: "nowhere",
        name: "Bone Saw of Ruin",
        spec: "",
        cost: "",
        detail: "",
        category: ""
      })
    },
    400
  );

  // --- Copying, on the same double gate as an NPC ---

  await json(
    `/api/rooms/${room.id}/items/copy-to`,
    { method: "POST", headers: gm.headers, body: JSON.stringify({ roomId: cairn.id, itemIds: [renamed.id] }) },
    409
  );
  await request(
    `/api/rooms/${room.id}/items/copy-to`,
    { method: "POST", headers: gm.headers, body: JSON.stringify({ roomId: twin.id, itemIds: [renamed.id] }) },
    201
  );
  assert.ok(
    (await sheetCatalogue(twin.id))[listKey].some((item) => item.name === "Bone Saw of Ruin"),
    "The copy is in the other room…"
  );
  assert.ok(
    (await sheetCatalogue(twin.id))[listKey].every((item) => item.id !== renamed.id),
    "…under an id of that room's own, never the one it came from."
  );

  // --- A creature armed from the pickers carries the entry, not a re-reading ---

  // A weapon by the heading it is filed under rather than by a die in its
  // parenthetical, which is the case a second reading of the text cannot get
  // right: nothing in "Stun Baton (shock, c-r)" says it is a weapon at all.
  const baton = (
    await request(
      `/api/rooms/${room.id}/items`,
      {
        method: "POST",
        headers: gm.headers,
        body: JSON.stringify({
          listKey,
          name: "Stun Baton",
          spec: "shock, c-r",
          cost: "",
          detail: "",
          category: "STANDARD WEAPONS"
        })
      },
      201
    )
  ).item;
  assert.equal(baton.weapon, true, "The heading it is filed under is what makes it a weapon.");
  assert.equal(baton.label, "Stun Baton (shock, c-r)");

  const guard = (
    await request(
      `/api/rooms/${room.id}/npcs`,
      { method: "POST", headers: gm.headers, body: JSON.stringify({ name: "Dock Guard", notes: "" }) },
      201
    )
  ).npc;
  await json(
    `/api/rooms/${room.id}/npcs/${guard.id}`,
    {
      method: "PATCH",
      headers: gm.headers,
      body: JSON.stringify({
        name: "Dock Guard",
        notes: "",
        // Two weapons, as a character carries two: one out of the pickers and
        // one written in, so the pair is filled both ways at once.
        statblock: { hp: 6, attacks: baton.label, secondWeapon: "Slug Pistol (D8, mid-range)" }
      })
    },
    204
  );
  const fight = (
    await request(
      `/api/rooms/${room.id}/encounters`,
      { method: "POST", headers: gm.headers, body: JSON.stringify({ name: "On the quay" }) },
      201
    )
  ).encounter;
  const armed = (
    await request(
      `/api/rooms/${room.id}/encounters/${fight.id}/combatants`,
      { method: "POST", headers: gm.headers, body: JSON.stringify({ kind: "npc", npcId: guard.id }) },
      201
    )
  ).encounter.combatants.find((entry) => entry.kind === "npc");
  assert.equal(armed.weapon.name, "Stun Baton", "The creature is holding the entry, under the entry's own name.");
  assert.deepEqual(armed.weapon.traits, ["shock", "c-r"], "…with the traits the catalogue gave it.");
  assert.equal(armed.weapon.range, "Melee", "…and the reach the catalogue read, not one worked out again here.");
  assert.equal(armed.offhand.name, "Slug Pistol", "The second slot reaches the rail as the creature's other hand.");
  assert.equal(armed.offhand.damage, "D8");
  assert.equal(armed.offhand.range, "mid-range", "…read from its own notation, since it was typed rather than picked.");

  // A creature given one weapon has one, not an empty second mark beside it.
  const oneHanded = (
    await request(
      `/api/rooms/${room.id}/npcs`,
      { method: "POST", headers: gm.headers, body: JSON.stringify({ name: "Deckhand", notes: "" }) },
      201
    )
  ).npc;
  await json(
    `/api/rooms/${room.id}/npcs/${oneHanded.id}`,
    {
      method: "PATCH",
      headers: gm.headers,
      body: JSON.stringify({ name: "Deckhand", notes: "", statblock: { hp: 3, attacks: baton.label } })
    },
    204
  );
  const alone = (
    await request(
      `/api/rooms/${room.id}/encounters/${fight.id}/combatants`,
      { method: "POST", headers: gm.headers, body: JSON.stringify({ kind: "npc", npcId: oneHanded.id }) },
      201
    )
  ).encounter.combatants.find((entry) => entry.name === "Deckhand");
  assert.equal(alone.weapon.name, "Stun Baton");
  assert.equal(alone.offhand, undefined, "An empty second slot is absent, not a blank weapon.");

  // Anything typed in rather than picked is still read from its own notation.
  const tough = (
    await request(
      `/api/rooms/${room.id}/npcs`,
      { method: "POST", headers: gm.headers, body: JSON.stringify({ name: "Wharf Tough", notes: "" }) },
      201
    )
  ).npc;
  await json(
    `/api/rooms/${room.id}/npcs/${tough.id}`,
    {
      method: "PATCH",
      headers: gm.headers,
      body: JSON.stringify({ name: "Wharf Tough", notes: "", statblock: { hp: 4, attacks: "Cudgel (D6)" } })
    },
    204
  );
  const typed = (
    await request(
      `/api/rooms/${room.id}/encounters/${fight.id}/combatants`,
      { method: "POST", headers: gm.headers, body: JSON.stringify({ kind: "npc", npcId: tough.id }) },
      201
    )
  ).encounter.combatants.find((entry) => entry.name === "Wharf Tough");
  assert.equal(typed.weapon.name, "Cudgel");
  assert.equal(typed.weapon.damage, "D6");

  // --- A character in a pool has no room, and so has the book's catalogue ---

  const pooled = await request(`/api/rooms/${twin.id}/characters`, { headers: gm.headers });
  assert.ok(pooled.itemCatalogue[listKey].length >= beforeCount);

  // --- Who may touch it ---

  const invitation = await request(
    `/api/rooms/${room.id}/invitations`,
    { method: "POST", headers: gm.headers, body: JSON.stringify({ username: "ItemPlayer" }) },
    201
  );
  const player = await redeem(invitation.invitation.token, "item-player-password");
  await json(`/api/rooms/${room.id}/items`, { headers: player.headers }, 403);
  await json(
    `/api/rooms/${room.id}/items`,
    { method: "POST", headers: player.headers, body: JSON.stringify({ listKey, name: "Nope" }) },
    403
  );
  // A player still gets the room's gear where they are meant to: in their sheet.
  const asPlayer = await request(`/api/rooms/${room.id}/characters`, { headers: player.headers });
  assert.ok(asPlayer.itemCatalogue[listKey].some((item) => item.name === "Bone Saw of Ruin"));

  // An admin who is not a member configures it, as everywhere else in the panel.
  await json(`/api/rooms/${room.id}/items`, { headers: admin.headers }, 200);

  // --- The room owns its rows ---

  await json(`/api/rooms/${room.id}`, { method: "DELETE", headers: admin.headers }, 204);
  await json(`/api/rooms/${room.id}/items`, { headers: admin.headers }, 404);
});
