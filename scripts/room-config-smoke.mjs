import assert from "node:assert/strict";
import { runSmoke } from "./harness.mjs";

await runSmoke("Room Config smoke test", async ({ request, json, setup, login, redeem, connect, waitFor }) => {
  const admin = await setup("ConfigAdmin", "config-admin-password");

  const makeAccount = (username, password, role) =>
    request(
      "/api/accounts",
      { method: "POST", headers: admin.headers, body: JSON.stringify({ username, password, role }) },
      201
    );
  await makeAccount("ConfigGM", "config-gm-password", "gm");
  await makeAccount("RivalGM", "rival-gm-password", "gm");

  const gm = await login("ConfigGM", "config-gm-password");
  const rival = await login("RivalGM", "rival-gm-password");

  const makeRoom = (headers, name, system) =>
    request("/api/rooms", { method: "POST", headers, body: JSON.stringify({ name, system }) }, 201);
  const gmRoom = (await makeRoom(gm.headers, "GM Table", "toybox")).room;
  const rivalRoom = (await makeRoom(rival.headers, "Rival Table", "plainbox")).room;
  const adminRoom = (await makeRoom(admin.headers, "Admin Table", "toybox")).room;

  // A player who is a member of the GM's room, to prove that belonging to a room
  // is not what grants the right to configure it.
  const invitation = await request(
    `/api/rooms/${gmRoom.id}/invitations`,
    { method: "POST", headers: gm.headers, body: JSON.stringify({ username: "ConfigPlayer" }) },
    201
  );
  const player = await redeem(invitation.invitation.token, "config-player-password");

  // --- Who may open the panel at all ---

  await json("/api/room-config/rooms", { headers: player.headers }, 403);
  await json(`/api/room-config/${gmRoom.id}`, { headers: player.headers }, 403);
  await json("/api/room-config/rooms", {}, 401);

  const gmRooms = await request("/api/room-config/rooms", { headers: gm.headers });
  assert.deepEqual(
    gmRooms.rooms.map((room) => room.name),
    ["GM Table"],
    "A GM should see only the rooms they are GM of."
  );
  assert.equal(gmRooms.rooms[0].access, "gm");

  const adminRooms = await request("/api/room-config/rooms", { headers: admin.headers });
  assert.deepEqual(
    adminRooms.rooms.map((room) => room.name).sort(),
    ["Admin Table", "GM Table", "Rival Table"],
    "An admin should see every room on the server."
  );
  assert.ok(
    adminRooms.rooms.every((room) => room.access === "admin"),
    "An admin reaches rooms as an admin, not as a GM."
  );

  await json(`/api/room-config/${rivalRoom.id}`, { headers: gm.headers }, 404);
  await json(`/api/room-config/${gmRoom.id}`, { headers: gm.headers }, 200);
  await json(`/api/room-config/${gmRoom.id}`, { headers: admin.headers }, 200);
  await json(`/api/room-config/${gmRoom.id + 9000}`, { headers: admin.headers }, 404);

  // --- What a room's sections are ---

  const full = await request(`/api/room-config/${gmRoom.id}`, { headers: gm.headers });
  const sectionIds = full.sections.map((section) => section.id);
  assert.ok(sectionIds.includes("hirelings"), "Toybox declares hirelings, so the section is offered.");
  assert.ok(sectionIds.includes("assets"), "Toybox declares a group asset sheet, so group assets are offered.");
  assert.equal(
    full.sections.find((section) => section.id === "calendar").enabled,
    false,
    "A new room has no calendar, so the section is listed switched off."
  );

  const minimal = await request(`/api/room-config/${rivalRoom.id}`, { headers: admin.headers });
  assert.ok(
    !minimal.sections.some((section) => section.id === "assets"),
    "Plainbox has no group assets, so the section is left out rather than shown empty."
  );

  // Turning a section on is setup, and belongs to the panel.
  await json(
    `/api/rooms/${gmRoom.id}`,
    { method: "PATCH", headers: gm.headers, body: JSON.stringify({ calendarEnabled: true }) },
    204
  );
  const withCalendar = await request(`/api/room-config/${gmRoom.id}`, { headers: gm.headers });
  assert.equal(withCalendar.sections.find((section) => section.id === "calendar").enabled, true);

  // --- Watching a room without being in it ---

  const table = await connect(gm.cookie, gmRoom.id);
  const panel = await connect(admin.cookie, gmRoom.id, { mode: "watch" });
  await waitFor(table.events, "presence", "the GM's presence");

  await request(
    `/api/rooms/${gmRoom.id}/messages`,
    { method: "POST", headers: gm.headers, body: JSON.stringify({ body: "Only the table hears this." }) },
    201
  );
  // Sent after the message, so its arrival proves the message had its chance.
  await json(
    `/api/rooms/${gmRoom.id}`,
    { method: "PATCH", headers: gm.headers, body: JSON.stringify({ musicEnabled: true }) },
    204
  );
  await waitFor(panel.events, "room-updated", "the panel's change notice");
  assert.ok(
    !panel.events.some((event) => event.type === "message"),
    "A watching panel must not receive the room's chat."
  );
  assert.ok(
    !panel.events.some((event) => event.type === "presence"),
    "A watching panel must not receive the room's presence."
  );

  const presence = await waitFor(table.events, "presence", "the room's members", { latest: true });
  assert.ok(
    !presence.members.some((member) => member.username === "ConfigAdmin"),
    "An admin watching from the panel must never appear in the room."
  );

  // The admin's own room exists so "every room" is more than "every room someone
  // else made"; nothing else needs it.
  assert.ok(adminRooms.rooms.some((room) => room.id === adminRoom.id));

  // --- The Library, including from an admin who is not a member ---

  const addAsset = async (headers, kind, name) => {
    const form = new FormData();
    form.append("file", new Blob([pngBytes()], { type: "image/png" }), name);
    form.append("kind", kind);
    const created = await request(
      `/api/rooms/${gmRoom.id}/media`,
      { method: "POST", headers: onlyCookie(headers), body: form },
      201
    );
    return created.media;
  };
  const oneMap = await addAsset(gm.headers, "map", "keep.png");
  const oneScene = await addAsset(gm.headers, "scene", "hall.png");
  // Uploaded by the admin, in a room they do not belong to.
  const oneReference = await addAsset(admin.headers, "reference", "letter.png");

  const asAdmin = await request(`/api/rooms/${gmRoom.id}/media`, { headers: admin.headers });
  assert.equal(asAdmin.library.length, 3, "An admin who is not a member still sees the whole library.");
  assert.ok("revealedReferenceIds" in asAdmin, "An admin sees the GM's view of the library, not a player's.");
  await json(`/api/rooms/${gmRoom.id}/media`, { headers: player.headers });
  const asPlayer = await request(`/api/rooms/${gmRoom.id}/media`, { headers: player.headers });
  assert.equal(asPlayer.library.length, 0, "A player still sees only what has been revealed.");
  assert.ok(!("revealedReferenceIds" in asPlayer), "A player never gets the GM's view.");

  // Bulk refiling, and the guard that makes it all-or-nothing.
  await json(
    `/api/rooms/${gmRoom.id}/media/bulk`,
    {
      method: "PATCH",
      headers: admin.headers,
      body: JSON.stringify({ ids: [oneScene.id, oneReference.id], category: "reference" })
    },
    204
  );
  const refiled = await request(`/api/rooms/${gmRoom.id}/media`, { headers: gm.headers });
  assert.equal(
    refiled.library.filter((asset) => asset.kind === "reference").length,
    2,
    "Bulk refiling moves every asset it names."
  );

  const rivalAsset = (await request(`/api/rooms/${rivalRoom.id}/media`, { headers: rival.headers })).library[0];
  assert.equal(rivalAsset, undefined);
  await json(
    `/api/rooms/${gmRoom.id}/media/bulk`,
    { method: "PATCH", headers: gm.headers, body: JSON.stringify({ ids: [oneMap.id, 9999], visible: true }) },
    404
  );
  const untouched = await request(`/api/rooms/${gmRoom.id}/media`, { headers: gm.headers });
  assert.equal(
    untouched.library.find((asset) => asset.id === oneMap.id).visible,
    false,
    "A bulk request naming one asset it may not have must change none of them."
  );

  // Making a map active, then refiling it, must not leave the room pointing at it.
  await json(
    `/api/rooms/${gmRoom.id}/map`,
    { method: "PATCH", headers: gm.headers, body: JSON.stringify({ mediaId: oneMap.id }) },
    204
  );
  assert.equal((await request(`/api/rooms/${gmRoom.id}/media`, { headers: gm.headers })).map.id, oneMap.id);
  await json(
    `/api/rooms/${gmRoom.id}/media/bulk`,
    { method: "PATCH", headers: gm.headers, body: JSON.stringify({ ids: [oneMap.id], category: "reference" }) },
    204
  );
  assert.equal(
    (await request(`/api/rooms/${gmRoom.id}/media`, { headers: gm.headers })).map,
    null,
    "An asset that stops being a map cannot stay the room's active one."
  );

  const removed = await request(
    `/api/rooms/${gmRoom.id}/media/bulk-delete`,
    { method: "POST", headers: admin.headers, body: JSON.stringify({ ids: [oneMap.id, oneScene.id] }) },
    200
  );
  assert.equal(removed.deleted, 2);
  assert.equal((await request(`/api/rooms/${gmRoom.id}/media`, { headers: gm.headers })).library.length, 1);

  await json(`/api/rooms/${gmRoom.id}/media/bulk`, { method: "PATCH", headers: player.headers }, 403);
  await json(`/api/rooms/${rivalRoom.id}/media/bulk`, { method: "PATCH", headers: gm.headers }, 403);

  // --- NPCs, and copying one between rooms ---

  const npc = (
    await request(
      `/api/rooms/${gmRoom.id}/npcs`,
      {
        method: "POST",
        headers: admin.headers,
        body: JSON.stringify({ name: "Harrow", notes: "Waits by the door.", statblock: {} })
      },
      201
    )
  ).npc;

  const monolithTwin = (
    await request(
      "/api/rooms",
      { method: "POST", headers: gm.headers, body: JSON.stringify({ name: "GM Second Table", system: "toybox" }) },
      201
    )
  ).room;

  await request(
    `/api/rooms/${gmRoom.id}/npcs/${npc.id}/copy-to`,
    { method: "POST", headers: gm.headers, body: JSON.stringify({ roomId: monolithTwin.id }) },
    201
  );
  assert.deepEqual(
    (await request(`/api/rooms/${monolithTwin.id}/npcs`, { headers: gm.headers })).custom.map((entry) => entry.name),
    ["Harrow"],
    "Copying an NPC puts it in the other room."
  );

  // The double gate: the source is reachable, the target is not.
  await json(
    `/api/rooms/${gmRoom.id}/npcs/${npc.id}/copy-to`,
    { method: "POST", headers: gm.headers, body: JSON.stringify({ roomId: rivalRoom.id }) },
    404
  );
  // Reachable on both sides, but the systems disagree.
  await json(
    `/api/rooms/${gmRoom.id}/npcs/${npc.id}/copy-to`,
    { method: "POST", headers: admin.headers, body: JSON.stringify({ roomId: rivalRoom.id }) },
    409
  );
  await json(
    `/api/rooms/${gmRoom.id}/npcs/${npc.id}/copy-to`,
    { method: "POST", headers: player.headers, body: JSON.stringify({ roomId: monolithTwin.id }) },
    403
  );

  // --- The calendar: setup, from either footing, with its clash intact ---

  const configured = await request(`/api/room-config/${gmRoom.id}`, { headers: admin.headers });
  assert.ok(configured.calendar, "The panel is sent the calendar so an admin non-member can edit it.");

  const edited = {
    ...configured.calendar,
    daysPerWeek: 5,
    dayNames: ["Firstday", "Waterday", "Ashday", "Longday", "Restday"],
    monthNames: ["Thaw", "Bloom", "Char", "Fall"],
    month: 0,
    events: [{ id: "harvest", name: "Harvest", cadence: "holiday", day: 3, month: 2 }]
  };
  // An admin who is not a member can save it, which is the whole point of the
  // section being reachable to them at all.
  const saved = await request(
    `/api/rooms/${gmRoom.id}/calendar`,
    { method: "PUT", headers: admin.headers, body: JSON.stringify(edited) },
    200
  );
  assert.equal(saved.calendar.daysPerWeek, 5);
  assert.equal(saved.calendar.revision, configured.calendar.revision + 1);
  assert.deepEqual(
    saved.calendar.monthNames,
    ["Thaw", "Bloom", "Char", "Fall"],
    "Reordering and renaming months is saved as given."
  );

  // The same edit sent twice is the stale save the panel has to survive.
  await json(
    `/api/rooms/${gmRoom.id}/calendar`,
    { method: "PUT", headers: admin.headers, body: JSON.stringify(edited) },
    409
  );
  // What the panel does next: refetch, carry the newer revision, save again.
  const reapplied = await request(
    `/api/rooms/${gmRoom.id}/calendar`,
    {
      method: "PUT",
      headers: gm.headers,
      body: JSON.stringify({ ...edited, daysPerWeek: 6, revision: saved.calendar.revision })
    },
    200
  );
  assert.equal(reapplied.calendar.daysPerWeek, 6, "Reapplying over the newer revision succeeds.");

  await json(
    `/api/rooms/${gmRoom.id}/calendar`,
    { method: "PUT", headers: player.headers, body: JSON.stringify(edited) },
    403
  );
  // Advancing time writes into the room's chat, so it stays with the room's own
  // people rather than following configuration access.
  await json(`/api/rooms/${gmRoom.id}/calendar/advance`, { method: "POST", headers: admin.headers }, 403);
  await json(`/api/rooms/${gmRoom.id}/calendar/advance`, { method: "POST", headers: gm.headers }, 200);
});

/** The smallest valid PNG, so uploads are exercised without a fixture file. */
function pngBytes() {
  return Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100" +
      "05fe02fea7e1b2000000000049454e44ae426082",
    "hex"
  );
}

/** Multipart bodies must set their own content type, so the JSON one is dropped. */
function onlyCookie(headers) {
  return { cookie: headers.cookie };
}
