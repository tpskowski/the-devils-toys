import type { ChatMessage, ItemClassification } from "@devils-toys/shared";
import { damageExpression } from "@devils-toys/shared";
import { api } from "./api";

/** A weapon as the room's log names it. */
export interface WeaponRollTarget {
  name: string;
  damage: string;
  traits?: readonly string[];
}

/**
 * The damage a click can actually roll. Notation the dice cannot state in one
 * roll — Monolith's one weapon whose two attack dice are different sizes — is
 * left to the dice builder rather than offered as a button that fails.
 */
export function rollableDamage(held: Pick<ItemClassification, "damage"> | undefined) {
  return held?.damage && damageExpression(held.damage) ? held.damage : undefined;
}

/**
 * How a weapon reads in the log: "Laser Rifle (D8) [thermal]". The die is the
 * part being rolled, so it sits with the name; what the book says the weapon
 * does is set apart in brackets, which the log shows with its own tooltip.
 */
export function weaponLabel(weapon: WeaponRollTarget) {
  const traits = weapon.traits?.length ? ` [${weapon.traits.join(", ")}]` : "";
  return `${weapon.name} (${weapon.damage})${traits}`;
}

/** The bracketed traits in a roll's line, for the log to mark as its own. */
export function rollBodyParts(body: string) {
  return body
    .split(/(\[[^\]]+\])/)
    .filter(Boolean)
    .map((part) => (part.startsWith("[") && part.endsWith("]") ? { traits: part.slice(1, -1) } : { text: part }));
}

/**
 * Rolls a weapon's damage into the room's log. The notation goes as written and
 * the room's system decides what it means, so nothing here has to know that an
 * attack's several dice count only their highest.
 */
export async function rollWeapon(roomId: number, holder: string, weapon: WeaponRollTarget) {
  const response = await api<{ message: ChatMessage }>(`/api/rooms/${roomId}/rolls`, {
    method: "POST",
    body: JSON.stringify({
      attack: { label: `${holder} · ${weaponLabel(weapon)}`.slice(0, 100), damage: weapon.damage }
    })
  });
  return response.message;
}
