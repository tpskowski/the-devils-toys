export interface PairedStatKeys {
  currentKey: string;
  maximumKey: string;
}

/** Blank, absent, and unparseable sheet values all count as "no number recorded". */
export function hasNumericValue(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  if (typeof value === "boolean") return false;
  return Number.isFinite(Number(value));
}

/**
 * A character whose maximums were just set usually starts at full. Fills in only the
 * currents still left blank, so a deliberately low or zero current is never overwritten.
 */
export function currentsToBackfill(sheet: Record<string, unknown>, rows: readonly PairedStatKeys[]) {
  const updates: Record<string, number> = {};

  for (const { currentKey, maximumKey } of rows) {
    if (hasNumericValue(sheet[currentKey])) continue;
    if (!hasNumericValue(sheet[maximumKey])) continue;
    updates[currentKey] = Number(sheet[maximumKey]);
  }

  return updates;
}
