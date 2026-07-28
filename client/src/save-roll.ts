export type SaveAbility = "STR" | "DEX" | "WIL";

export interface SaveRollSetup {
  ability: SaveAbility;
  target: number;
}

const saveAbilitiesByCurrentKey: Readonly<Record<string, SaveAbility>> = {
  strCurrent: "STR",
  dexCurrent: "DEX",
  wilCurrent: "WIL"
};

export function saveAbilityForStatKey(key: string) {
  return saveAbilitiesByCurrentKey[key];
}

export function saveSetupForAttribute(key: string, value: unknown): SaveRollSetup | undefined {
  const ability = saveAbilityForStatKey(key);
  if (!ability) return undefined;
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return undefined;
  const target = Number(value);
  if (!Number.isInteger(target) || target < 1 || target > 20) return undefined;
  return { ability, target };
}
