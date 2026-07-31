import type { GroupPageDefinition, SystemId } from "@devils-toys/shared";
import { rollDice } from "./dice.js";
import { compactTables, parseCompactRollTables } from "./roll-tables.js";
import { systems } from "./systems.js";

type CreationRoll = NonNullable<NonNullable<GroupPageDefinition["hirelings"]>["creationRoll"]>;

export function rollHirelingCreation(
  definition: CreationRoll,
  source: string | SystemId,
  random: () => number = Math.random
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
  generated.weapon = definition.weapon;

  const finishing = definition.finishingTouches;
  if (!finishing) return generated;

  const tables = new Map(
    (Object.hasOwn(systems, source)
      ? compactTables(source as SystemId, finishing.section)
      : parseCompactRollTables(source, finishing.section)
    ).map((table) => [table.name, table])
  );
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
