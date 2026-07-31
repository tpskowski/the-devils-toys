import type { CharacterItem, CharacterListDefinition } from "@devils-toys/shared";

/** Keeps unrestricted entries and entries whose source names the socket being edited. */
export function characterItemsForSlot(
  items: readonly CharacterItem[],
  list: CharacterListDefinition,
  slotIndex: number
) {
  const slotType = list.slotTypes?.[slotIndex];
  if (!slotType) return items;
  return items.filter((item) => !item.allowedSlotTypes?.length || item.allowedSlotTypes.includes(slotType));
}
