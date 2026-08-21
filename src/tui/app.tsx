import { type KeyEvent } from "@opentui/core";
import {
  useKeyboard,
  useRenderer,
  useTerminalDimensions,
} from "@opentui/react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { parseDuration } from "../core/task/timelog.ts";
import { DateOnly, GoTime, parseDateOnly } from "../core/time.ts";
import { initTheme, isDark } from "../core/ui/colors.ts";
import type { RondoData, TaskDraft, UndoAction } from "./data.ts";
import { usePomodoro } from "./hooks/usePomodoro.ts";
import {
  SORT_LABELS,
  TABS,
  clampIndex,
  emptyFilters,
  tabCounts,
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
  type PaletteAction,
} from "./components/Dialogs.tsx";
import { TaskForm, emptyTaskForm, type TaskFormValues } from "./components/TaskForm.tsx";
import { SettingsOverlay } from "./components/Settings.tsx";
import { writeJSON, writeTasks } from "../core/export/export.ts";
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
  const due = values.due.trim();
  return {
    title: values.title.trim(),
    description: values.description.trim(),
    priority: values.priority,
    dueDate: due === "" ? null : parseDateOnly(due, "utc"),
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
  const [dark, setDark] = useState(isDark());
  const theme = useMemo(() => tuiTheme(dark), [dark]);

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

  const [tab, setTab] = useState<TabId>("all");
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
  const [clock, setClock] = useState(() => GoTime.now().format("15:04"));

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
    const id = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    const id = setInterval(() => setClock(GoTime.now().format("15:04")), 15_000);
    return () => clearInterval(id);
  }, []);

  const pomodoro = usePomodoro(data, cfg, (kind) => {
    notify(
      kind === SessionKind.Work ? "Focus session complete" : "Break over",
      "success",
    );
    if (cfg.focus.sound) process.stdout.write("\u0007"); // terminal bell
  });

  const shown = useMemo(
    () => visibleTasks(tasks, tab, filters, sort),
    [tasks, tab, filters, sort],
  );
  const counts = useMemo(() => tabCounts(tasks, notes.length), [tasks, notes]);

  const selectedTask = shown[clampIndex(taskIndex, shown.length)] ?? null;
  const selectedNote = notes[clampIndex(noteIndex, notes.length)] ?? null;

  const taskTitles = useMemo(
    () => new Map(tasks.map((t) => [t.id, `#${t.id} ${t.title}`])),
    [tasks],
  );

  useEffect(() => {
    setTaskIndex((i) => clampIndex(i, shown.length));
  }, [shown.length]);

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
      label: "Duration (1h30m, 45m, 2h)",
      placeholder: "25m",
      onSubmit: (value) => {
        try {
          const duration = parseDuration(value);
          data.logTime(taskId, duration, "");
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
      const content =
        format === "json"
          ? writeJSON(tasks, notes)
          : `${writeTasks(tasks)}`;
      try {
        writeFileSync(path, content, "utf8");
        notify(`Exported to ${path}`, "success");
      } catch (err) {
        notify(`Export failed: ${(err as Error).message}`, "error");
      }
    },
    [notes, notify, tasks],
  );

  const toggleTheme = useCallback(() => {
    const next = !dark;
    initTheme(next);
    setDark(next);
  }, [dark]);

  const cycleSort = useCallback(() => {
    const order: SortKey[] = ["created", "due", "priority"];
    const next = order[(order.indexOf(sort) + 1) % order.length]!;
    setSort(next);
    notify(`Sorted by ${SORT_LABELS[next].toLowerCase()}`, "info");
  }, [notify, sort]);

  const toggleFocus = useCallback(() => {
    pomodoro.toggle(selectedTask?.id ?? 0);
    notify(
      pomodoro.running ? "Focus stopped" : `Focus started (${cfg.focus.workDuration}m)`,
      "info",
    );
  }, [cfg, notify, pomodoro, selectedTask]);

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

  // -------------------------------------------------------------- palette

  const paletteActions = useMemo<PaletteAction[]>(() => {
    const actions: PaletteAction[] = [
      { id: "task.add", group: "Task", label: "New task", hint: "a", run: openAddTask },
      { id: "task.edit", group: "Task", label: "Edit selected task", hint: "e", run: openEditTask },
      { id: "task.status", group: "Task", label: "Cycle status", hint: "space", run: () => cycleStatus(selectedTask) },
      { id: "task.delete", group: "Task", label: "Delete selected task", hint: "d", run: deleteSelectedTask },
      { id: "task.subtask", group: "Task", label: "Add subtask", hint: "t", run: addSubtask },
      { id: "task.note", group: "Task", label: "Add note", hint: "n", run: addTaskNote },
      { id: "task.time", group: "Task", label: "Log time", hint: "L", run: logTime },
      { id: "journal.add", group: "Journal", label: "Add journal entry", hint: "a", run: addJournalEntry },
      { id: "view.sort", group: "View", label: "Cycle sort order", hint: "o", run: cycleSort },
      { id: "view.tags", group: "View", label: "Toggle tag bar", hint: "#", run: () => setTagBar((v) => !v) },
      { id: "view.search", group: "View", label: "Filter tasks", hint: "/", run: () => setSearching(true) },
      { id: "view.theme", group: "View", label: "Toggle light / dark", hint: "T", run: toggleTheme },
      { id: "view.stats", group: "View", label: "Show statistics", hint: "S", run: () => setModal({ type: "stats" }) },
      { id: "view.help", group: "View", label: "Show help", hint: "?", run: () => setModal({ type: "help" }) },
      { id: "focus.toggle", group: "Focus", label: "Start / stop focus timer", hint: "f", run: toggleFocus },
      { id: "app.undo", group: "App", label: "Undo last delete", hint: "u", run: undo },
      { id: "app.settings", group: "App", label: "Focus settings", hint: "P", run: () => setModal({ type: "settings" }) },
      { id: "app.export.md", group: "App", label: "Export everything to Markdown", run: () => exportAll("md") },
      { id: "app.export.json", group: "App", label: "Export everything to JSON", run: () => exportAll("json") },
      { id: "app.quit", group: "App", label: "Quit", hint: "q", run: () => onQuit?.() },
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
    onQuit,
    openAddTask,
    openEditTask,
    selectedTask,
    toggleFocus,
    toggleTheme,
    undo,
  ]);

  // ------------------------------------------------------------- keyboard

  const move = useCallback(
    (delta: number) => {
      if (tab === "journal") {
        if (panel === 0) {
          setNoteIndex((i) => clampIndex(i + delta, notes.length));
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
    [notes.length, panel, selectedNote, selectedTask, shown.length, tab],
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
        onQuit?.();
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
        if (key.name === "h" && tab === "journal") {
          toggleNoteHidden();
          return;
        }
        setPanel(0);
        return;
      case "right":
      case "l":
        setPanel(1);
        return;
      case "1":
        setPanel(0);
        return;
      case "2":
        setPanel(1);
        return;
      case "escape":
        if (filters.query !== "" || filters.tag) setFilters(emptyFilters);
        else setPanel(0);
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
        cycleSort();
        return;
      case "/":
        if (!isJournalTab) setSearching(true);
        return;
      case "f1":
        setSort("created");
        return;
      case "f2":
        setSort("due");
        return;
      case "f3":
        setSort("priority");
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
        setRatio((r) => Math.max(r - 0.05, 0.2));
        break;
      case ">":
        setRatio((r) => Math.min(r + 0.05, 0.8));
        break;
      case "S":
        setModal({ type: "stats" });
        break;
      case "?":
        setModal({ type: "help" });
        break;
      case "#":
        setTagBar((v) => !v);
        break;
      case "/":
        if (!isJournalTab) setSearching(true);
        break;
      default:
        break;
    }
  });

  // --------------------------------------------------------------- layout

  const compact = width < 72;
  const listWidth = compact
    ? width
    : Math.max(Math.round(width * ratio), 24);
  const isJournal = isJournalTab;

  const hints: [string, string][] = isJournal
    ? [
        ["a", "add"],
        ["e", "edit"],
        ["d", "delete"],
        ["h", "hide"],
        ["H", "hidden"],
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
    ? `${notes.length} days`
    : shown.length === tasks.length
      ? `${tasks.length} tasks`
      : `${shown.length} of ${tasks.length}`;

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
        timer={pomodoro.timer}
        timerLabel={pomodoro.label}
        timerRatio={pomodoro.progress}
        timerColor={
          pomodoro.kind === SessionKind.Work ? theme.warning : theme.success
        }
        cycleDots={`${"●".repeat(pomodoro.cyclePos)}${"○".repeat(
          Math.max(cfg.focus.longBreakInterval - pomodoro.cyclePos, 0),
        )}`}
        clock={clock}
        compact={compact}
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
            {searching && !isJournal ? (
              <SearchBar
                theme={theme}
                value={filters.query}
                active={searching}
                onInput={(query) => setFilters((f) => ({ ...f, query }))}
                onSubmit={() => setSearching(false)}
                resultCount={shown.length}
                totalCount={tasks.length}
              />
            ) : null}

            {isJournal ? (
              <NoteList
                theme={theme}
                cfg={cfg}
                notes={notes}
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
              const next = Math.min(Math.max(event.x / width, 0.2), 0.8);
              setRatio(next);
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
                  subtaskIndex={subtaskIndex}
                  onSelectSubtask={(i) => {
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
        sort={sort}
        width={width}
      />

      {modal.type === "task-form" ? (
        <TaskForm
          theme={theme}
          title={modal.title}
          initial={modal.initial}
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
