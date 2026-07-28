import assert from "node:assert/strict";
import { runSmoke } from "./harness.mjs";

function expectedPass(roll, target) {
  return roll === 1 || (roll !== 20 && roll <= target);
}

await runSmoke("System-defined dice smoke test", async ({ json, setup, redeem, connect, sleep }) => {
  const gm = await setup("DiceGM", "dice-test-password");
  const { headers } = gm;

  const cairn = await json(
    "/api/rooms",
    { method: "POST", headers, body: JSON.stringify({ name: "Cairn Dice", system: "cairn" }) },
    201
  );
  const monolith = await json(
    "/api/rooms",
    { method: "POST", headers, body: JSON.stringify({ name: "Monolith Dice", system: "monolith" }) },
    201
  );

  const invitation = await json(
    `/api/rooms/${cairn.body.room.id}/invitations`,
    { method: "POST", headers, body: JSON.stringify({ username: "DicePlayer" }) },
    201
  );
  const player = await redeem(invitation.body.invitation.token, "dice-player-password");
  const playerHeaders = player.headers;

  const privateRoll = await json(
    `/api/rooms/${cairn.body.room.id}/rolls`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ expression: "d66", private: true })
    },
    201
  );
  assert.equal(privateRoll.body.message.private, true);
  assert.equal(privateRoll.body.message.kind, "roll");
  assert.ok(privateRoll.body.message.body.startsWith("1d66 "));

  const gmHistory = await json(`/api/rooms/${cairn.body.room.id}/messages`, { headers });
  assert.ok(gmHistory.body.messages.some((message) => message.private && message.id === privateRoll.body.message.id));
  const playerHistory = await json(`/api/rooms/${cairn.body.room.id}/messages`, { headers: playerHeaders });
  assert.equal(
    playerHistory.body.messages.some((message) => message.private),
    false
  );
  assert.equal(
    playerHistory.body.messages.some((message) => message.body === privateRoll.body.message.body),
    false
  );

  // A private roll tells the table a roll happened, without the result.
  const { events: playerEvents } = await connect(player.cookie, cairn.body.room.id);
  async function hiddenRoll(flags) {
    playerEvents.length = 0;
    const result = await json(
      `/api/rooms/${cairn.body.room.id}/rolls`,
      { method: "POST", headers, body: JSON.stringify({ expression: "1d20", ...flags }) },
      201
    );
    await sleep(250);
    return { ...result.body, broadcasts: playerEvents.filter((event) => event.type === "message") };
  }

  const announced = await hiddenRoll({ private: true });
  assert.equal(announced.private, true);
  assert.equal(announced.broadcasts.length, 1);
  assert.equal(announced.broadcasts[0].message.body, "Rolled privately");
  assert.ok(!announced.broadcasts[0].message.detail, "The notice carries no detail.");
  assert.ok(
    !JSON.stringify(announced.broadcasts[0].message).includes(String(announced.roll.total)),
    "The notice must not carry the result."
  );

  // An invisible roll leaves the table nothing at all.
  const unseen = await hiddenRoll({ invisible: true });
  assert.equal(unseen.private, true);
  assert.ok(unseen.message.body.startsWith("1d20 "));
  assert.equal(unseen.broadcasts.length, 0, "An invisible roll tells players nothing.");

  // Two private rolls have been made and both announced themselves; the
  // invisible one added nothing.
  const afterHidden = await json(`/api/rooms/${cairn.body.room.id}/messages`, { headers: playerHeaders });
  assert.equal(
    afterHidden.body.messages.filter((message) => message.body === "Rolled privately").length,
    2,
    "Only private rolls leave a notice behind."
  );

  // A player may roll privately, and it reaches the GM and nobody else.
  const { events: gmEvents } = await connect(gm.cookie, cairn.body.room.id);
  playerEvents.length = 0;
  gmEvents.length = 0;
  const playerPrivate = await json(
    `/api/rooms/${cairn.body.room.id}/rolls`,
    { method: "POST", headers: playerHeaders, body: JSON.stringify({ expression: "1d20", private: true }) },
    201
  );
  assert.equal(playerPrivate.body.private, true);
  assert.equal(playerPrivate.body.message.private, true);
  await sleep(300);
  const gmPrivateEvents = gmEvents.filter((event) => event.type === "message" && event.message.private);
  assert.equal(gmPrivateEvents.length, 1, "The GM is sent a player's private roll.");
  assert.equal(gmPrivateEvents[0].message.id, playerPrivate.body.message.id);
  assert.equal(
    playerEvents.filter((event) => event.type === "message" && event.message.private).length,
    0,
    "The roller's own copy comes from their response, not the socket."
  );

  const gmAfterPlayer = await json(`/api/rooms/${cairn.body.room.id}/messages`, { headers });
  assert.ok(
    gmAfterPlayer.body.messages.some(
      (message) => message.private && message.id === playerPrivate.body.message.id && message.body.startsWith("1d20 ")
    ),
    "A player's private roll is in the GM's history."
  );
  const gmRollLog = await json(`/api/rooms/${cairn.body.room.id}/private-rolls`, { headers });
  assert.ok(
    gmRollLog.body.rolls.some((roll) => roll.id === playerPrivate.body.message.id),
    "A player's private roll is in the GM's roll log."
  );

  // A second player at the table sees the notice but never the result.
  const otherInvitation = await json(
    `/api/rooms/${cairn.body.room.id}/invitations`,
    { method: "POST", headers, body: JSON.stringify({ username: "DiceOnlooker" }) },
    201
  );
  const onlooker = await redeem(otherInvitation.body.invitation.token, "onlooker-password");
  const onlookerHistory = await json(`/api/rooms/${cairn.body.room.id}/messages`, { headers: onlooker.headers });
  assert.equal(
    onlookerHistory.body.messages.some((message) => message.private),
    false,
    "One player never reads another's private roll."
  );
  assert.ok(onlookerHistory.body.messages.some((message) => message.body === "Rolled privately"));

  // Leaving no trace at all is still the GM's own privilege.
  await json(
    `/api/rooms/${cairn.body.room.id}/rolls`,
    { method: "POST", headers: playerHeaders, body: JSON.stringify({ expression: "1d20", invisible: true }) },
    403
  );

  const kept = await json(
    `/api/rooms/${cairn.body.room.id}/messages`,
    { method: "POST", headers, body: JSON.stringify({ body: "/roll 3d6kh1+2" }) },
    201
  );
  assert.ok(kept.body.message.body.startsWith("3d6kh1+2 →"));
  assert.ok(kept.body.message.detail.includes("kept ["));
  assert.ok(kept.body.message.detail.includes("dropped ["));

  await json(
    `/api/rooms/${cairn.body.room.id}/rolls`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        expression: "1d20",
        private: false,
        save: { ability: "STR", target: 10, position: "advantage" }
      })
    },
    400
  );

  for (const [position, successLabel, failureLabel] of [
    ["advantage", "Enhanced success", "Reduced failure"],
    ["disadvantage", "Mixed success", "Disastrous failure"]
  ]) {
    const response = await json(
      `/api/rooms/${monolith.body.room.id}/rolls`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          expression: "9d100+99",
          private: false,
          save: { ability: "WIL", target: 10, position }
        })
      },
      201
    );
    assert.equal(response.body.roll.expression, "1d20");
    assert.equal(response.body.roll.rolls.length, 1);
    const passed = expectedPass(response.body.roll.total, 10);
    assert.equal(response.body.roll.outcome.passed, passed);
    assert.equal(response.body.roll.outcome.label, passed ? successLabel : failureLabel);
    assert.ok(response.body.message.body.includes(position === "advantage" ? "WIL save (ADV)" : "WIL save (DIS)"));
  }
});
