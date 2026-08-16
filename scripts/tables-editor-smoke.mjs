import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { runSmoke } from "./harness.mjs";

const password = "tables-editor-password";

const starterMarkdown = `# Market rumours

## Rumours in the market

<!-- tags: fantasy -->
| d6 | Rumour |
| --- | --- |
| 1-3 | The well has gone bitter. |
| 4-6 | A stranger asks after the old road. |
`;

const csv = `table,dice,tags,roll,Omen,Seen by
Wilderness omens,d4,fantasy,1,Crows circling with nothing beneath them,A shepherd
Wilderness omens,,,2,A cairn that was not there yesterday,A carter
Wilderness omens,,,3,Water running the wrong way,A miller
Wilderness omens,,,4,No birdsong at all,Everyone
`;

function form(fields) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value instanceof Blob) body.append(key, value, "upload");
    else body.append(key, value);
  }
  return body;
}

await runSmoke(
  "The Devil's Tables editor, artifacts, and permissions smoke test",
  async ({ json, tablesJson, tablesBytes, tablesPort, setup, login, stopGameServer }) => {
    // The account is made in the game server; the cookie it returns is scoped to
    // the host rather than the port, so it signs the same person in over here.
    const admin = await setup("TablesAdmin", password);
    const shared = await tablesJson("/api/me", { headers: { cookie: admin.cookie } });
    assert.equal(shared.body.account.username, "TablesAdmin");
    assert.equal(shared.body.account.role, "admin");

    // A GM and a player, made directly so this test does not depend on rooms.
    for (const [username, role] of [
      ["TablesGM", "gm"],
      ["TablesPlayer", "player"]
    ]) {
      await json(
        "/api/management/players",
        { method: "POST", headers: admin.headers, body: JSON.stringify({ username, password, role }) },
        201
      );
    }
    const gm = await login("TablesGM", password);
    const player = await login("TablesPlayer", password);

    // The game tells its rail where the editor is and whether it answered, so a
    // dead link can offer the command that starts it instead of failing.
    const link = await json("/api/tables-app", { headers: admin.headers });
    assert.equal(link.body.running, true, "the editor is running, and the game should be able to see it");
    assert.equal(link.body.port, tablesPort, "the game must point at this editor, not whatever is on the default port");
    assert.match(link.body.command, /^npm run (dev|start):tables$/);
    await json("/api/tables-app", { headers: { cookie: player.cookie } }, 403);

    // Everything from here on is against The Devil's Tables, with the game
    // server stopped: the editor has to stand on its own.
    await stopGameServer();

    // Every catalogue row opens. System sets expose their source Markdown as a
    // read-only browser; custom sets use the same canonical set id.
    const initialCatalogue = await tablesJson("/api/table-sets", { headers: player.headers });
    const systemSet = initialCatalogue.body.sets.find((set) => set.id === "system:toybox");
    assert.ok(systemSet?.tables.length > 0);
    const systemSetDetail = await tablesJson("/api/table-sets/system%3Atoybox", { headers: player.headers });
    assert.equal(systemSetDetail.body.set.readOnly, true);
    assert.equal(systemSetDetail.body.set.name, systemSet.name);
    assert.ok(systemSetDetail.body.set.tables.length > 0);

    // Usage includes source-backed system catalogues and tags inherited by all
    // of their tables, rather than looking only at custom database rows.
    const initialTags = await tablesJson("/api/table-tags", { headers: player.headers });
    const fantasyUsage = initialTags.body.tags.find((tag) => tag.slug === "fantasy").usage;
    const scifiUsage = initialTags.body.tags.find((tag) => tag.slug === "scifi").usage;
    assert.ok(fantasyUsage.sets >= 1);
    assert.ok(fantasyUsage.tables >= systemSet.tables.length);
    // Nothing installed carries "scifi", and a tag nobody uses reports zero
    // rather than going missing from the vocabulary.
    assert.deepEqual(scifiUsage, { sets: 0, tables: 0 });

    const created = await tablesJson(
      "/api/table-sets",
      {
        method: "POST",
        headers: gm.headers,
        body: JSON.stringify({ name: "Market rumours", markdown: starterMarkdown, tags: ["random-encounter"] })
      },
      201
    );
    const setId = Number(created.body.set.id.replace("custom:", ""));
    assert.equal(created.body.set.tables, 1);

    // A set tag and a table's own tag are both carried, without repeats.
    const catalogue = await tablesJson("/api/table-sets", { headers: gm.headers });
    const custom = catalogue.body.sets.find((set) => set.id === `custom:${setId}`);
    assert.deepEqual(custom.tables[0].tags, ["fantasy", "random-encounter"]);
    const customDetail = await tablesJson(`/api/table-sets/custom%3A${setId}`, { headers: gm.headers });
    assert.equal(customDetail.body.set.id, setId);
    assert.equal(customDetail.body.set.readOnly, false);
    assert.equal(catalogue.body.canEdit, true);
    assert.equal(catalogue.body.canAdminister, false);

    // A tag this instance did not know is refused rather than quietly dropped.
    await tablesJson(
      `/api/table-sets/${setId}`,
      {
        method: "PATCH",
        headers: gm.headers,
        body: JSON.stringify({ name: "Market rumours", markdown: starterMarkdown, tags: ["nonesuch"] })
      },
      400
    );

    // A GM may add a tag and use it.
    await tablesJson(
      "/api/table-tags",
      { method: "POST", headers: gm.headers, body: JSON.stringify({ slug: "spooky", label: "Spooky" }) },
      201
    );
    const vocabulary = await tablesJson("/api/table-tags", { headers: player.headers });
    assert.ok(vocabulary.body.tags.some((tag) => tag.slug === "spooky" && tag.builtin === false));

    // CSV: look first, then commit.
    const csvFile = () => new Blob([csv], { type: "text/csv" });
    const preview = await tablesJson(`/api/table-sets/${setId}/import-csv`, {
      method: "POST",
      headers: { cookie: gm.cookie },
      body: form({ file: csvFile() })
    });
    assert.deepEqual(preview.body.problems, []);
    assert.deepEqual(
      preview.body.preview.map((table) => [table.name, table.dice, table.rowCount]),
      [["Wilderness omens", "d4", 4]]
    );
    await tablesJson(
      `/api/table-sets/${setId}/import-csv`,
      { method: "POST", headers: { cookie: gm.cookie }, body: form({ file: csvFile(), commit: "true" }) },
      201
    );

    const afterCsv = await tablesJson(`/api/table-sets/${setId}`, { headers: gm.headers });
    assert.ok(afterCsv.body.set.tables.some((table) => table.name === "Wilderness omens"));
    const original = afterCsv.body.set.tables.find((table) => table.name === "Rumours in the market");
    assert.deepEqual(original.tags, ["fantasy"], "the table keeps only its own source tags");
    assert.equal(original.rows[0].cells[0], "The well has gone bitter.", "the original rows were untouched");

    // The sample template is downloadable and reads as the shape it documents.
    const sample = await tablesBytes("/api/table-templates/sample.csv", { headers: { cookie: player.cookie } });
    assert.match(sample.response.headers.get("content-disposition") ?? "", /attachment; filename=/);
    assert.match(sample.bytes.toString("utf8"), /^table,dice,tags,roll,/);

    // Artifact two: export, delete, import, and the Markdown document comes back exactly.
    const exported = await tablesBytes("/api/table-export", { headers: { cookie: gm.cookie } });
    const archive = unzipSync(new Uint8Array(exported.bytes));
    const manifest = JSON.parse(strFromU8(archive["manifest.json"]));
    assert.equal(manifest.app, "devils-tables");
    assert.deepEqual(
      manifest.sets.map((set) => set.name),
      ["Market rumours"]
    );
    assert.ok(
      manifest.tags.some((tag) => tag.slug === "fantasy"),
      "table tags travel with the bundle"
    );
    assert.ok(manifest.sets[0].file.endsWith(".md"));

    await tablesJson(`/api/table-sets/${setId}`, { method: "DELETE", headers: gm.headers }, 204);
    const bundle = () => new Blob([exported.bytes], { type: "application/zip" });
    const importPreview = await tablesJson("/api/table-import", {
      method: "POST",
      headers: { cookie: gm.cookie },
      body: form({ file: bundle() })
    });
    assert.deepEqual(
      importPreview.body.sets.map((set) => [set.name, set.status]),
      [["Market rumours", "new"]]
    );
    const restored = await tablesJson(
      "/api/table-import",
      { method: "POST", headers: { cookie: gm.cookie }, body: form({ file: bundle(), commit: "true" }) },
      201
    );
    assert.equal(restored.body.created, 1);

    const back = await tablesJson("/api/table-sets", { headers: gm.headers });
    const restoredSet = back.body.sets.find((set) => set.name === "Market rumours");
    assert.ok(restoredSet, "the imported set is in the catalogue");
    const restoredId = Number(restoredSet.id.replace("custom:", ""));
    const restoredBody = await tablesJson(`/api/table-sets/${restoredId}`, { headers: gm.headers });
    assert.deepEqual(restoredBody.body.set.tables, afterCsv.body.set.tables, "the round trip changed the tables");

    // Artifact three is an admin's, and carries runtime JSON plus its importer.
    await tablesJson(`/api/table-sets/custom:${restoredId}/repo-bundle`, { headers: gm.headers }, 403);
    const repo = await tablesBytes(`/api/table-sets/custom:${restoredId}/repo-bundle`, {
      headers: { cookie: admin.cookie }
    });
    const repoFiles = unzipSync(new Uint8Array(repo.bytes));
    const names = Object.keys(repoFiles).sort();
    assert.deepEqual(names, ["README.md", "import-tables.mjs", "manifest.json", "sets/market-rumours.json"]);
    const repoManifest = JSON.parse(strFromU8(repoFiles["manifest.json"]));
    assert.equal(repoManifest.app, "devils-tables-repository");
    assert.deepEqual(
      repoManifest.sets.map((set) => [set.id, set.name]),
      [["market-rumours", "Market rumours"]]
    );
    const repositorySet = JSON.parse(strFromU8(repoFiles["sets/market-rumours.json"]));
    assert.equal(repositorySet.setName, "Market rumours");
    assert.equal(repositorySet.tables.length, afterCsv.body.set.tables.length);
    assert.match(strFromU8(repoFiles["import-tables.mjs"]), /Confirm Y\/N\?/);

    // What a GM may not do.
    await tablesJson(
      "/api/table-tags/spooky",
      { method: "PATCH", headers: gm.headers, body: JSON.stringify({ slug: "eerie" }) },
      403
    );
    await tablesJson(
      "/api/table-tags/spooky/merge",
      { method: "POST", headers: gm.headers, body: JSON.stringify({ into: "fantasy" }) },
      403
    );
    await tablesJson("/api/table-tags/spooky", { method: "DELETE", headers: gm.headers }, 403);

    // A built-in keeps its slug, because seeding would bring the old one back.
    await tablesJson(
      "/api/table-tags/gear",
      { method: "PATCH", headers: admin.headers, body: JSON.stringify({ slug: "equipment" }) },
      400
    );
    await tablesJson(
      "/api/table-tags/gear",
      { method: "PATCH", headers: admin.headers, body: JSON.stringify({ label: "Kit" }) },
      204
    );

    // What a player may do: read everything, change nothing.
    await tablesJson("/api/table-sets", { headers: player.headers });
    await tablesJson(`/api/table-sets/${restoredId}`, { headers: player.headers });
    await tablesJson("/api/table-tags", { headers: player.headers });
    await tablesBytes("/api/table-export", { headers: { cookie: player.cookie } });
    await tablesJson(
      "/api/table-sets",
      {
        method: "POST",
        headers: player.headers,
        body: JSON.stringify({ name: "Not allowed", markdown: starterMarkdown, tags: [] })
      },
      403
    );
    await tablesJson(
      `/api/table-sets/${restoredId}`,
      {
        method: "PATCH",
        headers: player.headers,
        body: JSON.stringify({ name: "Not allowed", markdown: starterMarkdown, tags: [] })
      },
      403
    );
    await tablesJson(`/api/table-sets/${restoredId}`, { method: "DELETE", headers: player.headers }, 403);
    await tablesJson(
      "/api/table-tags",
      { method: "POST", headers: player.headers, body: JSON.stringify({ slug: "nope", label: "Nope" }) },
      403
    );
    await tablesJson(
      `/api/table-sets/${restoredId}/import-csv`,
      { method: "POST", headers: { cookie: player.cookie }, body: form({ file: csvFile() }) },
      403
    );
    await tablesJson(
      "/api/table-import",
      { method: "POST", headers: { cookie: player.cookie }, body: form({ file: bundle() }) },
      403
    );
    await tablesJson(`/api/table-sets/custom:${restoredId}/repo-bundle`, { headers: player.headers }, 403);

    // Signing out on this side ends the shared session.
    await tablesJson("/api/logout", { method: "POST", headers: { cookie: player.cookie } }, 204);
    await tablesJson("/api/me", { headers: { cookie: player.cookie } }, 401);
  },
  { withTablesServer: true }
);
