import { useEffect, useRef, useState } from "react";

const FRAME_MS = 16;

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * Animates a number towards `target` over `duration` ms.
 * Used for the small motion touches that make the UI feel alive: meters
 * filling, overlays fading in, the focus ring advancing.
 */
export function useTween(target: number, duration = 180): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const startRef = useRef(0);

  useEffect(() => {
    if (value === target) return;
    fromRef.current = value;
    startRef.current = Date.now();

    const id = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      const t = Math.min(elapsed / duration, 1);
      const next = fromRef.current + (target - fromRef.current) * easeOutCubic(t);
      setValue(t >= 1 ? target : next);
      if (t >= 1) clearInterval(id);
    }, FRAME_MS);

    return () => clearInterval(id);
    // `value` is intentionally excluded: restarting on every frame would stall.
  }, [target, duration]);

  return value;
}

/**
 * Runs from 0 to 1 once after mount. Overlays use it to fade their backdrop in
 * instead of popping onto the screen.
 */
export function useEntrance(duration = 140): number {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      const t = Math.min((Date.now() - start) / duration, 1);
      setProgress(easeOutCubic(t));
      if (t >= 1) clearInterval(id);
    }, FRAME_MS);
    return () => clearInterval(id);
  }, [duration]);

  return progress;
}

/**
 * Countdown from 1 to 0 over `duration` ms, restarted whenever `key` changes.
 * Drives the toast timer bar.
 */
export function useCountdown(key: unknown, duration: number): number {
  const [remaining, setRemaining] = useState(1);

  useEffect(() => {
    if (key === null || key === undefined) return;
    setRemaining(1);
    const start = Date.now();
    const id = setInterval(() => {
      const t = Math.max(1 - (Date.now() - start) / duration, 0);
      setRemaining(t);
      if (t <= 0) clearInterval(id);
    }, 60);
    return () => clearInterval(id);
  }, [key, duration]);

  return remaining;
}
