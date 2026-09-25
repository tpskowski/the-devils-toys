import { AsyncLocalStorage } from "node:async_hooks";
import { Worker } from "node:worker_threads";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { DicePhysicsReplay, PresentedDie } from "@devils-toys/shared";
import type { DiceResult } from "./dice.js";

type Simulation = { faces: number[]; replay: DicePhysicsReplay };
type Job = { dice: PresentedDie[]; resolve: (result: Simulation) => void; reject: (error: Error) => void };
export class DicePhysicsError extends Error {}
const queue: Job[] = [];
let running = 0;
/** Two isolated simulations at a time; a crowded throw cannot block room/chat I/O. */
function simulate(dice: PresentedDie[]): Promise<Simulation> {
  return new Promise((resolve, reject) => {
    queue.push({ dice, resolve, reject });
    drain();
  });
}
function drain() {
  while (running < 2 && queue.length) {
    const job = queue.shift()!;
    running++;
    let worker: Worker;
    try {
      const compiled = new URL("./dice-physics-worker.js", import.meta.url);
      const require = createRequire(import.meta.url);
      worker = existsSync(compiled)
        ? new Worker(compiled, { execArgv: [] })
        : new Worker(
            "const {workerData}=require('node:worker_threads'); require(workerData.loader); require(workerData.module)",
            {
              eval: true,
              execArgv: [],
              workerData: {
                loader: require.resolve("tsx/cjs"),
                module: fileURLToPath(new URL("./dice-physics-worker.ts", import.meta.url))
              }
            }
          );
    } catch (error) {
      running--;
      job.reject(error instanceof Error ? error : new Error(String(error)));
      continue;
    }
    let finished = false;
    const finish = (error?: Error, result?: Simulation) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      void worker.terminate();
      running--;
      if (error) job.reject(error);
      else job.resolve(result!);
      drain();
    };
    const timer = setTimeout(
      () => finish(new DicePhysicsError("The physical throw timed out. Please roll again.")),
      15000
    );
    worker.once("message", (message: { result?: Simulation; error?: string }) =>
      finish(message.error ? new DicePhysicsError(message.error) : undefined, message.result)
    );
    worker.once("error", (error) => finish(error));
    worker.once("exit", () => {
      if (!finished) finish(new DicePhysicsError("The dice simulation stopped. Please roll again."));
    });
    worker.postMessage(job.dice);
  }
}

interface RollContext {
  rolls: { key: string; result: DiceResult }[];
  cursor: number;
  choices: number[];
  choiceCursor: number;
}
const context = new AsyncLocalStorage<RollContext>();
export class PendingPhysics extends Error {
  constructor(
    readonly key: string,
    readonly dice: PresentedDie[],
    readonly complete: (faces: number[]) => DiceResult
  ) {
    super("Preparing physical dice");
  }
}
export function physicalRandom(draw: () => number) {
  const current = context.getStore();
  if (!current) return draw();
  const index = current.choiceCursor++;
  return current.choices[index] ?? (current.choices[index] = draw());
}
export function physicalResult(
  key: string,
  prepare: () => DiceResult,
  complete: (faces: number[]) => DiceResult
): DiceResult | undefined {
  const current = context.getStore();
  if (!current) return;
  const cached = current.rolls[current.cursor++];
  if (cached) {
    if (cached.key !== key) throw new Error("The roll changed while its dice were being prepared. Please try again.");
    return cached.result;
  }
  throw new PendingPhysics(key, prepare().dice, complete);
}

/**
 * Prepare dice for synchronous rules evaluation without performing writes twice.
 * action must do all rolling before any write. PendingPhysics escapes before a
 * result exists; previously prepared rolls and non-dice choices replay unchanged.
 */
export async function withPhysicalDice<T>(action: () => T): Promise<T> {
  const state: RollContext = { rolls: [], cursor: 0, choices: [], choiceCursor: 0 };
  for (;;) {
    state.cursor = 0;
    state.choiceCursor = 0;
    try {
      return context.run(state, action);
    } catch (error) {
      if (!(error instanceof PendingPhysics)) throw error;
      const simulation = await simulate(error.dice);
      // Build mechanics outside the context so this does not request another throw.
      const result = error.complete(simulation.faces);
      Object.defineProperty(result, "physics", { value: simulation.replay, enumerable: false });
      state.rolls.push({ key: error.key, result });
    }
  }
}
