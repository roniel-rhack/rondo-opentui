import { useCallback, useEffect, useState } from "react";
import type { Note } from "../../core/journal/journal.ts";
import type { Task } from "../../core/task/task.ts";
import type { RondoData } from "../data.ts";
import { withTasks } from "../state.ts";
import type { Notify } from "./useToast.ts";

/** How often the database is asked whether another connection committed. */
const CHANGE_POLL_MS = 2000;

export interface TaskData {
  tasks: Task[];
  notes: Note[];
  showHidden: boolean;
  setShowHidden: (hidden: boolean) => void;
  reloadTasks: () => void;
  reloadNotes: (hidden?: boolean) => void;
  reloadAll: () => void;
  /** Swaps single tasks in place; every other row keeps its identity. */
  refreshTasks: (ids: readonly number[]) => void;
}

/** Everything the app reads from the stores, plus the poll that notices a
 * write from the CLI or the agent skill. */
export function useTaskData(data: RondoData, notify: Notify): TaskData {
  const [tasks, setTasks] = useState<Task[]>(() => data.listTasks());
  const [notes, setNotes] = useState<Note[]>(() => data.listNotes(false));
  const [showHidden, setHidden] = useState(false);

  const reloadTasks = useCallback(() => {
    setTasks(data.listTasks());
  }, [data]);

  const reloadNotes = useCallback(
    (hidden = showHidden) => {
      setNotes(data.listNotes(hidden));
    },
    [data, showHidden],
  );

  const reloadAll = useCallback(() => {
    reloadTasks();
    reloadNotes();
  }, [reloadNotes, reloadTasks]);

  const setShowHidden = useCallback(
    (hidden: boolean) => {
      setHidden(hidden);
      setNotes(data.listNotes(hidden));
    },
    [data],
  );

  // A single-task mutation swaps that task only; every other row keeps its
  // identity and its memoized render.
  const refreshTasks = useCallback(
    (ids: readonly number[]) => {
      const fresh = new Map(ids.map((id) => [id, data.refreshTask(id)]));
      setTasks((prev) => withTasks(prev, fresh));
    },
    [data],
  );

  // The CLI and the agent skill write the same database; a foreign commit
  // shows up within a poll. The baseline is taken once, at mount.
  useEffect(() => {
    data.changed();
  }, [data]);
  useEffect(() => {
    const id = setInterval(() => {
      if (!data.changed()) return;
      reloadAll();
      notify("Refreshed — changed outside", "info");
    }, CHANGE_POLL_MS);
    return () => clearInterval(id);
  }, [data, notify, reloadAll]);

  return {
    tasks,
    notes,
    showHidden,
    setShowHidden,
    reloadTasks,
    reloadNotes,
    reloadAll,
    refreshTasks,
  };
}
