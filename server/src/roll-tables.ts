/**
 * The table parser lives in `shared` so the Devil's Tables editor can preview a
 * set in the browser with exactly the parser the roller uses. This re-export
 * keeps the server's existing imports pointing somewhere sensible.
 */
export {
  diceMaximum,
  parseRollTables,
  rowForRoll,
  rowText,
  tableSummary,
  unreachableRows,
  SUPPORTED_DIE_SIDES
} from "@devils-toys/shared";
