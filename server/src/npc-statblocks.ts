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

/** The scores an inline statblock names when a system has not said otherwise. */
const INLINE_SCORES = ["hp", "armor", "str", "dex", "wil"] as const;

/**
 * A statblock written as one line of prose: `4 HP, 8 STR, 14 DEX, 8 WIL, spear (d6)`.
 *
 * `scores` are the words that count as scores rather than as part of the attack
 * text. They used to be the five above, written into the pattern — which meant
 * this only ever worked for a system whose abilities were STR, DEX, and WIL, and
 * quietly swept every other system's abilities into `attacks` instead. A system
 * declares its own statblock fields, so those are what is read; the default is
 * kept so a caller with no system to hand behaves as it always did.
 */
export function parseCairnNpcStatblock(
  markdown: string,
  scores: readonly string[] = INLINE_SCORES
): ParsedNpcStatblock {
  const fields: Record<string, NpcStatblockValue> = { armor: 0 };
  const line = firstStatLine(markdown)?.replace(/^\*|\*$/g, "");
  if (!line) return { fields, unparsed: markdown };

  const wanted = new Map(scores.map((score) => [score.toLocaleLowerCase(), score]));
  const attacks: string[] = [];
  for (const part of line.split(",")) {
    const match = /^(\d+)\s+([A-Za-z][A-Za-z0-9-]*)\s*$/.exec(part.trim());
    const key = match && wanted.get(match[2].toLocaleLowerCase());
    if (!key) {
      if (part.trim()) attacks.push(part.trim());
      continue;
    }
    fields[key] = Number(match![1]);
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
  const statblock = systemOrThrow(system).npcStatblock;
  // The system's own field keys are what its bestiary writes, so they are what
  // an inline line is read against. Without this, a system whose abilities are
  // not STR/DEX/WIL loses every one of them into the attack text.
  return parseStatblockWith(
    statblock.parser ?? "inline",
    markdown,
    statblock.fields.map((field) => field.key)
  );
}

export function parseStatblockWith(
  parser: NpcStatblockParser,
  markdown: string,
  scores?: readonly string[]
): ParsedNpcStatblock {
  switch (parser) {
    case "inline":
      return parseCairnNpcStatblock(markdown, scores);
    case "labelled":
      return parseCwnNpcStatblock(markdown);
    default: {
      const exhaustive: never = parser;
      return exhaustive;
    }
  }
}
