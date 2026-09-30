import { expect, test, type APIResponse, type Page, type Route } from "@playwright/test";
import type { GroupObligation } from "@devils-toys/shared";
import { prepareTable } from "./setup";

async function createRoom(page: Page, suffix: string) {
  const system = await prepareTable(page.request);
  const name = `Save races ${suffix} ${Date.now()}`;
  const response = await page.request.post("/api/rooms", { data: { name, system } });
  expect(response.status()).toBe(201);
  const room = (await response.json()).room as { id: number; name: string };
  return room;
}

async function openRoom(page: Page, name: string) {
  await page.goto("/");
  await page.getByRole("button", { name: `Open ${name}, Game master` }).click();
}

// Fetch the real response, but keep it off the page until the next user action.
// By default only the first match is held. holdAll also catches overlapping
// refreshes until release; later saves and refreshes then run normally.
async function holdResponse(
  page: Page,
  path: string,
  method = "GET",
  status?: number,
  accept?: (response: APIResponse) => Promise<boolean>,
  holdAll = false
) {
  let release!: () => void;
  let fetched!: () => void;
  let delivered!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    fetched = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    delivered = resolve;
  });
  let intercepted = false;
  let released = false;
  await page.route(`**${path}`, async (route: Route) => {
    if ((intercepted && (!holdAll || released)) || route.request().method() !== method) return route.continue();
    const response = await route.fetch();
    if ((intercepted && (!holdAll || released)) || (accept && !(await accept(response))))
      return route.fulfill({ response });
    intercepted = true;
    fetched();
    await held;
    if (status) {
      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({ error: "Delayed failure" })
      });
    } else await route.fulfill({ response });
    delivered();
  });
  return {
    pending,
    async release() {
      const response = page.waitForResponse(
        (response) => response.url().endsWith(path) && response.request().method() === method
      );
      released = true;
      release();
      await finished;
      await (await response).finished();
      // Let the fetch continuation and React's resulting paint complete before
      // asserting that something was NOT overwritten by this response.
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      );
    }
  };
}

for (const mode of ["plain", "rich"] as const) {
  test(`Wiki keeps ${mode} edits made during Save and saves them against the returned revision`, async ({ page }) => {
    const room = await createRoom(page, `Wiki ${mode}`);
    const base = `/api/rooms/${room.id}/wiki/pages`;
    const saved = await page.request.post(base, { data: { title: "Race page", markdown: "Original" } });
    const wikiPage = (await saved.json()).page;
    await openRoom(page, room.name);
    await page.getByRole("button", { name: "Wiki", exact: true }).click();
    await page.getByRole("button", { name: "Race page", exact: true }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    if (mode === "plain") await page.getByRole("button", { name: "Use plain Markdown" }).click();
    const editor = mode === "plain" ? page.getByLabel("Page Markdown") : page.locator(".wiki-milkdown .ProseMirror");
    await editor.fill("Submitted draft");
    const path = `${base}/${wikiPage.slug}`;
    const held = await holdResponse(page, path, "PUT");
    // In rich mode, Save must flush the live document before its debounce fires.
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await held.pending;
    await editor.fill("Newer draft typed during save");
    await page.getByLabel("Page title").fill("Newer title");
    await held.release();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
    await expect(editor).toBeVisible();
    if (mode === "plain") await expect(editor).toHaveValue("Newer draft typed during save");
    else await expect(editor).toHaveText("Newer draft typed during save");
    await expect(page.getByLabel("Page title")).toHaveValue("Newer title");
    expect((await (await page.request.get(path)).json()).page.markdown.trim()).toBe("Submitted draft");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator(".wiki-reader h2")).toHaveText("Newer title");
    await expect(page.locator(".wiki-markdown")).toHaveText("Newer draft typed during save");
    const persisted = (await (await page.request.get(path)).json()).page;
    expect(persisted.markdown.trim()).toBe("Newer draft typed during save");
    expect(persisted.revision).toBe(wikiPage.revision + 2);
  });
}

test("new Wiki pages keep in-flight edits without creating duplicate pages", async ({ page }) => {
  const room = await createRoom(page, "New Wiki page");
  const base = `/api/rooms/${room.id}/wiki/pages`;
  await openRoom(page, room.name);
  await page.getByRole("button", { name: "Wiki", exact: true }).click();
  await page
    .getByRole("complementary", { name: "Wiki pages" })
    .getByRole("button", { name: "New page", exact: true })
    .click();
  await page.getByLabel("Page title").fill("New page");
  await page.getByRole("button", { name: "Use plain Markdown" }).click();
  const editor = page.getByLabel("Page Markdown");
  await editor.fill("First version");
  const held = await holdResponse(page, base, "POST");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await held.pending;
  await editor.fill("Continued writing");
  await held.release();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await expect(editor).toHaveValue("Continued writing");
  const firstSave = await (await page.request.get(`/api/rooms/${room.id}/wiki`)).json();
  expect(firstSave.pages).toHaveLength(1);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".wiki-markdown")).toHaveText("Continued writing");
  const wiki = await (await page.request.get(`/api/rooms/${room.id}/wiki`)).json();
  expect(wiki.pages).toHaveLength(1);
  const persisted = (await (await page.request.get(`${base}/${wiki.pages[0].slug}`)).json()).page;
  expect(persisted.markdown).toBe("Continued writing");
  expect(persisted.revision).toBe(firstSave.pages[0].revision + 1);
});

