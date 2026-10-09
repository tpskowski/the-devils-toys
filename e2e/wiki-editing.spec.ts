import { expect, test, type Locator } from "@playwright/test";
import { prepareTable } from "./setup";

test("Wiki table breaks survive rich editing, mode switches, and saving", async ({ page }) => {
  const system = await prepareTable(page.request);
  const roomName = `Wiki tables ${Date.now() % 100000}`;
  const created = await page.request.post("/api/rooms", { data: { name: roomName, system } });
  const roomId = (await created.json()).room.id;
  const saved = await page.request.post(`/api/rooms/${roomId}/wiki/pages`, {
    data: { title: "Table notes", markdown: "| Note | Owner |\n| --- | --- |\n| First</br>Second | Alice |" }
  });
  expect(saved.status()).toBe(201);
  await page.goto("/");
  await page.getByRole("button", { name: `Open ${roomName}, Game master` }).click();
  await page.getByRole("button", { name: "Wiki", exact: true }).click();
  await page.getByRole("button", { name: "Table notes", exact: true }).click();
  const reader = page.locator(".wiki-markdown");
  await expect(reader.locator("tr")).toHaveCount(2);
  await expect(reader.locator("td")).toHaveText([/^First\s*Second$/, "Alice"]);
  await expect(reader.locator("td br")).toHaveCount(1);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.locator(".wiki-milkdown .ProseMirror");
  await expect(editor.locator("tr")).toHaveCount(2);
  await expect(editor.locator("td")).toHaveText([/^First\s*Second$/, "Alice"]);
  await page.getByRole("button", { name: "Use plain Markdown" }).click();
  const source = page.getByLabel("Page Markdown");
  expect((await source.inputValue()).trim().split("\n")).toHaveLength(3);
  await expect(source).toHaveValue(/First<br \/>Second/);
  await page.getByRole("button", { name: "Try rich editor" }).click();
  await expect(editor.locator("tr")).toHaveCount(2);
  const note = editor.locator("td p").first();
  await note.click();
  // Verify the real click selected this cell before normalizing the offset.
  // Otherwise the range below could conceal a click that landed in the header.
  await expect
    .poll(() =>
      note.evaluate((paragraph) => {
        const selection = window.getSelection();
        return (
          !!selection?.anchorNode &&
          !!selection.focusNode &&
          paragraph.contains(selection.anchorNode) &&
          paragraph.contains(selection.focusNode)
        );
      })
    )
    .toBe(true);
  // A paragraph-centre click can land on either line, and focusing the whole
  // contenteditable again can move its caret. Pin the insertion point to this
  // cell, then type through the keyboard without refocusing the editor root.
  await note.evaluate((paragraph) => {
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await expect(editor).toBeFocused();
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("Third");
  await expect(note).toHaveText(/^First\s*Second\s*Third$/);
  await expect(note.locator("br")).toHaveCount(2);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(reader.locator("tr")).toHaveCount(2);
  await expect(reader.locator("td")).toHaveText([/^First\s*Second\s*Third$/, "Alice"]);
  await expect(reader.locator("td br")).toHaveCount(2);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(editor.locator("tr")).toHaveCount(2);
  await expect(editor.locator("td")).toHaveText([/^First\s*Second\s*Third$/, "Alice"]);
});

test("Wiki rich editing preserves spacing, hides its toolbar, and keeps Save still", async ({ page }) => {
  const system = await prepareTable(page.request);
  const roomName = `Wiki ${Date.now() % 100000}`;
  const created = await page.request.post("/api/rooms", { data: { name: roomName, system } });
  const roomId = (await created.json()).room.id;
  const saved = await page.request.post(`/api/rooms/${roomId}/wiki/pages`, {
    data: { title: "Spacing", markdown: "## Heading\n\nFirst line</br>Second line\n\n</br>\n\nThird paragraph" }
  });
  expect(saved.status()).toBe(201);
  await page.goto("/");
  await page.getByRole("button", { name: `Open ${roomName}, Game master` }).click();
  await page.getByRole("button", { name: "Wiki", exact: true }).click();
  await page.getByRole("button", { name: "Spacing", exact: true }).click();
  const reader = page.locator(".wiki-markdown");
  await expect(reader).not.toContainText(/<\/?br/i);
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
  await expect(page.getByLabel("Page Markdown")).not.toHaveValue(/<\/?br\s*\/?\s*>/i);
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
  const labelColor = await save.evaluate((button) => getComputedStyle(button).color);
  await save.hover();
  await expect(save).toHaveCSS("color", labelColor);
  await expect(save.locator("svg")).toHaveCSS("color", labelColor);
  expect(await save.evaluate((button) => getComputedStyle(button).backgroundColor)).not.toBe(labelColor);
  await expect(save).toHaveCSS("transform", "none");
  expect(await save.boundingBox()).toEqual(beforeHover);
  await save.click();
  await expect(reader.locator("p")).toHaveCount(5);
  await expect(reader).not.toContainText(/<\/?br/i);
  expect(await metrics(reader)).toEqual(editingMetrics);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(editor.locator("p")).toHaveCount(5);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Scene", exact: true }).click();
  await expect(page.getByRole("button", { name: "Hide toolbar", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
