import express from "express";
import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  DEFAULT_DICE_PREFERENCES,
  diceAppearance,
  THEME_IDS,
  type DicePreferences,
  type DicePresentation,
  type ThemeId
} from "@devils-toys/shared";
import { requireAuth, roomRole, type AuthedRequest } from "./auth.js";
import { db, one } from "./db.js";
import { broadcastRoom, sendToRoomGms, sendToRoomAccount } from "./realtime.js";
import { systemOrThrow } from "./systems.js";
import type { DiceResult } from "./dice.js";
import { withPhysicalDice } from "./dice-physics.js";

export async function withRoomDice<T>(roomId: number, accountId: number, action: () => T): Promise<T> {
  const role = roomRole(accountId, roomId);
  if (!role) throw new Error("Room access is no longer available.");
  const enabled = one<{ enabled: number }>(
    "SELECT dice_3d_enabled AS enabled FROM rooms WHERE id = ?",
    roomId
  )?.enabled;
  const evaluate = () => {
    if (roomRole(accountId, roomId) !== role) throw new Error("Room access changed while the dice were rolling.");
    return action();
  };
  const result = enabled ? await withPhysicalDice(evaluate) : evaluate();
  if (roomRole(accountId, roomId) !== role) throw new Error("Room access changed while the dice were rolling.");
  return result;
}

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const dicePreferencesSchema = z
  .object({
    enabled: z.boolean(),
    theme: z.enum([...THEME_IDS, "room", "custom"]),
    custom: z.object({ body: color, ink: color, accent: color, finish: z.enum(["matte", "satin", "gloss"]) }).strict()
  })
  .strict();
export function readDicePreferences(accountId: number): DicePreferences {
  const row = one<{ settings_json: string }>(
    "SELECT settings_json FROM dice_preferences WHERE account_id = ?",
    accountId
  );
  if (!row) return DEFAULT_DICE_PREFERENCES;
  try {
    return dicePreferencesSchema.parse(JSON.parse(row.settings_json));
  } catch {
    return DEFAULT_DICE_PREFERENCES;
  }
}
export const dice3dRouter = express.Router();
dice3dRouter.get("/me/dice", requireAuth, (req: AuthedRequest, res) =>
  res.json({ preferences: readDicePreferences(req.account!.id) })
);
dice3dRouter.put("/me/dice", requireAuth, (req: AuthedRequest, res) => {
  const parsed = dicePreferencesSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose valid dice colors and a finish." });
  db.prepare(
    "INSERT INTO dice_preferences (account_id, settings_json) VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET settings_json = excluded.settings_json"
  ).run(req.account!.id, JSON.stringify(parsed.data));
  res.json({ preferences: parsed.data });
});
dice3dRouter.get("/rooms/:roomId/dice", requireAuth, (req: AuthedRequest, res) => {
  const roomId = Number(req.params.roomId);
  if (!roomRole(req.account!.id, roomId)) return res.status(404).json({ error: "Room not found." });
  const room = one<{ system: string }>("SELECT system FROM rooms WHERE id = ?", roomId)!;
  res.json({ dice: systemOrThrow(room.system).dice3d?.dice ?? [] });
});

export type DiceAudience = "room" | "roller" | "roller-and-gms";
/** This must be called at the route's visibility boundary, never by the RNG. */
export function presentDice(
  roomId: number,
  accountId: number,
  roll: Pick<DiceResult, "dice" | "total" | "modifier" | "expression" | "physics">,
  audience: DiceAudience,
  label = roll.expression
): DicePresentation[] {
  const room = one<{ dice_3d_enabled: number; theme: ThemeId }>(
    "SELECT dice_3d_enabled, theme FROM rooms WHERE id = ?",
    roomId
  );
  if (!room?.dice_3d_enabled || !roll.dice.length) return [];
  const animation: DicePresentation = {
    version: 1,
    id: randomUUID(),
    roomId,
    accountId,
    createdAt: Date.now(),
    seed: randomInt(2 ** 32),
    label,
    total: roll.total,
    modifier: roll.modifier,
    appearance: diceAppearance(readDicePreferences(accountId), room.theme),
    dice: roll.dice,
    ...(roll.physics ? { physics: roll.physics } : {})
  };
  const event = { type: "dice-roll", animation };
  if (audience === "room") broadcastRoom(roomId, event);
  else {
    sendToRoomAccount(roomId, accountId, event);
    if (audience === "roller-and-gms") sendToRoomGms(roomId, event);
  }
  return [animation];
}
