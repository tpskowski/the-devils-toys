import assert from "node:assert/strict";
import { runSmoke } from "./harness.mjs";
import { readFile } from "node:fs/promises";

const repositorySets = JSON.parse(
  await readFile(new URL("../raw/tables/repository-sets.json", import.meta.url), "utf8")
).sets;

const customTable = {
  id: "rumours-in-the-market-d6",
  name: "Rumours in the market (d6)",
  section: "",
  category: "Rumours in the market (d6)",
  dice: "d6",
  columns: ["Rumour"],
  tags: [],
  rows: [
    "The well has gone bitter.",
    "A tax collector has vanished.",
    "Lights move in the barrow field.",
    "The miller is buying silver.",
    "Someone is paying for wolf pelts.",
    "A stranger asks after the old road."
  ].map((text, index) => ({ label: String(index + 1), min: index + 1, max: index + 1, cells: [text] }))
};

const customMarkdown = `## Rumours in the market (d6)

| d6 | Rumour |
| --- | --- |
${customTable.rows.map((row) => `| ${row.label} | ${row.cells[0]} |`).join("\n")}
`;

await runSmoke(
  "Random table catalogue, visibility, and custom table set smoke test",
  async ({ json, setup, redeem, connect, sleep }) => {
    const gm = await setup("TableGM", "tables-test-password");
    const gmCookie = gm.cookie;
    const gmJson = gm.headers;

    const room = await json(
      "/api/rooms",
      { method: "POST", headers: gmJson, body: JSON.stringify({ name: "Cairn Tables", system: "toybox" }) },
      201
    );
    const roomId = room.body.room.id;

    // Every system and checked-in repository set is offered, and the room's own system is preselected.
    const listed = await json(`/api/rooms/${roomId}/tables`, { headers: { cookie: gmCookie } });
    assert.equal(listed.body.roomSetId, "system:toybox");
    assert.deepEqual(
      listed.body.sets.map((set) => set.id),
      ["system:toybox", "system:plainbox", ...repositorySets.map((set) => `repository:${set.id}`)]
    );
    const toyboxSet = listed.body.sets[0];
    const plainSet = listed.body.sets[1];
    // Toybox's catalogue declares "fantasy", so every table inherits it; Plainbox
    // declares none, so its tables carry nothing they were not given.
    assert.ok(toyboxSet.tables.every((table) => table.tags.includes("fantasy")));
    assert.ok(plainSet.tables.every((table) => !table.tags.includes("fantasy")));
    assert.ok(toyboxSet.tables.length >= 5, "Toybox should contribute its oracles and creation tables.");
    assert.ok(plainSet.tables.length >= 1, "Plainbox should contribute the one table it has.");

    const complications = toyboxSet.tables.find((table) => table.name === "Complications (d10)");
    assert.equal(complications.dice, "d10");
    assert.equal(complications.rowCount, 10);
    const weather = toyboxSet.tables.find((table) => table.name === "Weather (d6)");
    assert.deepEqual(weather.columns.slice(0, 3), ["Sky", "Wind", "Underfoot"]);
    const compound = toyboxSet.tables.find((table) => table.dice === "d66");
    assert.ok(compound, "A d66 is read as two dice rather than a sixty-six-sided one.");

    // Summaries stay light; rows arrive only for the table the GM opens.
    assert.equal(complications.rows, undefined);
    const full = await json(`/api/rooms/${roomId}/tables/system:toybox/${complications.id}`, {
      headers: { cookie: gmCookie }
    });
    assert.equal(full.body.table.rows.length, 10);
    assert.deepEqual(full.body.table.tags, ["fantasy"]);
    assert.equal(full.body.table.rows[0].label, "1");

    const invitation = await json(
      `/api/rooms/${roomId}/invitations`,
      { method: "POST", headers: gmJson, body: JSON.stringify({ username: "TablePlayer" }) },
      201
    );
    const player = await redeem(invitation.body.invitation.token, "tables-test-password");
    const playerCookie = player.cookie;

    // Players cannot read or roll the catalogue.
    await json(`/api/rooms/${roomId}/tables`, { headers: { cookie: playerCookie } }, 403);
    await json(
      `/api/rooms/${roomId}/tables/roll`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: playerCookie },
        body: JSON.stringify({ setId: "system:toybox", tableId: complications.id, visibility: "public" })
      },
      403
    );

    const { events: playerEvents } = await connect(playerCookie, roomId);
    const { events: gmEvents } = await connect(gmCookie, roomId);
    const table = toyboxSet.tables.find((entry) => entry.name === "Complications (d10)");

    async function roll(visibility) {
      playerEvents.length = 0;
      gmEvents.length = 0;
      const result = await json(
        `/api/rooms/${roomId}/tables/roll`,
        {
          method: "POST",
          headers: gmJson,
          body: JSON.stringify({ setId: "system:toybox", tableId: table.id, visibility })
        },
        201
      );
      await sleep(250);
      return {
        ...result.body,
        broadcasts: playerEvents.filter((event) => event.type === "message"),
        gmBroadcasts: gmEvents.filter((event) => event.type === "message")
      };
    }

    // Default: the GM sees the result text while players learn only that a roll happened.
    const shown = await roll("public");
    assert.equal(shown.roll.visibility, "public");
    assert.ok(shown.roll.text.length > 0);
    assert.equal(shown.broadcasts.length, 1);
    assert.equal(shown.broadcasts[0].message.body, "Rolled on a random table");
    assert.equal(shown.gmBroadcasts.length, 1);
    assert.equal(shown.gmBroadcasts[0].message.rollVisibility, "private");
    assert.match(shown.gmBroadcasts[0].message.body, /^Complications \(d10\) → \d+$/);
    assert.ok(shown.gmBroadcasts[0].message.detail.includes(shown.roll.text));
    assert.ok(
      !JSON.stringify(shown.broadcasts[0].message).includes(shown.roll.text),
      "A default roll must not leak the table text to players."
    );
    const playerHistory = await json(`/api/rooms/${roomId}/messages`, { headers: { cookie: playerCookie } });
    const gmHistory = await json(`/api/rooms/${roomId}/messages`, { headers: { cookie: gmCookie } });
    assert.ok(playerHistory.body.messages.some((message) => message.body === "Rolled on a random table"));
    assert.ok(!JSON.stringify(playerHistory.body.messages).includes(shown.roll.text));
    assert.ok(gmHistory.body.messages.some((message) => message.detail?.includes(shown.roll.text)));
    assert.ok(!gmHistory.body.messages.some((message) => message.body === "Rolled on a random table"));
    // A heading that already carries its die must not be labelled twice.
    const named = toyboxSet.tables.find((entry) => entry.name === "Weather (d6)");
    const namedRoll = await json(
      `/api/rooms/${roomId}/tables/roll`,
      {
        method: "POST",
        headers: gmJson,
        body: JSON.stringify({ setId: "system:toybox", tableId: named.id, visibility: "public" })
      },
      201
    );
    assert.match(namedRoll.body.message.body, /^Weather \(d6\) → \d+$/);
    // Reveal: everyone is given the text that was rolled.
    const revealed = await roll("reveal");
    assert.equal(revealed.broadcasts.length, 1);
    assert.equal(revealed.broadcasts[0].message.detail, `${revealed.roll.tableName}: ${revealed.roll.text}`);

    // Private: the GM keeps the result, and the room is told a roll happened.
    const secret = await roll("private");
    assert.equal(secret.private, true);
    assert.equal(secret.message.private, true);
    assert.equal(secret.message.rollVisibility, "private");
    assert.ok(secret.message.detail.includes(secret.roll.text), "The GM sees the table text for a private roll.");
    assert.equal(secret.broadcasts.length, 1);
    assert.equal(secret.broadcasts[0].message.body, "Rolled privately on Complications (d10)");
    assert.ok(
      !JSON.stringify(secret.broadcasts[0].message).includes(secret.roll.text),
      "A private roll must not leak the table text."
    );

    // Invisible: nothing reaches the room at all.
    const hidden = await roll("invisible");
    assert.equal(hidden.private, true);
    assert.equal(hidden.message.rollVisibility, "invisible");
    assert.ok(hidden.message.detail.includes(hidden.roll.text));
    assert.equal(hidden.broadcasts.length, 0, "An invisible roll tells players nothing.");

    const gmPrivate = await json(`/api/rooms/${roomId}/private-rolls`, { headers: { cookie: gmCookie } });
    assert.equal(
      gmPrivate.body.rolls.length,
      4,
      "Default, private, and invisible rolls are kept in the GM's restricted log."
    );

    // A table set added outside any system joins the switcher and rolls like the rest.
    const created = await json(
      "/api/table-sets",
      {
        method: "POST",
        headers: gmJson,
        body: JSON.stringify({
          name: "House rumours",
          markdown: customMarkdown,
          tags: ["fantasy", "random-encounter"]
        })
      },
      201
    );
    assert.equal(created.body.set.tables, 1);
    assert.deepEqual(created.body.set.tags, ["fantasy", "random-encounter"]);
    const customId = created.body.set.id;

    const withCustom = await json(`/api/rooms/${roomId}/tables`, { headers: { cookie: gmCookie } });
    const customSet = withCustom.body.sets.find((set) => set.id === customId);
    assert.equal(customSet.origin, "custom");
    assert.equal(customSet.name, "House rumours");
    assert.deepEqual(customSet.tables[0].tags, ["fantasy", "random-encounter"]);
    assert.equal(customSet.tables[0].name, "Rumours in the market (d6)");
    assert.equal(customSet.tables[0].dice, "d6");

    const customRoll = await json(
      `/api/rooms/${roomId}/tables/roll`,
      {
        method: "POST",
        headers: gmJson,
        body: JSON.stringify({ setId: customId, tableId: customSet.tables[0].id, visibility: "reveal" })
      },
      201
    );
    assert.equal(customRoll.body.roll.setName, "House rumours");
    assert.ok(customRoll.body.roll.total >= 1 && customRoll.body.roll.total <= 6);
    assert.ok(customTable.rows.some((row) => row.cells.includes(customRoll.body.roll.text)));

    const numericId = Number(customId.replace("custom:", ""));
    await json(
      `/api/table-sets/${numericId}`,
      {
        method: "PATCH",
        headers: gmJson,
        body: JSON.stringify({ name: "Market rumours", markdown: customMarkdown, tags: ["gear"] })
      },
      204
    );
    const edited = await json(`/api/table-sets/${numericId}`, { headers: { cookie: gmCookie } });
    assert.equal(edited.body.set.name, "Market rumours");
    assert.deepEqual(edited.body.set.tags, ["gear"]);

    await json(
      "/api/table-sets",
      {
        method: "POST",
        headers: gmJson,
        body: JSON.stringify({ name: "Invalid tags", markdown: customMarkdown, tags: ["horror"] })
      },
      400
    );

    // Players may not manage sets.
    await json(
      "/api/table-sets",
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie: playerCookie },
        body: JSON.stringify({ name: "Player set", markdown: customMarkdown })
      },
      403
    );

    await json(`/api/table-sets/${numericId}`, { method: "DELETE", headers: { cookie: gmCookie } }, 204);
    const afterDelete = await json(`/api/rooms/${roomId}/tables`, { headers: { cookie: gmCookie } });
    assert.ok(!afterDelete.body.sets.some((set) => set.origin === "custom"));
  }
);
