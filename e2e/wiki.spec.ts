import { expect, test, type Browser, type Page } from "@playwright/test";
import { FIXTURE_SYSTEM, bundleSystemRepo } from "../scripts/harness.mjs";

test.setTimeout(120_000);

async function joinPlayer(
  browser: Browser,
  token: string,
  password: string,
  viewport?: { width: number; height: number }
) {
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:4321", ...(viewport ? { viewport } : {}) });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  await page.goto(`/invite/${token}`);
  await page.getByLabel("Choose a password").fill(password);
  await page.getByRole("button", { name: "Join the table" }).click();
  return { context, page };
}

async function openWiki(page: Page, roomName: string, role: "Game master" | "Player") {
  await page.getByRole("button", { name: `Open ${roomName}, ${role}` }).click();
  await expect(page.getByRole("heading", { name: roomName })).toBeVisible();
  const desktopLibrary = page.getByLabel(role === "Game master" ? "Manage Library" : "Open References and Wiki");
  if (await desktopLibrary.isVisible()) await desktopLibrary.click();
  else await page.getByRole("button", { name: "Refs", exact: true }).click();
  await page.getByRole("tab", { name: "Wiki" }).click();
  await expect(page.getByRole("complementary", { name: "Wiki pages" })).toBeVisible();
}

test("a player shares a private wiki page only when the GM reveals it", async ({ browser, page }) => {
  page.setDefaultTimeout(10_000);
  const setup = await page.request.post("/api/setup", {
    data: { username: "WikiGM", password: "wiki-gm-password" }
  });
  expect(setup.status()).toBe(201);

  const { id: system, zip } = await bundleSystemRepo(FIXTURE_SYSTEM);
  const installed = await page.request.post("/api/admin/systems", {
    multipart: { bundle: { name: `${system}.devilsystem.zip`, mimeType: "application/zip", buffer: zip } }
  });
  expect(installed.status()).toBe(201);

  const created = await page.request.post("/api/rooms", { data: { name: "Wiki Campaign", system } });
  expect(created.status()).toBe(201);
  const roomId = (await created.json()).room.id as number;

  async function invitation(username: string) {
    const response = await page.request.post(`/api/rooms/${roomId}/invitations`, { data: { username } });
    expect(response.status()).toBe(201);
    return (await response.json()).invitation.token as string;
  }

  const alice = await joinPlayer(browser, await invitation("WikiAlice"), "wiki-alice-password");
  const bob = await joinPlayer(browser, await invitation("WikiBob"), "wiki-bob-password", { width: 390, height: 844 });

  try {
    await openWiki(alice.page, "Wiki Campaign", "Player");
    await alice.page.getByTitle("New folder").click();
    await alice.page.locator(".wiki-folder-create input").fill("Alice's leads");
    await alice.page.getByRole("button", { name: "Create", exact: true }).click();
    await alice.page.getByRole("button", { name: "Alice's leads", exact: true }).click();
    await alice.page.getByLabel("Page title").fill("The hidden route");

    // This is the rich editor, not the fallback textarea: creating a page is
    // what should fetch the lazy Milkdown chunk for an author.
    const editor = alice.page.locator(".wiki-milkdown .ProseMirror");
    await expect(editor).toBeVisible();
    await editor.click();
    await editor.pressSequentially("Only Alice and the GM know this passage.", { delay: 5 });
    // Switching modes is not a navigation action. It still has to preserve
    // the live Milkdown document before its Markdown listener's debounce.
    await alice.page.getByRole("button", { name: "Use plain Markdown" }).click();
    await expect(alice.page.getByLabel("Page Markdown")).toHaveValue(/Only Alice and the GM know this passage\./);
    // The References shell delegates its close control back to the embedded
    // Wiki, so a live draft cannot be lost through the parent modal.
    await alice.page.getByLabel("Close").click();
    await expect(alice.page.getByRole("alertdialog", { name: "Discard unsaved changes?" })).toBeVisible();
    await alice.page.getByRole("button", { name: "Keep editing" }).click();
    await alice.page.getByRole("tab", { name: "References" }).click();
    await expect(alice.page.getByRole("alertdialog", { name: "Discard unsaved changes?" })).toBeVisible();
    await alice.page.getByRole("button", { name: "Keep editing" }).click();
    await alice.page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(alice.page.getByRole("heading", { name: "The hidden route" })).toBeVisible();
    await expect(alice.page.getByText("Private notebook", { exact: true })).toBeVisible();

    const editorRequests: string[] = [];
    bob.page.on("request", (request) => {
      if (/\/assets\/WikiEditor-[^/]+\.js(?:\?|$)/.test(request.url())) editorRequests.push(request.url());
    });
    await openWiki(bob.page, "Wiki Campaign", "Player");
    await expect(bob.page.getByText("Alice's leads", { exact: true })).toHaveCount(0);
    await expect(bob.page.getByText("The hidden route", { exact: true })).toHaveCount(0);
    expect(editorRequests).toEqual([]);

    await page.goto("/");
    await openWiki(page, "Wiki Campaign", "Game master");
    await page.getByRole("button", { name: "The hidden route", exact: true }).click();
    await expect(page.getByRole("heading", { name: "The hidden route" })).toBeVisible();
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await expect(page.getByText("Shared with the room", { exact: true })).toBeVisible();

    // The player remains in its small viewport: the reader must expose the
    // shared page without making an editor request or presenting edit actions.
    const sharedPage = bob.page.getByRole("button", { name: /^The hidden route/ });
    await expect(sharedPage).toBeVisible();
    await sharedPage.click();
    await expect(bob.page.getByRole("heading", { name: "The hidden route" })).toBeVisible();
    await expect(bob.page.getByText("Only Alice and the GM know this passage.", { exact: true })).toBeVisible();
    await expect(bob.page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
    expect(editorRequests).toEqual([]);
  } finally {
    await alice.context.close();
    await bob.context.close();
  }
});
