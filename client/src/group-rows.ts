/**
 * The group's roster as the server now sends it: one record per hireling, per
 * shared asset, and per obligation, each with an id the database owns.
 *
 * They used to be arrays inside one JSON blob, identified by a string this
 * client minted. The three `parseGroup*` readers that dug them out of it are
 * gone; what is left is the shape, and the one conversion the sheet renderers
 * need — they address a hireling's fields as `hireling[key]`, so a row is
 * flattened for rendering and split apart again for saving.
 */

export interface GroupSheetRow {
  id: number;
  name: string;
  sheet: Record<string, unknown>;
  sortOrder: number;
  imageUrl: string | null;
  updatedAt: string;
}

export interface GroupObligation {
  id: number;
  name: string;
  owedTo: string;
  amount: string;
  details: string;
  sortOrder: number;
  updatedAt: string;
}

/** A row with its sheet's fields alongside its own, which is what a sheet renders from. */
export type GroupEntry = Record<string, unknown> & { id: number; name: string; imageUrl: string | null };

/** A hireling and a shared asset are the same shape here; only their routes differ. */
export type GroupHireling = GroupEntry;
export type GroupAsset = GroupEntry;

/**
 * What belongs to the row rather than to its sheet. Flattening puts these
 * beside the sheet's fields for rendering, and splitting has to take them back
 * out so they are never written into the sheet as if they were part of it.
 */
const rowOwnKeys = ["id", "name", "imageUrl", "sortOrder", "updatedAt"] as const;

export function flattenRow(row: GroupSheetRow): GroupEntry {
  return { ...row.sheet, id: row.id, name: row.name, imageUrl: row.imageUrl };
}

export function splitRow(entry: GroupEntry) {
  const sheet: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry))
    if (!(rowOwnKeys as readonly string[]).includes(key)) sheet[key] = value;
  return { name: String(entry.name ?? ""), sheet };
}

export function flattenRows(rows: readonly GroupSheetRow[]): GroupEntry[] {
  return rows.map(flattenRow);
}
