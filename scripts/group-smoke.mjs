import assert from "node:assert/strict";
import { runSmoke } from "./harness.mjs";

await runSmoke("Group roster smoke test", async ({ request, json, setup, login }) => {
  const admin = await setup("GroupAdmin", "group-admin-password");
  await request(
    "/api/accounts",
    {
      method: "POST",
      headers: admin.headers,
      body: JSON.stringify({ username: "GroupGM", password: "group-gm-password", role: "gm" })
    },
    201
  );
  const gm = await login("GroupGM", "group-gm-password");
  const room = (
    await request(
      "/api/rooms",
      { method: "POST", headers: gm.headers, body: JSON.stringify({ name: "The Hold", system: "monolith" }) },
      201
    )
  ).room;

  const group = () => request(`/api/rooms/${room.id}/group`, { headers: gm.headers });

  // --- Hirelings are rows, with their own ids and their own sheets ---

  const first = (
    await request(
      `/api/rooms/${room.id}/group/hirelings`,
      { method: "POST", headers: gm.headers, body: JSON.stringify({ name: "Vetch" }) },
      201
    )
  ).hireling;
  const second = (
    await request(
      `/api/rooms/${room.id}/group/hirelings`,
      { method: "POST", headers: gm.headers, body: JSON.stringify({ name: "Orsk" }) },
      201
    )
  ).hireling;
  assert.equal(typeof first.id, "number", "A hireling's id comes from the database, not the browser.");
  assert.notEqual(first.id, second.id);
  assert.deepEqual([first.sortOrder, second.sortOrder], [0, 1], "A new hireling goes after what is already there.");

  await request(`/api/rooms/${room.id}/group/hirelings/${first.id}`, {
    method: "PATCH",
    headers: gm.headers,
    body: JSON.stringify({ sheet: { hpCurrent: 4, hpMax: 4 } })
  });
  const withSheets = await group();
  assert.deepEqual(
    withSheets.hirelings.map((entry) => entry.name),
    ["Vetch", "Orsk"]
  );
  assert.deepEqual(withSheets.hirelings[0].sheet, { hpCurrent: 4, hpMax: 4 });
  assert.equal(withSheets.hirelings[1].sheet.hpCurrent, undefined, "Editing one row must not touch another.");

  // --- Per-row concurrency, which is what rows buy over one document ---

  const stale = withSheets.hirelings[0].revision;
  await request(`/api/rooms/${room.id}/group/hirelings/${first.id}`, {
    method: "PATCH",
    headers: gm.headers,
    body: JSON.stringify({ name: "Vetch the Lucky" })
  });
  await json(
    `/api/rooms/${room.id}/group/hirelings/${first.id}`,
    { method: "PATCH", headers: gm.headers, body: JSON.stringify({ name: "Too late", revision: stale }) },
    409
  );
  // The other row is untouched by that clash: two people editing two hirelings
  // never collide, which the one-document version could not promise.
  await request(`/api/rooms/${room.id}/group/hirelings/${second.id}`, {
    method: "PATCH",
    headers: gm.headers,
    body: JSON.stringify({ name: "Orsk the Patient", revision: withSheets.hirelings[1].revision })
  });

  // --- Reordering is a column, not an array's shape ---

  await request(`/api/rooms/${room.id}/group/order`, {
    method: "PATCH",
    headers: gm.headers,
    body: JSON.stringify({ kind: "hirelings", ids: [second.id, first.id] })
  });
  assert.deepEqual(
    (await group()).hirelings.map((entry) => entry.id),
    [second.id, first.id]
  );

  // --- A hireling in a fight, and what happens when it leaves the roster ---

  const encounter = (
    await request(
      `/api/rooms/${room.id}/encounters`,
      { method: "POST", headers: gm.headers, body: JSON.stringify({ name: "The ambush" }) },
      201
    )
  ).encounter;
  await request(
    `/api/rooms/${room.id}/encounters/${encounter.id}/combatants`,
    { method: "POST", headers: gm.headers, body: JSON.stringify({ kind: "hireling", hirelingId: first.id }) },
    201
  );
  const inFight = await request(`/api/rooms/${room.id}/encounters/${encounter.id}`, { headers: gm.headers });
  const combatant = inFight.encounter.combatants.find((entry) => entry.kind === "hireling");
  assert.ok(combatant, "The hireling is in the fight.");
  assert.equal(combatant.name, "Vetch the Lucky", "It is named from the row rather than from a stale copy.");
  assert.equal(combatant.hpCurrent, 4, "Its hit points come from its own sheet.");

  // Damage writes through to the row rather than merging into a shared document.
  await request(`/api/rooms/${room.id}/encounters/${encounter.id}/combatants/${combatant.id}`, {
    method: "PATCH",
    headers: gm.headers,
    body: JSON.stringify({ hpCurrent: 1 })
  });
  assert.equal(
    (await group()).hirelings.find((entry) => entry.id === first.id).sheet.hpCurrent,
    1,
    "Damage taken in a fight is on the hireling's own row."
  );

  await json(`/api/rooms/${room.id}/group/hirelings/${first.id}`, { method: "DELETE", headers: gm.headers });
  const afterDelete = await request(`/api/rooms/${room.id}/encounters/${encounter.id}`, { headers: gm.headers });
  assert.equal(
    afterDelete.encounter.combatants.filter((entry) => entry.kind === "hireling").length,
    0,
    "Deleting a hireling takes its combatants with it, by foreign key."
  );

  // --- Ships are the same shape, under whatever kind the system declares ---

  const ship = (
    await request(
      `/api/rooms/${room.id}/group/assets`,
      { method: "POST", headers: gm.headers, body: JSON.stringify({ name: "Desdemona", kind: "starship" }) },
      201
    )
  ).asset;
  await request(`/api/rooms/${room.id}/group/assets/${ship.id}`, {
    method: "PATCH",
    headers: gm.headers,
    body: JSON.stringify({ sheet: { size: "frigate" } })
  });
  const savedShip = (await group()).assets[0];
  assert.deepEqual(savedShip.sheet, { size: "frigate" });
  assert.equal(savedShip.id, ship.id);
  assert.equal(savedShip.kind, "starship");
  assert.equal(savedShip.revision, ship.revision + 1, "Every write moves the row's revision on by one.");

  // The kinds of shared property come from the system definition, so a kind it
  // does not declare is refused rather than quietly stored.
  await json(
    `/api/rooms/${room.id}/group/assets`,
    { method: "POST", headers: gm.headers, body: JSON.stringify({ kind: "stronghold" }) },
    404
  );
  const declared = (await group()).definition.groupAssets;
  assert.deepEqual(
    declared.map((asset) => asset.kind),
    ["starship"],
    "Monolith declares one kind of shared property, read through the generalised list."
  );
  assert.ok(declared[0].sheet.parts?.length, "Its sheet still arrives with the parts its book offers.");

  // --- Obligations, and the group's own fields beside them ---

  const debt = (
    await request(
      `/api/rooms/${room.id}/group/obligations`,
      { method: "POST", headers: gm.headers, body: JSON.stringify({ name: "The Guild", amount: "10k" }) },
      201
    )
  ).obligation;
  await request(`/api/rooms/${room.id}/group`, {
    method: "PATCH",
    headers: gm.headers,
    body: JSON.stringify({ state: { creed: "Owe nothing" } })
  });
  const whole = await group();
  assert.deepEqual(whole.state, { creed: "Owe nothing" }, "The blob holds the group's own fields and nothing else.");
  assert.equal(whole.obligations[0].name, "The Guild");
  assert.equal(whole.obligations[0].amount, "10k");

  await json(`/api/rooms/${room.id}/group/obligations/${debt.id}`, { method: "DELETE", headers: gm.headers });
  assert.equal((await group()).obligations.length, 0);

  // --- A room's roster is its own ---

  const other = (
    await request(
      "/api/rooms",
      { method: "POST", headers: gm.headers, body: JSON.stringify({ name: "Elsewhere", system: "monolith" }) },
      201
    )
  ).room;
  await json(`/api/rooms/${other.id}/group/hirelings/${second.id}`, { method: "PATCH", headers: gm.headers }, 404);
  await json(`/api/rooms/${other.id}/group/assets/${ship.id}`, { method: "DELETE", headers: gm.headers }, 404);

  // Deleting the room takes its roster with it.
  await json(`/api/rooms/${room.id}`, { method: "DELETE", headers: admin.headers }, 204);
  await json(`/api/rooms/${room.id}/group`, { headers: gm.headers }, 404);
});
