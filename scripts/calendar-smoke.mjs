import assert from "node:assert/strict";
import { runSmoke } from "./harness.mjs";

await runSmoke("Calendar controls smoke test", async ({ json, login, setup }) => {
  const gm = await setup("CalendarGM", "calendar-gm-password");
  const room = await json(
    "/api/rooms",
    {
      method: "POST",
      headers: gm.headers,
      body: JSON.stringify({ name: "Calendar Table", system: "toybox" })
    },
    201
  );
  const roomId = room.body.room.id;
  await json(
    `/api/rooms/${roomId}`,
    { method: "PATCH", headers: gm.headers, body: JSON.stringify({ calendarEnabled: true }) },
    204
  );

  const account = await json(
    "/api/accounts",
    {
      method: "POST",
      headers: gm.headers,
      body: JSON.stringify({ username: "CalendarPlayer", password: "calendar-player-password" })
    },
    201
  );
  await json(
    `/api/rooms/${roomId}/members`,
    {
      method: "POST",
      headers: gm.headers,
      body: JSON.stringify({ accountId: account.body.account.id })
    },
    201
  );
  const player = await login("CalendarPlayer", "calendar-player-password");

  const publicEntry = await json(
    `/api/rooms/${roomId}/calendar/events`,
    {
      method: "POST",
      headers: player.headers,
      body: JSON.stringify({ name: "Player note", year: 1, month: 0, day: 4, hidden: false })
    },
    201
  );
  assert.equal(publicEntry.body.entry.cadence, "once");
  assert.deepEqual(
    publicEntry.body.calendar.events.map((event) => event.name),
    ["Player note"]
  );
  await json(
    `/api/rooms/${roomId}/calendar/events`,
    {
      method: "POST",
      headers: player.headers,
      body: JSON.stringify({ name: "Secret player note", year: 1, month: 0, day: 5, hidden: true })
    },
    403
  );
  await json(
    `/api/rooms/${roomId}/calendar/set-time`,
    {
      method: "POST",
      headers: player.headers,
      body: JSON.stringify({ year: 2, month: 1, day: 7, segment: 0 })
    },
    403
  );

  await json(
    `/api/rooms/${roomId}/calendar/events`,
    {
      method: "POST",
      headers: gm.headers,
      body: JSON.stringify({ name: "GM note", year: 2, month: 1, day: 7, hidden: true })
    },
    201
  );
  const moved = await json(`/api/rooms/${roomId}/calendar/set-time`, {
    method: "POST",
    headers: gm.headers,
    body: JSON.stringify({ year: 2, month: 1, day: 7, segment: 0 })
  });
  assert.deepEqual(
    { year: moved.body.calendar.year, month: moved.body.calendar.month, day: moved.body.calendar.day },
    { year: 2, month: 1, day: 7 }
  );

  const playerRoom = await json(`/api/rooms/${roomId}`, { headers: player.headers });
  assert.deepEqual(
    playerRoom.body.room.calendar.events.map((event) => event.name),
    ["Player note"]
  );
});
