import type { CharacterFieldDefinition } from "@devils-toys/shared";

export interface SaveRollSetup {
  label: string;
  target: number;
}

export function saveSetupForField(field: CharacterFieldDefinition, value: unknown): SaveRollSetup | undefined {
  if (!field.roll || field.roll.kind !== "save") return undefined;
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return undefined;
  const target = Number(value);
  if (!Number.isInteger(target) || target < 1 || target > 20) return undefined;
  return { label: field.roll.label, target };
}
