import { useEffect, useRef, useState } from "react";
import type { DicePresentation } from "@devils-toys/shared";
import { DICE_EVENT, DiceInbox } from "./dice-events";
import type { DiceRenderer } from "./dice-renderer";
import "./dice-3d.css";

export function DiceOverlay({ roomId, enabled }: { roomId: number; enabled: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [caption, setCaption] = useState("");
  useEffect(() => {
    setCaption("");
    if (!enabled || !host.current) {
      return;
    }
    const element = host.current,
      inbox = new DiceInbox(roomId);
    let renderer: DiceRenderer | undefined,
      stopped = false,
      busy = false,
      failed = false;
    let generation = 0;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    const queue: { animation: DicePresentation; receivedAt: number }[] = [];
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const bounds = () => {
      const stage = document.querySelector<HTMLElement>(".scene-stage .table-media-panel");
      const panel = document.querySelector<HTMLElement>(".context-panel");
      const visible = (node: HTMLElement | null) =>
        node && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
      const target = visible(stage) ? stage : visible(panel) ? panel : null;
      if (!target) return;
      const rect = target.getBoundingClientRect();
      let bottom = Math.min(rect.bottom, window.innerHeight);
      const composer = target.querySelector<HTMLElement>(".chat-form")?.getBoundingClientRect();
      if (composer && composer.height) bottom = Math.min(bottom, composer.top);
      const top = Math.max(0, rect.top),
        left = Math.max(0, rect.left),
        width = Math.min(rect.right, window.innerWidth) - left,
        height = bottom - top;
      Object.assign(element.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${Math.max(0, width)}px`,
        height: `${Math.max(0, height)}px`
      });
      renderer?.resize(width, height);
    };
    const finish = () => {
      busy = false;
      setCaption("");
      void next();
    };
    const next = async () => {
      if (stopped || busy || document.hidden) return;
      const entry = queue.shift();
      if (!entry) return;
      if (performance.now() - entry.receivedAt > 15000) return void next();
      const roll = entry.animation;
      busy = true;
      const current = ++generation;
      bounds();
      setCaption(`${roll.label} → ${roll.total}${roll.dice.some((die) => !die.kept) ? " · faded dice dropped" : ""}`);
      if (reduced.matches || failed) {
        fallbackTimer = setTimeout(finish, 1800);
        return;
      }
      try {
        if (!renderer) {
          const module = await import("./dice-renderer");
          if (stopped || document.hidden || current !== generation) return;
          renderer = new module.DiceRenderer(element.querySelector<HTMLElement>(".dice-canvas")!);
          bounds();
        }
        renderer.play(roll, finish);
      } catch {
        failed = true;
        renderer?.dispose();
        renderer = undefined;
        fallbackTimer = setTimeout(finish, 1800);
      }
    };
    const receive = (event: Event) => {
      const roll = (event as CustomEvent<DicePresentation>).detail;
      if (!inbox.accept(roll) || document.hidden) return;
      // Visual backlog only. Mechanics and textual results have already completed.
      if (queue.length >= 8) queue.shift();
      queue.push({ animation: roll, receivedAt: performance.now() });
      void next();
    };
    const hide = () => {
      if (document.hidden) {
        generation++;
        queue.length = 0;
        renderer?.clear();
        clearTimeout(fallbackTimer);
        busy = false;
        setCaption("");
      }
    };
    const contextLost = (event: Event) => {
      event.preventDefault();
      failed = true;
      queue.length = 0;
      renderer?.dispose();
      renderer = undefined;
      finish();
    };
    const motionChanged = () => {
      generation++;
      queue.length = 0;
      renderer?.clear();
      clearTimeout(fallbackTimer);
      finish();
    };
    const observer = new ResizeObserver(bounds);
    for (const selector of [".table-grid", ".scene-stage .table-media-panel", ".context-panel"]) {
      const node = document.querySelector(selector);
      if (node) observer.observe(node);
    }
    bounds();
    window.addEventListener(DICE_EVENT, receive);
    window.addEventListener("resize", bounds);
    window.addEventListener("scroll", bounds, true);
    document.addEventListener("visibilitychange", hide);
    element.addEventListener("webglcontextlost", contextLost, true);
    reduced.addEventListener("change", motionChanged);
    return () => {
      stopped = true;
      queue.length = 0;
      clearTimeout(fallbackTimer);
      observer.disconnect();
      renderer?.dispose();
      window.removeEventListener(DICE_EVENT, receive);
      window.removeEventListener("resize", bounds);
      window.removeEventListener("scroll", bounds, true);
      document.removeEventListener("visibilitychange", hide);
      element.removeEventListener("webglcontextlost", contextLost, true);
      reduced.removeEventListener("change", motionChanged);
    };
  }, [roomId, enabled]);
  return (
    <div ref={host} className="dice-overlay" data-active={Boolean(caption)}>
      <div className="dice-canvas" />
      {caption && (
        <div className="dice-caption" role="status">
          {caption}
        </div>
      )}
    </div>
  );
}
