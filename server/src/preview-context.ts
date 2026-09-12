import { AsyncLocalStorage } from "node:async_hooks";

/** Request-local: never changes a membership or another tab's authority. */
export const playerPreview = new AsyncLocalStorage<{ roomId: number; accountId: number }>();
