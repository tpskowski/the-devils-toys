import type { GroupPageDefinition } from "@devils-toys/shared";
import { rollDice } from "./dice.js";
import { parseCompactRollTables } from "./roll-tables.js";

type CreationRoll = NonNullable<NonNullable<GroupPageDefinition["hirelings"]>["creationRoll"]>;

export function rollHirelingCreation(
  definition: CreationRoll,
  markdown: string,
  random: () => number = Math.random,
  /** Where the starting weapon is stowed, so it can be drawn like any other. */
  weaponList?: string
) {
  const generated: Record<string, unknown> = {};

  for (const ability of definition.abilities) {
    const score = rollDice(ability.dice, random).total;
    generated[ability.currentKey] = score;
    generated[ability.maximumKey] = score;
  }

  const hp = rollDice(definition.hitProtection.dice, random).total;
  generated[definition.hitProtection.currentKey] = hp;
  generated[definition.hitProtection.maximumKey] = hp;
  // The weapon goes into the first slot rather than into a field of its own: a
  // hireling draws from what they are carrying, exactly as a character does.
  if (weaponList) generated[weaponList] = [definition.weapon];
  else generated.weapon = definition.weapon;

  const finishing = definition.finishingTouches;
  if (!finishing) return generated;

  const tables = new Map(parseCompactRollTables(markdown, finishing.section).map((table) => [table.name, table]));
  const rollTable = (name: string) => {
    const table = tables.get(name);
    if (!table) throw new Error(`The ${finishing.section} source has no rollable "${name}" table.`);
    const total = rollDice(table.dice, random).total;
    const value = table.entries.get(total);
    if (!value) throw new Error(`The "${name}" table has no result for ${total}.`);
    return value;
  };

  const firstNameTable =
    finishing.firstNames[Math.min(finishing.firstNames.length - 1, Math.floor(random() * finishing.firstNames.length))];
  if (!firstNameTable) throw new Error(`The ${finishing.section} source has no first-name tables configured.`);

  generated.name = `${rollTable(firstNameTable)} ${rollTable(finishing.lastName)}`;
  generated.details = finishing.details.map((name) => `${name}: ${rollTable(name)}`).join("\n");
  return generated;
}
