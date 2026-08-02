import assert from "node:assert/strict";
import { runSmoke } from "./harness.mjs";

const portraitPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

await runSmoke(
  "Encounter roster and visibility smoke test",
  async ({ base, json, setup, redeem, connect, waitFor, upload }) => {
    const gm = await setup("EncounterGM", "encounter-test-password");
    const gmCookie = gm.cookie;
    const gmJson = gm.headers;

    const room = await json(
      "/api/rooms",
      { method: "POST", headers: gmJson, body: JSON.stringify({ name: "Cairn Encounter Table", system: "cairn" }) },
      201
    );
    const roomId = room.body.room.id;

    const invitation = await json(
      `/api/rooms/${roomId}/invitations`,
      { method: "POST", headers: gmJson, body: JSON.stringify({ username: "EncounterPlayer" }) },
      201
    );
    const player = await redeem(invitation.body.invitation.token, "encounter-player-password");
    const playerCookie = player.cookie;
    const playerJson = player.headers;

    const character = await json(
      `/api/rooms/${roomId}/characters`,
      { method: "POST", headers: playerJson, body: JSON.stringify({ name: "Bea", sheet: { hpCurrent: 5, hpMax: 5 } }) },
      201
    );
    const characterId = character.body.character.id;

    // Players never create or manage encounters.
    await json(
      `/api/rooms/${roomId}/encounters`,
      { method: "POST", headers: playerJson, body: JSON.stringify({ name: "Forbidden" }) },
      403
    );

    const { events } = await connect(gmCookie, roomId);
    const created = await json(
      `/api/rooms/${roomId}/encounters`,
      { method: "POST", headers: gmJson, body: JSON.stringify({ name: "Ambush at the ford" }) },
      201
    );
    const encounterId = created.body.encounter.id;
    await waitFor(events, "encounters-updated");

    // Cairn declares party and enemies, and both are seeded when the encounter is made.
    assert.deepEqual(
      created.body.encounter.sides.map((side) => side.side),
      ["party", "enemies"]
    );

    // An inactive encounter is invisible to players, so their tab stays empty.
    let playerView = await json(`/api/rooms/${roomId}/encounters`, { headers: { cookie: playerCookie } });
    assert.equal(playerView.body.encounters.length, 0);

    // Adding a character without naming a side must work: the side follows the kind.
    // A blanket "enemies" default made this a 400 and left every encounter empty.
    const withCharacter = await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/combatants`,
      { method: "POST", headers: gmJson, body: JSON.stringify({ kind: "character", characterId }) },
      201
    );
    const partyMember = withCharacter.body.encounter.combatants.find((entry) => entry.kind === "character");
    assert.equal(partyMember.side, "party");
    assert.equal(partyMember.name, "Bea");
    assert.equal(partyMember.hpCurrent, 5, "character HP is read from the sheet, not stored on the combatant");

    // A combatant carries a portrait where one exists. Without one it reports null
    // rather than a URL that would 404 into a broken image in the rail.
    assert.equal(partyMember.imageUrl, null, "a character with no portrait has no image URL");

    await upload(
      `/api/rooms/${roomId}/characters/${characterId}/portrait`,
      playerCookie,
      { file: new File([portraitPng], "bea.png", { type: "image/png" }) },
      201
    );
    const withPortrait = await json(`/api/rooms/${roomId}/encounters/${encounterId}`, {
      headers: { cookie: gmCookie }
    });
    const portrait = withPortrait.body.encounter.combatants.find((entry) => entry.kind === "character").imageUrl;
    assert.match(portrait, /portrait\?v=/, "the combatant picks up the character's portrait");
    const portraitFile = await fetch(`${base}${portrait}`, { headers: { cookie: gmCookie } });
    assert.equal(portraitFile.status, 200, "the rail's image URL actually resolves");
    assert.match(portraitFile.headers.get("content-type") ?? "", /^image\/png/);

    // The same character cannot be added twice.
    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/combatants`,
      { method: "POST", headers: gmJson, body: JSON.stringify({ kind: "character", characterId }) },
      409
    );

    // A bestiary entry clones into the room's NPCs and joins the encounter in one call.
    const withNpc = await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/combatants`,
      { method: "POST", headers: gmJson, body: JSON.stringify({ kind: "npc", catalogName: "Root Goblin" }) },
      201
    );
    const goblin = withNpc.body.encounter.combatants.find((entry) => entry.kind === "npc");
    assert.equal(goblin.side, "enemies");
    assert.equal(goblin.hpCurrent, 4, "the Cairn parser reads 4 HP off the bestiary line");
    // A record cloned to put something in a fight is a spawn, and the bestiary
    // must not list it beside the entry it was copied from.
    const npcs = await json(`/api/rooms/${roomId}/npcs`, { headers: { cookie: gmCookie } });
    assert.ok(
      !npcs.body.custom.some((npc) => npc.name === "Root Goblin"),
      "a spawned copy stays out of the bestiary's custom list"
    );
    assert.ok(
      npcs.body.catalog.some((npc) => npc.name === "Root Goblin"),
      "the built-in bestiary entry is still there"
    );
    let spawned = await json(`/api/rooms/${roomId}/npcs/spawned`, { headers: { cookie: gmCookie } });
    assert.equal(spawned.body.spawned.length, 1);
    assert.equal(spawned.body.spawned[0].name, "Root Goblin");
    assert.equal(spawned.body.spawned[0].encounterName, "Ambush at the ford");

    // Two goblins are two independent HP pools.
    const second = await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/combatants`,
      { method: "POST", headers: gmJson, body: JSON.stringify({ kind: "npc", catalogName: "Root Goblin" }) },
      201
    );
    assert.equal(second.body.encounter.combatants.filter((entry) => entry.kind === "npc").length, 2);

    // Two goblins are two combatants but only one spawned record, so repeatedly
    // adding from the bestiary does not pile up duplicates behind the scenes.
    spawned = await json(`/api/rooms/${roomId}/npcs/spawned`, { headers: { cookie: gmCookie } });
    assert.equal(spawned.body.spawned.length, 2, "each goblin is tracked separately");
    const goblinRecords = await json(`/api/rooms/${roomId}/npcs`, { headers: { cookie: gmCookie } });
    assert.equal(
      goblinRecords.body.custom.filter((npc) => npc.name === "Root Goblin").length,
      0,
      "neither goblin leaks into the bestiary"
    );

    // A GM's own NPC is not a spawn and stays in the bestiary even once it is fighting.
    const authored = await json(
      `/api/rooms/${roomId}/npcs`,
      { method: "POST", headers: gmJson, body: JSON.stringify({ name: "Moss Knight", notes: "8 HP" }) },
      201
    );
    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/combatants`,
      { method: "POST", headers: gmJson, body: JSON.stringify({ kind: "npc", npcId: authored.body.npc.id }) },
      201
    );
    const afterAuthored = await json(`/api/rooms/${roomId}/npcs`, { headers: { cookie: gmCookie } });
    assert.ok(
      afterAuthored.body.custom.some((npc) => npc.name === "Moss Knight"),
      "an NPC the GM wrote stays in the bestiary while it is in a fight"
    );

    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/combatants/${goblin.id}`,
      { method: "PATCH", headers: gmJson, body: JSON.stringify({ hpCurrent: 1 }) },
      200
    );
    const afterDamage = await json(`/api/rooms/${roomId}/encounters/${encounterId}`, { headers: { cookie: gmCookie } });
    const damaged = afterDamage.body.encounter.combatants.find((entry) => entry.id === goblin.id);
    const untouched = afterDamage.body.encounter.combatants.find(
      (entry) => entry.kind === "npc" && entry.id !== goblin.id
    );
    assert.equal(damaged.hpCurrent, 1);
    assert.equal(untouched.hpCurrent, 4, "damaging one goblin leaves the other alone");

    // The GM writes a player's HP through to the character sheet.
    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/combatants/${partyMember.id}`,
      { method: "PATCH", headers: gmJson, body: JSON.stringify({ hpCurrent: 2 }) },
      200
    );
    const sheet = await json(`/api/rooms/${roomId}/characters`, { headers: { cookie: playerCookie } });
    const bea = sheet.body.characters.find((entry) => entry.id === characterId);
    assert.equal(bea.sheet.hpCurrent, 2, "the tracker writes through to the character sheet");
    assert.equal(bea.sheet.hpMax, 5, "a partial HP write must not erase the rest of the sheet");

    await json(`/api/rooms/${roomId}/encounters/${encounterId}/activate`, { method: "POST", headers: gmJson }, 200);

    // Once active, a player sees the encounter but not what the GM knows about the enemies.
    playerView = await json(`/api/rooms/${roomId}/encounters`, { headers: { cookie: playerCookie } });
    assert.equal(playerView.body.encounters.length, 1);
    const seen = playerView.body.encounters[0];
    assert.equal(seen.notes, undefined, "encounter notes are GM-only");
    const seenGoblin = seen.combatants.find((entry) => entry.kind === "npc");
    assert.equal(seenGoblin.name, "Root Goblin", "players see an NPC's name and position");
    assert.equal(seenGoblin.hpCurrent, undefined, "players never see NPC hit points");
    assert.equal(seenGoblin.statblock, undefined, "players never see an NPC statblock");

    // A player spends and heals their own character's hit points from the tracker.
    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/combatants/${partyMember.id}`,
      { method: "PATCH", headers: playerJson, body: JSON.stringify({ hpCurrent: 3 }) },
      200
    );
    const stepped = await json(`/api/rooms/${roomId}/characters`, { headers: { cookie: playerCookie } });
    assert.equal(
      stepped.body.characters.find((entry) => entry.id === characterId).sheet.hpCurrent,
      3,
      "a player's own HP step reaches their sheet"
    );

    // Hit points are the whole of it. Anything else on the combatant is the GM's,
    // and so is anyone else's HP.
    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/combatants/${partyMember.id}`,
      { method: "PATCH", headers: playerJson, body: JSON.stringify({ hpCurrent: 4, side: "enemies" }) },
      403
    );
    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/combatants/${seenGoblin.id}`,
      { method: "PATCH", headers: playerJson, body: JSON.stringify({ hpCurrent: 1 }) },
      403
    );
    const interloperInvitation = await json(
      `/api/rooms/${roomId}/invitations`,
      { method: "POST", headers: gmJson, body: JSON.stringify({ username: "EncounterInterloper" }) },
      201
    );
    const interloper = await redeem(interloperInvitation.body.invitation.token, "encounter-interloper-password");
    // A map put on the encounter tab is shown to the table whether or not the
    // Library has revealed it, and putting it there reveals nothing elsewhere.
    const mapUpload = await upload(
      `/api/rooms/${roomId}/media`,
      gmCookie,
      { kind: "map", file: new File([portraitPng], "ford.png", { type: "image/png" }) },
      201
    );
    const mapId = mapUpload.body.media.id;
    assert.equal(mapUpload.body.media.visible, false, "an upload starts hidden");
    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}`,
      { method: "PATCH", headers: gmJson, body: JSON.stringify({ mediaId: mapId }) },
      200
    );
    const withMap = await json(`/api/rooms/${roomId}/encounters/${encounterId}`, {
      headers: { cookie: playerCookie }
    });
    assert.equal(withMap.body.encounter.media.id, mapId, "the encounter's own map is shown to players");
    const library = await json(`/api/rooms/${roomId}/media`, { headers: { cookie: playerCookie } });
    assert.ok(
      !(library.body.library ?? []).some((asset) => asset.id === mapId),
      "and the Maps tab still has not revealed it"
    );

    // Map tokens use normalized coordinates so they stay attached to the same
    // place as the image responds to different screens. Control is identical to
    // the zone board: a player moves their character, while the GM moves NPCs.
    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/combatants/${partyMember.id}`,
      { method: "PATCH", headers: playerJson, body: JSON.stringify({ mapPosition: { x: 0.25, y: 0.6 } }) },
      200
    );
    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/combatants/${seenGoblin.id}`,
      { method: "PATCH", headers: gmJson, body: JSON.stringify({ mapPosition: { x: 0.7, y: 0.3 } }) },
      200
    );
    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/combatants/${seenGoblin.id}`,
      { method: "PATCH", headers: playerJson, body: JSON.stringify({ mapPosition: { x: 0.4, y: 0.4 } }) },
      403
    );
    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/combatants/${partyMember.id}`,
      { method: "PATCH", headers: interloper.headers, body: JSON.stringify({ mapPosition: { x: 0.4, y: 0.4 } }) },
      404
    );
    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/combatants/${partyMember.id}`,
      { method: "PATCH", headers: gmJson, body: JSON.stringify({ mapPosition: { x: 1.1, y: 0.4 } }) },
      400
    );
    const tokenMap = await json(`/api/rooms/${roomId}/encounters/${encounterId}`, {
      headers: { cookie: playerCookie }
    });
    assert.deepEqual(
      tokenMap.body.encounter.combatants.find((entry) => entry.id === partyMember.id).mapPosition,
      { x: 0.25, y: 0.6 },
      "the whole table sees a character's map position"
    );
    assert.deepEqual(
      tokenMap.body.encounter.combatants.find((entry) => entry.id === seenGoblin.id).mapPosition,
      { x: 0.7, y: 0.3 },
      "the whole table sees an NPC's map position without seeing its hidden statistics"
    );
    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/combatants/${seenGoblin.id}`,
      { method: "PATCH", headers: gmJson, body: JSON.stringify({ mapPosition: null }) },
      200
    );
    const clearedTokenMap = await json(`/api/rooms/${roomId}/encounters/${encounterId}`, {
      headers: { cookie: gmCookie }
    });
    assert.equal(
      clearedTokenMap.body.encounter.combatants.find((entry) => entry.id === seenGoblin.id).mapPosition,
      null,
      "clearing a map position returns the combatant to the roster"
    );

    // The encounter tab shows either a map or a board of zones, and the GM says
    // which. Zones read left to right in the order they were made.
    assert.equal(seen.display, "map", "an encounter starts on its map");
    const zoned = await json(
      `/api/rooms/${roomId}/encounters/${encounterId}`,
      { method: "PATCH", headers: gmJson, body: JSON.stringify({ display: "zones" }) },
      200
    );
    assert.equal(zoned.body.encounter.display, "zones");
    const gate = await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/zones`,
      { method: "POST", headers: gmJson, body: JSON.stringify({ name: "The gate" }) },
      201
    );
    const ford = await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/zones`,
      { method: "POST", headers: gmJson, body: JSON.stringify({ name: "The ford" }) },
      201
    );
    assert.deepEqual(
      ford.body.encounter.zones.map((zone) => zone.name),
      ["The gate", "The ford"],
      "a new zone joins the right-hand end"
    );
    const gateId = gate.body.encounter.zones[0].id;
    const fordId = ford.body.encounter.zones[1].id;

    // The GM lays the row out again by sending the whole order, so the result
    // never depends on which of a run of single writes arrived first.
    const reordered = await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/zones`,
      { method: "PATCH", headers: gmJson, body: JSON.stringify({ order: [fordId, gateId] }) },
      200
    );
    assert.deepEqual(
      reordered.body.encounter.zones.map((zone) => zone.name),
      ["The ford", "The gate"],
      "the left-hand zone can be moved to the right"
    );
    // An order that leaves a zone out, or names one twice, is not an order.
    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/zones`,
      { method: "PATCH", headers: gmJson, body: JSON.stringify({ order: [gateId] }) },
      400
    );
    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/zones`,
      { method: "PATCH", headers: gmJson, body: JSON.stringify({ order: [gateId, gateId] }) },
      400
    );
    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/zones`,
      { method: "PATCH", headers: playerJson, body: JSON.stringify({ order: [gateId, fordId] }) },
      403
    );

    // Players may only ever move themselves; the GM moves anyone.
    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/combatants/${partyMember.id}`,
      { method: "PATCH", headers: playerJson, body: JSON.stringify({ zoneId: gateId }) },
      200
    );
    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/combatants/${seenGoblin.id}`,
      { method: "PATCH", headers: playerJson, body: JSON.stringify({ zoneId: gateId }) },
      403
    );
    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/combatants/${seenGoblin.id}`,
      { method: "PATCH", headers: gmJson, body: JSON.stringify({ zoneId: gateId }) },
      200
    );
    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/combatants/${partyMember.id}`,
      { method: "PATCH", headers: gmJson, body: JSON.stringify({ zoneId: 999999 }) },
      404
    );
    // Placement is not a way around whose character it is: another player is
    // told what they are told about any character that is not theirs.
    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/combatants/${partyMember.id}`,
      { method: "PATCH", headers: interloper.headers, body: JSON.stringify({ zoneId: gateId }) },
      404
    );

    const board = await json(`/api/rooms/${roomId}/encounters/${encounterId}`, { headers: { cookie: playerCookie } });
    assert.equal(
      board.body.encounter.combatants.find((entry) => entry.id === partyMember.id).zoneId,
      gateId,
      "where everyone stands is on the board for the whole table"
    );

    // Removing a zone clears the board, and leaves the fight alone.
    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/zones/${gateId}`,
      { method: "DELETE", headers: gmJson },
      200
    );
    const cleared = await json(`/api/rooms/${roomId}/encounters/${encounterId}`, { headers: { cookie: gmCookie } });
    assert.equal(cleared.body.encounter.zones.length, 1);
    assert.equal(
      cleared.body.encounter.combatants.find((entry) => entry.id === partyMember.id).zoneId,
      null,
      "a removed zone puts its combatants back on the bench, not out of the fight"
    );
    assert.ok(cleared.body.encounter.combatants.some((entry) => entry.id === partyMember.id));

    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/combatants/${partyMember.id}`,
      { method: "PATCH", headers: interloper.headers, body: JSON.stringify({ hpCurrent: 1 }) },
      404
    );

    // Damage past 0 HP moves to an attribute. The same rule about whose scores
    // they are holds, and where the score lives follows the kind of combatant.
    assert.ok(
      seen.attributeDamage.attributes.some((attribute) => attribute.id === "str"),
      "a player is told which attributes their character can spend"
    );
    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/combatants/${partyMember.id}`,
      { method: "PATCH", headers: playerJson, body: JSON.stringify({ attributes: { str: 7 } }) },
      200
    );
    const spent = await json(`/api/rooms/${roomId}/characters`, { headers: { cookie: playerCookie } });
    const spentBea = spent.body.characters.find((entry) => entry.id === characterId);
    assert.equal(spentBea.sheet.strCurrent, 7, "an attribute step reaches the character sheet");
    assert.equal(spentBea.sheet.hpCurrent, 3, "spending an attribute leaves hit points alone");

    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/combatants/${seenGoblin.id}`,
      { method: "PATCH", headers: playerJson, body: JSON.stringify({ attributes: { str: 1 } }) },
      403
    );
    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/combatants/${partyMember.id}`,
      { method: "PATCH", headers: playerJson, body: JSON.stringify({ attributes: { luck: 1 } }) },
      400
    );

    // Cairn does not carry Monolith's mark, so nothing here may set one.
    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/combatants/${partyMember.id}`,
      { method: "PATCH", headers: gmJson, body: JSON.stringify({ criticalDamage: true }) },
      400
    );

    // An NPC's scores live in its statblock, not on any sheet.
    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/combatants/${goblin.id}`,
      { method: "PATCH", headers: gmJson, body: JSON.stringify({ attributes: { str: 2 } }) },
      200
    );
    const afterSpend = await json(`/api/rooms/${roomId}/encounters/${encounterId}`, { headers: { cookie: gmCookie } });
    const spentGoblin = afterSpend.body.encounter.combatants.find((entry) => entry.id === goblin.id);
    assert.equal(spentGoblin.statblock.str, 2, "the GM spends an NPC's attribute in its statblock");
    assert.equal(spentGoblin.statblock.strMax, 8, "and what it was is kept, so the dialog can show 2/8");
    assert.equal(spentGoblin.statblock.hp, 4, "the rest of the statblock survives an attribute write");
    assert.equal(spentGoblin.hpCurrent, 1, "and its hit points are untouched");

    // The rail carries the first weapon each combatant is holding, so it can be
    // rolled from beside the name.
    assert.equal(spentGoblin.weapon.damage, "d6", "a creature's attack is read from its statblock");
    assert.equal(spentGoblin.weapon.range, "unknown", "Cairn states no ranges, so a reach it never gave is unknown");
    assert.equal(spentGoblin.armor, 0, "a creature's armor is read from its statblock");
    assert.equal(afterSpend.body.encounter.rangedWeaponIcon, "bow", "the rail draws Cairn's ranged weapons as a bow");
    const armed = await json(
      `/api/rooms/${roomId}/characters/${characterId}`,
      {
        method: "PATCH",
        headers: playerJson,
        body: JSON.stringify({
          sheet: {
            hpCurrent: 3,
            hpMax: 5,
            armor: 2,
            inventory: ["Rope", "Sword (d6)", "Dagger (d4)", "", "Halberd (d10 damage, bulky)"]
          }
        })
      },
      200
    );
    assert.ok(armed.body.character);
    const armedView = await json(`/api/rooms/${roomId}/encounters/${encounterId}`, { headers: { cookie: gmCookie } });
    const armedBea = armedView.body.encounter.combatants.find((entry) => entry.id === partyMember.id);
    assert.equal(armedBea.weapon.name, "Sword", "the first weapon within reach, not the first slot");
    assert.equal(armedBea.weapon.damage, "d6");
    assert.equal(armedBea.offhand, undefined, "one hand until the sheet says otherwise");

    // A player is told what the party carries, and never what a creature does.
    const armedPlayerView = await json(`/api/rooms/${roomId}/encounters/${encounterId}`, {
      headers: { cookie: playerCookie }
    });
    const playerCombatants = armedPlayerView.body.encounter.combatants;
    assert.equal(playerCombatants.find((entry) => entry.id === partyMember.id).weapon.damage, "d6");
    // What a creature is holding and wearing is plain to look at across a room,
    // so the whole table sees both. How much fight is left in it is not.
    const playerGoblin = playerCombatants.find((entry) => entry.kind === "npc");
    assert.equal(playerGoblin.weapon.damage, "d6", "players see what a creature attacks with");
    assert.equal(playerGoblin.armor, 0, "and what it is wearing");
    assert.equal(playerGoblin.hpCurrent, undefined, "but never its hit points");
    assert.equal(playerGoblin.statblock, undefined, "nor the rest of its statblock");
    assert.equal(
      playerCombatants.find((entry) => entry.id === partyMember.id).armor,
      2,
      "the party's armor is on the rail for everyone"
    );

    // Which weapon is drawn, and whether a second is, is the sheet's to say.
    await json(
      `/api/rooms/${roomId}/characters/${characterId}`,
      {
        method: "PATCH",
        headers: playerJson,
        body: JSON.stringify({
          sheet: {
            hpCurrent: 3,
            hpMax: 5,
            armor: 2,
            inventory: ["Rope", "Sword (d6)", "Dagger (d4)", "", "Halberd (d10 damage, bulky)"],
            weaponSlot: 2,
            weaponOffhandSlot: 1,
            dualWield: true
          }
        })
      },
      200
    );
    const dualView = await json(`/api/rooms/${roomId}/encounters/${encounterId}`, { headers: { cookie: gmCookie } });
    const dualBea = dualView.body.encounter.combatants.find((entry) => entry.id === partyMember.id);
    assert.equal(dualBea.weapon.name, "Dagger", "the chosen weapon, not the first one");
    assert.equal(dualBea.offhand.name, "Sword", "and the second where they fight with both");

    // Rolling a weapon: the notation goes as written and the system reads it.
    const attack = await json(
      `/api/rooms/${roomId}/rolls`,
      {
        method: "POST",
        headers: playerJson,
        body: JSON.stringify({ attack: { label: "Bea · Sword (d6) [bulky]", damage: "d6" } })
      },
      201
    );
    assert.match(attack.body.message.body, /^Bea · Sword \(d6\) \[bulky\] → \d+$/);
    assert.ok(attack.body.roll.total >= 1 && attack.body.roll.total <= 6, "a d6 rolls within a d6");
    // Two attack dice of different sizes are nobody's single roll.
    await json(
      `/api/rooms/${roomId}/rolls`,
      {
        method: "POST",
        headers: playerJson,
        body: JSON.stringify({ attack: { label: "Bea · Odd", damage: "D6+D4" } })
      },
      400
    );

    // A second activation needs confirmation before it is allowed to stand alongside the first.
    const other = await json(
      `/api/rooms/${roomId}/encounters`,
      { method: "POST", headers: gmJson, body: JSON.stringify({ name: "The bridge" }) },
      201
    );
    await json(
      `/api/rooms/${roomId}/encounters/${other.body.encounter.id}/activate`,
      { method: "POST", headers: gmJson },
      409
    );
    await json(
      `/api/rooms/${roomId}/encounters/${other.body.encounter.id}/activate`,
      { method: "POST", headers: gmJson, body: JSON.stringify({ confirm: true }) },
      200
    );

    // Cairn has no individual initiative variant, so it cannot be switched on.
    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}`,
      { method: "PATCH", headers: gmJson, body: JSON.stringify({ individualInitiative: true }) },
      400
    );

    // Cairn orders its sides by rule, so there is nothing to roll.
    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/roll-initiative`,
      { method: "POST", headers: gmJson },
      400
    );

    // Opening saves are recorded and then cleared by hand, since nothing tracks the first turn.
    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/combatants/${partyMember.id}`,
      { method: "PATCH", headers: gmJson, body: JSON.stringify({ actsFirstTurn: false }) },
      200
    );
    let saves = await json(`/api/rooms/${roomId}/encounters/${encounterId}`, { headers: { cookie: gmCookie } });
    assert.equal(saves.body.encounter.combatants.find((entry) => entry.id === partyMember.id).actsFirstTurn, false);
    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}/opening-saves`,
      { method: "DELETE", headers: { cookie: gmCookie } },
      204
    );
    saves = await json(`/api/rooms/${roomId}/encounters/${encounterId}`, { headers: { cookie: gmCookie } });
    assert.equal(saves.body.encounter.combatants.find((entry) => entry.id === partyMember.id).actsFirstTurn, null);

    // A CWN room rolls per side, and the party adds its best DEX modifier.
    const cwn = await json(
      "/api/rooms",
      { method: "POST", headers: gmJson, body: JSON.stringify({ name: "CWN Encounter Table", system: "cwn" }) },
      201
    );
    const cwnRoomId = cwn.body.room.id;
    const cwnEncounter = await json(
      `/api/rooms/${cwnRoomId}/encounters`,
      { method: "POST", headers: gmJson, body: JSON.stringify({ name: "Rooftop firefight" }) },
      201
    );
    // CWN does not spend attributes, so nothing offers to.
    assert.equal(
      cwnEncounter.body.encounter.attributeDamage,
      undefined,
      "a system without attribute damage declares none"
    );
    const rolled = await json(
      `/api/rooms/${cwnRoomId}/encounters/${cwnEncounter.body.encounter.id}/roll-initiative`,
      { method: "POST", headers: gmJson },
      200
    );
    for (const side of rolled.body.encounter.sides) {
      assert.ok(
        Number.isInteger(side.initiative) && side.initiative >= 1,
        `${side.side} should have rolled an initiative, got ${side.initiative}`
      );
    }

    // CWN is the one system that offers individual initiative.
    await json(
      `/api/rooms/${cwnRoomId}/encounters/${cwnEncounter.body.encounter.id}`,
      { method: "PATCH", headers: gmJson, body: JSON.stringify({ individualInitiative: true }) },
      200
    );

    // Deleting the character removes it from combat by cascade.
    await json(
      `/api/rooms/${roomId}/characters/${characterId}`,
      { method: "DELETE", headers: { cookie: gmCookie } },
      204
    );
    const afterDelete = await json(`/api/rooms/${roomId}/encounters/${encounterId}`, { headers: { cookie: gmCookie } });
    assert.ok(
      !afterDelete.body.encounter.combatants.some((entry) => entry.kind === "character"),
      "a deleted character leaves the encounter"
    );

    await json(
      `/api/rooms/${roomId}/encounters/${encounterId}`,
      { method: "DELETE", headers: { cookie: gmCookie } },
      204
    );
    const remaining = await json(`/api/rooms/${roomId}/encounters`, { headers: { cookie: gmCookie } });
    assert.equal(remaining.body.encounters.length, 1);
  }
);
