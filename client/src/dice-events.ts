import type { DicePresentation } from "@devils-toys/shared";

export const DICE_EVENT = "devils-dice-roll";
export function receiveDice(animation: DicePresentation) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(DICE_EVENT, { detail: animation }));
}
/** Room-scoped live deduplication. History is never passed here. */
export class DiceInbox {
  private seen = new Set<string>();
  constructor(private roomId: number) {}
  accept(animation: DicePresentation) {
    if (animation.version !== 1 || animation.roomId !== this.roomId || this.seen.has(animation.id)) return false;
    this.seen.add(animation.id);
    if (this.seen.size > 512) this.seen.delete(this.seen.values().next().value!);
    return true;
  }
}