test("Wiki conflicts retain text typed while the rejected save was pending", async ({ page }) => {
  const room = await createRoom(page, "Wiki conflict");
  const base = `/api/rooms/${room.id}/wiki/pages`;
  const original = (
    await (await page.request.post(base, { data: { title: "Conflict page", markdown: "Original" } })).json()
  ).page;
  const path = `${base}/${original.slug}`;
  await openRoom(page, room.name);
  await page.getByRole("button", { name: "Wiki", exact: true }).click();
  await page.getByRole("button", { name: "Conflict page", exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Use plain Markdown" }).click();
  await page.getByLabel("Page Markdown").fill("Submitted version");
  const changed = await page.request.put(path, {
    data: { title: original.title, markdown: "Other author's edit", folderId: null, revision: original.revision }
  });
  expect(changed.ok()).toBe(true);
  const held = await holdResponse(page, path, "PUT");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await held.pending;
  await page.getByLabel("Page Markdown").fill("My newest version");
  await held.release();
  await expect(page.getByLabel("Current page Markdown")).toHaveValue("Other author's edit");
  await expect(page.getByLabel("Your draft Markdown")).toHaveValue("My newest version");
  await page.getByRole("button", { name: "Keep my draft", exact: true }).click();
  await expect(page.locator(".wiki-milkdown .ProseMirror")).toHaveText("My newest version");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".wiki-markdown")).toHaveText("My newest version");
});

test("a failed group row stays unsaved through other saves and refreshes, then can be retried", async ({ page }) => {
  const room = await createRoom(page, "Group");
  const base = `/api/rooms/${room.id}/group/obligations`;
  const first = (await (await page.request.post(base, { data: { name: "First debt" } })).json()).obligation;
  const second = (await (await page.request.post(base, { data: { name: "Second debt" } })).json()).obligation;
  await openRoom(page, room.name);
  await page.getByRole("button", { name: "Group", exact: true }).click();
  await expect(page.locator(".group-save-status")).toHaveText("Read only");
  await page.getByRole("button", { name: "Group", exact: true }).click();
  await page.getByRole("option", { name: "Debts", exact: true }).click();
  let fail = true;
  await page.route(`**${base}/${first.id}`, async (route) => {
    if (fail && route.request().method() === "PATCH") {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Injected save failure" })
      });
    }
    return route.continue();
  });
  const firstInput = page.locator(".group-obligation-name").nth(0);
  await firstInput.fill("First unsaved edit");
  await expect(page.getByText("Injected save failure", { exact: true })).toBeVisible();
  const secondSave = page.waitForResponse(
    (response) => response.url().endsWith(`${base}/${second.id}`) && response.request().method() === "PATCH"
  );
  await page.locator(".group-obligation-name").nth(1).fill("Saved second edit");
  expect((await secondSave).ok()).toBe(true);
  await expect(page.locator(".group-save-status")).toHaveText("Unsaved");
  const rows = async () =>
    (await (await page.request.get(`/api/rooms/${room.id}/group`)).json()).obligations as GroupObligation[];
  expect((await rows()).find((row) => row.id === first.id)?.name).toBe("First debt");
  expect((await rows()).find((row) => row.id === second.id)?.name).toBe("Saved second edit");
  // The real broadcast must not replace the first row's unsaved text.
  await page.request.post(base, { data: { name: "Broadcast trigger" } });
  await expect(firstInput).toHaveValue("First unsaved edit");
  fail = false;
  await firstInput.fill("Retried first edit");
  await expect(page.locator(".group-save-status")).toHaveText("Saved");
  expect((await rows()).find((row) => row.id === first.id)?.name).toBe("Retried first edit");
  // Successful retry releases the dirty guard so future refreshes are accepted.
  await page.request.post(base, { data: { name: "After retry" } });
  await expect(page.locator(".group-obligation-name")).toHaveCount(4);
  // Deliberately deleting a failed row must also release its dirty state.
  fail = true;
  await firstInput.fill("Discard by deleting");
  await expect(page.getByText("Injected save failure", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove obligation 1", exact: true }).click();
  await expect(page.locator(".group-save-status")).toHaveText("Saved");
  await expect(page.locator(".group-obligation-name")).toHaveCount(3);
});

