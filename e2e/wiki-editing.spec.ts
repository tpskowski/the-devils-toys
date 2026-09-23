import { expect, test, type Locator } from "@playwright/test";
import { prepareTable } from "./setup";

test("Wiki rich editing preserves spacing, hides its toolbar, and keeps Save still", async ({ page }) => {
  const system = await prepareTable(page.request);
  const roomName = `Wiki ${Date.now() % 100000}`;
  const created = await page.request.post("/api/rooms", { data: { name: roomName, system } });
  const roomId = (await created.json()).room.id;
  const saved = await page.request.post(`/api/rooms/${roomId}/wiki/pages`, {
    data: { title: "Spacing", markdown: "## Heading\n\nFirst line  \nSecond line\n\n<br />\n\nThird paragraph" }
  });
  expect(saved.status()).toBe(201);
  await page.goto("/");
  await page.getByRole("button", { name: `Open ${roomName}, Game master` }).click();
  await page.getByRole("button", { name: "Wiki", exact: true }).click();
  await page.getByRole("button", { name: "Spacing", exact: true }).click();
  const reader = page.locator(".wiki-markdown");
  await expect(reader).not.toContainText("<br");
  await expect(reader.locator("p")).toHaveCount(3);
  await expect(reader.locator("br")).toHaveCount(1);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.locator(".wiki-milkdown .ProseMirror");
  await expect(editor.locator("p")).toHaveCount(3);
  await page.getByRole("button", { name: "Hide toolbar", exact: true }).click();
  await expect(page.getByRole("group", { name: "Text formatting" })).toHaveCount(0);
  await expect(editor).toContainText("Third paragraph");
  await page.getByRole("button", { name: "Show toolbar", exact: true }).click();
  await editor.click();
  await editor.press("ControlOrMeta+End");
  await editor.press("ControlOrMeta+Shift+ArrowLeft");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(editor.locator("strong")).toHaveText("paragraph");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(editor.locator("strong")).toHaveCount(0);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(editor.locator("strong")).toHaveText("paragraph");
  await editor.press("ControlOrMeta+End");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await editor.press("Enter");
  await editor.press("Enter");
  await editor.pressSequentially("After blank");
  await editor.press("Shift+Enter");
  await editor.pressSequentially("After break");
  await expect(editor.locator("p")).toHaveCount(5);
  await page.getByRole("button", { name: "Use plain Markdown" }).click();
  await expect(page.getByLabel("Page Markdown")).not.toHaveValue(/<br\s*\/?\s*>/i);
  await expect(page.getByLabel("Page Markdown")).toHaveValue(/\n\n\n\nAfter blank/);
  await page.getByRole("button", { name: "Try rich editor" }).click();
  await expect(editor.locator("p")).toHaveCount(5);

  const metrics = (root: Locator) =>
    root.locator(":scope > p, :scope > h2").evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = getComputedStyle(node);
        return {
          text: node.textContent?.replace(/\n/g, ""),
          height: node.getBoundingClientRect().height,
          fontSize: style.fontSize,
          lineHeight: style.lineHeight,
          marginTop: style.marginTop,
          marginBottom: style.marginBottom
        };
      })
    );
  const editingMetrics = await metrics(editor);
  const save = page.getByRole("button", { name: "Save", exact: true });
  await save.scrollIntoViewIfNeeded();
  const beforeHover = await save.boundingBox();
  await save.hover();
  await expect(save).toHaveCSS("transform", "none");
  expect(await save.boundingBox()).toEqual(beforeHover);
  await save.click();
  await expect(reader.locator("p")).toHaveCount(5);
  await expect(reader).not.toContainText("<br");
  expect(await metrics(reader)).toEqual(editingMetrics);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(editor.locator("p")).toHaveCount(5);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Scene", exact: true }).click();
  await expect(page.getByRole("button", { name: "Hide toolbar", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
