import { type KeyEvent } from "@opentui/core";
import {
  useKeyboard,
  useRenderer,
  useTerminalDimensions,
} from "@opentui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  configDir,
  formatDateTime,
  formatNoteTitle,
  save as saveConfig,
  type Config,
} from "../core/config/config.ts";
import type { Density } from "../core/config/tui-state.ts";
import { Minute } from "../core/duration.ts";
import { SessionKind } from "../core/focus/focus.ts";
import type { Note } from "../core/journal/journal.ts";
import { RecurFreq, recurFreqString } from "../core/task/recur.ts";
import {
  Status,
  priorityString,
  statusString,
  type Task,
} from "../core/task/task.ts";
import { formatDuration } from "../core/task/timelog.ts";
import { DateOnly, GoTime } from "../core/time.ts";
import { initTheme, isDark } from "../core/ui/colors.ts";
import type { RondoData, TaskDraft, UndoAction } from "./data.ts";
import { usePomodoro } from "./hooks/usePomodoro.ts";
import {
  DUE_CHIPS,
  TABS,
  blockedIds,
  clampIndex,
  clampRatio,
  collectTags,
  cycleDensity,
  detailRows,
  doneToday,
  emptyFilters,
  excerptOf,
  exportContent,
  exportFileName,
  exportTasksContent,
  focusStatusMessage,
  hintSpecs,
  indexOfId,
  indexOfNoteDate,
  isDense,
  listWidthFor,
  openFirst,
  pageSize,
  parseDueInput,
  parseTimeLogInput,
  plural,
  sortToast,
  statusToast,
  stepPriority,
  tabCounts,
  timeLogInput,
  toastDuration,
  uniquePath,
  visibleNotes,
  visibleTasks,
  type Filters,
  type Hint,
  type HintAction,
  type SortKey,
  type TabId,
  type ToastKind,
} from "./state.ts";
import { tuiTheme } from "./theme.ts";
import { Header } from "./components/Header.tsx";
import { EntryList, NoteList } from "./components/JournalPanel.tsx";
import {
  HelpOverlay,
  Panel,
  PanelDivider,
  SearchBar,
  StatsOverlay,
  StatusBar,
  TagBar,
} from "./components/Panels.tsx";
import { TaskDetail, type TaskDetailHandle } from "./components/TaskDetail.tsx";
import { TaskList, isOneLine } from "./components/TaskList.tsx";
import {
  CommandPalette,
  ConfirmDialog,
  PromptDialog,
  TaskPickerDialog,
  type PaletteAction,
  type PromptChip,
} from "./components/Dialogs.tsx";
import { TaskForm, emptyTaskForm, type TaskFormValues } from "./components/TaskForm.tsx";
import { SettingsOverlay } from "./components/Settings.tsx";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

type Modal =
  | { type: "none" }
  | { type: "task-form"; title: string; initial: TaskFormValues; taskId: number | null }
  | {
      type: "confirm";
      title: string;
      message: string;
      excerpt?: string;
      detail?: string;
      confirmLabel?: string;
      onConfirm: () => void;
    }
  | {
      type: "prompt";
      title: string;
      label: string;
      placeholder?: string;
      initial?: string;
      multiline?: boolean;
      chips?: PromptChip[];
      stayOpen?: boolean;
      onSubmit: (value: string) => string | void;
    }
  | {
      type: "task-pick";
      title: string;
      subtitle?: string;
      tasks: Task[];
      onPick: (taskId: number) => void;
    }
  | { type: "palette" }
  | { type: "help" }
  | { type: "stats" }
  | { type: "settings" };

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

export interface AppProps {
  data: RondoData;
  onQuit?: () => void;
}

/** Rows the chrome around the list always takes: header, panel borders and
 * the two status-bar rows. The tag and search bars add one each. */
const LIST_CHROME = 5;
/** Rows the detail panel's chrome takes: header, borders, status bar. */
const DETAIL_CHROME = 5;
/** Milliseconds the panel ratio waits before it is written to config.json,
 * so a drag or a run of `<` presses ends in one write. */
const RATIO_SAVE_MS = 400;

function toDraft(values: TaskFormValues): TaskDraft {
  return {
    title: values.title.trim(),
    description: values.description.trim(),
    priority: values.priority,
    dueDate: parseDueInput(values.due, GoTime.now()),
    tags: values.tags
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t !== ""),
    recurFreq: values.recur,
  };
}

function fromTask(task: Task): TaskFormValues {
  return {
    title: task.title,
    description: task.description,
    priority: task.priority,
    due: task.dueDate ? task.dueDate.format(DateOnly) : "",
    tags: task.tags.join(", "),
    recur: task.recurFreq,
  };
}

