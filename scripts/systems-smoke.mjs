import assert from "node:assert/strict";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { runSmoke } from "./harness.mjs";

/**
 * toybox-2: the fixture, exported as a bundle under a new id, installed on a
 * running server, and expected to behave identically to the original.
 *
 * This is the acceptance test for installable systems. It is not a fixture — the
 * bundle is the export command's real output, which is what makes it prove the
 * format rather than the test.
 */
await runSmoke("Installable system smoke test", async ({ request, json, bytes, setup, login, redeem }) => {
  const admin = await setup("SystemAdmin", "system-admin-password");
  await request(
    "/api/accounts",
    {
      method: "POST",
      headers: admin.headers,
      body: JSON.stringify({ username: "SystemGM", password: "system-gm-password", role: "gm" })
    },
    201
  );
  const gm = await login("SystemGM", "system-gm-password");

  // --- Who may install ---

  await json("/api/admin/systems", {}, 401);
  await json("/api/admin/systems", { headers: gm.headers }, 403);
  await json("/api/admin/systems", { method: "POST", headers: gm.headers }, 403);
  await json("/api/admin/systems/toybox/export", { headers: gm.headers }, 403);

  const initial = await request("/api/admin/systems", { headers: admin.headers });
  assert.deepEqual(
    initial.systems.map((system) => system.id).sort(),
    ["plainbox", "toybox"],
    "A server lists what has been installed on it, since it ships nothing."
  );
  assert.ok(
    initial.systems.every((system) => system.origin === "installed" && system.loaded && !system.retired),
    "Every installed system is registered, loaded, and offered."
  );

  // --- Export the fixture as toybox-2 ---

  const exported = await bytes("/api/admin/systems/toybox/export?as=toybox-2&name=Toybox%20(installed)", {
    headers: admin.headers
  });
  assert.match(exported.response.headers.get("content-type") ?? "", /application\/zip/);
  assert.match(
    exported.response.headers.get("content-disposition") ?? "",
    /toybox-2\.devilsystem\.zip/,
    "The download is named for the system it carries."
  );
  assert.ok(exported.bytes.length > 2_000, "A whole rulebook should not compress to nothing.");

  const install = async (buffer, expected, filename = "toybox-2.devilsystem.zip", acknowledgeBreaking = "") => {
    const form = new FormData();
    form.append("bundle", new Blob([buffer], { type: "application/zip" }), filename);
    if (acknowledgeBreaking) form.append("acknowledgeBreaking", acknowledgeBreaking);
    return json("/api/admin/systems", { method: "POST", headers: { cookie: admin.cookie }, body: form }, expected);
  };

  // --- What is refused ---

  const notAZip = await install(Buffer.from("not a zip at all"), 400);
  assert.match(notAZip.body.error, /not a readable zip archive/);

  // Exported under its own id and installed again, a system replaces itself.
  // That is the update path, and it reports the replacement rather than a new
  // system — the only thing it may not do is silently become a second copy.
  const ownId = await bytes("/api/admin/systems/toybox/export", { headers: admin.headers });
  const reinstalled = await install(ownId.bytes, 200, "toybox.devilsystem.zip");
  assert.equal(reinstalled.body.replaced, true, "Re-installing an id replaces what was there.");
  assert.equal(reinstalled.body.system.id, "toybox");

  await json("/api/admin/systems/toybox/export?as=Toybox2", { headers: admin.headers }, 400);
  await json("/api/admin/systems/no-such-system/export", { headers: admin.headers }, 404);

  // --- Install ---

  const installed = await install(exported.bytes, 201);
  assert.equal(installed.body.system.id, "toybox-2");
  assert.equal(installed.body.system.name, "Toybox (installed)");
  assert.equal(installed.body.system.origin, "installed");
  assert.equal(installed.body.replaced, false);
  assert.deepEqual(installed.body.licenses, ["CC0 1.0"], "The bundle's licence is reported on install.");

  // --- It behaves as the original does ---

  const status = await request("/api/status");
  const [monolith, installedSystem] = ["toybox", "toybox-2"].map((id) =>
    status.systems.find((system) => system.id === id)
  );
  assert.ok(installedSystem, "An installed system is offered for new rooms.");
  assert.deepEqual(installedSystem.dice, monolith.dice, "Its dice rules are the original's.");
  assert.deepEqual(installedSystem.traits, monolith.traits, "Its weapon vocabulary is the original's.");
  assert.equal(installedSystem.groupPage, monolith.groupPage);
  assert.equal(installedSystem.defaultTheme, monolith.defaultTheme);

  const room = (
    await request(
      "/api/rooms",
      { method: "POST", headers: gm.headers, body: JSON.stringify({ name: "Installed Table", system: "toybox-2" }) },
      201
    )
  ).room;
  assert.equal(room.system, "toybox-2");
  assert.equal(room.theme, monolith.defaultTheme);

  const original = (
    await request(
      "/api/rooms",
      { method: "POST", headers: gm.headers, body: JSON.stringify({ name: "Original Table", system: "toybox" }) },
      201
    )
  ).room;

  const charactersOf = (roomId) => request(`/api/rooms/${roomId}/characters`, { headers: gm.headers });
  const [fromInstalled, fromOriginal] = await Promise.all([charactersOf(room.id), charactersOf(original.id)]);
  assert.deepEqual(
    fromInstalled.sheetDefinition,
    fromOriginal.sheetDefinition,
    "The installed system's character sheet is the original's, field for field."
  );
  assert.equal(fromInstalled.partyLabel, fromOriginal.partyLabel);
  // The sheet's rail arrangement travels in the definition rather than being
  // drawn for whichever system the browser recognises, so an installed system
  // lays out the way its own sheet asks.
  assert.deepEqual(
    fromInstalled.sheetDefinition.layout,
    { kind: "rails", left: ["vitals"], feature: ["abilities"], right: { sections: ["details"], lists: ["inventory"] } },
    "The installed system carries the original's sheet layout."
  );
  assert.deepEqual(
    fromInstalled.viceCatalogue,
    fromOriginal.viceCatalogue,
    "Vices are read from the installed system's own tables."
  );
  assert.ok(fromInstalled.viceCatalogue.length > 0, "The original has vices, so toybox-2 must have them too.");

  // Item ids are namespaced by the system, so the catalogue is the installed
  // system's own rather than a copy still claiming to be the original's.
  const installedItems = Object.values(fromInstalled.itemCatalogue).flat();
  const originalItems = Object.values(fromOriginal.itemCatalogue).flat();
  assert.equal(installedItems.length, originalItems.length, "It offers the same gear.");
  assert.ok(
    installedItems.every((item) => item.id.startsWith("toybox-2/")),
    "Every item id names the system that owns it."
  );
  assert.deepEqual(
    installedItems.map((item) => item.name),
    originalItems.map((item) => item.name),
    "The same items, in the same order."
  );

  // The group tabs come from the definition, so an installed system gets the
  // ones it declares rather than the ones a browser knows the original to have.
  const groupOf = (roomId) => request(`/api/rooms/${roomId}/group`, { headers: gm.headers });
  const [installedGroup, originalGroup] = await Promise.all([groupOf(room.id), groupOf(original.id)]);
  assert.deepEqual(
    installedGroup.definition.obligations,
    originalGroup.definition.obligations,
    "It declares the obligations roster, which is what gives it that tab."
  );
  assert.ok(installedGroup.definition.hirelings, "It declares freelancers.");
  assert.equal(installedGroup.definition.hirelings.label, "Hands");
  assert.ok(
    installedGroup.definition.groupAssets?.some((asset) => asset.kind === "starship"),
    "It owns ships."
  );
  assert.ok(
    installedGroup.definition.starshipSheet.parts.length > 0,
    "Its parts are read from its own book, not from the original's."
  );

  // --- Rules, and the player cut of them ---

  const rulesOf = async (roomId, cookie) =>
    (await bytes(`/api/rooms/${roomId}/rules`, { headers: { cookie } })).bytes.toString("utf8");
  const [installedRules, originalRules] = await Promise.all([
    rulesOf(room.id, gm.cookie),
    rulesOf(original.id, gm.cookie)
  ]);
  // Identical apart from the table anchors, which `rulesMarkdown` mints as
  // `system:<id>` at read time and writes URL-encoded into each link — so they
  // must differ, and nothing else in the book may.
  assert.equal(
    installedRules.replaceAll("system%3Atoybox-2", "system%3Atoybox"),
    originalRules,
    "The installed system serves the same book, byte for byte apart from its table anchors."
  );
  assert.ok(installedRules.includes("system%3Atoybox-2"), "Its table links point at its own set.");
  assert.ok(installedRules.includes("## Bestiary"), "A GM reading toybox-2 sees the GM-only chapters.");

  // The player cut is where a mistake in gmOnlyHeadings or contentModules would
  // hide, so it is checked rather than assumed to follow from the GM cut.
  const invitation = await request(
    `/api/rooms/${room.id}/invitations`,
    { method: "POST", headers: gm.headers, body: JSON.stringify({ username: "SystemPlayer" }) },
    201
  );
  const player = await redeem(invitation.invitation.token, "system-player-password");
  const playerRules = await rulesOf(room.id, player.cookie);
  assert.ok(playerRules.length > 0 && playerRules.length < installedRules.length, "A player sees less than a GM.");
  for (const heading of ["## Bestiary", "Chalk Golem", "Tin Rat"])
    assert.ok(!playerRules.includes(heading), `A player must not be served the ${heading} chapter.`);

  // --- Updating ---

  // toybox-2 arrived as an uploaded bundle, so it has no source to update from.
  // That is a 409 rather than a 404: the system is real, the request is not.
  await json("/api/admin/systems/toybox-2/update", { method: "POST", headers: gm.headers }, 403);
  await json("/api/admin/systems/no-such-system/update", { method: "POST", headers: admin.headers }, 404);
  const unsourced = await json("/api/admin/systems/toybox-2/update", { method: "POST", headers: admin.headers }, 409);
  assert.match(
    unsourced.body.error,
    /installed from a file/,
    "An update names why a file-installed system has no source."
  );

  const updates = await request("/api/admin/systems/updates", { headers: admin.headers });
  const toyboxUpdate = updates.systems.find((system) => system.id === "toybox-2");
  assert.equal(toyboxUpdate.state, "unsourced", "A system installed from a file has no upstream to check.");
  await json("/api/admin/systems/updates", { headers: gm.headers }, 403);

  // --- Retiring, restoring, deleting ---

  await json("/api/admin/systems/toybox-2/retire", { method: "POST", headers: gm.headers }, 403);
  const retired = await request("/api/admin/systems/toybox-2/retire", { method: "POST", headers: admin.headers });
  assert.equal(retired.system.retired, true);

  const afterRetire = await request("/api/status");
  assert.ok(
    !afterRetire.systems.some((system) => system.id === "toybox-2"),
    "A retired system is not offered for new rooms."
  );
  await json(
    "/api/rooms",
    { method: "POST", headers: gm.headers, body: JSON.stringify({ name: "Too Late", system: "toybox-2" }) },
    409
  );

  // The room already on it keeps working, which is the whole point of retiring
  // rather than deleting.
  const stillThere = await charactersOf(room.id);
  assert.deepEqual(stillThere.sheetDefinition, fromOriginal.sheetDefinition, "A retired system's rooms still open.");

  const deleteRefused = await json("/api/admin/systems/toybox-2", { method: "DELETE", headers: admin.headers }, 409);
  assert.match(deleteRefused.body.error, /still in use by 1 room \(Installed Table\)/);

  // A system nothing points at may be deleted; one with a room on it may not.
  await json("/api/admin/systems/plainbox", { method: "DELETE", headers: admin.headers }, 204);
  const restored = await request("/api/admin/systems/toybox-2/restore", { method: "POST", headers: admin.headers });
  assert.equal(restored.system.retired, false);

  // --- Replacing an installed system, and deleting one nothing uses ---

  const replacementFiles = unzipSync(exported.bytes);
  const replacementManifest = JSON.parse(strFromU8(replacementFiles["manifest.json"]));
  replacementManifest.bundleVersion = 2;
  replacementManifest.version = "2.0.0";
  replacementManifest.breaking = true;
  replacementManifest.releaseNotes = [
    "Existing rooms must review their character sheets.",
    "The replacement changes the installed rules text."
  ];
  replacementFiles["manifest.json"] = strToU8(`${JSON.stringify(replacementManifest, null, 2)}\n`);
  replacementFiles["rules/Toybox.md"] = strToU8(
    `${strFromU8(replacementFiles["rules/Toybox.md"])}\n\nReplacement bundle marker.\n`
  );
  const replacementBundle = zipSync(replacementFiles);
  const review = await install(replacementBundle, 409);
  assert.equal(review.body.code, "breaking_system_change");
  assert.equal(review.body.change.fromVersion, "1.0.0");
  assert.equal(review.body.change.toVersion, "2.0.0");
  assert.deepEqual(review.body.change.notes, replacementManifest.releaseNotes);
  assert.ok(review.body.change.fingerprint, "The acknowledgement is bound to the release that was reviewed.");
  assert.ok(
    !(await rulesOf(room.id, gm.cookie)).includes("Replacement bundle marker."),
    "Refusing a breaking replacement leaves the installed content untouched."
  );

  const replaced = await install(replacementBundle, 200, "toybox-2.devilsystem.zip", review.body.change.fingerprint);
  assert.equal(replaced.body.replaced, true, "Installing over an existing system reports that it replaced one.");
  assert.equal(replaced.body.breakingAcknowledged, true);
  assert.ok(
    (await rulesOf(room.id, gm.cookie)).includes("Replacement bundle marker."),
    "The running server reads replacement content without a restart."
  );

  await request(`/api/rooms/${room.id}`, { method: "DELETE", headers: admin.headers }, 204);
  await json("/api/admin/systems/toybox-2", { method: "DELETE", headers: admin.headers }, 204);

  const finally_ = await request("/api/admin/systems", { headers: admin.headers });
  assert.deepEqual(
    finally_.systems.map((system) => system.id).sort(),
    ["toybox"],
    "Once nothing points at it, an installed system can be removed entirely."
  );
  await json(
    "/api/rooms",
    { method: "POST", headers: gm.headers, body: JSON.stringify({ name: "Gone", system: "toybox-2" }) },
    400
  );

  // --- Importing from a repository ---

  // A server comes configured with the published catalogue; the harness turns it
  // off so this suite never reaches the network. Turned off, the panel says so
  // rather than answering with an empty list, which would read as "none".
  const catalogue = await request("/api/admin/systems/catalog", { headers: admin.headers });
  assert.equal(catalogue.configured, false, "With no catalogue URL set, the menu reports itself unconfigured.");
  assert.deepEqual(catalogue.systems, []);
  await json("/api/admin/systems/catalog", { headers: gm.headers }, 403);

  // Importing is an admin's, and refuses anything it could not fetch safely
  // before it opens a connection at all.
  await json("/api/admin/systems/import", { method: "POST", headers: gm.headers, body: "{}" }, 403);
  const noTarget = await json("/api/admin/systems/import", { method: "POST", headers: admin.headers, body: "{}" }, 400);
  assert.match(noTarget.body.error, /catalogue id, or a repository and ref/);

  for (const [repository, ref, pattern] of [
    ["not-a-repository", "main", /not an owner\/repository name/],
    ["owner/repo", "../../etc/passwd", /not a usable branch, tag, or commit/],
    ["https://evil.test/x", "main", /not an owner\/repository name/]
  ]) {
    const refused = await json(
      "/api/admin/systems/import",
      { method: "POST", headers: admin.headers, body: JSON.stringify({ repository, ref }) },
      400
    );
    assert.match(refused.body.error, pattern, `${repository}@${ref} should be refused before any fetch.`);
  }

  // An unconfigured catalogue holds nothing, so naming an entry in it is a 404.
  // A catalogue that exists and could not be reached answers 502 instead — the
  // difference between being told no and not being able to ask.
  const missing = await json(
    "/api/admin/systems/import",
    { method: "POST", headers: admin.headers, body: JSON.stringify({ id: "cairn" }) },
    404
  );
  assert.match(missing.body.error, /catalogue has no system called "cairn"/);
});
