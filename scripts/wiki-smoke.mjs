import assert from "node:assert/strict";
import { runSmoke } from "./harness.mjs";

const png = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cff0000004010100ad5d4db10000000049454e44ae426082",
  "hex"
);

await runSmoke("Campaign wiki smoke test", async ({ request, json, setup, redeem, upload }) => {
  const gm = await setup("WikiGM", "wiki-gm-password");
  const room = (
    await request(
      "/api/rooms",
      { method: "POST", headers: gm.headers, body: JSON.stringify({ name: "Wiki Table", system: "toybox" }) },
      201
    )
  ).room;

  const invite = async (username, password) => {
    const invitation = await request(
      `/api/rooms/${room.id}/invitations`,
      { method: "POST", headers: gm.headers, body: JSON.stringify({ username }) },
      201
    );
    return redeem(invitation.invitation.token, password);
  };
  const owner = await invite("WikiOwner", "wiki-owner-password");
  const reader = await invite("WikiReader", "wiki-reader-password");

  // A player's folder and page begin private to that player, even though both
  // players belong to the same table.
  const folder = (
    await request(
      `/api/rooms/${room.id}/wiki/folders`,
      {
        method: "POST",
        headers: owner.headers,
        body: JSON.stringify({ name: "Owner's notes" })
      },
      201
    )
  ).folder;
  const privatePage = (
    await request(
      `/api/rooms/${room.id}/wiki/pages`,
      {
        method: "POST",
        headers: owner.headers,
        body: JSON.stringify({ title: "Private Ledger", markdown: "First draft.", folderId: folder.id })
      },
      201
    )
  ).page;
  assert.equal(privatePage.visible, false);
  await json(`/api/rooms/${room.id}/wiki/pages/${privatePage.slug}`, { headers: reader.headers }, 404);
  const privateListing = await request(`/api/rooms/${room.id}/wiki`, { headers: reader.headers });
  assert.ok(
    !privateListing.pages.some((page) => page.slug === privatePage.slug),
    "A private page stays out of another player's index."
  );
  assert.ok(
    !privateListing.folders.some((entry) => entry.id === folder.id),
    "A private folder stays out of another player's index."
  );

  // Sharing is a GM action. It grants reading, never editing.
  await request(`/api/rooms/${room.id}/wiki/pages/${privatePage.slug}/reveal`, {
    method: "POST",
    headers: gm.headers,
    body: JSON.stringify({ visible: true })
  });
  const shared = await request(`/api/rooms/${room.id}/wiki/pages/${privatePage.slug}`, { headers: reader.headers });
  assert.equal(shared.page.markdown, "First draft.");
  await json(
    `/api/rooms/${room.id}/wiki/pages/${privatePage.slug}`,
    {
      method: "PUT",
      headers: reader.headers,
      body: JSON.stringify({ revision: shared.page.revision, markdown: "Forbidden." })
    },
    404
  );

  // Writes carry a revision, so an old editor receives the current page rather
  // than silently overwriting a later draft.
  const current = await request(`/api/rooms/${room.id}/wiki/pages/${privatePage.slug}`, {
    method: "PUT",
    headers: owner.headers,
    body: JSON.stringify({ revision: privatePage.revision, markdown: "Current draft." })
  });
  assert.equal(current.page.revision, privatePage.revision + 1);
  const conflict = await json(
    `/api/rooms/${room.id}/wiki/pages/${privatePage.slug}`,
    {
      method: "PUT",
      headers: owner.headers,
      body: JSON.stringify({ revision: privatePage.revision, markdown: "Stale draft." })
    },
    409
  );
  assert.equal(conflict.body.page.markdown, "Current draft.");
  assert.equal(conflict.body.page.revision, current.page.revision);

  // Mentions are indexed on save, but their targets are evaluated again for
  // each reader. A hidden NPC cannot be discovered through a shared page, the
  // picker, or a forged directive.
  const npc = (
    await request(
      `/api/rooms/${room.id}/npcs`,
      {
        method: "POST",
        headers: gm.headers,
        body: JSON.stringify({ name: "Hidden Broker", notes: "GM-only." })
      },
      201
    )
  ).npc;
  const mentionPage = (
    await request(
      `/api/rooms/${room.id}/wiki/pages`,
      {
        method: "POST",
        headers: gm.headers,
        body: JSON.stringify({ title: "Broker lead", markdown: `Meet :npc[Hidden Broker]{id=${npc.id}}.` })
      },
      201
    )
  ).page;
  await request(`/api/rooms/${room.id}/wiki/pages/${mentionPage.slug}/reveal`, {
    method: "POST",
    headers: gm.headers,
    body: JSON.stringify({ visible: true })
  });
  const redacted = await request(`/api/rooms/${room.id}/wiki/pages/${mentionPage.slug}`, { headers: reader.headers });
  assert.match(redacted.page.markdown, /Hidden Broker/);
  assert.ok(!redacted.page.markdown.includes(":npc["), "A hidden target is sent as its plain label.");
  assert.ok(!redacted.page.markdown.includes(`id=${npc.id}`), "A hidden target id is never sent to the player.");
  const picker = await request(`/api/rooms/${room.id}/wiki/mentionables?q=broker`, { headers: reader.headers });
  assert.ok(
    !picker.mentionables.some((entry) => entry.kind === "npc" && entry.id === npc.id),
    "The mention picker hides unrevealed NPCs."
  );
  await json(
    `/api/rooms/${room.id}/wiki/pages`,
    {
      method: "POST",
      headers: reader.headers,
      body: JSON.stringify({ title: "Probe", markdown: `:npc[Hidden Broker]{id=${npc.id}}` })
    },
    400
  );

  // A map exposes its legend only once the normal page sharing gate permits
  // the reader to open that page.
  const map = (
    await upload(`/api/rooms/${room.id}/media`, gm.cookie, {
      kind: "map",
      file: new File([png], "undercroft.png", { type: "image/png" })
    })
  ).body.media;
  await json(
    `/api/rooms/${room.id}/map`,
    {
      method: "PATCH",
      headers: gm.headers,
      body: JSON.stringify({ mediaId: map.id })
    },
    204
  );
  const legend = (
    await request(
      `/api/rooms/${room.id}/wiki/pages`,
      {
        method: "POST",
        headers: gm.headers,
        body: JSON.stringify({ title: "Undercroft legend", markdown: "The numbered rooms." })
      },
      201
    )
  ).page;
  await request(`/api/rooms/${room.id}/maps/${map.id}/legend`, {
    method: "POST",
    headers: gm.headers,
    body: JSON.stringify({ slug: legend.slug })
  });
  assert.equal((await request(`/api/rooms/${room.id}/media`, { headers: reader.headers })).map.legend, null);
  await request(`/api/rooms/${room.id}/wiki/pages/${legend.slug}/reveal`, {
    method: "POST",
    headers: gm.headers,
    body: JSON.stringify({ visible: true })
  });
  assert.deepEqual((await request(`/api/rooms/${room.id}/media`, { headers: reader.headers })).map.legend, {
    slug: legend.slug,
    title: legend.title
  });

  // Turning the room feature off removes the whole wiki surface, rather than
  // returning a partly visible collection.
  await json(
    `/api/rooms/${room.id}`,
    { method: "PATCH", headers: gm.headers, body: JSON.stringify({ wikiEnabled: false }) },
    204
  );
  await json(`/api/rooms/${room.id}/wiki`, { headers: owner.headers }, 404);
});
