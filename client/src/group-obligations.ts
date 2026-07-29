export interface GroupObligation {
  id: string;
  name: string;
  owedTo: string;
  amount: string;
  details: string;
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function parseGroupObligations(state: Record<string, unknown>): GroupObligation[] {
  if (Array.isArray(state.obligations)) {
    return state.obligations.flatMap((value, index) => {
      const obligation = recordValue(value);
      if (!obligation) return [];
      return [
        {
          id: String(obligation.id || `obligation-${index + 1}`),
          name: String(obligation.name ?? ""),
          owedTo: String(obligation.owedTo ?? ""),
          amount: String(obligation.amount ?? ""),
          details: String(obligation.details ?? "")
        }
      ];
    });
  }

  const legacyDetails = String(state.groupDebt ?? "");
  return legacyDetails.trim()
    ? [{ id: "legacy-group-debt", name: "", owedTo: "", amount: "", details: legacyDetails }]
    : [];
}