export function App({ data, onQuit }: AppProps) {
  const { width, height } = useTerminalDimensions();
  const renderer = useRenderer();
  // A saved preference wins over whatever the terminal reports.
  const [dark, setDark] = useState(() =>
    data.cfg.theme !== "" ? data.cfg.theme === "dark" : isDark(),
  );
  const theme = useMemo(() => tuiTheme(dark), [dark]);

  // Aligns the shared CLI palette (colors.ts) with the effective theme.
  useEffect(() => {
    initTheme(dark);
  }, [dark]);

  // Repaint the base layer when the palette changes, otherwise the previous
  // theme lingers wherever nothing else marked the cells dirty.
  useEffect(() => {
    renderer.setBackgroundColor(theme.bg);
    renderer.requestRender();
  }, [renderer, theme]);
  const [cfg, setCfg] = useState<Config>(data.cfg);

  const [tasks, setTasks] = useState<Task[]>(() => data.listTasks());
  const [notes, setNotes] = useState<Note[]>(() => data.listNotes(false));
  const [showHidden, setShowHidden] = useState(false);

  const [tab, setTab] = useState<TabId>("active");
  const [panel, setPanel] = useState<0 | 1>(0);
  const [taskIndex, setTaskIndex] = useState(0);
  const [detailIndex, setDetailIndex] = useState(0);
  const [noteIndex, setNoteIndex] = useState(0);
  const [entryIndex, setEntryIndex] = useState(0);
  // The selection is remembered by identity, not row number: a re-sort, a
  // filter, a create or a reload looks the task (or the day) up again.
  const selectedTaskId = useRef<number | null>(null);
  const selectedNoteDate = useRef<string | null>(null);

  const [sort, setSort] = useState<SortKey>("due");
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [searching, setSearching] = useState(false);
  const [tagBar, setTagBar] = useState(false);
  const [ratio, setRatio] = useState(cfg.panelRatio);
  const [density, setDensity] = useState<Density>("auto");

  const [modal, setModal] = useState<Modal>({ type: "none" });
  const [toast, setToast] = useState<Toast | null>(null);
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const detailRef = useRef<TaskDetailHandle | null>(null);

  const notify = useCallback(
    (message: string, kind: Toast["kind"] = "info") => {
      setToast((prev) => ({ id: (prev?.id ?? 0) + 1, message, kind }));
    },
    [],
  );

  const reloadTasks = useCallback(() => {
    setTasks(data.listTasks());
  }, [data]);

  const reloadNotes = useCallback(
    (hidden = showHidden) => {
      setNotes(data.listNotes(hidden));
    },
    [data, showHidden],
  );

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), toastDuration(toast.kind));
    return () => clearTimeout(id);
  }, [toast]);

  const pomodoro = usePomodoro(data, cfg, (kind, taskId) => {
    if (kind !== SessionKind.Work) {
      notify("Break over", "success");
    } else if (taskId > 0) {
      // The app already measured the time; the task should not have to wait
      // for the user to type it in again.
      const duration = cfg.focus.workDuration * Minute;
      data.logTime(taskId, duration, "focus session");
      reloadTasks();
      notify(
        `Focus complete · ${formatDuration(duration)} logged to #${taskId}`,
        "success",
      );
    } else {
      notify("Focus session complete", "success");
    }
    if (cfg.focus.sound) process.stdout.write("\u0007"); // terminal bell
  });

  const shown = useMemo(
    () => visibleTasks(tasks, tab, filters, sort),
    [tasks, tab, filters, sort],
  );
  // Baseline for "N of M" and search counters: the tab without any filter.
  const tabTotal = useMemo(
    () => visibleTasks(tasks, tab, emptyFilters, sort).length,
    [tasks, tab, sort],
  );
  const shownNotes = useMemo(
    () => visibleNotes(notes, filters.query),
    [notes, filters.query],
  );
  const counts = useMemo(() => tabCounts(tasks, notes.length), [tasks, notes]);

  const selectedTask = shown[clampIndex(taskIndex, shown.length)] ?? null;
  const selectedNote =
    shownNotes[clampIndex(noteIndex, shownNotes.length)] ?? null;

  // Cursors are clamped where they are read, so a delete under the cursor
  // leaves it on the last row rather than on nothing.
  const rows = useMemo(
    () => (selectedTask ? detailRows(selectedTask) : []),
    [selectedTask],
  );
  const detailCursor = clampIndex(detailIndex, rows.length);
  const detailRow = rows[detailCursor];
  const entryCount = selectedNote?.entries.length ?? 0;
  const entryCursor = clampIndex(entryIndex, entryCount);

  const taskTitles = useMemo(
    () => new Map(tasks.map((t) => [t.id, `#${t.id} ${t.title}`])),
    [tasks],
  );

  // A new query, tag or view ranks the list afresh, so the cursor lands on
  // the best match. Clearing the filter is different: the task found under
  // it stays selected, and the mount keeps whatever the caller restored.
  const filtersSeen = useRef(false);
  useEffect(() => {
    if (!filtersSeen.current) {
      filtersSeen.current = true;
      return;
    }
    const cleared =
      filters.query === "" && filters.tag === null && filters.view === "all";
    if (cleared) return;
    selectedTaskId.current = null;
    setTaskIndex(0);
    setDetailIndex(0);
    selectedNoteDate.current = null;
    setNoteIndex(0);
    setEntryIndex(0);
  }, [filters.query, filters.tag, filters.view]);

  useEffect(() => {
    setTaskIndex((i) => {
      const next = indexOfId(shown, selectedTaskId.current, i);
      selectedTaskId.current = shown[next]?.id ?? null;
      return next;
    });
  }, [shown]);

  useEffect(() => {
    setNoteIndex((i) => {
      const next = indexOfNoteDate(shownNotes, selectedNoteDate.current, i);
      selectedNoteDate.current =
        shownNotes[next]?.date.format(DateOnly) ?? null;
      return next;
    });
  }, [shownNotes]);

  useEffect(() => {
    setDetailIndex(0);
  }, [selectedTask?.id]);

  const selectTaskAt = useCallback(
    (index: number) => {
      const i = clampIndex(index, shown.length);
      selectedTaskId.current = shown[i]?.id ?? null;
      setTaskIndex(i);
    },
    [shown],
  );

  const selectNoteAt = useCallback(
    (index: number) => {
      const i = clampIndex(index, shownNotes.length);
      const next = shownNotes[i]?.date.format(DateOnly) ?? null;
      if (next !== selectedNoteDate.current) setEntryIndex(0);
      selectedNoteDate.current = next;
      setNoteIndex(i);
    },
    [shownNotes],
  );

  const closeModal = useCallback(() => setModal({ type: "none" }), []);

  // ---------------------------------------------------------------- actions

  const openAddTask = useCallback(() => {
    // A task created inside a filter belongs to it, or it would vanish from
    // the list the moment it is saved.
    setModal({
      type: "task-form",
      title: "New task",
      initial: {
        ...emptyTaskForm,
        tags: filters.tag ?? "",
        due: filters.view === "today" ? "today" : "",
      },
      taskId: null,
    });
  }, [filters.tag, filters.view]);

  const openEditTask = useCallback(() => {
    if (!selectedTask) return;
    setModal({
      type: "task-form",
      title: `Edit task #${selectedTask.id}`,
      initial: fromTask(selectedTask),
      taskId: selectedTask.id,
    });
  }, [selectedTask]);

  const submitTaskForm = useCallback(
    (values: TaskFormValues, taskId: number | null) => {
      const draft = toDraft(values);
      if (taskId === null) {
        const created = data.createTask(draft);
        selectedTaskId.current = created.id;
        notify(`Created "${created.title}"`, "success");
      } else {
        const task = data.tasks.getById(taskId);
        if (task) {
          data.updateTask(task, draft);
          notify(`Updated "${task.title}"`, "success");
        }
      }
      closeModal();
      reloadTasks();
    },
    [closeModal, data, notify, reloadTasks],
  );

  const pushUndo = useCallback((action: UndoAction) => {
    setUndoStack((stack) => [action, ...stack].slice(0, 20));
  }, []);

  // Every status change is one keypress and one undo entry; the toast names
  // the spawned occurrence so a recurring completion is not a surprise.
  const applyStatus = useCallback(
    (
      task: Task,
      result: { status: Status; spawnedId: number | null; undo: UndoAction },
    ) => {
      pushUndo(result.undo);
      reloadTasks();
      notify(statusToast(task.id, result.status, result.spawnedId), "success");
    },
    [notify, pushUndo, reloadTasks],
  );

  const toggleDone = useCallback(
    (task: Task | null) => {
      if (task) applyStatus(task, data.toggleDone(task));
    },
    [applyStatus, data],
  );

  const toggleInProgress = useCallback(
    (task: Task | null) => {
      if (task) applyStatus(task, data.toggleInProgress(task));
    },
    [applyStatus, data],
  );

  // Deletes are undoable, so they no longer ask; the toast lingers as long
  // as an error would, which is the window for pressing u.
  const undoableDelete = useCallback(
    (action: UndoAction, what: string) => {
      pushUndo(action);
      closeModal();
      notify(`${what} · u to undo`, "undo");
    },
    [closeModal, notify, pushUndo],
  );

  const deleteSelectedTask = useCallback(() => {
    if (!selectedTask) return;
    const task = selectedTask;
    const perform = () => {
      const action = data.deleteTask(task);
      undoableDelete(action, action.label);
      reloadTasks();
    };
    // Removing a blocker changes other tasks, which is worth a look first.
    const blocked = data.blockedBy(task);
    if (blocked.length === 0) {
      perform();
      return;
    }
    setModal({
      type: "confirm",
      title: "Delete task",
      message: `Delete "${task.title}"?`,
      detail: `It blocks ${blocked.map((id) => `#${id}`).join(", ")} — they will be unblocked.`,
      onConfirm: perform,
    });
  }, [data, reloadTasks, selectedTask, undoableDelete]);

  const stepPriorityBy = useCallback(
    (delta: 1 | -1) => {
      if (!selectedTask) return;
      const next = stepPriority(selectedTask.priority, delta);
      if (next === null) {
        notify(
          `#${selectedTask.id} is already ${priorityString(selectedTask.priority)}`,
          "info",
        );
        return;
      }
      const action = data.setPriority(selectedTask, next);
      pushUndo(action);
      reloadTasks();
      notify(`${action.label} · u undo`, "success");
    },
    [data, notify, pushUndo, reloadTasks, selectedTask],
  );

  const openDuePrompt = useCallback(() => {
    if (!selectedTask) return;
    const task = selectedTask;
    setModal({
      type: "prompt",
      title: "Due date",
      label: `Due date for #${task.id}`,
      placeholder: "YYYY-MM-DD · today · +3d · none",
      initial: task.dueDate ? task.dueDate.format(DateOnly) : "",
      chips: DUE_CHIPS,
      onSubmit: (value) => {
        let due: GoTime | null;
        try {
          due = parseDueInput(value, GoTime.now());
        } catch {
          return "Use YYYY-MM-DD, today, tomorrow, +3d, +1w or none";
        }
        const action = data.setDue(task, due);
        pushUndo(action);
        closeModal();
        reloadTasks();
        notify(`${action.label} · u undo`, "success");
      },
    });
  }, [closeModal, data, notify, pushUndo, reloadTasks, selectedTask]);

  // Enter adds and keeps the prompt, so a list of steps goes in at once.
  const addSubtask = useCallback(() => {
    if (!selectedTask) return;
    const taskId = selectedTask.id;
    setModal({
      type: "prompt",
      title: "New subtask",
      label: `Subtask for #${taskId}`,
      placeholder: "Step description",
      stayOpen: true,
      onSubmit: (value) => {
        data.addSubtask(taskId, value);
        reloadTasks();
      },
    });
  }, [data, reloadTasks, selectedTask]);

  const toggleSubtaskAt = useCallback(
    (index: number) => {
      const subtask = selectedTask?.subtasks[index];
      if (!subtask) return;
      data.toggleSubtask(subtask.id);
      reloadTasks();
    },
    [data, reloadTasks, selectedTask],
  );

  const toggleDetailRow = useCallback(() => {
    if (detailRow?.kind === "subtask") toggleSubtaskAt(detailRow.index);
  }, [detailRow, toggleSubtaskAt]);

  const editDetailRow = useCallback(() => {
    const task = selectedTask;
    if (!task || !detailRow) return;
    if (detailRow.kind === "subtask") {
      const subtask = task.subtasks[detailRow.index];
      if (!subtask) return;
      setModal({
        type: "prompt",
        title: "Edit subtask",
        label: "New title",
        initial: subtask.title,
        onSubmit: (value) => {
          data.editSubtask(subtask.id, value);
          closeModal();
          reloadTasks();
          notify("Subtask updated", "success");
        },
      });
      return;
    }
    if (detailRow.kind === "note") {
      const note = task.notes[detailRow.index];
      if (!note) return;
      setModal({
        type: "prompt",
        title: "Edit note",
        label: `Note for #${task.id}`,
        initial: note.body,
        multiline: true,
        onSubmit: (value) => {
          data.editTaskNote(note.id, value);
          closeModal();
          reloadTasks();
          notify("Note updated", "success");
        },
      });
      return;
    }
    const log = task.timeLogs[detailRow.index];
    if (!log) return;
    setModal({
      type: "prompt",
      title: "Edit time log",
      label: "Duration, then an optional note",
      placeholder: "25m what you did",
      initial: timeLogInput(log),
      onSubmit: (value) => {
        let parsed: ReturnType<typeof parseTimeLogInput>;
        try {
          parsed = parseTimeLogInput(value);
        } catch {
          return "Invalid duration — try 45m or 1h30m";
        }
        pushUndo(data.replaceTimeLog(task.id, log, parsed.duration, parsed.note));
        closeModal();
        reloadTasks();
        notify("Time log updated · u undo", "success");
      },
    });
  }, [closeModal, data, detailRow, notify, pushUndo, reloadTasks, selectedTask]);

  // The cursor is clamped where it is read, so the row after the deleted
  // one (or the last) ends up under it without bookkeeping here.
  const deleteDetailRow = useCallback(() => {
    const task = selectedTask;
    if (!task || !detailRow) return;
    if (detailRow.kind === "subtask") {
      const subtask = task.subtasks[detailRow.index];
      if (!subtask) return;
      undoableDelete(data.deleteSubtask(task.id, subtask), `Deleted step "${subtask.title}"`);
    } else if (detailRow.kind === "note") {
      const note = task.notes[detailRow.index];
      if (!note) return;
      undoableDelete(
        data.deleteTaskNote(task.id, note),
        `Deleted note “${excerptOf(note.body, 32)}”`,
      );
    } else {
      const log = task.timeLogs[detailRow.index];
      if (!log) return;
      undoableDelete(
        data.deleteTimeLog(task.id, log),
        `Deleted the ${formatDuration(log.duration)} log`,
      );
    }
    reloadTasks();
  }, [data, detailRow, reloadTasks, selectedTask, undoableDelete]);

  const addTaskNote = useCallback(() => {
    if (!selectedTask) return;
    const taskId = selectedTask.id;
    setModal({
      type: "prompt",
      title: "Add note",
      label: `Note for #${taskId}`,
      placeholder: "What happened?",
      multiline: true,
      onSubmit: (value) => {
        data.addTaskNote(taskId, value);
        closeModal();
        reloadTasks();
        notify("Note added", "success");
      },
    });
  }, [closeModal, data, notify, reloadTasks, selectedTask]);

  const logTime = useCallback(() => {
    if (!selectedTask) return;
    const taskId = selectedTask.id;
    setModal({
      type: "prompt",
      title: "Log time",
      label: "Duration, then an optional note",
      placeholder: "25m what you did",
      onSubmit: (value) => {
        let parsed: ReturnType<typeof parseTimeLogInput>;
        try {
          parsed = parseTimeLogInput(value);
        } catch {
          return "Invalid duration — try 45m or 1h30m";
        }
        data.logTime(taskId, parsed.duration, parsed.note);
        closeModal();
        reloadTasks();
        notify(`Logged ${value}`, "success");
      },
    });
  }, [closeModal, data, notify, reloadTasks, selectedTask]);

  // `a` always writes to today, which is what a morning without a note yet
  // needs; `A` keeps the selected day for catching up on the past.
  const addJournalEntry = useCallback(
    (day: "today" | "selected") => {
      const target = day === "selected" ? selectedNote : null;
      setModal({
        type: "prompt",
        title: "Journal entry",
        label: target
          ? `Entry for ${formatNoteTitle(cfg, target.date, GoTime.now())}`
          : "Entry for today",
        placeholder: "What is on your mind?",
        multiline: true,
        onSubmit: (value) => {
          const note = data.addJournalEntry(value, target?.date.format(DateOnly));
          selectedNoteDate.current = note.date.format(DateOnly);
          closeModal();
          reloadNotes();
          notify("Journal entry saved", "success");
        },
      });
    },
    [cfg, closeModal, data, notify, reloadNotes, selectedNote],
  );

  const editJournalEntry = useCallback(() => {
    const entry = selectedNote?.entries[entryCursor];
    if (!entry) return;
    setModal({
      type: "prompt",
      title: "Edit entry",
      label: "Entry text",
      initial: entry.body,
      multiline: true,
      onSubmit: (value) => {
        data.editJournalEntry(entry.id, value);
        closeModal();
        reloadNotes();
        notify("Entry updated", "success");
      },
    });
  }, [closeModal, data, entryCursor, notify, reloadNotes, selectedNote]);

  const deleteJournalEntry = useCallback(() => {
    const entry = selectedNote?.entries[entryCursor];
    if (!entry) return;
    undoableDelete(
      data.deleteJournalEntry(entry),
      `Deleted entry “${excerptOf(entry.body, 32)}”`,
    );
    reloadNotes();
  }, [data, entryCursor, reloadNotes, selectedNote, undoableDelete]);

  const undo = useCallback(() => {
    const [action, ...rest] = undoStack;
    if (!action) {
      notify("Nothing to undo", "info");
      return;
    }
    data.undo(action);
    // A restored task keeps its id, so the cursor can go back to it.
    if (action.kind === "task") selectedTaskId.current = action.task.id;
    setUndoStack(rest);
    reloadTasks();
    reloadNotes();
    notify("Undone", "success");
  }, [data, notify, reloadNotes, reloadTasks, undoStack]);

  const saveSettings = useCallback(
    (next: Config) => {
      data.cfg = next;
      setCfg(next);
      // The theme row applies immediately; "auto" falls back to the terminal.
      if (next.theme === "dark") setDark(true);
      else if (next.theme === "light") setDark(false);
      else setDark(isDark());
      closeModal();
      try {
        saveConfig(next);
        notify("Settings saved", "success");
      } catch (err) {
        notify(`Could not save settings: ${(err as Error).message}`, "error");
      }
    },
    [closeModal, data, notify],
  );

  // The path is offered, not imposed: a dated file under the data dir by
  // default, and an existing file is never overwritten — the export lands
  // next to it with a numbered name and the toast says so.
  const exportTo = useCallback(
    (format: "md" | "json", scope: "all" | "tasks") => {
      const suggested = join(
        configDir(),
        "exports",
        exportFileName(format, GoTime.now()),
      );
      setModal({
        type: "prompt",
        title: scope === "tasks" ? "Export tasks" : "Export everything",
        label: `File path (${format === "md" ? "Markdown" : "JSON"})`,
        initial: suggested,
        onSubmit: (value) => {
          const content =
            scope === "tasks"
              ? exportTasksContent(format, tasks)
              : exportContent(format, tasks, notes);
          try {
            mkdirSync(dirname(value), { recursive: true });
            const path = uniquePath(value, existsSync);
            writeFileSync(path, content, "utf8");
            closeModal();
            notify(
              path === value
                ? `Exported to ${path}`
                : `${basename(value)} exists · exported to ${path}`,
              "success",
            );
          } catch (err) {
            return `Export failed: ${(err as Error).message}`;
          }
        },
      });
    },
    [closeModal, notes, notify, tasks],
  );

  const persistConfig = useCallback(
    (next: Config, failure: string) => {
      data.cfg = next;
      setCfg(next);
      try {
        saveConfig(next);
      } catch (err) {
        notify(`${failure}: ${(err as Error).message}`, "error");
      }
    },
    [data, notify],
  );

  const toggleTheme = useCallback(() => {
    const next = !dark;
    setDark(next);
    persistConfig(
      { ...cfg, theme: next ? "dark" : "light" },
      "Could not save theme",
    );
  }, [cfg, dark, persistConfig]);

  // Both the keys and the drag fire in bursts; the ratio is written once
  // the user settles, and the same clamp keeps both panels usable.
  const ratioSave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyRatio = useCallback(
    (raw: number) => {
      const next = clampRatio(raw, width);
      setRatio(next);
      if (ratioSave.current) clearTimeout(ratioSave.current);
      ratioSave.current = setTimeout(() => {
        persistConfig(
          { ...cfg, panelRatio: Number(next.toFixed(2)) },
          "Could not save layout",
        );
      }, RATIO_SAVE_MS);
    },
    [cfg, persistConfig, width],
  );

  const resizePanels = useCallback(
    (delta: number) => applyRatio(ratio + delta),
    [applyRatio, ratio],
  );

  const applySort = useCallback(
    (next: SortKey) => {
      setSort(next);
      notify(sortToast(next, filters.query !== ""), "info");
    },
    [filters.query, notify],
  );

  const cycleSort = useCallback(() => {
    const order: SortKey[] = ["created", "due", "priority"];
    applySort(order[(order.indexOf(sort) + 1) % order.length]!);
  }, [applySort, sort]);

  const toggleDensity = useCallback(() => {
    const next = cycleDensity(density);
    setDensity(next);
    notify(`Density: ${next}`, "info");
  }, [density, notify]);

  const isJournalTab = tab === "journal";

  // The journal cannot see the selection, so a session started there is not
  // attached to a task the user never chose.
  const toggleFocus = useCallback(() => {
    pomodoro.toggle(isJournalTab ? 0 : (selectedTask?.id ?? 0));
    notify(focusStatusMessage(pomodoro.running, pomodoro.kind, cfg), "info");
  }, [cfg, isJournalTab, notify, pomodoro, selectedTask]);

  const requestQuit = useCallback(() => {
    if (!pomodoro.running) {
      onQuit?.();
      return;
    }
    setModal({
      type: "confirm",
      title: "Quit",
      message: "A focus session is running — quit and discard it?",
      confirmLabel: "Quit",
      onConfirm: () => {
        pomodoro.stop();
        onQuit?.();
      },
    });
  }, [onQuit, pomodoro]);

  const toggleHiddenNotes = useCallback(() => {
    const next = !showHidden;
    setShowHidden(next);
    setNotes(data.listNotes(next));
    notify(next ? "Showing hidden notes" : "Hiding hidden notes", "info");
  }, [data, notify, showHidden]);

  const toggleNoteHidden = useCallback(() => {
    if (!selectedNote) return;
    data.toggleNoteHidden(selectedNote.id);
    reloadNotes();
    notify(selectedNote.hidden ? "Note restored" : "Note hidden", "success");
  }, [data, notify, reloadNotes, selectedNote]);

  const openBlockPicker = useCallback(() => {
    if (!selectedTask) return;
    const target = selectedTask;
    const candidates = openFirst(
      tasks.filter(
        (t) => t.id !== target.id && !target.blockedByIds.includes(t.id),
      ),
    );
    if (candidates.length === 0) {
      notify("No other task to block on", "info");
      return;
    }
    setModal({
      type: "task-pick",
      title: "Block on",
      subtitle: `#${target.id} ${target.title}`,
      tasks: candidates,
      onPick: (blockerId) => {
        closeModal();
        try {
          data.addDependency(target.id, blockerId);
          notify(`#${target.id} now blocked by #${blockerId}`, "success");
        } catch (err) {
          notify((err as Error).message, "error");
        }
        reloadTasks();
      },
    });
  }, [closeModal, data, notify, reloadTasks, selectedTask, tasks]);

  const openUnblockPicker = useCallback(() => {
    if (!selectedTask) return;
    const target = selectedTask;
    const blockers = openFirst(
      tasks.filter((t) => target.blockedByIds.includes(t.id)),
    );
    if (blockers.length === 0) {
      notify("This task has no blockers", "info");
      return;
    }
    setModal({
      type: "task-pick",
      title: "Remove blocker",
      subtitle: `#${target.id} ${target.title}`,
      tasks: blockers,
      onPick: (blockerId) => {
        closeModal();
        data.removeDependency(target.id, blockerId);
        notify(`#${target.id} unblocked from #${blockerId}`, "success");
        reloadTasks();
      },
    });
  }, [closeModal, data, notify, reloadTasks, selectedTask, tasks]);

  const startSearch = useCallback(() => {
    // The filter bar lives in the list panel; typing into it from the
    // detail side would move an invisible cursor.
    setSearching(true);
    setPanel(0);
  }, []);

  const stopSearch = useCallback((keep: boolean) => {
    setSearching(false);
    if (!keep) setFilters((f) => ({ ...f, query: "" }));
  }, []);

  // -------------------------------------------------------------- palette

  const paletteActions = useMemo<PaletteAction[]>(() => {
    // Task actions act on the current selection; the journal cannot see it,
    // so they disappear there instead of mutating something invisible.
    const taskActions: PaletteAction[] =
      tab === "journal"
        ? []
        : [
            { id: "task.add", group: "Task", label: "New task", hint: "a", run: openAddTask },
            { id: "task.edit", group: "Task", label: "Edit selected task", hint: "e", run: openEditTask },
            { id: "task.done", group: "Task", label: "Mark done / reopen", hint: "space", run: () => toggleDone(selectedTask) },
            { id: "task.start", group: "Task", label: "Start / stop", hint: "s", run: () => toggleInProgress(selectedTask) },
            { id: "task.delete", group: "Task", label: "Delete selected task", hint: "d", run: deleteSelectedTask },
            { id: "task.priorityUp", group: "Task", label: "Priority up", hint: "+", run: () => stepPriorityBy(1) },
            { id: "task.priorityDown", group: "Task", label: "Priority down", hint: "-", run: () => stepPriorityBy(-1) },
            { id: "task.due", group: "Task", label: "Set due date", hint: "@", run: openDuePrompt },
            { id: "task.subtask", group: "Task", label: "Add subtask", hint: "t", run: addSubtask },
            { id: "task.note", group: "Task", label: "Add note", hint: "n", run: addTaskNote },
            { id: "task.time", group: "Task", label: "Log time", hint: "L", run: logTime },
            { id: "task.block", group: "Task", label: "Block on…", hint: "b", run: openBlockPicker },
            { id: "task.unblock", group: "Task", label: "Remove blocker…", hint: "B", run: openUnblockPicker },
            { id: "view.sort", group: "View", label: "Cycle sort order", hint: "o", run: cycleSort },
            { id: "view.tags", group: "View", label: "Toggle tag bar", hint: "#", run: () => setTagBar((v) => !v) },
          ];
    const actions: PaletteAction[] = [
      ...taskActions,
      { id: "journal.add", group: "Journal", label: "Add journal entry for today", hint: "a", run: () => addJournalEntry("today") },
      { id: "journal.addDay", group: "Journal", label: "Add entry to selected day", hint: "A", run: () => addJournalEntry("selected") },
      { id: "view.search", group: "View", label: "Filter", hint: "/", run: startSearch },
      { id: "view.density", group: "View", label: "Cycle row density", hint: "z", run: toggleDensity },
      { id: "view.widen", group: "View", label: "Widen task list", hint: ">", run: () => resizePanels(0.05) },
      { id: "view.narrow", group: "View", label: "Narrow task list", hint: "<", run: () => resizePanels(-0.05) },
      { id: "view.theme", group: "View", label: "Toggle light / dark", hint: "T", run: toggleTheme },
      { id: "view.stats", group: "View", label: "Show statistics", hint: "S", run: () => setModal({ type: "stats" }) },
      { id: "view.help", group: "View", label: "Show help", hint: "?", run: () => setModal({ type: "help" }) },
      { id: "focus.toggle", group: "Focus", label: "Start / stop focus timer", hint: "f", run: toggleFocus },
      { id: "app.undo", group: "App", label: "Undo", hint: "u", run: undo },
      { id: "app.settings", group: "App", label: "Settings", hint: "P", run: () => setModal({ type: "settings" }) },
      { id: "app.export.md", group: "App", label: "Export everything to Markdown", run: () => exportTo("md", "all") },
      { id: "app.export.json", group: "App", label: "Export everything to JSON", run: () => exportTo("json", "all") },
      { id: "app.export.tasks.md", group: "App", label: "Export tasks only to Markdown", run: () => exportTo("md", "tasks") },
      { id: "app.export.tasks.json", group: "App", label: "Export tasks only to JSON", run: () => exportTo("json", "tasks") },
      { id: "app.quit", group: "App", label: "Quit", hint: "q", run: requestQuit },
    ];
    for (const t of TABS) {
      actions.push({
        id: `view.tab.${t.id}`,
        group: "View",
        label: `Go to ${t.label}`,
        hint: t.key,
        run: () => setTab(t.id),
      });
    }
    return actions;
  }, [
    addJournalEntry,
    addSubtask,
    addTaskNote,
    cycleSort,
    deleteSelectedTask,
    exportTo,
    logTime,
    openAddTask,
    openBlockPicker,
    openDuePrompt,
    openEditTask,
    openUnblockPicker,
    requestQuit,
    resizePanels,
    selectedTask,
    startSearch,
    stepPriorityBy,
    tab,
    toggleDensity,
    toggleDone,
    toggleFocus,
    toggleInProgress,
    toggleTheme,
    undo,
  ]);

  // --------------------------------------------------------------- layout

  const compact = width < 72;
  const listWidth = compact ? width : listWidthFor(ratio, width);
  const dense = isDense(density, height);
  const isJournal = isJournalTab;
  const showTagBar = !isJournal && (tagBar || filters.tag !== null);
  const showSearchBar = searching || filters.query !== "";

  // ------------------------------------------------------------- keyboard

  const move = useCallback(
    (delta: number) => {
      if (tab === "journal") {
        if (panel === 0) selectNoteAt(noteIndex + delta);
        else setEntryIndex(clampIndex(entryCursor + delta, entryCount));
        return;
      }
      if (panel === 0) {
        setTaskIndex((i) => {
          const next = clampIndex(i + delta, shown.length);
          selectedTaskId.current = shown[next]?.id ?? null;
          return next;
        });
      } else {
        setDetailIndex(clampIndex(detailCursor + delta, rows.length));
      }
    },
    [
      detailCursor,
      entryCount,
      entryCursor,
      noteIndex,
      panel,
      rows.length,
      selectNoteAt,
      shown,
      tab,
    ],
  );

  // A page is what the focused panel can show; the list's rows vary with
  // density, while the other surfaces are read line by line.
  const listRowHeight = isOneLine(listWidth, dense)
    ? 1
    : 2 + (height < 30 ? 0 : 1);
  const listChrome =
    LIST_CHROME + (showTagBar ? 1 : 0) + (showSearchBar ? 1 : 0);
  const pageBy = useCallback(
    (direction: 1 | -1) => {
      if (tab !== "journal" && panel === 1) {
        const lines = pageSize(height, 1, DETAIL_CHROME);
        if (rows.length === 0) detailRef.current?.scrollBy(direction * lines);
        else move(direction * lines);
        return;
      }
      const rowHeight = tab === "journal" ? (panel === 0 ? 1 : 3) : listRowHeight;
      move(direction * pageSize(height, rowHeight, listChrome));
    },
    [height, listChrome, listRowHeight, move, panel, rows.length, tab],
  );

  useKeyboard((key: KeyEvent) => {
    // Quitting must work from anywhere, overlays included, and always ask
    // while a session runs; the confirm replaces whatever is open.
    if (key.ctrl && key.name === "c") {
      requestQuit();
      return;
    }
    if (modal.type !== "none") return;

    if (key.ctrl && key.name === "k") {
      setModal({ type: "palette" });
      return;
    }

    if (searching) {
      if (key.name === "escape") stopSearch(false);
      else if (key.name === "return") stopSearch(true);
      else if (key.name === "down") move(1);
      else if (key.name === "up") move(-1);
      return;
    }

    if (key.ctrl) {
      if (key.name === "u") pageBy(-1);
      else if (key.name === "d") pageBy(1);
      return;
    }

    switch (key.name) {
      case "q":
        requestQuit();
        return;
      case "tab":
        setTab((current) => {
          const idx = TABS.findIndex((t) => t.id === current);
          const next = (idx + (key.shift ? -1 : 1) + TABS.length) % TABS.length;
          return TABS[next]!.id;
        });
        return;
      case "1":
      case "2":
      case "3":
      case "4":
        setTab(TABS[Number(key.name) - 1]!.id);
        return;
      case "j":
      case "down":
        move(1);
        return;
      case "k":
      case "up":
        move(-1);
        return;
      case "g":
        if (key.shift) {
          move(Number.MAX_SAFE_INTEGER);
        } else {
          move(-Number.MAX_SAFE_INTEGER);
        }
        return;
      case "home":
        move(-Number.MAX_SAFE_INTEGER);
        return;
      case "end":
        move(Number.MAX_SAFE_INTEGER);
        return;
      case "pageup":
        pageBy(-1);
        return;
      case "pagedown":
        pageBy(1);
        return;
      case "left":
      case "h":
        // Shifted letters (H) belong to the sequence switch below.
        if (key.name === "h" && key.shift) break;
        setPanel(0);
        return;
      case "right":
      case "l":
        if (key.name === "l" && key.shift) break;
        setPanel(1);
        return;
      case "escape":
        // Leave the detail panel first; a second escape clears the filter.
        if (panel === 1) setPanel(0);
        else if (
          filters.query !== "" ||
          filters.tag !== null ||
          filters.view !== "all"
        ) {
          setFilters(emptyFilters);
        }
        return;
      case "return":
        // Enter opens the detail, then edits the row under its cursor;
        // toggling stays on space so a double enter cannot check a step.
        if (panel !== 1) setPanel(1);
        else if (tab === "journal") editJournalEntry();
        else editDetailRow();
        return;
      case "space":
        if (tab !== "journal") {
          if (panel === 1) toggleDetailRow();
          else toggleDone(selectedTask);
        }
        return;
      case "u":
        undo();
        return;
      case "f":
        toggleFocus();
        return;
      case "o":
        // The journal is date-ordered; sorting only means something for tasks.
        if (!isJournalTab) cycleSort();
        return;
      case "/":
        startSearch();
        return;
      case "f1":
        if (!isJournalTab) applySort("created");
        return;
      case "f2":
        if (!isJournalTab) applySort("due");
        return;
      case "f3":
        if (!isJournalTab) applySort("priority");
        return;
      default:
        break;
    }

    switch (key.sequence) {
      case "a":
        if (tab === "journal") addJournalEntry("today");
        else openAddTask();
        break;
      case "A":
        if (tab === "journal") addJournalEntry("selected");
        break;
      case "e":
        // Journal entries are only highlighted in their own panel, so the
        // day list never edits or deletes one blind.
        if (tab === "journal") {
          if (panel === 1) editJournalEntry();
        } else if (panel === 1) editDetailRow();
        else openEditTask();
        break;
      case "d":
        if (tab === "journal") {
          if (panel === 1) deleteJournalEntry();
        } else if (panel === 1) deleteDetailRow();
        else deleteSelectedTask();
        break;
      case "s":
        if (tab !== "journal") toggleInProgress(selectedTask);
        break;
      case "+":
        if (tab !== "journal") stepPriorityBy(1);
        break;
      case "-":
        if (tab !== "journal") stepPriorityBy(-1);
        break;
      case "@":
        if (tab !== "journal") openDuePrompt();
        break;
      case "t":
        if (tab !== "journal") addSubtask();
        break;
      case "n":
        if (tab !== "journal") addTaskNote();
        break;
      case "L":
        if (tab !== "journal") logTime();
        break;
      case "b":
        if (tab !== "journal") openBlockPicker();
        break;
      case "B":
        if (tab !== "journal") openUnblockPicker();
        break;
      case "x":
        if (tab === "journal") toggleNoteHidden();
        break;
      case "H":
        if (tab === "journal") toggleHiddenNotes();
        break;
      case "T":
        toggleTheme();
        break;
      case "P":
        setModal({ type: "settings" });
        break;
      case "<":
        resizePanels(-0.05);
        break;
      case ">":
        resizePanels(0.05);
        break;
      case "S":
        setModal({ type: "stats" });
        break;
      case "z":
        toggleDensity();
        break;
      case "?":
        setModal({ type: "help" });
        break;
      case "#":
        if (!isJournalTab) setTagBar((v) => !v);
        break;
      default:
        break;
    }
  });

  const focusTaskTitle = useMemo(
    () =>
      pomodoro.taskId
        ? tasks.find((t) => t.id === pomodoro.taskId)?.title
        : undefined,
    [pomodoro.taskId, tasks],
  );

  // Memoized so the header only reconciles when the session itself changes;
  // the per-second readout lives in a leaf inside it.
  const headerFocus = useMemo(
    () => ({
      endAt: pomodoro.endAt,
      durationMs: pomodoro.durationMs,
      label: pomodoro.label,
      color: pomodoro.kind === SessionKind.Work ? theme.warning : theme.success,
      task: focusTaskTitle,
      cycleDots: `${"●".repeat(pomodoro.cyclePos)}${"○".repeat(
        Math.max(cfg.focus.longBreakInterval - pomodoro.cyclePos, 0),
      )}`,
      nextLabel: pomodoro.nextLabel,
    }),
    [pomodoro, theme, focusTaskTitle, cfg.focus.longBreakInterval],
  );

  // The status bar is the discoverability surface: its keycaps run the same
  // callbacks the keys do, and its list follows the focused panel.
  const hintActions = useMemo<Record<HintAction, () => void>>(
    () => ({
      add: () => (isJournal ? addJournalEntry("today") : openAddTask()),
      addDay: () => addJournalEntry("selected"),
      edit: () =>
        isJournal
          ? editJournalEntry()
          : panel === 1
            ? editDetailRow()
            : openEditTask(),
      delete: () =>
        isJournal
          ? deleteJournalEntry()
          : panel === 1
            ? deleteDetailRow()
            : deleteSelectedTask(),
      done: () => toggleDone(selectedTask),
      start: () => toggleInProgress(selectedTask),
      due: openDuePrompt,
      toggle: toggleDetailRow,
      subtask: addSubtask,
      note: addTaskNote,
      time: logTime,
      filter: startSearch,
      focus: toggleFocus,
      block: openBlockPicker,
      back: () => setPanel(0),
      details: () => setPanel(1),
      hide: toggleNoteHidden,
      hidden: toggleHiddenNotes,
      keep: () => stopSearch(true),
      clear: () => stopSearch(false),
      palette: () => setModal({ type: "palette" }),
      help: () => setModal({ type: "help" }),
    }),
    [
      addJournalEntry,
      addSubtask,
      addTaskNote,
      deleteDetailRow,
      deleteJournalEntry,
      deleteSelectedTask,
      editDetailRow,
      editJournalEntry,
      isJournal,
      logTime,
      openAddTask,
      openBlockPicker,
      openDuePrompt,
      openEditTask,
      panel,
      selectedTask,
      startSearch,
      stopSearch,
      toggleDetailRow,
      toggleDone,
      toggleFocus,
      toggleHiddenNotes,
      toggleInProgress,
      toggleNoteHidden,
    ],
  );

  const hints = useMemo<Hint[]>(
    () =>
      hintSpecs({
        tab,
        panel,
        compact,
        searching,
        row: detailRow?.kind ?? null,
      }).map((h) => ({
        key: h.key,
        label: h.label,
        run: h.action ? hintActions[h.action] : undefined,
      })),
    [compact, detailRow?.kind, hintActions, panel, searching, tab],
  );

  const tabLabel = TABS.find((t) => t.id === tab)?.label ?? "Tasks";

  const finishedToday = useMemo(
    () => (tab === "done" ? doneToday(tasks, GoTime.now()) : 0),
    [tab, tasks],
  );

  let listSubtitle: string;
  if (isJournal) {
    listSubtitle =
      shownNotes.length === notes.length
        ? plural(notes.length, "day")
        : `${shownNotes.length} of ${notes.length}`;
  } else if (shown.length !== tabTotal) {
    listSubtitle = `${shown.length} of ${tabTotal}`;
  } else if (tab === "done") {
    listSubtitle = `${plural(tabTotal, "task")} · ${finishedToday} today`;
  } else {
    listSubtitle = plural(tabTotal, "task");
  }
  // In one column the other panel is off screen; say how to reach it.
  if (compact) listSubtitle += isJournal ? " · l entries" : " · l details";

  const detailTitle = isJournal
    ? selectedNote
      ? formatNoteTitle(cfg, selectedNote.date, GoTime.now())
      : "Entries"
    : "Details";

  // The panel footer carries the identity, so the body never repeats it.
  // Blockers may sit on another tab, so the set comes from every task.
  const blocked = useMemo(() => blockedIds(tasks), [tasks]);

  const detailSubtitle =
    !isJournal && selectedTask
      ? `#${selectedTask.id} · updated ${formatDateTime(cfg, selectedTask.updatedAt)}`
      : undefined;

  return (
    <box
      flexGrow={1}
      flexDirection="column"
      backgroundColor={theme.bg}
      width={width}
      height={height}
    >
      <Header
        theme={theme}
        activeTab={tab}
        counts={counts}
        onSelectTab={setTab}
        focus={headerFocus}
        compact={compact}
        width={width}
      />

      {/* An active tag filter keeps its bar, or the filter would be invisible
          once the bar is toggled away. */}
      {showTagBar ? (
        <TagBar
          theme={theme}
          tasks={tasks}
          activeTag={filters.tag}
          width={width}
          onSelect={(tag) => setFilters((f) => ({ ...f, tag }))}
        />
      ) : null}

      <box flexGrow={1} flexDirection="row" minHeight={0}>
        {compact && panel === 1 ? null : (
        <box width={compact ? undefined : listWidth} flexGrow={compact ? 1 : 0} flexDirection="column" minHeight={0}>
          <Panel
            theme={theme}
            title={tabLabel}
            subtitle={listSubtitle}
            focused={panel === 0}
            onMouseDown={() => setPanel(0)}
          >
            {/* An applied filter must stay visible after enter, so the bar
                sticks around while a query is active. */}
            {showSearchBar ? (
              <SearchBar
                theme={theme}
                value={filters.query}
                active={searching}
                onInput={(query) => setFilters((f) => ({ ...f, query }))}
                onSubmit={() => setSearching(false)}
                resultCount={isJournal ? shownNotes.length : shown.length}
                totalCount={isJournal ? notes.length : tabTotal}
              />
            ) : null}

            {isJournal ? (
              <NoteList
                theme={theme}
                cfg={cfg}
                notes={shownNotes}
                emptyText={
                  filters.query !== ""
                    ? "No entries match — esc clears the search"
                    : undefined
                }
                selected={noteIndex}
                focused={panel === 0}
                onSelect={(i) => {
                  selectNoteAt(i);
                  setPanel(0);
                }}
              />
            ) : (
              <TaskList
                theme={theme}
                cfg={cfg}
                tasks={shown}
                selected={taskIndex}
                focused={panel === 0}
                width={listWidth}
                height={height}
                dense={dense}
                // Due groups label finished tasks "overdue"; the Done tab
                // reads as a log, so it stays flat whatever the sort.
                sort={tab === "done" ? "created" : sort}
                now={GoTime.now()}
                blocked={blocked}
                marked={undefined}
                onSelect={selectTaskAt}
                onActivate={() => setPanel(0)}
                onToggleStatus={(index) => toggleDone(shown[index] ?? null)}
                emptyIcon={filters.query !== "" || filters.tag ? "⌕" : "✦"}
                emptyTitle={
                  filters.query !== "" || filters.tag
                    ? "No matches"
                    : "No tasks yet"
                }
                emptyHint={
                  filters.query !== "" || filters.tag
                    ? "Press esc to clear the filter"
                    : "Press a to create your first task"
                }
              />
            )}
          </Panel>
        </box>
        )}

        {compact ? null : (
          <PanelDivider theme={theme} onDrag={(x) => applyRatio(x / width)} />
        )}

        {compact && panel === 0 ? null : (
          <box flexGrow={1} flexDirection="column" minHeight={0}>
            <Panel
              theme={theme}
              title={detailTitle}
              subtitle={compact ? "h back" : detailSubtitle}
              focused={panel === 1}
              onMouseDown={() => setPanel(1)}
            >
              {isJournal ? (
                <EntryList
                  theme={theme}
                  cfg={cfg}
                  note={selectedNote}
                  selected={entryCursor}
                  focused={panel === 1}
                  onSelect={(i) => {
                    setEntryIndex(i);
                    setPanel(1);
                  }}
                />
              ) : (
                <TaskDetail
                  ref={detailRef}
                  theme={theme}
                  cfg={cfg}
                  task={selectedTask}
                  focused={panel === 1}
                  cursor={detailCursor}
                  onSelectRow={(i) => {
                    setDetailIndex(i);
                    setPanel(1);
                  }}
                  onToggleSubtask={toggleSubtaskAt}
                  blockedByTitles={taskTitles}
                />
              )}
            </Panel>
          </box>
        )}
      </box>

      <StatusBar
        theme={theme}
        hints={hints}
        message={toast?.message ?? null}
        messageKind={toast?.kind ?? "info"}
        messageId={toast?.id ?? 0}
        messageMs={toastDuration(toast?.kind ?? "info")}
        sort={isJournal ? undefined : sort}
        onCycleSort={isJournal ? undefined : cycleSort}
        width={width}
      />

      {modal.type === "task-form" ? (
        <TaskForm
          theme={theme}
          title={modal.title}
          initial={modal.initial}
          knownTags={collectTags(tasks).map((t) => t.tag)}
          screenWidth={width}
          screenHeight={height}
          onSubmit={(values) => submitTaskForm(values, modal.taskId)}
          onCancel={closeModal}
        />
      ) : null}

      {modal.type === "confirm" ? (
        <ConfirmDialog
          theme={theme}
          title={modal.title}
          message={modal.message}
          excerpt={modal.excerpt}
          detail={modal.detail}
          confirmLabel={modal.confirmLabel}
          screenWidth={width}
          screenHeight={height}
          onConfirm={modal.onConfirm}
          onCancel={closeModal}
        />
      ) : null}

      {modal.type === "prompt" ? (
        <PromptDialog
          theme={theme}
          title={modal.title}
          label={modal.label}
          placeholder={modal.placeholder}
          initial={modal.initial}
          multiline={modal.multiline}
          chips={modal.chips}
          stayOpen={modal.stayOpen}
          screenWidth={width}
          screenHeight={height}
          onSubmit={modal.onSubmit}
          onCancel={closeModal}
        />
      ) : null}

      {modal.type === "task-pick" ? (
        <TaskPickerDialog
          theme={theme}
          title={modal.title}
          subtitle={modal.subtitle}
          tasks={modal.tasks}
          screenWidth={width}
          screenHeight={height}
          onPick={modal.onPick}
          onClose={closeModal}
        />
      ) : null}

      {modal.type === "palette" ? (
        <CommandPalette
          theme={theme}
          actions={paletteActions}
          screenWidth={width}
          screenHeight={height}
          onClose={closeModal}
        />
      ) : null}

      {modal.type === "help" ? (
        <HelpOverlay
          theme={theme}
          screenWidth={width}
          screenHeight={height}
          onClose={closeModal}
        />
      ) : null}

      {modal.type === "settings" ? (
        <SettingsOverlay
          theme={theme}
          cfg={cfg}
          screenWidth={width}
          screenHeight={height}
          onSave={saveSettings}
          onCancel={closeModal}
        />
      ) : null}

      {modal.type === "stats" ? (
        <StatsOverlay
          theme={theme}
          tasks={tasks}
          completionsByDay={data.focus.completionsByDay(30)}
          todayFocus={data.focus.todayWorkCount()}
          focusGoal={cfg.focus.dailyGoal}
          streakDays={data.focus.streak()}
          screenWidth={width}
          screenHeight={height}
          onClose={closeModal}
        />
      ) : null}
    </box>
  );
}

/** Kept for callers that want the recurrence label without importing core. */
export const recurLabel = recurFreqString;
export const statusLabel = statusString;
export const oneMinute = Minute;
export const noRecurrence = RecurFreq.None;
export const doneStatus = Status.Done;
