import { parentPort } from "node:worker_threads";
import { randomInt } from "node:crypto";
import { simulateDice } from "@devils-toys/shared/dice-physics";
import type { PresentedDie } from "@devils-toys/shared";

parentPort!.on("message", (dice: PresentedDie[]) => {
  try {
    parentPort!.postMessage({ result: simulateDice(dice, () => randomInt(2 ** 32) / 2 ** 32) });
  } catch (error) {
    parentPort!.postMessage({ error: (error as Error).message });
  }
});
