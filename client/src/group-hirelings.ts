export interface GroupHireling extends Record<string, unknown> {
  id: string;
  name: string;
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function parseGroupHirelings(state: Record<string, unknown>): GroupHireling[] {
  if (!Array.isArray(state.hirelings)) return [];
  return state.hirelings.flatMap((value, index) => {
    const hireling = recordValue(value);
    if (!hireling) return [];
    return [{ ...hireling, id: String(hireling.id || `hireling-${index + 1}`), name: String(hireling.name ?? "") }];
  });
}
