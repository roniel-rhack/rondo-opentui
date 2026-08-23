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
import { useClock } from "./hooks/useClock.ts";
import { usePomodoro } from "./hooks/usePomodoro.ts";
import {
  useRestoredSession,
  useSessionSave,
} from "./hooks/useSessionState.ts";
import { useTaskData } from "./hooks/useTaskData.ts";
import { useToast } from "./hooks/useToast.ts";
import { useUndo } from "./hooks/useUndo.ts";
import { buildPaletteActions } from "./palette.ts";
import {
  DUE_CHIPS,
  TABS,
  blockedIds,
  bulkToast,
  clampIndex,
  clampRatio,
  collectTags,
  cycleDensity,
  cycleTag,
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
  isOneLine,
  listWidthFor,
  nextView,
  openFirst,
  pageSize,
  parseDueInput,
  parseFilterQuery,
  parseTimeLogInput,
  plural,
  restoredTag,
  rowGap,
  sortToast,
  statusToast,
  stepPriority,
  tabCounts,
  timeLogInput,
  toastDuration,
  toggleInSet,
  uniquePath,
  viewSubtitle,
  viewToast,
  visibleNotes,
  visibleTasks,
  type Filters,
  type Hint,
  type HintAction,
  type SortKey,
  type TabId,
  type ToastKind,
  type View,
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
import { TaskList } from "./components/TaskList.tsx";
import {
  CommandPalette,
  ConfirmDialog,
  PromptDialog,
  TagPickerDialog,
  TaskPickerDialog,
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
  | { type: "tag-pick" }
  | { type: "palette" }
  | { type: "help" }
  | { type: "stats"; snapshot: StatsSnapshot }
  | { type: "settings" };

/** Focus figures read once when the overlay opens, not on every render. */
interface StatsSnapshot {
  completionsByDay: Record<string, number>;
  todayFocus: number;
  streakDays: number;
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

/** Inline prompt error for a task that disappeared while its dialog was open;
 * the change poll can delete it from under one. */
function gone(taskId: number): string {
  return `Task #${taskId} no longer exists`;
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

  const { toast, notify } = useToast();
  const {
    tasks,
    notes,
    showHidden,
    setShowHidden,
    reloadTasks,
    reloadNotes,
    reloadAll,
    refreshTasks,
  } = useTaskData(data, notify);

  const restored = useRestoredSession();

  const [tab, setTab] = useState<TabId>(restored.tab);
  const [panel, setPanel] = useState<0 | 1>(0);
  const [taskIndex, setTaskIndex] = useState(0);
  // The detail cursor belongs to the task it was moved in, so another task
  // starts at its first row without an effect firing a second commit per
  // selection change.
  const [detailAt, setDetailAt] = useState<{
    taskId: number | null;
    index: number;
  }>({ taskId: null, index: 0 });
  const [noteIndex, setNoteIndex] = useState(0);
  const [entryIndex, setEntryIndex] = useState(0);
  // The selection is remembered by identity, not row number: a re-sort, a
  // filter, a create or a reload looks the task (or the day) up again.
  const selectedTaskId = useRef<number | null>(restored.selectedTaskId);
  const selectedNoteDate = useRef<string | null>(restored.selectedNoteDate);

  const [sort, setSort] = useState<SortKey>(restored.sort);
  const [filters, setFilters] = useState<Filters>(() => ({
    ...emptyFilters,
    tag: restoredTag(restored.tag, tasks),
    view: restored.view,
  }));
  const [searching, setSearching] = useState(false);
  const [tagBar, setTagBar] = useState(restored.tagBar);
  const [ratio, setRatio] = useState(cfg.panelRatio);
  const [density, setDensity] = useState<Density>(restored.density);
  const [marked, setMarked] = useState<ReadonlySet<number>>(() => new Set());
  // Mirrored in a ref for the same reason the undo stack is: a run of `m`
  // presses arrives in one stdin chunk, before React commits any of them.
  const markedRef = useRef<ReadonlySet<number>>(marked);
  // Coarse clock: due labels and groups only care about the calendar day.
  const now = useClock();

  const [modal, setModal] = useState<Modal>({ type: "none" });
  const detailRef = useRef<TaskDetailHandle | null>(null);

  // A restored task keeps its id, so the cursor goes back to where it was.
  const restoreCursor = useCallback((taskId: number) => {
    selectedTaskId.current = taskId;
  }, []);
  const { pushUndo, undo } = useUndo(data, notify, reloadAll, restoreCursor);

  const pomodoro = usePomodoro(data, cfg, (kind, taskId) => {
    if (kind !== SessionKind.Work) {
      notify("Break over", "success");
    } else if (taskId > 0) {
      // The app already measured the time; the task should not have to wait
      // for the user to type it in again.
      const duration = cfg.focus.workDuration * Minute;
      if (data.logTime(taskId, duration, "focus session")) {
        refreshTasks([taskId]);
        notify(
          `Focus complete · ${formatDuration(duration)} logged to #${taskId}`,
          "success",
        );
      } else {
        notify("Focus session complete", "success");
      }
    } else {
      notify("Focus session complete", "success");
    }
    if (cfg.focus.sound) process.stdout.write("\u0007"); // terminal bell
  });

  const shown = useMemo(
    () => visibleTasks(tasks, tab, filters, sort, now),
    [tasks, tab, filters, sort, now],
  );
  // Baseline for "N of M" and search counters: the tab without any filter.
  const tabTotal = useMemo(
    () => visibleTasks(tasks, tab, emptyFilters, sort, now).length,
    [tasks, tab, sort, now],
  );
  const knownTags = useMemo(() => collectTags(tasks), [tasks]);
  const tagNames = useMemo(() => knownTags.map((t) => t.tag), [knownTags]);
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
  const detailIndex =
    detailAt.taskId === (selectedTask?.id ?? null) ? detailAt.index : 0;
  const detailCursor = clampIndex(detailIndex, rows.length);
  const detailRow = rows[detailCursor];
  const entryCount = selectedNote?.entries.length ?? 0;
  const entryCursor = clampIndex(entryIndex, entryCount);

  const taskTitles = useMemo(
    () => new Map(tasks.map((t) => [t.id, `#${t.id} ${t.title}`])),
    [tasks],
  );

  // The cursor row keeps the id it was moved in, so a stale index cannot
  // point the detail panel at the wrong task's rows.
  const setDetailIndex = useCallback((index: number) => {
    setDetailAt({ taskId: selectedTaskId.current, index });
  }, []);

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

  // An empty list leaves the remembered identity alone: the tab or filter
  // that shows nothing is usually a detour, and the cursor comes back to the
  // same row afterwards.
  useEffect(() => {
    setTaskIndex((i) => {
      const next = indexOfId(shown, selectedTaskId.current, i);
      const id = shown[next]?.id;
      if (id !== undefined) selectedTaskId.current = id;
      return next;
    });
  }, [shown]);

  useEffect(() => {
    setNoteIndex((i) => {
      const next = indexOfNoteDate(shownNotes, selectedNoteDate.current, i);
      const date = shownNotes[next]?.date.format(DateOnly);
      if (date !== undefined) selectedNoteDate.current = date;
      return next;
    });
  }, [shownNotes]);

  const selectTaskAt = useCallback(
    (index: number) => {
      const i = clampIndex(index, shown.length);
      const id = shown[i]?.id;
      if (id !== undefined) selectedTaskId.current = id;
      setTaskIndex(i);
    },
    [shown],
  );

  const selectNoteAt = useCallback(
    (index: number) => {
      const i = clampIndex(index, shownNotes.length);
      const next = shownNotes[i]?.date.format(DateOnly);
      if (next !== undefined && next !== selectedNoteDate.current) {
        selectedNoteDate.current = next;
        setEntryIndex(0);
      }
      setNoteIndex(i);
    },
    [shownNotes],
  );

  const closeModal = useCallback(() => setModal({ type: "none" }), []);

  // An empty list keeps the last identity rather than saving "nothing".
  const flushState = useSessionSave({
    tab,
    sort,
    tagBar,
    tag: filters.tag,
    view: filters.view,
    selectedTaskId: selectedTask?.id ?? selectedTaskId.current,
    selectedNoteDate:
      selectedNote?.date.format(DateOnly) ?? selectedNoteDate.current,
    density,
  });

  // --------------------------------------------------------------- layout

  const isJournal = tab === "journal";
  const compact = width < 72;
  const listWidth = compact ? width : listWidthFor(ratio, width);
  // Density reads the list's width as well as the height: a wide list fits
  // the metadata beside the title instead of half-filling a second line.
  const dense = isDense(density, height, listWidth);
  const listGap = rowGap(density, height);
  const showTagBar = !isJournal && (tagBar || filters.tag !== null);
  const showSearchBar = searching || filters.query !== "";

  // ---------------------------------------------------------------- actions

  const openAddTask = useCallback(() => {
    // A task created inside a filter belongs to it, or it would vanish from
    // the list the moment it is saved. Both filter paths seed it: the tag
    // picker and a #tag typed into the query.
    const parsed = parseFilterQuery(filters.query);
    const tags = [...new Set([filters.tag, ...parsed.tags])].filter(
      (t): t is string => t !== null && t !== "",
    );
    setModal({
      type: "task-form",
      title: "New task",
      initial: {
        ...emptyTaskForm,
        tags: tags.join(", "),
        due: filters.view === "today" || parsed.due === "today" ? "today" : "",
      },
      taskId: null,
    });
  }, [filters.query, filters.tag, filters.view]);

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

  // The keyboard hands over a whole stdin chunk before React commits, so an
  // action that mutates the selection reads the row from the store instead of
  // the snapshot the render it was built in captured.
  const currentTask = useCallback(() => {
    const id = selectedTaskId.current ?? selectedTask?.id ?? null;
    return id === null ? null : data.refreshTask(id);
  }, [data, selectedTask]);

  // Every status change is one keypress and one undo entry; the toast names
  // the spawned occurrence so a recurring completion is not a surprise.
  const applyStatus = useCallback(
    (
      task: Task,
      result: { status: Status; spawnedId: number | null; undo: UndoAction },
    ) => {
      pushUndo(result.undo);
      if (result.spawnedId !== null) reloadTasks();
      else refreshTasks([task.id]);
      notify(statusToast(task.id, result.status, result.spawnedId), "success");
    },
    [notify, pushUndo, refreshTasks, reloadTasks],
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
      notify(`${what} · u undo`, "undo");
    },
    [closeModal, notify, pushUndo],
  );

  const deleteSelectedTask = useCallback(() => {
    // Re-read: a second `d` from the same chunk must find the row gone
    // instead of deleting it twice and stacking two undo entries for it.
    const task = currentTask();
    if (!task) return;
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
      detail: `It blocks ${blocked
        .map((id) => `#${id}`)
        .join(", ")} — they will be unblocked.`,
      onConfirm: perform,
    });
  }, [currentTask, data, reloadTasks, undoableDelete]);

  const stepPriorityBy = useCallback(
    (delta: 1 | -1) => {
      const task = currentTask();
      if (!task) return;
      const next = stepPriority(task.priority, delta);
      if (next === null) {
        notify(
          `#${task.id} is already ${priorityString(task.priority)}`,
          "info",
        );
        return;
      }
      const action = data.setPriority(task, next);
      pushUndo(action);
      refreshTasks([task.id]);
      notify(`${action.label} · u undo`, "success");
    },
    [currentTask, data, notify, pushUndo, refreshTasks],
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
        // The task may have been deleted from another connection while the
        // prompt was open; say so instead of writing into nothing.
        const fresh = data.refreshTask(task.id);
        if (!fresh) return gone(task.id);
        const action = data.setDue(fresh, due);
        pushUndo(action);
        closeModal();
        refreshTasks([task.id]);
        notify(`${action.label} · u undo`, "success");
      },
    });
  }, [closeModal, data, notify, pushUndo, refreshTasks, selectedTask]);

  // Enter adds and keeps the prompt, so a list of steps goes in at once.
  const addSubtask = useCallback(() => {
    if (!selectedTask) return;
    const taskId = selectedTask.id;
    const title = selectedTask.title;
    setModal({
      type: "prompt",
      title: "New subtask",
      label: `Subtask for #${taskId} ${title}`,
      placeholder: "Step description",
      stayOpen: true,
      onSubmit: (value) => {
        if (!data.addSubtask(taskId, value)) return gone(taskId);
        refreshTasks([taskId]);
      },
    });
  }, [data, refreshTasks, selectedTask]);

  const toggleSubtaskAt = useCallback(
    (index: number) => {
      const subtask = selectedTask?.subtasks[index];
      if (!subtask) return;
      data.toggleSubtask(subtask.id);
      refreshTasks([selectedTask.id]);
    },
    [data, refreshTasks, selectedTask],
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
          refreshTasks([task.id]);
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
        label: `Note for #${task.id} ${task.title}`,
        initial: note.body,
        multiline: true,
        onSubmit: (value) => {
          data.editTaskNote(note.id, value);
          closeModal();
          refreshTasks([task.id]);
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
      label: `Time for #${task.id} ${task.title}`,
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
        refreshTasks([task.id]);
        notify("Time log updated · u undo", "success");
      },
    });
  }, [closeModal, data, detailRow, notify, pushUndo, refreshTasks, selectedTask]);

  // The cursor is clamped where it is read, so the row after the deleted
  // one (or the last) ends up under it without bookkeeping here.
  const deleteDetailRow = useCallback(() => {
    const task = selectedTask;
    if (!task || !detailRow) return;
    if (detailRow.kind === "subtask") {
      const subtask = task.subtasks[detailRow.index];
      if (!subtask) return;
      undoableDelete(
        data.deleteSubtask(task.id, subtask),
        `Deleted subtask "${subtask.title}"`,
      );
    } else if (detailRow.kind === "note") {
      const note = task.notes[detailRow.index];
      if (!note) return;
      undoableDelete(
        data.deleteTaskNote(task.id, note),
        `Deleted note "${excerptOf(note.body, 32)}"`,
      );
    } else {
      const log = task.timeLogs[detailRow.index];
      if (!log) return;
      undoableDelete(
        data.deleteTimeLog(task.id, log),
        `Deleted the ${formatDuration(log.duration)} log`,
      );
    }
    refreshTasks([task.id]);
  }, [data, detailRow, refreshTasks, selectedTask, undoableDelete]);

  const addTaskNote = useCallback(() => {
    if (!selectedTask) return;
    const taskId = selectedTask.id;
    const title = selectedTask.title;
    setModal({
      type: "prompt",
      title: "Add note",
      label: `Note for #${taskId} ${title}`,
      placeholder: "What happened?",
      multiline: true,
      onSubmit: (value) => {
        if (!data.addTaskNote(taskId, value)) return gone(taskId);
        closeModal();
        refreshTasks([taskId]);
        notify("Note added", "success");
      },
    });
  }, [closeModal, data, notify, refreshTasks, selectedTask]);

  const logTime = useCallback(() => {
    if (!selectedTask) return;
    const taskId = selectedTask.id;
    const title = selectedTask.title;
    setModal({
      type: "prompt",
      title: "Log time",
      label: `Time for #${taskId} ${title}`,
      placeholder: "25m what you did",
      onSubmit: (value) => {
        let parsed: ReturnType<typeof parseTimeLogInput>;
        try {
          parsed = parseTimeLogInput(value);
        } catch {
          return "Invalid duration — try 45m or 1h30m";
        }
        if (!data.logTime(taskId, parsed.duration, parsed.note)) {
          return gone(taskId);
        }
        closeModal();
        refreshTasks([taskId]);
        notify(`Logged ${value}`, "success");
      },
    });
  }, [closeModal, data, notify, refreshTasks, selectedTask]);

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
          // `a` writes to today even while another day is selected, so the
          // toast has to name the day that actually received the entry.
          notify(
            `Entry added to ${formatNoteTitle(cfg, note.date, GoTime.now())}`,
            "success",
          );
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
      `Deleted entry "${excerptOf(entry.body, 32)}"`,
    );
    reloadNotes();
  }, [data, entryCursor, reloadNotes, selectedNote, undoableDelete]);

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
  const pendingRatio = useRef<number | null>(null);

  /** Merges the pending ratio onto the config as it stands when the write
   * happens: a settings save inside the debounce window must not be undone
   * by a snapshot taken before it. */
  const flushRatio = useCallback(() => {
    if (ratioSave.current) {
      clearTimeout(ratioSave.current);
      ratioSave.current = null;
    }
    const next = pendingRatio.current;
    if (next === null) return;
    pendingRatio.current = null;
    persistConfig({ ...data.cfg, panelRatio: next }, "Could not save layout");
  }, [data, persistConfig]);

  // A pending write is dropped on unmount; quitting flushes it first.
  useEffect(
    () => () => {
      if (ratioSave.current) clearTimeout(ratioSave.current);
    },
    [],
  );

  const applyRatio = useCallback(
    (raw: number) => {
      const next = clampRatio(raw, width);
      setRatio(next);
      pendingRatio.current = Number(next.toFixed(2));
      if (ratioSave.current) clearTimeout(ratioSave.current);
      ratioSave.current = setTimeout(flushRatio, RATIO_SAVE_MS);
    },
    [flushRatio, width],
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
    // Density only reaches the rows once the list is wide enough for the
    // one-line layout; below that the toast would claim a change nothing made.
    const before = isOneLine(listWidth, isDense(density, height, listWidth));
    const after = isOneLine(listWidth, isDense(next, height, listWidth));
    notify(
      before === after
        ? `Density: ${next} · widen the list with > to see it`
        : `Density: ${next}`,
      "info",
    );
  }, [density, height, listWidth, notify]);

  // The journal cannot see the selection, so a session started there is not
  // attached to a task the user never chose.
  const toggleFocus = useCallback(() => {
    pomodoro.toggle(isJournal ? 0 : (selectedTask?.id ?? 0));
    notify(focusStatusMessage(pomodoro.running, pomodoro.kind, cfg), "info");
  }, [cfg, isJournal, notify, pomodoro, selectedTask]);

  // Quitting exits the process, so whatever the debounces are still holding
  // has to reach disk here: the last tab switch or `>` before `q` counts.
  const quitNow = useCallback(() => {
    flushState();
    flushRatio();
    onQuit?.();
  }, [flushRatio, flushState, onQuit]);

  const requestQuit = useCallback(() => {
    if (!pomodoro.running) {
      quitNow();
      return;
    }
    setModal({
      type: "confirm",
      title: "Quit",
      message: "A focus session is running — quit and discard it?",
      confirmLabel: "Quit",
      onConfirm: () => {
        pomodoro.stop();
        quitNow();
      },
    });
  }, [pomodoro, quitNow]);

  const toggleHiddenNotes = useCallback(() => {
    const next = !showHidden;
    setShowHidden(next);
    notify(next ? "Showing hidden notes" : "Hiding hidden notes", "info");
  }, [notify, setShowHidden, showHidden]);

  const toggleNoteHidden = useCallback(() => {
    if (!selectedNote) return;
    data.toggleNoteHidden(selectedNote.id);
    reloadNotes();
    // The row leaves the list, so a second `x` cannot bring it back: the
    // message is the only place the way back can be named.
    notify(
      selectedNote.hidden ? "Note restored" : "Note hidden · H to show hidden",
      "success",
    );
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
        refreshTasks([target.id, blockerId]);
      },
    });
  }, [closeModal, data, notify, refreshTasks, selectedTask, tasks]);

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
        refreshTasks([target.id, blockerId]);
      },
    });
  }, [closeModal, data, notify, refreshTasks, selectedTask, tasks]);

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

  const setTagFilter = useCallback((tag: string | null) => {
    setFilters((f) => ({ ...f, tag }));
  }, []);

  // No guard on the tag bar being open: setting the filter is what makes it
  // appear, so `[` and `]` are how a tag filter is started, not only moved.
  const cycleTagFilter = useCallback(
    (delta: 1 | -1) => {
      if (knownTags.length === 0) {
        notify("No tags yet — add one with e", "info");
        return;
      }
      setTagFilter(cycleTag(knownTags, filters.tag, delta));
    },
    [filters.tag, knownTags, notify, setTagFilter],
  );

  const openTagPicker = useCallback(() => {
    if (knownTags.length === 0) {
      notify("No tags yet — add one with e", "info");
      return;
    }
    setModal({ type: "tag-pick" });
  }, [knownTags.length, notify]);

  const setView = useCallback(
    (view: View) => {
      setFilters((f) => ({ ...f, view }));
      notify(viewToast(view), "info");
    },
    [notify],
  );

  const cycleView = useCallback(() => {
    setView(nextView(filters.view));
  }, [filters.view, setView]);

  const reloadFromDisk = useCallback(() => {
    reloadAll();
    notify("Reloaded", "info");
  }, [notify, reloadAll]);

  // Marks turn the one-key edits into bulk edits: every marked task goes
  // through the same store call and the results fold into one undo entry.
  const markedTasks = useMemo(
    () => tasks.filter((t) => marked.has(t.id)),
    [marked, tasks],
  );

  const applyMarks = useCallback((next: ReadonlySet<number>) => {
    markedRef.current = next;
    setMarked(next);
  }, []);

  // The rail cannot show a mark on the cursor row, so the toast is what
  // confirms the very first press; the count matches the panel footer.
  const toggleMark = useCallback(() => {
    const task = selectedTask;
    if (!task) return;
    // Marks only act on the list, so marking from the palette focuses it.
    setPanel(0);
    const next = toggleInSet(markedRef.current, task.id);
    applyMarks(next);
    const rest = next.size > 0 ? ` · ${next.size} marked` : "";
    notify(
      next.has(task.id)
        ? `Marked #${task.id}${rest}`
        : `Unmarked #${task.id}${rest}`,
      "info",
    );
  }, [applyMarks, notify, selectedTask]);

  const clearMarks = useCallback(() => applyMarks(new Set()), [applyMarks]);

  const bulk = useCallback(
    (
      what: string,
      apply: (task: Task) => UndoAction | null,
      kind: ToastKind = "success",
    ) => {
      const actions: UndoAction[] = [];
      for (const task of markedTasks) {
        const action = apply(task);
        if (action) actions.push(action);
      }
      if (actions.length === 0) {
        notify(`Nothing to change: ${what}`, "info");
        return;
      }
      pushUndo({
        kind: "bulk",
        label: `${plural(actions.length, "task")} → ${what}`,
        actions,
      });
      applyMarks(new Set());
      reloadTasks();
      notify(bulkToast(actions.length, what), kind);
    },
    [applyMarks, markedTasks, notify, pushUndo, reloadTasks],
  );

  const bulkDone = useCallback(() => {
    // A mixed selection completes; only an all-done one reopens.
    const reopen = markedTasks.every((t) => t.status === Status.Done);
    const status = reopen ? Status.Pending : Status.Done;
    bulk(statusString(status), (t) =>
      t.status === status ? null : data.setStatus(t, status).undo,
    );
  }, [bulk, data, markedTasks]);

  const bulkPriority = useCallback(
    (delta: 1 | -1) => {
      bulk(delta > 0 ? "Priority up" : "Priority down", (t) => {
        const next = stepPriority(t.priority, delta);
        return next === null ? null : data.setPriority(t, next);
      });
    },
    [bulk, data],
  );

  const bulkDelete = useCallback(() => {
    const perform = () => {
      closeModal();
      bulk("Deleted", (t) => data.deleteTask(t), "undo");
    };
    // The same safeguard a single delete has, and more tasks are at stake:
    // blockers that are themselves being deleted do not count.
    const marks = new Set(markedTasks.map((t) => t.id));
    const unblocked = new Set<number>();
    for (const task of markedTasks) {
      for (const id of data.blockedBy(task)) {
        if (!marks.has(id)) unblocked.add(id);
      }
    }
    if (unblocked.size === 0) {
      perform();
      return;
    }
    setModal({
      type: "confirm",
      title: "Delete tasks",
      message: `Delete ${plural(markedTasks.length, "task")}?`,
      detail: `They block ${[...unblocked]
        .map((id) => `#${id}`)
        .join(", ")} — they will be unblocked.`,
      onConfirm: perform,
    });
  }, [bulk, closeModal, data, markedTasks]);

  const openBulkDuePrompt = useCallback(() => {
    setModal({
      type: "prompt",
      title: "Due date",
      label: `Due date for ${plural(markedTasks.length, "task")}`,
      placeholder: "YYYY-MM-DD · today · +3d · none",
      chips: DUE_CHIPS,
      onSubmit: (value) => {
        let due: GoTime | null;
        try {
          due = parseDueInput(value, GoTime.now());
        } catch {
          return "Use YYYY-MM-DD, today, tomorrow, +3d, +1w or none";
        }
        closeModal();
        bulk(due ? `Due ${due.format(DateOnly)}` : "Due cleared", (t) =>
          data.setDue(t, due),
        );
      },
    });
  }, [bulk, closeModal, data, markedTasks.length]);

  // Bulk keys take over the list while marks exist; the detail panel keeps
  // acting on its own rows.
  const bulkActive = !isJournal && panel === 0 && marked.size > 0;

  const pressDone = useCallback(() => {
    if (bulkActive) bulkDone();
    else toggleDone(currentTask());
  }, [bulkActive, bulkDone, currentTask, toggleDone]);

  const pressStart = useCallback(() => {
    toggleInProgress(currentTask());
  }, [currentTask, toggleInProgress]);

  const pressDue = useCallback(() => {
    if (bulkActive) openBulkDuePrompt();
    else openDuePrompt();
  }, [bulkActive, openBulkDuePrompt, openDuePrompt]);

  const pressDelete = useCallback(() => {
    if (bulkActive) bulkDelete();
    else deleteSelectedTask();
  }, [bulkActive, bulkDelete, deleteSelectedTask]);

  const pressPriority = useCallback(
    (delta: 1 | -1) => {
      if (bulkActive) bulkPriority(delta);
      else stepPriorityBy(delta);
    },
    [bulkActive, bulkPriority, stepPriorityBy],
  );

  // A task outside the current tab or filter is reached by widening both;
  // the selection effect then finds it by id.
  const goToTask = useCallback(
    (id: number) => {
      const index = shown.findIndex((t) => t.id === id);
      if (index !== -1) {
        selectTaskAt(index);
      } else {
        selectedTaskId.current = id;
        setTab("all");
        setFilters(emptyFilters);
      }
      setPanel(1);
    },
    [selectTaskAt, shown],
  );

  const openStats = useCallback(() => {
    setModal({
      type: "stats",
      snapshot: {
        completionsByDay: data.focus.completionsByDay(30),
        todayFocus: data.focus.todayWorkCount(),
        streakDays: data.focus.streak(),
      },
    });
  }, [data]);

  // -------------------------------------------------------------- palette

  const paletteActions = useMemo(
    () =>
      buildPaletteActions({
        tab,
        marked: marked.size,
        addTask: openAddTask,
        editTask: openEditTask,
        toggleDone: pressDone,
        toggleStart: pressStart,
        deleteTask: pressDelete,
        stepPriority: pressPriority,
        setDue: pressDue,
        addSubtask,
        addNote: addTaskNote,
        logTime,
        block: openBlockPicker,
        unblock: openUnblockPicker,
        mark: toggleMark,
        clearMarks,
        cycleSort,
        sortBy: applySort,
        pickTag: openTagPicker,
        cycleTag: cycleTagFilter,
        toggleTagBar: () => setTagBar((v) => !v),
        cycleView,
        setView,
        addJournalEntry,
        toggleNoteHidden,
        toggleHiddenNotes,
        search: startSearch,
        cycleDensity: toggleDensity,
        resizePanels,
        toggleTheme,
        showStats: openStats,
        showHelp: () => setModal({ type: "help" }),
        toggleFocus,
        undo,
        reload: reloadFromDisk,
        openSettings: () => setModal({ type: "settings" }),
        exportTo,
        quit: requestQuit,
        goToTab: setTab,
      }),
    [
      addJournalEntry,
      addSubtask,
      addTaskNote,
      applySort,
      clearMarks,
      cycleSort,
      cycleTagFilter,
      cycleView,
      exportTo,
      logTime,
      marked.size,
      openAddTask,
      openBlockPicker,
      openEditTask,
      openStats,
      openTagPicker,
      openUnblockPicker,
      pressDelete,
      pressDone,
      pressDue,
      pressPriority,
      pressStart,
      reloadFromDisk,
      requestQuit,
      resizePanels,
      setView,
      startSearch,
      tab,
      toggleDensity,
      toggleFocus,
      toggleHiddenNotes,
      toggleMark,
      toggleNoteHidden,
      toggleTheme,
      undo,
    ],
  );

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
          const id = shown[next]?.id;
          if (id !== undefined) selectedTaskId.current = id;
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
  const listRowHeight = (isOneLine(listWidth, dense) ? 1 : 2) + listGap;
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
      case "4": {
        // The digit comes from the tab's own `key`, the same field the
        // palette prints, so reordering TABS cannot split the two.
        const target = TABS.find((t) => t.key === key.name);
        if (target) setTab(target.id);
        return;
      }
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
        // One step back per press: marks, then the detail panel, then the
        // query and tag, and the view last.
        if (marked.size > 0) clearMarks();
        else if (panel === 1) setPanel(0);
        else if (filters.query !== "" || filters.tag !== null) {
          setFilters((f) => ({ ...f, query: "", tag: null }));
        } else if (filters.view !== "all") {
          setFilters((f) => ({ ...f, view: "all" }));
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
          else pressDone();
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
        if (!isJournal) cycleSort();
        return;
      case "/":
        startSearch();
        return;
      case "f1":
        if (!isJournal) applySort("created");
        return;
      case "f2":
        if (!isJournal) applySort("due");
        return;
      case "f3":
        if (!isJournal) applySort("priority");
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
        else pressDelete();
        break;
      case "s":
        if (tab !== "journal") pressStart();
        break;
      case "+":
        if (tab !== "journal") pressPriority(1);
        break;
      case "-":
        if (tab !== "journal") pressPriority(-1);
        break;
      case "@":
        if (tab !== "journal") pressDue();
        break;
      case "m":
        // Every bulk key acts on the list; a mark made from the detail panel
        // would sit there with nothing able to use it.
        if (tab !== "journal" && panel === 0) toggleMark();
        break;
      case "v":
        if (tab !== "journal") cycleView();
        break;
      case "R":
        reloadFromDisk();
        break;
      case "[":
      case "]":
        cycleTagFilter(key.sequence === "]" ? 1 : -1);
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
        openStats();
        break;
      case "z":
        toggleDensity();
        break;
      case "?":
        setModal({ type: "help" });
        break;
      case "#":
        if (!isJournal) openTagPicker();
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
            : pressDelete(),
      done: pressDone,
      start: pressStart,
      due: pressDue,
      toggle: toggleDetailRow,
      subtask: addSubtask,
      note: addTaskNote,
      time: logTime,
      filter: startSearch,
      view: cycleView,
      tag: openTagPicker,
      mark: toggleMark,
      clearMarks,
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
      clearMarks,
      cycleView,
      deleteDetailRow,
      deleteJournalEntry,
      editDetailRow,
      editJournalEntry,
      isJournal,
      logTime,
      openAddTask,
      openBlockPicker,
      openEditTask,
      openTagPicker,
      panel,
      pressDelete,
      pressDone,
      pressDue,
      pressStart,
      selectedTask,
      startSearch,
      stopSearch,
      toggleDetailRow,
      toggleFocus,
      toggleHiddenNotes,
      toggleMark,
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
        marked: marked.size,
        done: selectedTask?.status === Status.Done,
      }).map((h) => ({
        key: h.key,
        label: h.label,
        run: h.action ? hintActions[h.action] : undefined,
      })),
    [
      compact,
      detailRow?.kind,
      hintActions,
      marked.size,
      panel,
      searching,
      selectedTask?.status,
      tab,
    ],
  );

  const tabLabel = TABS.find((t) => t.id === tab)?.label ?? "Tasks";

  const finishedToday = useMemo(
    () => (tab === "done" ? doneToday(tasks, now) : 0),
    [now, tab, tasks],
  );

  let listSubtitle: string;
  if (isJournal) {
    listSubtitle =
      shownNotes.length === notes.length
        ? plural(notes.length, "day")
        : `${shownNotes.length} of ${notes.length}`;
  } else if (filters.view !== "all") {
    listSubtitle = viewSubtitle(filters.view, shown.length, tabTotal);
  } else if (shown.length !== tabTotal) {
    listSubtitle = `${shown.length} of ${tabTotal}`;
  } else if (tab === "done") {
    listSubtitle = `${plural(tabTotal, "task")} · ${finishedToday} today`;
  } else {
    listSubtitle = plural(tabTotal, "task");
  }
  if (!isJournal && marked.size > 0) listSubtitle += ` · ${marked.size} marked`;
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

  // Memoized children only skip work when their callbacks hold still.
  const focusList = useCallback(() => setPanel(0), []);
  const toggleRowStatus = useCallback(
    (index: number) => toggleDone(shown[index] ?? null),
    [shown, toggleDone],
  );
  const selectDetailRow = useCallback((index: number) => {
    setDetailIndex(index);
    setPanel(1);
  }, []);
  const filtered =
    filters.query !== "" || filters.tag !== null || filters.view !== "all";

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
          tags={knownTags}
          activeTag={filters.tag}
          width={width}
          onSelect={setTagFilter}
          onMore={openTagPicker}
        />
      ) : null}

      <box flexGrow={1} flexDirection="row" minHeight={0}>
        {compact && panel === 1 ? null : (
        <box
          width={compact ? undefined : listWidth}
          flexGrow={compact ? 1 : 0}
          flexDirection="column"
          minHeight={0}
        >
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
                placeholder={
                  isJournal
                    ? "search entries…"
                    : "text · #tag · !high · due:today · is:blocked"
                }
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
                gap={listGap}
                dense={dense}
                sort={sort}
                now={now}
                blocked={blocked}
                marked={marked}
                onSelect={selectTaskAt}
                onActivate={focusList}
                onToggleStatus={toggleRowStatus}
                emptyIcon={filtered ? "⌕" : "✦"}
                emptyTitle={filtered ? "No matches" : "No tasks yet"}
                emptyHint={
                  filtered
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
                  onSelectRow={selectDetailRow}
                  onToggleSubtask={toggleSubtaskAt}
                  blocked={selectedTask ? blocked.has(selectedTask.id) : false}
                  blockedByTitles={taskTitles}
                  onFilterTag={setTagFilter}
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
          knownTags={tagNames}
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

      {modal.type === "tag-pick" ? (
        <TagPickerDialog
          theme={theme}
          tags={knownTags}
          screenWidth={width}
          screenHeight={height}
          onPick={(tag) => {
            closeModal();
            setTagFilter(tag);
          }}
          onClose={closeModal}
        />
      ) : null}

      {modal.type === "palette" ? (
        <CommandPalette
          theme={theme}
          actions={paletteActions}
          tasks={tasks}
          screenWidth={width}
          screenHeight={height}
          onPickTask={goToTask}
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
          completionsByDay={modal.snapshot.completionsByDay}
          todayFocus={modal.snapshot.todayFocus}
          focusGoal={cfg.focus.dailyGoal}
          streakDays={modal.snapshot.streakDays}
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
