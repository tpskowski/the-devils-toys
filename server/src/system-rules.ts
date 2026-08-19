import {
  effectiveRules,
  hasRuleFeature,
  type RoomRuleSettings,
  type SystemId,
  type SystemOptionalRule,
  type SystemRuleFeature
} from "@devils-toys/shared";
import { all, db, one } from "./db.js";
import { hasSystem, systemOrThrow } from "./systems.js";

/**
 * Where a room stands on its system's optional rules.
 *
 * The system declares the rules and the room records only where it has moved
 * one, which is what keeps a default meaningful: a system that later changes
 * what it offers by default changes it for every room that never said
 * otherwise, and says nothing about the rooms that did.
 *
 * A rule the system no longer declares is not read back, and its stored row is
 * left alone rather than deleted. An install replaces a system in place, and a
 * rule that goes missing in one version and returns in the next should come back
 * as the room left it.
 */

/** The rules a system offers, or none. Reading a room's system may fail; nothing here does. */
export function systemRules(system: SystemId): readonly SystemOptionalRule[] {
  return (hasSystem(system) ? systemOrThrow(system).optionalRules : undefined) ?? [];
}

/** Only what the room itself has said, without the defaults folded in. */
export function storedRoomRules(roomId: number): RoomRuleSettings {
  const settings: RoomRuleSettings = {};
  for (const row of all<{ rule_id: string; enabled: number }>(
    "SELECT rule_id, enabled FROM room_system_rules WHERE room_id = ?",
    roomId
  ))
    settings[row.rule_id] = Boolean(row.enabled);
  return settings;
}

/** Where each of the system's rules stands in this room, resolved for a client. */
export function roomRules(roomId: number, system: SystemId): RoomRuleSettings {
  return effectiveRules(systemRules(system), storedRoomRules(roomId));
}

/** Whether the room has an application behaviour switched on. The one gate every feature asks. */
export function roomHasFeature(roomId: number, feature: SystemRuleFeature): boolean {
  const room = one<{ system: SystemId }>("SELECT system FROM rooms WHERE id = ?", roomId);
  if (!room) return false;
  return hasRuleFeature(systemRules(room.system), storedRoomRules(roomId), feature);
}

/**
 * Moves the switches a request named.
 *
 * A rule the system does not declare, and one it requires, are both refused
 * rather than dropped: the first is a client naming something that does not
 * exist, and the second is a request to turn off a rule the game is played by.
 */
export function setRoomRules(
  roomId: number,
  system: SystemId,
  changes: RoomRuleSettings
): { error: string } | undefined {
  const declared = systemRules(system);
  // Every rule is checked before any of them is written, so a request naming one
  // good rule and one bad one moves neither.
  for (const ruleId of Object.keys(changes)) {
    const rule = declared.find((item) => item.id === ruleId);
    if (!rule) return { error: `${systemOrThrow(system).name} has no optional rule called ${ruleId}.` };
    if (rule.required) return { error: `${rule.label} is required by ${systemOrThrow(system).name}.` };
  }
  const write = db.prepare(
    `INSERT INTO room_system_rules (room_id, rule_id, enabled) VALUES (?, ?, ?)
     ON CONFLICT(room_id, rule_id) DO UPDATE SET enabled = excluded.enabled, updated_at = CURRENT_TIMESTAMP`
  );
  for (const [ruleId, enabled] of Object.entries(changes)) write.run(roomId, ruleId, enabled ? 1 : 0);
  return undefined;
}
