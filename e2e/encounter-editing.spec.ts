import { expect, test } from "@playwright/test";
import { prepareTable } from "./setup";

test("GM edits, creates, activates one encounter, and creates or removes roster NPCs", async ({ page }) => {
  const system = await prepareTable(page.request);
  const room = await page.request.post("/api/rooms", { data: { name: "Encounter Editing", system } });
  const roomId = (await room.json()).room.id;
  const first = await page.request.post(`/api/rooms/${roomId}/encounters`, { data: { name: "First fight" } });
  const firstId = (await first.json()).encounter.id;
  await page.request.patch(`/api/rooms/${roomId}/encounters/${firstId}`, { data: { display: "zones" } });
  await page.goto("/");
  await page.getByRole("button", { name: "Open Encounter Editing, Game master" }).click();
  await page.getByRole("button", { name: "Encounter", exact: true }).click();
  const panel = page.locator(".encounter-page");
  await expect(panel.locator(".encounter-header .eyebrow")).toHaveCount(0);
  await panel.getByRole("button", { name: "Edit encounter name", exact: true }).click();
  await panel.getByLabel("Encounter name", { exact: true }).fill("The terminal");
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "The terminal", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Add description", exact: true }).click();
  await panel.getByLabel("Encounter description").fill("Customs officers wait at the gate.");
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await expect(panel.locator(".encounter-notes")).toHaveText("Customs officers wait at the gate.");
  await panel.getByRole("button", { name: "Activate", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Deactivate", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Create NPC", exact: true }).click();
  await panel.getByLabel("NPC name", { exact: true }).fill("Customs officer");
  await panel.getByLabel("NPC notes", { exact: true }).fill("Checks cargo manifests.");
  await panel.getByRole("button", { name: "Create and add NPC", exact: true }).click();
  const remove = panel.getByRole("button", { name: "Remove Customs officer from encounter", exact: true });
  await expect(remove).toBeVisible();
  const npcs = (await (await page.request.get(`/api/rooms/${roomId}/npcs`)).json()).custom;
  const npc = npcs.find((entry: { name: string }) => entry.name === "Customs officer");
  expect(npc).toBeTruthy();
  await remove.click();
  await expect(remove).toHaveCount(0);
  expect(
    (await (await page.request.get(`/api/rooms/${roomId}/npcs`)).json()).custom.some(
      (entry: { id: number }) => entry.id === npc.id
    )
  ).toBe(true);
  // Invalid statblocks never leave a half-created NPC in the room.
  const invalid = await page.request.post(`/api/rooms/${roomId}/encounters/${firstId}/combatants`, {
    data: { kind: "npc", newNpc: { name: "Invalid NPC", statblock: { nonexistent: 3 } } }
  });
  expect(invalid.status()).toBe(400);
  expect((await (await page.request.get(`/api/rooms/${roomId}/npcs`)).json()).custom).toHaveLength(npcs.length);
  await panel.getByRole("button", { name: "New encounter", exact: true }).click();
  await panel.getByLabel("New encounter name", { exact: true }).fill("The next fight");
  await panel.getByRole("button", { name: "Create encounter", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "The next fight", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Activate", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Deactivate", exact: true })).toBeVisible();
  const encounters = (await (await page.request.get(`/api/rooms/${roomId}/encounters`)).json()).encounters;
  expect(
    encounters.filter((entry: { active: boolean }) => entry.active).map((entry: { name: string }) => entry.name)
  ).toEqual(["The next fight"]);
  expect(encounters.find((entry: { id: number }) => entry.id === firstId).notes).toBe(
    "Customs officers wait at the gate."
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".mobile-tabs").getByRole("button", { name: "Scene", exact: true }).click();
  await expect(panel.getByRole("button", { name: "New encounter", exact: true })).toBeVisible();
  await page.screenshot({ path: ".tmp-local-server/encounter-editing-mobile.png" });
});
