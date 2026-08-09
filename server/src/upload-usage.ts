import { one } from "./db.js";

/**
 * How many bytes of uploads this instance is holding, counted in one place so
 * every route that enforces the allowance is counting the same things.
 *
 * Hireling and ship pictures used to be two tables of their own. They are
 * portrait columns on `group_hirelings` and `group_assets` now, in the shape
 * `characters` already carried, so this is where that change is absorbed rather
 * than in each of the four routes that ask.
 */
export function storedUploadBytes() {
  const sum = (sql: string) => one<{ size: number }>(sql)?.size ?? 0;
  return (
    sum("SELECT COALESCE(SUM(size), 0) AS size FROM media") +
    sum("SELECT COALESCE(SUM(portrait_size), 0) AS size FROM characters") +
    sum("SELECT COALESCE(SUM(portrait_size), 0) AS size FROM group_hirelings") +
    sum("SELECT COALESCE(SUM(portrait_size), 0) AS size FROM group_assets")
  );
}
