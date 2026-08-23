import { useCallback, useRef } from "react";
import type { RondoData, UndoAction } from "../data.ts";
import type { Notify } from "./useToast.ts";

/** How deep the stack goes. Past this the point is no longer "take that
 * back", and every entry holds a row of the database alive. */
const UNDO_DEPTH = 20;

export interface Undo {
  /** Records an action taken; the toast for it is the caller's business. */
  pushUndo: (action: UndoAction) => void;
  /** Reverses the last recorded action, or says there is nothing to take
   * back. */
  undo: () => void;
}

/**
 * The undo stack and everything that belongs to it: the depth cap, the pop,
 * the reload afterwards and what the toast says. `onTaskRestored` is the one
 * thing the stack cannot know — where the cursor should land once a deleted
 * task comes back.
 */
export function useUndo(
  data: RondoData,
  notify: Notify,
  reloadAll: () => void,
  onTaskRestored: (taskId: number) => void,
): Undo {
  // The stack lives in a ref, not in state: a burst of `u` presses is drained
  // from one stdin chunk before React commits, and every one of them must see
  // what the previous press already popped.
  const stack = useRef<UndoAction[]>([]);

  const pushUndo = useCallback((action: UndoAction) => {
    stack.current = [action, ...stack.current].slice(0, UNDO_DEPTH);
  }, []);

  const undo = useCallback(() => {
    const [action, ...rest] = stack.current;
    if (!action) {
      notify("Nothing to undo", "info");
      return;
    }
    // Popped before the store is touched: a repeated `u` then finds the next
    // entry rather than replaying this one.
    stack.current = rest;
    try {
      data.undo(action);
    } catch (err) {
      notify(`Could not undo: ${(err as Error).message}`, "error");
      return;
    }
    // A restored task keeps its id, so the cursor can go back to it.
    if (action.kind === "task") onTaskRestored(action.task.id);
    reloadAll();
    // The action already carries a label; saying which one came back is what
    // makes a multi-level stack usable, and the depth says another `u` will
    // do something.
    notify(
      rest.length > 0
        ? `Undone: ${action.label} · ${rest.length} more`
        : `Undone: ${action.label}`,
      "success",
    );
  }, [data, notify, onTaskRestored, reloadAll]);

  return { pushUndo, undo };
}