test("a completed Wiki save cannot replace a different page's draft", async ({ page }) => {
  const room = await createRoom(page, "Wiki navigation");
  const base = `/api/rooms/${room.id}/wiki/pages`;
  const first = (
    await (await page.request.post(base, { data: { title: "First page", markdown: "First text" } })).json()
  ).page;
  await page.request.post(base, { data: { title: "Second page", markdown: "Second text" } });
  await openRoom(page, room.name);
  await page.getByRole("button", { name: "Wiki", exact: true }).click();
  await page.getByRole("button", { name: "First page", exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Use plain Markdown" }).click();
  await page.getByLabel("Page Markdown").fill("Saved first edit");
  const held = await holdResponse(page, `${base}/${first.slug}`, "PUT");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await held.pending;
  await page.getByRole("button", { name: "Second page", exact: true }).click();
  await page.getByRole("button", { name: "Discard draft", exact: true }).click();
  await expect(page.locator(".wiki-reader h2")).toHaveText("Second page");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Use plain Markdown" }).click();
  await page.getByLabel("Page Markdown").fill("Second page draft");
  await held.release();
  await expect(page.getByLabel("Page title")).toHaveValue("Second page");
  await expect(page.getByLabel("Page Markdown")).toHaveValue("Second page draft");
});

for (const responseStatus of [undefined, 500]) {
  test(`Room Config ignores a previous room's delayed ${responseStatus ? "failure" : "response"}`, async ({ page }) => {
    const first = await createRoom(page, "Config A");
    const second = await createRoom(page, "Config B");
    await page.goto(`/config?room=${first.id}`);
    await expect(page.locator(".room-config-switcher")).toContainText(first.name);
    const held = await holdResponse(page, `/api/room-config/${first.id}`, "GET", responseStatus);
    await page.request.post(`/api/rooms/${first.id}/wiki/pages`, {
      data: { title: "Refresh trigger", markdown: "Text" }
    });
    await held.pending;
    await page.locator(".room-config-switcher").click();
    await page.locator(".room-config-room-list button").filter({ hasText: second.name }).click();
    await expect(page.locator(".room-config-switcher")).toContainText(second.name);
    await held.release();
    await expect(page.locator(".room-config-switcher")).toContainText(second.name);
    await expect(page.locator(".room-config-error")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`room=${second.id}$`));
  });
}

for (const saveFirst of [false, true]) {
  test(`a delayed character refresh preserves edits ${saveFirst ? "after" : "before"} autosave completes`, async ({
    page
  }) => {
    const room = await createRoom(page, "Character");
    const base = `/api/rooms/${room.id}/characters`;
    const character = (
      await (await page.request.post(base, { data: { name: `Original character ${room.id}`, sheet: {} } })).json()
    ).character;
    await openRoom(page, room.name);
    await page.getByTitle("Manage characters").click();
    await page.locator(".character-index button").filter({ hasText: character.name }).click();
    const name = page.getByRole("textbox", { name: "Character name", exact: true });
    await expect(name).toHaveValue(character.name);
    // updated_at is second-resolution, so make the remote update observable.
    const initialSecond = Math.floor(Date.now() / 1000);
    await expect.poll(() => Math.floor(Date.now() / 1000), { intervals: [100] }).toBeGreaterThan(initialSecond);
    const held = await holdResponse(
      page,
      base,
      "GET",
      undefined,
      async (response) =>
        (await response.json()).characters.some(
          (row: { id: number; name: string }) => row.id === character.id && row.name === "Remote edit"
        ),
      true
    );
    await page.request.patch(`${base}/${character.id}`, { data: { name: "Remote edit", sheet: {} } });
    await held.pending;
    await name.fill("Local edit typed during refresh");
    if (saveFirst) {
      await expect(page.locator(".character-index button.selected")).toContainText("Local edit typed during refresh");
      await expect
        .poll(
          async () =>
            (await (await page.request.get(base)).json()).characters.find(
              (row: { id: number }) => row.id === character.id
            ).name
        )
        .toBe("Local edit typed during refresh");
    }
    await held.release();
    await expect(name).toHaveValue("Local edit typed during refresh");
    await expect
      .poll(async () => {
        const response = await page.request.get(base);
        return (await response.json()).characters.find((row: { id: number }) => row.id === character.id).name;
      })
      .toBe("Local edit typed during refresh");
  });
}

test("a socket refresh does not cancel selection of a newly created character", async ({ page }) => {
  const room = await createRoom(page, "Character selection");
  const base = `/api/rooms/${room.id}/characters`;
  const original = (await (await page.request.post(base, { data: { name: `Existing ${room.id}`, sheet: {} } })).json())
    .character;
  await openRoom(page, room.name);
  await page.getByTitle("Manage characters").click();
  await page.locator(".character-index button").filter({ hasText: original.name }).click();
  await expect(page.getByLabel("Character name", { exact: true })).toHaveValue(original.name);
  const held = await holdResponse(page, base, "GET", undefined, async (response) =>
    (await response.json()).characters.some((row: { name: string }) => row.name === "New character")
  );
  await page.getByRole("button", { name: "New character", exact: true }).click();
  await held.pending;
  // The mutation broadcasts another refresh while the explicit load is held.
  await page.request.patch(`${base}/${original.id}`, { data: { name: `Renamed ${room.id}`, sheet: {} } });
  await held.release();
  await expect(page.getByLabel("Character name", { exact: true })).toHaveValue("New character");
  await expect(page.getByLabel("Character name", { exact: true })).toBeFocused();
});
