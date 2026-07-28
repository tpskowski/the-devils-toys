import type { StarshipSheetDefinition, StarshipSizeDefinition } from "@devils-toys/shared";

function blank(value: unknown) {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function text(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase();
}

/** Finds the size a sheet records, matching either its id or its written label. */
export function starshipSizeFor(sheet: StarshipSheetDefinition | undefined, recorded: unknown) {
  const wanted = text(recorded);
  if (!wanted) return undefined;
  return sheet?.sizes?.find((size) => size.id === wanted || text(size.label) === wanted);
}

export function starshipHolds(sheet: StarshipSheetDefinition | undefined, recorded: unknown) {
  return starshipSizeFor(sheet, recorded)?.holds;
}

/**
 * Applies a chosen size to a ship. The stats a size decides — crew, movement and
 * mobility — are always rewritten, because they belong to the hull class. The
 * values every ship merely *starts* with are filled only where the sheet is
 * blank, so re-sizing a worked-up ship keeps scores raised by modules. Standard
 * parts go into free holds and are never duplicated.
 */
export function applyStarshipSize(
  ship: Readonly<Record<string, unknown>>,
  sheet: StarshipSheetDefinition | undefined,
  sizeId: string
): Record<string, unknown> {
  const size = sheet?.sizes?.find((entry) => entry.id === sizeId);
  if (!size) return { ...ship, size: "" };

  const next: Record<string, unknown> = { ...ship, size: size.label, ...size.fixed };
  for (const [key, value] of Object.entries(sheet?.baseValues ?? {})) if (blank(next[key])) next[key] = value;
  return next;
}

/** How the second hold of a bulky part is written, so the pair reads as one. */
export function continuationOf(label: string) {
  return `↳ ${label} (continued)`;
}

export function isContinuation(slot: unknown) {
  return text(slot).startsWith("↳");
}

export function holdSlots(ship: Readonly<Record<string, unknown>>, list: string, capacity: number) {
  const stored = Array.isArray(ship[list]) ? (ship[list] as unknown[]) : [];
  return Array.from({ length: Math.max(capacity, stored.length) }, (_unused, index) => String(stored[index] ?? ""));
}

export type HoldEdit = { ok: true; slots: string[] } | { ok: false; error: string };

/**
 * Writes a value into one hold. A bulky part needs the hold after it as well, so
 * it is refused when that hold is taken or does not exist — the ship's own layout
 * decides whether a part fits, not the person typing. Replacing a bulky part
 * frees the hold it was spilling into.
 */
export function setHoldValue(
  slots: readonly string[],
  index: number,
  value: string,
  options: { bulky?: boolean; capacity: number; slotName?: (index: number) => string } = { capacity: 0 }
): HoldEdit {
  const name = options.slotName ?? ((position: number) => `Hold ${position + 1}`);
  const next = Array.from({ length: Math.max(options.capacity, slots.length) }, (_unused, position) =>
    String(slots[position] ?? "")
  );
  if (index < 0 || index >= next.length) return { ok: false, error: "That hold is not on this ship." };

  // A bulky part being replaced releases its continuation.
  if (isContinuation(next[index + 1] ?? "")) next[index + 1] = "";

  const wanted = value.trim();
  if (!wanted) {
    next[index] = "";
    return { ok: true, slots: next };
  }
  if (!options.bulky) {
    next[index] = wanted;
    return { ok: true, slots: next };
  }
  if (index + 1 >= options.capacity)
    return { ok: false, error: `A bulky part needs two holds, and ${name(index)} is the last hold.` };
  if (next[index + 1].trim())
    return {
      ok: false,
      error: `A bulky part needs two holds, and ${name(index + 1)} holds ${next[index + 1].trim()}.`
    };
  next[index] = wanted;
  next[index + 1] = continuationOf(wanted);
  return { ok: true, slots: next };
}

export type { StarshipSizeDefinition };
