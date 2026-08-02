import { useEffect, useRef, useState } from "react";

/**
 * Optimistic stepping, shared by the tracker's hit points and the attribute
 * dialog. A click moves the number at once and the write is held briefly, so a
 * run of clicks costs one request rather than one apiece; the draft is dropped
 * only once the room reports the value already on screen, and a refused write
 * puts the room's own value back.
 */
export function useStatDrafts({
  current,
  revision,
  write,
  onError,
  delay = 250
}: {
  /** What the room reports for a key right now. */
  current: (key: string) => number | null | undefined;
  /** Anything that changes when the room's data has been refreshed. */
  revision: unknown;
  write: (key: string, target: number) => Promise<unknown>;
  onError: (message: string) => void;
  delay?: number;
}) {
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // Read at settle time rather than captured, so the effect always compares
  // against the payload that woke it.
  const latest = useRef(current);
  latest.current = current;

  useEffect(() => {
    setDrafts((existing) => {
      let next = existing;
      for (const key of Object.keys(existing)) {
        // A completed refresh is authoritative even when the server clamped or
        // otherwise changed the target we optimistically showed.
        if (latest.current(key) === undefined || latest.current(key) === null) continue;
        if (next === existing) next = { ...existing };
        delete next[key];
      }
      return next;
    });
  }, [revision]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  function step(key: string, target: number) {
    setDrafts((existing) => ({ ...existing, [key]: target }));
    clearTimeout(timers.current.get(key));
    timers.current.set(
      key,
      setTimeout(() => {
        timers.current.delete(key);
        write(key, target).catch((cause) => {
          // A later click may already have replaced this draft while the first
          // request was in flight; never erase that newer local value.
          setDrafts((existing) => {
            if (existing[key] !== target) return existing;
            const next = { ...existing };
            delete next[key];
            return next;
          });
          onError((cause as Error).message);
        });
      }, delay)
    );
  }

  /** What a click has already applied, before the room has confirmed it. */
  const draft = (key: string): number | undefined => drafts[key];

  return { draft, step };
}
