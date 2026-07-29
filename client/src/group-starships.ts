export interface GroupStarship extends Record<string, unknown> {
  id: string;
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function parseGroupStarships(state: Record<string, unknown>): GroupStarship[] {
  if (Array.isArray(state.starships)) {
    return state.starships.flatMap((value, index) => {
      const ship = recordValue(value);
      return ship ? [{ ...ship, id: String(ship.id || `starship-${index + 1}`) }] : [];
    });
  }

  const legacy = recordValue(state.starship);
  return legacy && Object.keys(legacy).length ? [{ ...legacy, id: "legacy-starship" }] : [];
}
