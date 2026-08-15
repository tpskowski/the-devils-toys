import type { NpcStatblockParser, SystemId } from "@devils-toys/shared";
import { systemOrThrow } from "./systems.js";

export type NpcStatblockValue = string | number;

export interface ParsedNpcStatblock {
  fields: Record<string, NpcStatblockValue>;
  unparsed: string;
}

function firstStatLine(markdown: string) {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#") && !line.startsWith("-"));
}

export function parseCairnNpcStatblock(markdown: string): ParsedNpcStatblock {
  const fields: Record<string, NpcStatblockValue> = { armor: 0 };
  const line = firstStatLine(markdown)?.replace(/^\*|\*$/g, "");
  if (!line) return { fields, unparsed: markdown };

  const attacks: string[] = [];
  for (const part of line.split(",")) {
    const match = /^(\d+)\s+(HP|ARMOR|STR|DEX|WIL)\s*$/i.exec(part.trim());
    if (!match) {
      if (part.trim()) attacks.push(part.trim());
      continue;
    }
    const key = match[2].toLocaleLowerCase() === "armor" ? "armor" : match[2].toLocaleLowerCase();
    fields[key] = Number(match[1]);
  }
  if (attacks.length) fields.attacks = attacks.join(", ");
  return { fields, unparsed: markdown };
}

const cwnLabels = new Map([
  ["hd", "hd"],
  ["ac", "ac"],
  ["tt", "tt"],
  ["skill", "skill"],
  ["save", "save"],
  ["atk", "atk"],
  ["dmg", "dmg"],
  ["shock", "shock"],
  ["move", "move"],
  ["ml", "ml"]
]);

function cwnPairs(line: string) {
  const cells = line
    .replace(/\u00a0/g, " ")
    .trim()
    .split(/\s{2,}/)
    .filter(Boolean);
  const pairs: [string, string][] = [];
  for (let index = 0; index + 1 < cells.length; index += 2) {
    const label = cells[index].replace(/:$/, "").trim().toLocaleLowerCase();
    const key = cwnLabels.get(label);
    if (key) pairs.push([key, cells[index + 1].trim()]);
  }
  return pairs;
}

export function parseCwnNpcStatblock(markdown: string): ParsedNpcStatblock {
  const fields: Record<string, NpcStatblockValue> = { damageSoak: 0 };
  const tail: string[] = [];
  let inTail = false;
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("-")) continue;
    const pairs = cwnPairs(rawLine);
    if (!inTail && pairs.length) {
      for (const [key, value] of pairs) {
        if (key === "hd") {
          const match = /^(\d+)\s*\((\d+)\s+HP(?:\+(\d+))?\)/i.exec(value);
          if (match) {
            fields.hd = Number(match[1]);
            fields.hp = Number(match[2]);
            fields.damageSoak = Number(match[3] ?? 0);
          } else {
            fields.hd = value;
          }
        } else if (key === "ac") {
          const [ranged, melee] = value.split("/");
          fields.acRanged = ranged?.trim() ?? value;
          fields.acMelee = melee?.trim() ?? value;
        } else {
          fields[key] = value;
        }
      }
      continue;
    }
    inTail = true;
    tail.push(line);
  }
  if (tail.length) fields.gear = tail.join("\n");
  return { fields, unparsed: markdown };
}

/**
 * Reads a creature's numbers the way its system's bestiary writes them. Which
 * reader that is comes from the system's own `npcStatblock.parser`, so an
 * installed system picks one by naming it rather than by being recognised here.
 */
export function parseNpcStatblock(system: SystemId, markdown: string): ParsedNpcStatblock {
  return parseStatblockWith(systemOrThrow(system).npcStatblock.parser ?? "inline", markdown);
}

export function parseStatblockWith(parser: NpcStatblockParser, markdown: string): ParsedNpcStatblock {
  switch (parser) {
    case "inline":
      return parseCairnNpcStatblock(markdown);
    case "labelled":
      return parseCwnNpcStatblock(markdown);
    default: {
      const exhaustive: never = parser;
      return exhaustive;
    }
  }
}
