import { type KeyEvent } from "@opentui/core";
import {
  useKeyboard,
  useRenderer,
  useTerminalDimensions,
} from "@opentui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  formatDateTime,
  formatNoteTitle,
  save as saveConfig,
  type Config,
} from "../core/config/config.ts";
import { Minute } from "../core/duration.ts";
import { SessionKind } from "../core/focus/focus.ts";
import type { Note } from "../core/journal/journal.ts";
import { RecurFreq, recurFreqString } from "../core/task/recur.ts";
import { Status, statusString, type Task } from "../core/task/task.ts";
import { formatDuration } from "../core/task/timelog.ts";
import { DateOnly, GoTime } from "../core/time.ts";
import { initTheme, isDark } from "../core/ui/colors.ts";
import type { RondoData, TaskDraft, UndoAction } from "./data.ts";
import { usePomodoro } from "./hooks/usePomodoro.ts";
import {
  SORT_LABELS,
  TABS,
  clampIndex,
  collectTags,
  emptyFilters,
  exportContent,
  focusStatusMessage,
  parseDueInput,
  parseTimeLogInput,
  tabCounts,
  toastDuration,
  visibleNotes,
  visibleTasks,
  type Filters,
  type SortKey,
  type TabId,
} from "./state.ts";
import { tuiTheme } from "./theme.ts";
import { Header } from "./components/Header.tsx";
import { EntryList, NoteList } from "./components/JournalPanel.tsx";
import {
  HelpOverlay,
  Panel,
  SearchBar,
  StatsOverlay,
  StatusBar,
  TagBar,
} from "./components/Panels.tsx";
import { TaskDetail } from "./components/TaskDetail.tsx";
import { TaskList } from "./components/TaskList.tsx";
import {
  CommandPalette,
  ConfirmDialog,
  PromptDialog,
  TaskPickerDialog,
  type PaletteAction,
} from "./components/Dialogs.tsx";
import { TaskForm, emptyTaskForm, type TaskFormValues } from "./components/TaskForm.tsx";
import { SettingsOverlay } from "./components/Settings.tsx";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

type Modal =
  | { type: "none" }
  | { type: "task-form"; title: string; initial: TaskFormValues; taskId: number | null }
  | {
      type: "confirm";
      title: string;
      message: string;
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
      onSubmit: (value: string) => void;
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
  kind: "info" | "success" | "error";
}

