import assert from "node:assert/strict";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { runSmoke } from "./harness.mjs";

/**
 * monolith-2: Monolith, exported as a bundle under a new id, installed on a
 * running server, and expected to behave identically to Monolith.
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
  await json("/api/admin/systems/monolith/export", { headers: gm.headers }, 403);

  const initial = await request("/api/admin/systems", { headers: admin.headers });
  assert.deepEqual(
    initial.systems.map((system) => system.id).sort(),
    ["cairn", "cwn", "monolith"],
    "A fresh server lists exactly the compiled systems."
  );
  assert.ok(
    initial.systems.every((system) => system.origin === "builtin" && system.loaded && !system.retired),
    "Every compiled system is registered, loaded, and offered."
  );

  // --- Export Monolith as monolith-2 ---

  const exported = await bytes("/api/admin/systems/monolith/export?as=monolith-2&name=Monolith%20(installed)", {
    headers: admin.headers
  });
  assert.match(exported.response.headers.get("content-type") ?? "", /application\/zip/);
  assert.match(
    exported.response.headers.get("content-disposition") ?? "",
    /monolith-2\.devilsystem\.zip/,
    "The download is named for the system it carries."
  );
  assert.ok(exported.bytes.length > 20_000, "A whole rulebook should not compress to nothing.");

  const install = async (buffer, expected, filename = "monolith-2.devilsystem.zip") => {
    const form = new FormData();
    form.append("bundle", new Blob([buffer], { type: "application/zip" }), filename);
    return json("/api/admin/systems", { method: "POST", headers: { cookie: admin.cookie }, body: form }, expected);
  };

  // --- What is refused ---

  const notAZip = await install(Buffer.from("not a zip at all"), 400);
  assert.match(notAZip.body.error, /not a readable zip archive/);

  const ownId = await bytes("/api/admin/systems/monolith/export", { headers: admin.headers });
  const shipped = await install(ownId.bytes, 400);
  assert.match(
    shipped.body.error,
    /is a system this application ships/,
    "A bundle may not overwrite a system compiled into the build."
  );

  await json("/api/admin/systems/monolith/export?as=cairn", { headers: admin.headers }, 409);
  await json("/api/admin/systems/monolith/export?as=Monolith2", { headers: admin.headers }, 400);
  await json("/api/admin/systems/no-such-system/export", { headers: admin.headers }, 404);

  // --- Install ---

  const installed = await install(exported.bytes, 201);
  assert.equal(installed.body.system.id, "monolith-2");
  assert.equal(installed.body.system.name, "Monolith (installed)");
  assert.equal(installed.body.system.origin, "installed");
  assert.equal(installed.body.replaced, false);
  assert.deepEqual(installed.body.licenses, ["CC BY-SA 4.0"], "The bundle's licence is reported on install.");

  // --- It behaves as Monolith does ---

  const status = await request("/api/status");
  const [monolith, installedSystem] = ["monolith", "monolith-2"].map((id) =>
    status.systems.find((system) => system.id === id)
  );
  assert.ok(installedSystem, "An installed system is offered for new rooms.");
  assert.deepEqual(installedSystem.dice, monolith.dice, "Its dice rules are Monolith's.");
  assert.deepEqual(installedSystem.traits, monolith.traits, "Its weapon vocabulary is Monolith's.");
  assert.equal(installedSystem.groupPage, monolith.groupPage);
  assert.equal(installedSystem.defaultTheme, monolith.defaultTheme);

  const room = (
    await request(
      "/api/rooms",
      { method: "POST", headers: gm.headers, body: JSON.stringify({ name: "Installed Table", system: "monolith-2" }) },
      201
    )
  ).room;
  assert.equal(room.system, "monolith-2");
  assert.equal(room.theme, monolith.defaultTheme);

  const original = (
    await request(
      "/api/rooms",
      { method: "POST", headers: gm.headers, body: JSON.stringify({ name: "Original Table", system: "monolith" }) },
      201
    )
  ).room;

  const charactersOf = (roomId) => request(`/api/rooms/${roomId}/characters`, { headers: gm.headers });
  const [fromInstalled, fromOriginal] = await Promise.all([charactersOf(room.id), charactersOf(original.id)]);
  assert.deepEqual(
    fromInstalled.sheetDefinition,
    fromOriginal.sheetDefinition,
    "The installed system's character sheet is Monolith's, field for field."
  );
  assert.equal(fromInstalled.partyLabel, fromOriginal.partyLabel);
  // The sheet's rail arrangement travels in the definition rather than being
  // drawn for whichever system the browser recognises, so an installed system
  // lays out the way its own sheet asks.
  assert.deepEqual(
    fromInstalled.sheetDefinition.layout,
    { kind: "rails", left: ["identity"], feature: ["talents"], right: { sections: ["vices"], lists: ["equipment"] } },
    "The installed system carries Monolith's sheet layout."
  );
  assert.deepEqual(
    fromInstalled.viceCatalogue,
    fromOriginal.viceCatalogue,
    "Vices are read from the installed system's own tables."
  );
  assert.ok(fromInstalled.viceCatalogue.length > 0, "Monolith has vices, so monolith-2 must have them too.");

  // Item ids are namespaced by the system, so the catalogue is the installed
  // system's own rather than a copy still claiming to be Monolith's.
  const installedItems = Object.values(fromInstalled.itemCatalogue).flat();
  const originalItems = Object.values(fromOriginal.itemCatalogue).flat();
  assert.equal(installedItems.length, originalItems.length, "It offers the same gear.");
  assert.ok(
    installedItems.every((item) => item.id.startsWith("monolith-2/")),
    "Every item id names the system that owns it."
  );
  assert.deepEqual(
    installedItems.map((item) => item.name),
    originalItems.map((item) => item.name),
    "The same items, in the same order."
  );

  // The group tabs come from the definition, so an installed system gets the
  // ones it declares rather than the ones a browser knows Monolith to have.
  const groupOf = (roomId) => request(`/api/rooms/${roomId}/group`, { headers: gm.headers });
  const [installedGroup, originalGroup] = await Promise.all([groupOf(room.id), groupOf(original.id)]);
  assert.deepEqual(
    installedGroup.definition.obligations,
    originalGroup.definition.obligations,
    "It declares the obligations roster, which is what gives it that tab."
  );
  assert.ok(installedGroup.definition.hirelings, "It declares freelancers.");
  assert.equal(installedGroup.definition.hirelings.label, "Freelancers");
  assert.ok(
    installedGroup.definition.groupAssets?.some((asset) => asset.kind === "starship"),
    "It owns ships."
  );
  assert.ok(
    installedGroup.definition.starshipSheet.parts.length > 0,
    "Its starship parts are read from its own book, not from Monolith's."
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
    installedRules.replaceAll("system%3Amonolith-2", "system%3Amonolith"),
    originalRules,
    "The installed system serves the same book, byte for byte apart from its table anchors."
  );
  assert.ok(installedRules.includes("system%3Amonolith-2"), "Its table links point at its own set.");
  assert.ok(installedRules.includes("SAMPLE BESTIARY"), "A GM reading monolith-2 sees the GM-only chapters.");

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
  for (const heading of ["SAMPLE BESTIARY", "FACTION RULES", "PLANETS"])
    assert.ok(!playerRules.includes(heading), `A player must not be served the ${heading} chapter.`);

  // --- Retiring, restoring, deleting ---

  await json("/api/admin/systems/monolith-2/retire", { method: "POST", headers: gm.headers }, 403);
  const retired = await request("/api/admin/systems/monolith-2/retire", { method: "POST", headers: admin.headers });
  assert.equal(retired.system.retired, true);

  const afterRetire = await request("/api/status");
  assert.ok(
    !afterRetire.systems.some((system) => system.id === "monolith-2"),
    "A retired system is not offered for new rooms."
  );
  await json(
    "/api/rooms",
    { method: "POST", headers: gm.headers, body: JSON.stringify({ name: "Too Late", system: "monolith-2" }) },
    409
  );

  // The room already on it keeps working, which is the whole point of retiring
  // rather than deleting.
  const stillThere = await charactersOf(room.id);
  assert.deepEqual(stillThere.sheetDefinition, fromOriginal.sheetDefinition, "A retired system's rooms still open.");

  const deleteRefused = await json("/api/admin/systems/monolith-2", { method: "DELETE", headers: admin.headers }, 409);
  assert.match(deleteRefused.body.error, /still in use by 1 room \(Installed Table\)/);

  await json("/api/admin/systems/cairn", { method: "DELETE", headers: admin.headers }, 409);
  const restored = await request("/api/admin/systems/monolith-2/restore", { method: "POST", headers: admin.headers });
  assert.equal(restored.system.retired, false);

  // --- Replacing an installed system, and deleting one nothing uses ---

  const replacementFiles = unzipSync(exported.bytes);
  replacementFiles["rules/Monolith.md"] = strToU8(
    `${strFromU8(replacementFiles["rules/Monolith.md"])}\n\nReplacement bundle marker.\n`
  );
  const replaced = await install(zipSync(replacementFiles), 200);
  assert.equal(replaced.body.replaced, true, "Installing over an existing system reports that it replaced one.");
  assert.ok(
    (await rulesOf(room.id, gm.cookie)).includes("Replacement bundle marker."),
    "The running server reads replacement content without a restart."
  );

  await request(`/api/rooms/${room.id}`, { method: "DELETE", headers: admin.headers }, 204);
  await json("/api/admin/systems/monolith-2", { method: "DELETE", headers: admin.headers }, 204);

  const finally_ = await request("/api/admin/systems", { headers: admin.headers });
  assert.deepEqual(
    finally_.systems.map((system) => system.id).sort(),
    ["cairn", "cwn", "monolith"],
    "Once nothing points at it, an installed system can be removed entirely."
  );
  await json(
    "/api/rooms",
    { method: "POST", headers: gm.headers, body: JSON.stringify({ name: "Gone", system: "monolith-2" }) },
    400
  );
});
