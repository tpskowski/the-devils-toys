import assert from "node:assert/strict";
import { runSmoke } from "./harness.mjs";

await runSmoke(
  "Room capacity and role-filtered presence smoke test",
  async ({ json, setup, login, connect, waitFor }) => {
    const latest = { latest: true };
    const gm = await setup("CapacityGM", "capacity-test-password");
    const gmCookie = gm.cookie;
    const gmHeaders = gm.headers;
    const room = await json(
      "/api/rooms",
      {
        method: "POST",
        headers: gmHeaders,
        body: JSON.stringify({ name: "Capacity Table", system: "cairn" })
      },
      201
    );
    const roomId = room.body.room.id;

    const accounts = [];
    for (let index = 1; index <= 20; index += 1) {
      const username = `CapacityPlayer${String(index).padStart(2, "0")}`;
      const created = await json(
        "/api/accounts",
        {
          method: "POST",
          headers: gmHeaders,
          body: JSON.stringify({ username, password: "capacity-player-password" })
        },
        201
      );
      accounts.push({ id: created.body.account.id, username });
      await json(
        `/api/rooms/${roomId}/members`,
        { method: "POST", headers: gmHeaders, body: JSON.stringify({ accountId: created.body.account.id }) },
        201
      );
    }

    const roster = await json(`/api/rooms/${roomId}`, { headers: gmHeaders });
    assert.equal(roster.body.members.filter((member) => member.role === "player").length, 20);

    const activePlayers = [];
    for (const account of accounts.slice(0, 10)) {
      const session = await login(account.username, "capacity-player-password");
      activePlayers.push(session.cookie);
    }

    const gmConnection = await connect(gmCookie, roomId);
    await waitFor(gmConnection.events, (message) => message.type === "presence", "initial GM presence", latest);

    const playerConnections = [];
    for (const cookie of activePlayers) {
      playerConnections.push(await connect(cookie, roomId));
    }

    const fullPresence = await waitFor(
      gmConnection.events,
      (message) =>
        message.type === "presence" &&
        message.members.filter((member) => member.role === "player" && member.online).length === 10,
      "ten active players",
      latest
    );
    assert.equal(fullPresence.members.length, 21);
    assert.equal(
      gmConnection.events.filter((message) => message.type === "presence-notice" && /joined/.test(message.message.body))
        .length,
      10
    );

    const playerPresence = await waitFor(
      playerConnections[0].events,
      (message) => message.type === "presence" && message.members.filter((member) => member.online).length === 10,
      "role-filtered player presence",
      latest
    );
    assert.equal(playerPresence.members.length, 20);
    assert.ok(playerPresence.members.every((member) => member.role === "player"));
    assert.equal(
      playerConnections[0].events.some((message) => message.type === "presence-notice"),
      false
    );

    playerConnections[9].socket.close();
    await waitFor(
      gmConnection.events,
      (message) => message.type === "presence-notice" && /left/.test(message.message.body),
      "GM-only leave notice",
      latest
    );
    const afterLeave = await waitFor(
      gmConnection.events,
      (message) =>
        message.type === "presence" &&
        message.members.filter((member) => member.role === "player" && member.online).length === 9,
      "presence after a player leaves",
      latest
    );
    assert.equal(afterLeave.members.filter((member) => member.role === "player").length, 20);
  }
);