export interface AppProps {
  data: RondoData;
  onQuit?: () => void;
}

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
  const [subtaskIndex, setSubtaskIndex] = useState(0);
  const [noteIndex, setNoteIndex] = useState(0);
  const [entryIndex, setEntryIndex] = useState(0);

  const [sort, setSort] = useState<SortKey>("created");
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [searching, setSearching] = useState(false);
  const [tagBar, setTagBar] = useState(false);
  const [ratio, setRatio] = useState(cfg.panelRatio);

  const [modal, setModal] = useState<Modal>({ type: "none" });
  const [toast, setToast] = useState<Toast | null>(null);
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);

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

  const taskTitles = useMemo(
    () => new Map(tasks.map((t) => [t.id, `#${t.id} ${t.title}`])),
    [tasks],
  );

  useEffect(() => {
    setTaskIndex((i) => clampIndex(i, shown.length));
  }, [shown.length]);

  useEffect(() => {
    setNoteIndex((i) => clampIndex(i, shownNotes.length));
  }, [shownNotes.length]);

  useEffect(() => {
    setSubtaskIndex(0);
  }, [selectedTask?.id]);

  const closeModal = useCallback(() => setModal({ type: "none" }), []);

  // ---------------------------------------------------------------- actions

  const openAddTask = useCallback(() => {
    setModal({
      type: "task-form",
      title: "New task",
      initial: emptyTaskForm,
      taskId: null,
    });
  }, []);

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

  const cycleStatus = useCallback(
    (task: Task | null) => {
      if (!task) return;
      const next = data.cycleStatus(task);
      reloadTasks();
      notify(`#${task.id} → ${statusString(next)}`, "success");
    },
    [data, notify, reloadTasks],
  );

  const pushUndo = useCallback((action: UndoAction) => {
    setUndoStack((stack) => [action, ...stack].slice(0, 20));
  }, []);

  const deleteSelectedTask = useCallback(() => {
    if (!selectedTask) return;
    const blocked = data.blockedBy(selectedTask);
    setModal({
      type: "confirm",
      title: "Delete task",
      message: `Delete "${selectedTask.title}"?`,
      detail:
        blocked.length > 0
          ? `It blocks ${blocked.map((id) => `#${id}`).join(", ")} — they will be unblocked.`
          : undefined,
      onConfirm: () => {
        const action = data.deleteTask(selectedTask);
        pushUndo(action);
        closeModal();
        reloadTasks();
        notify(`${action.label} · press u to undo`, "success");
      },
    });
  }, [closeModal, data, notify, pushUndo, reloadTasks, selectedTask]);

  const addSubtask = useCallback(() => {
    if (!selectedTask) return;
    const taskId = selectedTask.id;
    setModal({
      type: "prompt",
      title: "New subtask",
      label: `Subtask for #${taskId}`,
      placeholder: "Step description",
      onSubmit: (value) => {
        data.addSubtask(taskId, value);
        closeModal();
        reloadTasks();
        notify("Subtask added", "success");
      },
    });
  }, [closeModal, data, notify, reloadTasks, selectedTask]);

  const toggleSubtaskAt = useCallback(
    (index: number) => {
      const subtask = selectedTask?.subtasks[index];
      if (!subtask) return;
      data.toggleSubtask(subtask.id);
      reloadTasks();
    },
    [data, reloadTasks, selectedTask],
  );

  const editSubtask = useCallback(() => {
    const subtask = selectedTask?.subtasks[subtaskIndex];
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
  }, [closeModal, data, notify, reloadTasks, selectedTask, subtaskIndex]);

  const deleteSubtask = useCallback(() => {
    const task = selectedTask;
    const subtask = task?.subtasks[subtaskIndex];
    if (!task || !subtask) return;
    setModal({
      type: "confirm",
      title: "Delete subtask",
      message: `Delete "${subtask.title}"?`,
      onConfirm: () => {
        pushUndo(data.deleteSubtask(task.id, subtask));
        closeModal();
        reloadTasks();
        notify("Subtask deleted · press u to undo", "success");
      },
    });
  }, [closeModal, data, notify, pushUndo, reloadTasks, selectedTask, subtaskIndex]);

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
        try {
          const { duration, note } = parseTimeLogInput(value);
          data.logTime(taskId, duration, note);
          closeModal();
          reloadTasks();
          notify(`Logged ${value}`, "success");
        } catch {
          notify("Invalid duration — try 45m or 1h30m", "error");
        }
      },
    });
  }, [closeModal, data, notify, reloadTasks, selectedTask]);

  const addJournalEntry = useCallback(() => {
    const target = selectedNote;
    setModal({
      type: "prompt",
      title: "Journal entry",
      label: target
        ? `Entry for ${formatNoteTitle(cfg, target.date, GoTime.now())}`
        : "Entry for today",
      placeholder: "What is on your mind?",
      multiline: true,
      onSubmit: (value) => {
        data.addJournalEntry(value, target?.date.format(DateOnly));
        closeModal();
        reloadNotes();
        notify("Journal entry saved", "success");
      },
    });
  }, [cfg, closeModal, data, notify, reloadNotes, selectedNote]);

  const editJournalEntry = useCallback(() => {
    const entry = selectedNote?.entries[entryIndex];
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
  }, [closeModal, data, entryIndex, notify, reloadNotes, selectedNote]);

  const deleteJournalEntry = useCallback(() => {
    const entry = selectedNote?.entries[entryIndex];
    if (!entry) return;
    setModal({
      type: "confirm",
      title: "Delete entry",
      message: "Delete this journal entry?",
      onConfirm: () => {
        pushUndo(data.deleteJournalEntry(entry));
        closeModal();
        reloadNotes();
        notify("Entry deleted · press u to undo", "success");
      },
    });
  }, [closeModal, data, entryIndex, notify, pushUndo, reloadNotes, selectedNote]);

  const undo = useCallback(() => {
    const [action, ...rest] = undoStack;
    if (!action) {
      notify("Nothing to undo", "info");
      return;
    }
    data.undo(action);
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

  const exportAll = useCallback(
    (format: "md" | "json") => {
      const path = join(
        process.env.RONDO_HOME ?? process.cwd(),
        `rondo-export.${format}`,
      );
      const content = exportContent(format, tasks, notes);
      try {
        writeFileSync(path, content, "utf8");
        notify(`Exported to ${path}`, "success");
      } catch (err) {
        notify(`Export failed: ${(err as Error).message}`, "error");
      }
    },
    [notes, notify, tasks],
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

  const resizePanels = useCallback(
    (delta: number) => {
      const next = Math.min(Math.max(ratio + delta, 0.2), 0.8);
      setRatio(next);
      persistConfig(
        { ...cfg, panelRatio: Number(next.toFixed(2)) },
        "Could not save layout",
      );
    },
    [cfg, persistConfig, ratio],
  );

  // Dragging fires continuously; write the ratio once the mouse settles.
  const dragSave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragPanels = useCallback(
    (next: number) => {
      setRatio(next);
      if (dragSave.current) clearTimeout(dragSave.current);
      dragSave.current = setTimeout(() => {
        persistConfig(
          { ...cfg, panelRatio: Number(next.toFixed(2)) },
          "Could not save layout",
        );
      }, 400);
    },
    [cfg, persistConfig],
  );

  const cycleSort = useCallback(() => {
    const order: SortKey[] = ["created", "due", "priority"];
    const next = order[(order.indexOf(sort) + 1) % order.length]!;
    setSort(next);
    notify(`Sorted by ${SORT_LABELS[next].toLowerCase()}`, "info");
  }, [notify, sort]);

  const toggleFocus = useCallback(() => {
    pomodoro.toggle(selectedTask?.id ?? 0);
    notify(focusStatusMessage(pomodoro.running, pomodoro.kind, cfg), "info");
  }, [cfg, notify, pomodoro, selectedTask]);

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
    const candidates = tasks.filter(
      (t) => t.id !== target.id && !target.blockedByIds.includes(t.id),
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
    const blockers = tasks.filter((t) => target.blockedByIds.includes(t.id));
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
            { id: "task.status", group: "Task", label: "Cycle status", hint: "space", run: () => cycleStatus(selectedTask) },
            { id: "task.delete", group: "Task", label: "Delete selected task", hint: "d", run: deleteSelectedTask },
            { id: "task.subtask", group: "Task", label: "Add subtask", hint: "t", run: addSubtask },
            { id: "task.note", group: "Task", label: "Add note", hint: "n", run: addTaskNote },
            { id: "task.time", group: "Task", label: "Log time", hint: "L", run: logTime },
            { id: "task.block", group: "Task", label: "Block on…", run: openBlockPicker },
            { id: "task.unblock", group: "Task", label: "Remove blocker…", run: openUnblockPicker },
            { id: "view.sort", group: "View", label: "Cycle sort order", hint: "o", run: cycleSort },
            { id: "view.tags", group: "View", label: "Toggle tag bar", hint: "#", run: () => setTagBar((v) => !v) },
          ];
    const actions: PaletteAction[] = [
      ...taskActions,
      { id: "journal.add", group: "Journal", label: "Add journal entry", hint: "a", run: addJournalEntry },
      { id: "view.search", group: "View", label: "Filter", hint: "/", run: () => setSearching(true) },
      { id: "view.theme", group: "View", label: "Toggle light / dark", hint: "T", run: toggleTheme },
      { id: "view.stats", group: "View", label: "Show statistics", hint: "S", run: () => setModal({ type: "stats" }) },
      { id: "view.help", group: "View", label: "Show help", hint: "?", run: () => setModal({ type: "help" }) },
      { id: "focus.toggle", group: "Focus", label: "Start / stop focus timer", hint: "f", run: toggleFocus },
      { id: "app.undo", group: "App", label: "Undo last delete", hint: "u", run: undo },
      { id: "app.settings", group: "App", label: "Settings", hint: "P", run: () => setModal({ type: "settings" }) },
      { id: "app.export.md", group: "App", label: "Export everything to Markdown", run: () => exportAll("md") },
      { id: "app.export.json", group: "App", label: "Export everything to JSON", run: () => exportAll("json") },
      { id: "app.quit", group: "App", label: "Quit", hint: "q", run: requestQuit },
    ];
    for (const t of TABS) {
      actions.push({
        id: `view.tab.${t.id}`,
        group: "View",
        label: `Go to ${t.label}`,
        run: () => setTab(t.id),
      });
    }
    return actions;
  }, [
    addJournalEntry,
    addSubtask,
    exportAll,
    addTaskNote,
    cycleSort,
    cycleStatus,
    deleteSelectedTask,
    logTime,
    openAddTask,
    openBlockPicker,
    openEditTask,
    openUnblockPicker,
    requestQuit,
    selectedTask,
    tab,
    toggleFocus,
    toggleTheme,
    undo,
  ]);

  // ------------------------------------------------------------- keyboard

  const move = useCallback(
    (delta: number) => {
      if (tab === "journal") {
        if (panel === 0) {
          setNoteIndex((i) => clampIndex(i + delta, shownNotes.length));
          setEntryIndex(0);
        } else {
          setEntryIndex((i) =>
            clampIndex(i + delta, selectedNote?.entries.length ?? 0),
          );
        }
        return;
      }
      if (panel === 0) {
        setTaskIndex((i) => clampIndex(i + delta, shown.length));
      } else {
        setSubtaskIndex((i) =>
          clampIndex(i + delta, selectedTask?.subtasks.length ?? 0),
        );
      }
    },
    [panel, selectedNote, selectedTask, shown.length, shownNotes.length, tab],
  );

  const isJournalTab = tab === "journal";

  useKeyboard((key: KeyEvent) => {
    if (modal.type !== "none") return;

    if (searching) {
      if (key.name === "escape") {
        setSearching(false);
        setFilters((f) => ({ ...f, query: "" }));
      } else if (key.name === "return") {
        setSearching(false);
      } else if (key.name === "down") {
        move(1);
      } else if (key.name === "up") {
        move(-1);
      }
      return;
    }

    if (key.ctrl && key.name === "k") {
      setModal({ type: "palette" });
      return;
    }
    if (key.ctrl && key.name === "c") {
      onQuit?.();
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
      case "1":
        setPanel(0);
        return;
      case "2":
        setPanel(1);
        return;
      case "escape":
        // Leave the detail panel first; a second escape clears the filter.
        if (panel === 1) setPanel(0);
        else if (filters.query !== "" || filters.tag) setFilters(emptyFilters);
        return;
      case "return":
        if (tab !== "journal" && panel === 1) toggleSubtaskAt(subtaskIndex);
        else setPanel(1);
        return;
      case "space":
        if (tab !== "journal") {
          if (panel === 1) toggleSubtaskAt(subtaskIndex);
          else cycleStatus(selectedTask);
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
        setSearching(true);
        return;
      case "f1":
        if (!isJournalTab) setSort("created");
        return;
      case "f2":
        if (!isJournalTab) setSort("due");
        return;
      case "f3":
        if (!isJournalTab) setSort("priority");
        return;
      default:
        break;
    }

    switch (key.sequence) {
      case "a":
        if (tab === "journal") addJournalEntry();
        else openAddTask();
        break;
      case "e":
        if (tab === "journal") editJournalEntry();
        else if (panel === 1) editSubtask();
        else openEditTask();
        break;
      case "d":
        if (tab === "journal") deleteJournalEntry();
        else if (panel === 1) deleteSubtask();
        else deleteSelectedTask();
        break;
      case "s":
        if (tab !== "journal") cycleStatus(selectedTask);
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

  // --------------------------------------------------------------- layout

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

  const compact = width < 72;
  const listWidth = compact
    ? width
    : Math.max(Math.round(width * ratio), 24);
  const isJournal = isJournalTab;

  // The status bar is the discoverability surface; keep it in step with
  // whatever the focused panel actually answers to.
  const hints: [string, string][] = isJournal
    ? [
        ["a", "add"],
        ["e", "edit"],
        ["d", "delete"],
        ["/", "search"],
        ["x", "hide"],
        ["H", "hidden"],
        ["^k", "palette"],
        ["?", "help"],
      ]
    : panel === 1
      ? [
          ["space", "toggle"],
          ["e", "edit"],
          ["d", "delete"],
          ["t", "add step"],
          ["h", "back"],
          ["^k", "palette"],
          ["?", "help"],
        ]
      : [
          ["a", "add"],
          ["e", "edit"],
          ["space", "status"],
          ["t", "subtask"],
          ["/", "filter"],
          ["f", "focus"],
          ["^k", "palette"],
          ["?", "help"],
        ];

  const listSubtitle = isJournal
    ? shownNotes.length === notes.length
      ? `${notes.length} days`
      : `${shownNotes.length} of ${notes.length}`
    : shown.length === tabTotal
      ? `${tabTotal} tasks`
      : `${shown.length} of ${tabTotal}`;

  const detailTitle = isJournal
    ? selectedNote
      ? formatNoteTitle(cfg, selectedNote.date, GoTime.now())
      : "Entries"
    : "Details";

  // The panel footer carries the identity, so the body never repeats it.
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

      {tagBar && !isJournal ? (
        <TagBar
          theme={theme}
          tasks={tasks}
          activeTag={filters.tag}
          onSelect={(tag) => setFilters((f) => ({ ...f, tag }))}
        />
      ) : null}

      <box flexGrow={1} flexDirection="row">
        {compact && panel === 1 ? null : (
        <box width={compact ? undefined : listWidth} flexGrow={compact ? 1 : 0} flexDirection="column">
          <Panel
            theme={theme}
            title={isJournal ? "Journal" : "Tasks"}
            subtitle={listSubtitle}
            focused={panel === 0}
            onMouseDown={() => setPanel(0)}
          >
            {/* An applied filter must stay visible after enter, so the bar
                sticks around while a query is active. */}
            {searching || filters.query !== "" ? (
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
                  setNoteIndex(i);
                  setEntryIndex(0);
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
                onSelect={setTaskIndex}
                onActivate={() => setPanel(0)}
                onToggleStatus={(index) => cycleStatus(shown[index] ?? null)}
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
          <box
            width={1}
            backgroundColor={theme.bg}
            onMouseDrag={(event) => {
              dragPanels(Math.min(Math.max(event.x / width, 0.2), 0.8));
            }}
          />
        )}

        {compact && panel === 0 ? null : (
          <box flexGrow={1} flexDirection="column">
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
                  selected={entryIndex}
                  focused={panel === 1}
                  onSelect={(i) => {
                    setEntryIndex(i);
                    setPanel(1);
                  }}
                />
              ) : (
                <TaskDetail
                  theme={theme}
                  cfg={cfg}
                  task={selectedTask}
                  focused={panel === 1}
                  cursor={subtaskIndex}
                  onSelectRow={(i) => {
                    setSubtaskIndex(i);
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
