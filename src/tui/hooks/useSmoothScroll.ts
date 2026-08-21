import type { ScrollBoxRenderable } from "@opentui/core";
import { useEffect, useRef, type RefObject } from "react";

const FRAME_MS = 16;
const MS_PER_LINE = 22;
const MIN_MS = 60;
const MAX_MS = 200;

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * Brings `childId` into view over a few frames instead of teleporting there.
 *
 * OpenTUI's own `scrollChildIntoView` snaps the offset in one go, which reads
 * as a hop as soon as rows are taller than a line — and its effect only shows
 * up in `scrollTop` after the next layout pass, so it cannot be used to probe
 * for a target either. The offset is computed here from the child's geometry
 * and then animated.
 */
export function useSmoothScrollIntoView(
  ref: RefObject<ScrollBoxRenderable | null>,
  childId: string | undefined,
): void {
  // What we last wrote. It is the authoritative position while an animation is
  // running, since reading the box back mid-flight lags a frame behind.
  const current = useRef<number | null>(null);

  useEffect(() => {
    const box = ref.current;
    if (childId === undefined || !box) return;

    const rows = box.getChildren();
    const first = rows[0];
    const child = rows.find((row) => row.id === childId);
    if (!first || !child) return;

    // Offsets are measured against the first row rather than the viewport:
    // absolute positions lag a layout pass behind a scroll, and holding j down
    // would then compound the error into an overshoot.
    const offset = child.y - first.y;
    const height = box.viewport.height;
    const max = Math.max(box.scrollHeight - height, 0);
    // While an animation runs, our own last write is ahead of what the box
    // reports, so it is the one to measure from.
    const from = current.current ?? box.scrollTop;

    let target = from;
    if (offset < from) target = offset;
    else if (offset + child.height > from + height) {
      target = offset + child.height - height;
    }

    const to = Math.min(Math.max(target, 0), max);
    if (to === from) {
      current.current = null;
      return;
    }

    // Long jumps (G, a filter change) would crawl at a fixed duration, so the
    // distance sets the pace and the bounds keep it snappy either way.
    const duration = Math.min(
      Math.max(Math.abs(to - from) * MS_PER_LINE, MIN_MS),
      MAX_MS,
    );

    const start = Date.now();
    const step = () => {
      const t = Math.min((Date.now() - start) / duration, 1);
      const next = Math.round(from + (to - from) * easeOutCubic(t));
      current.current = next;
      box.scrollTop = next;
      if (t >= 1) {
        clearInterval(id);
        current.current = null;
      }
    };
    const id = setInterval(step, FRAME_MS);
    step();

    return () => clearInterval(id);
  }, [ref, childId]);
}
