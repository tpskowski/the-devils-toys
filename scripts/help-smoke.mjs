import assert from "node:assert/strict";
import { runSmoke } from "./harness.mjs";

await runSmoke("Help guides smoke test", async ({ base, json, request, setup, login, redeem }) => {
  const admin = await setup("HelpAdmin", "help-admin-password");
  await request(
    "/api/accounts",
    {
      method: "POST",
      headers: admin.headers,
      body: JSON.stringify({ username: "HelpGM", password: "help-gm-password", role: "gm" })
    },
    201
  );
  const gm = await login("HelpGM", "help-gm-password");
  const room = (
    await request(
      "/api/rooms",
      { method: "POST", headers: gm.headers, body: JSON.stringify({ name: "A Table", system: "cairn" }) },
      201
    )
  ).room;
  const invitation = await request(
    `/api/rooms/${room.id}/invitations`,
    { method: "POST", headers: gm.headers, body: JSON.stringify({ username: "HelpPlayer" }) },
    201
  );
  const player = await redeem(invitation.invitation.token, "help-player-password");

  // --- Every role gets every guide, and is told which one is theirs ---

  const forPlayer = await request("/api/help", { headers: player.headers });
  assert.equal(forPlayer.viewerRole, "player", "The reader's own role picks the guide that opens first.");
  assert.deepEqual(
    forPlayer.guides.map((guide) => guide.id),
    ["player", "gm", "admin", "tables"],
    "A player can read every guide; they describe what each role can do, which is not a secret."
  );
  assert.equal((await request("/api/help", { headers: gm.headers })).viewerRole, "gm");
  assert.equal((await request("/api/help", { headers: admin.headers })).viewerRole, "admin");
  await json("/api/help", {}, 401);

  // --- Each guide has its overview first, then its own pages ---

  for (const guide of forPlayer.guides) {
    assert.equal(guide.pages[0].slug, "overview", `${guide.id} opens on its README.`);
    assert.ok(guide.pages.length > 1, `${guide.id} has pages beneath its overview.`);
    assert.ok(
      guide.pages.every((page) => page.markdown.trim().length > 0),
      `${guide.id} has no empty page.`
    );
    assert.ok(
      guide.pages.every((page) => page.title && page.title !== page.slug),
      `${guide.id} names every page from its own first heading.`
    );
  }

  // The menu follows the order the guide's README links its pages in.
  const gmGuide = forPlayer.guides.find((guide) => guide.id === "gm");
  assert.deepEqual(
    gmGuide.pages.map((page) => page.slug),
    ["overview", "your-room", "room-config", "npcs-and-encounters", "at-the-table"],
    "The README is the table of contents, so the menu is in its order rather than alphabetical."
  );

  // --- The pictures beside them ---

  const withImage = forPlayer.guides
    .flatMap((guide) => guide.pages)
    .map((page) => /!\[[^\]]*\]\(([^)]+\.png)\)/.exec(page.markdown)?.[1])
    .find(Boolean);
  assert.ok(withImage, "The guides carry screenshots.");
  const name = withImage.split("/").pop();
  const image = await fetch(`${base}/api/help/images/${name}`, { headers: { cookie: player.cookie } });
  assert.equal(image.status, 200, "An image named by a guide is served.");
  assert.ok(image.headers.get("content-type")?.includes("image/"));

  // A name is a file beside the guides, never a path out of that directory.
  for (const attempt of ["..%2F..%2Fpackage.json", "..%2Fcombat.md", "nothing-here.png"])
    assert.equal(
      (await fetch(`${base}/api/help/images/${attempt}`, { headers: { cookie: player.cookie } })).status,
      404,
      `${attempt} must not be served.`
    );
  assert.equal((await fetch(`${base}/api/help/images/${name}`)).status, 401, "Images need a session too.");

  // --- Every link between the guides points at a page that exists ---

  const known = new Set(forPlayer.guides.flatMap((guide) => guide.pages.map((page) => `${guide.id}/${page.slug}`)));
  const directories = { player: "", gm: "gm/", admin: "admin/" };
  // The licensing notice is the one document the guides cite that is not a guide
  // of its own, so it is served as a document rather than navigated to.
  const outside = { NOTICE: "notice" };
  // The editor's guide is a whole guide, recognised by name wherever it is
  // linked from rather than resolved as a path out of the tree.
  const wholeGuides = { "devils-tables": "tables" };
  for (const guide of forPlayer.guides) {
    for (const page of guide.pages) {
      for (const [, href] of page.markdown.matchAll(/\[[^\]]*\]\(([^)\s]+\.md)(?:#[^)]*)?\)/g)) {
        // Resolve the link the way the reader's own address does.
        const parts = href.split("/").filter((part) => part && part !== ".");
        let target = guide.id;
        if (parts[0] === "..") {
          target = "player";
          parts.shift();
        }
        const named = Object.keys(directories).find((id) => id === parts[0] || directories[id] === `${parts[0]}/`);
        if (named) {
          target = named;
          parts.shift();
        }
        const slug = (parts.pop() ?? "README.md").replace(/\.md$/, "");
        if (wholeGuides[slug]) {
          assert.ok(known.has(`${wholeGuides[slug]}/overview`), `${href} names a guide that is not there.`);
          continue;
        }
        if (outside[slug]) {
          const served = await fetch(`${base}/api/project/${outside[slug]}`, { headers: { cookie: player.cookie } });
          assert.equal(served.status, 200, `${href} is cited by the guides, so it has to be served.`);
          continue;
        }
        const resolved = `${target}/${slug === "README" ? "overview" : slug}`;
        assert.ok(known.has(resolved), `${guide.id}/${page.slug} links to ${href}, which resolves to nothing.`);
      }
    }
  }

  // --- The address is the client's, so the server hands the page back ---

  // --- The editor's guide is one document, split at its own headings ---

  const tables = forPlayer.guides.find((guide) => guide.id === "tables");
  assert.ok(tables.pages.length > 4, "Its sections are its pages.");
  assert.equal(tables.pages[0].slug, "overview");
  assert.ok(
    tables.pages.some((page) => page.slug === "tags"),
    "A section becomes a page under a slug made from its heading."
  );
  // A heading inside a fenced example is example text, not a section of its own.
  assert.ok(
    tables.pages.every((page) => !page.title.startsWith("#")),
    "No page is titled from inside a code fence."
  );
  assert.ok(
    tables.pages.slice(1).every((page) => page.markdown.startsWith("## ")),
    "Each page is the section it was cut from, heading included."
  );
  // The file itself is still one document, which is what the editor serves.
  const whole = await fetch(`${base}/api/project/devils-tables`, { headers: { cookie: player.cookie } });
  assert.equal(whole.status, 200, "The single source is still served whole.");

  for (const path of ["/help", "/help/gm", "/help/gm/room-config", "/help/tables/tags"]) {
    const response = await fetch(`${base}${path}`, { headers: { cookie: player.cookie } });
    assert.equal(response.status, 200, `${path} is served by the client.`);
  }
});
