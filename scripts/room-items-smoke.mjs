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
