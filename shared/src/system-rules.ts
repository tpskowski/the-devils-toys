/**
 * Optional rules: the parts of a game a book offers rather than imposes, and
 * which a table decides on before it starts playing.
 *
 * A system declares them the way it declares everything else — as data — and a
 * room switches each one on or off. Nothing is computed from a rule's id: every
 * one of them names a `feature`, which is the application behaviour it gates.
 * A toggle that gated nothing would be a note about the book rather than a
 * setting, and there would be nothing for a room to turn on.
 */

/**
 * What a system's optional rule may switch on. Deliberately short: this is the
 * list of behaviours the application can withhold, not a list of house rules.
 */
export const SYSTEM_RULE_FEATURES = ["tags"] as const;

export type SystemRuleFeature = (typeof SYSTEM_RULE_FEATURES)[number];

/** Lower-case words joined by single hyphens, like every other id a system writes. */
export const SYSTEM_RULE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface SystemOptionalRule {
  /** Unique within the system. It is what a room's setting is recorded against. */
  id: string;
  label: string;
  hint?: string;
  /** The application behaviour this rule turns on. */
  feature: SystemRuleFeature;
  /** Where a room starts. A required rule is on whatever this says. */
  default: boolean;
  /**
   * True where the system's own rules need the feature rather than offering it.
   * The room is told about it and is not offered a switch, because there is
   * nothing a GM could do about it and a switch that cannot move is a lie.
   */
  required?: boolean;
  /** The heading in the book that explains the rule, for the reference link. */
  rulesQuery?: string;
}

/** What a room has recorded against its system's rules: rule id to switch position. */
export type RoomRuleSettings = Record<string, boolean>;

/**
 * Where each of a system's rules stands in one room: the room's own setting
 * where it has one, the rule's default where it does not, and on regardless for
 * a rule the system requires.
 *
 * A setting recorded against a rule the system no longer declares is dropped
 * rather than reported. A system is replaced in place by an install, and a room
 * that had switched off a rule since retired should behave as though it never
 * had rather than carry a setting nothing reads.
 */
export function effectiveRules(
  rules: readonly SystemOptionalRule[] = [],
  settings: RoomRuleSettings = {}
): RoomRuleSettings {
  const state: RoomRuleSettings = {};
  for (const rule of rules) state[rule.id] = rule.required ? true : (settings[rule.id] ?? rule.default);
  return state;
}

/**
 * Whether a room has a feature at all. Several rules may name the same feature —
 * a system offering two readings of one behaviour — and any one of them being on
 * is enough, since each is a rule for switching that behaviour on.
 */
export function hasRuleFeature(
  rules: readonly SystemOptionalRule[] = [],
  settings: RoomRuleSettings = {},
  feature: SystemRuleFeature
): boolean {
  const state = effectiveRules(rules, settings);
  return rules.some((rule) => rule.feature === feature && state[rule.id]);
}

/** The rules a room may actually switch, for a settings panel to draw. */
export function switchableRules(rules: readonly SystemOptionalRule[] = []): SystemOptionalRule[] {
  return rules.filter((rule) => !rule.required);
}

/**
 * What a settings panel actually moved: the rules whose switch is somewhere
 * other than where the room reported it.
 *
 * A panel holds every switch and sends back only these. Sending them all would
 * record a setting against rules nobody touched, which is the same as pinning
 * them — and a rule a room has never moved is exactly the one that should follow
 * its system's default when the system changes it.
 */
export function movedRules(
  rules: readonly SystemOptionalRule[] = [],
  before: RoomRuleSettings = {},
  after: RoomRuleSettings = {}
): RoomRuleSettings {
  const moved: RoomRuleSettings = {};
  for (const rule of switchableRules(rules)) {
    const wanted = after[rule.id];
    if (wanted === undefined) continue;
    if (wanted !== (before[rule.id] ?? rule.default)) moved[rule.id] = wanted;
  }
  return moved;
}
