import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadTuiState,
  saveTuiState,
  tuiStatePath,
  type TuiState,
} from "../../core/config/tui-state.ts";
import { restoreTuiState, type RestoredTuiState } from "../state.ts";

/** Milliseconds of quiet before the session state reaches tui-state.json. */
const STATE_SAVE_MS = 400;

/**
 * Where the last session left off. Read once, at mount: the file is only
 * ever consulted to seed the initial state, never again while running.
 */
export function useRestoredSession(): RestoredTuiState {
  const [restored] = useState(() => restoreTuiState(loadTuiState()));
  return restored;
}

/**
 * Writes `state` to tui-state.json after a short quiet period, and hands back
 * a flush for the paths that cannot wait for it — quitting exits the process,
 * so the last keystrokes before `q` would otherwise never reach the file.
 *
 * The restore is a separate hook because the values that make up `state` are
 * themselves seeded from it, so the two cannot share one call.
 */
export function useSessionSave(state: TuiState): () => void {
  // The path is fixed at mount, so a save that fires late can never land in a
  // directory chosen afterwards.
  const path = useRef(tuiStatePath());
  const pending = useRef<TuiState | null>(null);

  const flush = useCallback(() => {
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    try {
      saveTuiState(next, path.current);
    } catch {
      // A state file that cannot be written is not worth a toast.
    }
  }, []);

  // The mount only restores; the first render has nothing new to save.
  const seen = useRef(false);
  const {
    tab,
    sort,
    tagBar,
    tag,
    view,
    selectedTaskId,
    selectedNoteDate,
    density,
  } = state;
  useEffect(() => {
    if (!seen.current) {
      seen.current = true;
      return;
    }
    pending.current = {
      tab,
      sort,
      tagBar,
      tag,
      view,
      selectedTaskId,
      selectedNoteDate,
      density,
    };
    const id = setTimeout(flush, STATE_SAVE_MS);
    return () => clearTimeout(id);
  }, [
    density,
    flush,
    selectedNoteDate,
    selectedTaskId,
    sort,
    tab,
    tag,
    tagBar,
    view,
  ]);

  return flush;
}
