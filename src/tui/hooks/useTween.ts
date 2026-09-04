import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./useMotion.ts";

const FRAME_MS = 16;
/** Coarser tick for the row glow: a dozen repaints, not thirty, per edit. */
const FLASH_MS = 40;

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * Animates a number towards `target` over `duration` ms.
 * Used for the small motion touches that make the UI feel alive: meters
 * filling, overlays fading in, the focus ring advancing.
 *
 * A change of `resetKey` snaps to `target` in the same render: the value now
 * describes a different thing (another task's meter), so easing from the
 * previous one would draw a transition that never happened.
 */
export function useTween(
  target: number,
  duration = 180,
  resetKey?: unknown,
): number {
  const reduced = useReducedMotion();
  const [state, setState] = useState({ value: target, key: resetKey });
  const fromRef = useRef(target);
  const startRef = useRef(0);

  let value = state.value;
  if (state.key !== resetKey) {
    value = target;
    setState({ value: target, key: resetKey });
  }

  useEffect(() => {
    if (reduced) {
      setState({ value: target, key: resetKey });
      return;
    }
    if (value === target) return;
    fromRef.current = value;
    startRef.current = Date.now();

    const id = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      const t = Math.min(elapsed / duration, 1);
      const next = fromRef.current + (target - fromRef.current) * easeOutCubic(t);
      setState({ value: t >= 1 ? target : next, key: resetKey });
      if (t >= 1) clearInterval(id);
    }, FRAME_MS);

    return () => clearInterval(id);
    // `value` is intentionally excluded: restarting on every frame would stall.
  }, [target, duration, resetKey, reduced]);

  return reduced ? target : value;
}

/**
 * Runs from 0 to 1 once after mount. Overlays use it to fade their backdrop in
 * instead of popping onto the screen. A non-positive duration skips the
 * animation entirely and reports 1 from the first render.
 */
export function useEntrance(duration = 140): number {
  const reduced = useReducedMotion();
  const [progress, setProgress] = useState(duration > 0 ? 0 : 1);

  useEffect(() => {
    if (duration <= 0 || reduced) return;
    const start = Date.now();
    const id = setInterval(() => {
      const t = Math.min((Date.now() - start) / duration, 1);
      setProgress(easeOutCubic(t));
      if (t >= 1) clearInterval(id);
    }, FRAME_MS);
    return () => clearInterval(id);
  }, [duration, reduced]);

  return reduced ? 1 : progress;
}

/**
 * Countdown from 1 to 0 over `duration` ms, restarted whenever `key` changes.
 * Drives the toast timer bar.
 *
 * The value is quantized to `steps` (the bar's width in cells): state only
 * changes when the drawn bar would, so a 3 s toast costs one render per cell
 * instead of one per frame.
 */
export function useCountdown(
  key: unknown,
  duration: number,
  steps: number,
): number {
  const [remaining, setRemaining] = useState(1);

  useEffect(() => {
    if (key === null || key === undefined) return;
    const cells = Math.max(Math.floor(steps), 1);
    setRemaining(1);
    const start = Date.now();
    let last = cells;
    const id = setInterval(
      () => {
        const t = Math.max(1 - (Date.now() - start) / duration, 0);
        const step = Math.floor(t * cells);
        if (step !== last) {
          last = step;
          setRemaining(step / cells);
        }
        if (t <= 0) clearInterval(id);
      },
      Math.max(100, duration / cells),
    );
    return () => clearInterval(id);
  }, [key, duration, steps]);

  return remaining;
}

/**
 * Jumps to 1 whenever `key` changes after mount and eases back to 0 over
 * `duration` ms. A row uses it to glow for a moment when the task under it
 * was edited, so the change reads where it happened and not only in the
 * toast. The first render never flashes: a restored list is not news.
 */
export function useFlash(key: unknown, duration = 480): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(0);
  const seen = useRef(key);

  useEffect(() => {
    if (Object.is(seen.current, key)) return;
    seen.current = key;
    if (reduced) {
      setValue(0);
      return;
    }
    const start = Date.now();
    setValue(1);
    const id = setInterval(() => {
      const t = Math.min((Date.now() - start) / duration, 1);
      setValue(1 - easeOutCubic(t));
      if (t >= 1) clearInterval(id);
    }, FLASH_MS);
    return () => clearInterval(id);
  }, [key, duration, reduced]);

  return reduced ? 0 : value;
}
