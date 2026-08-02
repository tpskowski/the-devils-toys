import type { ChatMessage, CharacterFieldDefinition } from "@devils-toys/shared";
import { api } from "./api";

export interface SaveRollSetup {
  label: string;
  target: number;
}

/**
 * Rolls a save without the builder, for the places that already know both the
 * score and what is being saved against. Standard visibility and no position:
 * a roll made from a dialog carries no choices the builder would have offered.
 *
 * The outcome comes back with the message, since what a failure means is the
 * caller's to act on — Monolith marks a failed STR save as critical damage.
 */
export async function rollSave(roomId: number, setup: SaveRollSetup) {
  return api<{ message: ChatMessage; roll: { total: number; outcome?: { passed: boolean } } }>(
    `/api/rooms/${roomId}/rolls`,
    { method: "POST", body: JSON.stringify({ expression: "1d20", save: { ...setup, position: "normal" } }) }
  );
}

/** A save rolled against a bare score, as the attribute dialog rolls one. */
export function saveSetupForScore(label: string, value: unknown): SaveRollSetup | undefined {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return undefined;
  const target = Number(value);
  if (!Number.isInteger(target) || target < 1 || target > 20) return undefined;
  return { label, target };
}

export function saveSetupForField(field: CharacterFieldDefinition, value: unknown): SaveRollSetup | undefined {
  if (!field.roll || field.roll.kind !== "save") return undefined;
  return saveSetupForScore(field.roll.label, value);
}
