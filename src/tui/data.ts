import type { Database } from "bun:sqlite";
import type { Config } from "../core/config/config.ts";
import { FocusStore } from "../core/focus/store.ts";
import { JournalStore } from "../core/journal/store.ts";
import { TaskStore, newTask } from "../core/task/store.ts";
import { hasCycle } from "../core/task/deps.ts";
import { RecurFreq, nextDueDate } from "../core/task/recur.ts";
import {
  Status,
  priorityString,
  statusString,
  type Priority,
  type Task,
} from "../core/task/task.ts";
import type { Note } from "../core/journal/journal.ts";
import { DateOnly, type GoTime } from "../core/time.ts";

export interface TaskDraft {
  title: string;
  description: string;
  priority: Priority;
  dueDate: GoTime | null;
  tags: string[];
  recurFreq: RecurFreq;
}

/** Undoable action captured before a destructive operation. */
export type UndoAction =
  | { kind: "task"; label: string; task: Task }
  | { kind: "subtask"; label: string; taskId: number; title: string; completed: boolean; position: number }
  | { kind: "entry"; label: string; noteId: number; body: string; createdAt: GoTime }
  | {
      kind: "status";
      label: string;
      taskId: number;
      prevStatus: Status;
      prevRecurFreq: RecurFreq;
      prevRecurInterval: number;
      spawnedId: number | null;
    }
  | { kind: "note"; label: string; taskId: number; body: string; createdAt: GoTime }
  | { kind: "timelog"; label: string; taskId: number; duration: number; note: string; loggedAt: GoTime }
  | { kind: "timelog-added"; label: string; logId: number }
  | { kind: "priority"; label: string; taskId: number; prev: Priority }
  | { kind: "due"; label: string; taskId: number; prev: GoTime | null }
  | { kind: "bulk"; label: string; actions: UndoAction[] };

/**
 * Everything the TUI needs from storage, in one place, so components never
 * touch SQLite directly.
 */
export class RondoData {
  readonly tasks: TaskStore;
  readonly journal: JournalStore;
  readonly focus: FocusStore;
  private dataVersion: number | null = null;

  constructor(
    private readonly db: Database,
    public cfg: Config,
  ) {
    this.tasks = new TaskStore(db);
    this.journal = new JournalStore(db);
    this.focus = new FocusStore(db);
  }

  listTasks(): Task[] {
    return this.tasks.list();
  }

  listNotes(includeHidden: boolean): Note[] {
    return this.journal.listNotes(includeHidden);
  }

  /** Fresh copy of one task, or null once it has been deleted. */
  refreshTask(id: number): Task | null {
    return this.tasks.getById(id);
  }

  /**
   * True when another connection (the CLI, the agent skill) committed since
   * the last call. SQLite bumps `data_version` only for foreign commits, so
   * the TUI's own writes never trip it. The first call only takes a baseline.
   */
  changed(): boolean {
    const row = this.db.query("PRAGMA data_version").get() as {
      data_version: number;
    };
    const seen = this.dataVersion;
    this.dataVersion = row.data_version;
    return seen !== null && seen !== row.data_version;
  }

  createTask(draft: TaskDraft): Task {
    const t = newTask({
      title: draft.title,
      description: draft.description,
      priority: draft.priority,
      dueDate: draft.dueDate,
      tags: draft.tags,
    });
    this.tasks.create(t);
    if (draft.recurFreq !== RecurFreq.None) {
      this.tasks.updateRecurrence(t.id, draft.recurFreq, 1);
      t.recurFreq = draft.recurFreq;
      t.recurInterval = 1;
    }
    return t;
  }

  updateTask(task: Task, draft: TaskDraft): void {
    task.title = draft.title;
    task.description = draft.description;
    task.priority = draft.priority;
    task.dueDate = draft.dueDate;
    task.tags = draft.tags;
    this.tasks.update(task);
    if (draft.recurFreq !== task.recurFreq) {
      this.tasks.updateRecurrence(
        task.id,
        draft.recurFreq,
        task.recurInterval > 0 ? task.recurInterval : 1,
      );
    }
  }

  /**
   * Moves a task to `status`. Completing a recurring task spawns the next
   * occurrence and hands the recurrence over to it, so a later
   * Done → Pending → Done bounce cannot spawn duplicates. The returned undo
   * reverses all of it, spawn included.
   */
  setStatus(
    task: Task,
    status: Status,
  ): { spawnedId: number | null; undo: UndoAction } {
    const undo: UndoAction = {
      kind: "status",
      label: `#${task.id} → ${statusString(status)}`,
      taskId: task.id,
      prevStatus: task.status,
      prevRecurFreq: task.recurFreq,
      prevRecurInterval: task.recurInterval,
      spawnedId: null,
    };

    if (
      status === Status.Done &&
      task.status !== Status.Done &&
      task.recurFreq !== RecurFreq.None
    ) {
      const interval = task.recurInterval > 0 ? task.recurInterval : 1;
      const spawned = newTask({
        title: task.title,
        description: task.description,
        priority: task.priority,
        dueDate: nextDueDate(task),
        tags: task.tags,
        recurFreq: task.recurFreq,
        recurInterval: interval,
      });
      this.tasks.create(spawned);
      this.tasks.updateRecurrence(spawned.id, task.recurFreq, interval);
      this.tasks.updateRecurrence(task.id, RecurFreq.None, 0);
      task.recurFreq = RecurFreq.None;
      task.recurInterval = 0;
      undo.spawnedId = spawned.id;
    }

    task.status = status;
    this.tasks.update(task);
    return { spawnedId: undo.spawnedId, undo };
  }

  /** Pending/InProgress → Done, Done → Pending. */
  toggleDone(task: Task): {
    status: Status;
    spawnedId: number | null;
    undo: UndoAction;
  } {
    const status =
      task.status === Status.Done ? Status.Pending : Status.Done;
    return { status, ...this.setStatus(task, status) };
  }

  /** Pending → InProgress, InProgress → Pending, Done → InProgress. */
  toggleInProgress(task: Task): {
    status: Status;
    spawnedId: number | null;
    undo: UndoAction;
  } {
    const status =
      task.status === Status.InProgress ? Status.Pending : Status.InProgress;
    return { status, ...this.setStatus(task, status) };
  }

  setPriority(task: Task, priority: Priority): UndoAction {
    const prev = task.priority;
    task.priority = priority;
    this.tasks.update(task);
    return {
      kind: "priority",
      label: `#${task.id} → ${priorityString(priority)}`,
      taskId: task.id,
      prev,
    };
  }

  setDue(task: Task, due: GoTime | null): UndoAction {
    const prev = task.dueDate;
    task.dueDate = due;
    this.tasks.update(task);
    return {
      kind: "due",
      label: `#${task.id} due ${due ? due.format(DateOnly) : "cleared"}`,
      taskId: task.id,
      prev,
    };
  }

  deleteTask(task: Task): UndoAction {
    this.tasks.delete(task.id);
    return { kind: "task", label: `Deleted "${task.title}"`, task };
  }

  /** Task IDs blocked by this task; deleting the task unblocks them. */
  blockedBy(task: Task): number[] {
    return this.tasks.listBlocksIds(task.id);
  }

  /** Marks taskId as blocked by blockerId, refusing cycles and self-blocks. */
  addDependency(taskId: number, blockerId: number): void {
    if (
      hasCycle(taskId, [blockerId], (id) => this.tasks.listBlockerIds(id))
    ) {
      throw new Error("that would create a dependency cycle");
    }
    this.tasks.setBlocker(taskId, blockerId);
  }

  removeDependency(taskId: number, blockerId: number): void {
    this.tasks.removeBlocker(taskId, blockerId);
  }

  /** False when the task is gone — deleted from another connection while a
   * prompt for it was open — so the caller can say so instead of letting a
   * foreign-key error escape. */
  addSubtask(taskId: number, title: string): boolean {
    if (!this.tasks.getById(taskId)) return false;
    this.tasks.addSubtask(taskId, title);
    return true;
  }

  toggleSubtask(id: number): void {
    this.tasks.toggleSubtask(id);
  }

  editSubtask(id: number, title: string): void {
    this.tasks.updateSubtask(id, title);
  }

  deleteSubtask(
    taskId: number,
    subtask: { id: number; title: string; completed: boolean; position: number },
  ): UndoAction {
    this.tasks.deleteSubtask(subtask.id);
    return {
      kind: "subtask",
      label: `Deleted subtask "${subtask.title}"`,
      taskId,
      title: subtask.title,
      completed: subtask.completed,
      position: subtask.position,
    };
  }

  /** False when the task no longer exists; see `addSubtask`. */
  addTaskNote(taskId: number, body: string): boolean {
    if (!this.tasks.getById(taskId)) return false;
    this.tasks.addNote(taskId, body);
    return true;
  }

  editTaskNote(noteId: number, body: string): void {
    this.tasks.updateNote(noteId, body);
  }

  deleteTaskNote(
    taskId: number,
    note: { id: number; body: string; createdAt: GoTime },
  ): UndoAction {
    this.tasks.deleteNote(note.id);
    return {
      kind: "note",
      label: "Deleted note",
      taskId,
      body: note.body,
      createdAt: note.createdAt,
    };
  }

  /** False when the task no longer exists; see `addSubtask`. */
  logTime(taskId: number, duration: number, note: string): boolean {
    if (!this.tasks.getById(taskId)) return false;
    this.tasks.addTimeLog(taskId, duration, note);
    return true;
  }

  deleteTimeLog(
    taskId: number,
    log: { id: number; duration: number; note: string; loggedAt: GoTime },
  ): UndoAction {
    this.tasks.deleteTimeLog(log.id);
    return {
      kind: "timelog",
      label: "Deleted time log",
      taskId,
      duration: log.duration,
      note: log.note,
      loggedAt: log.loggedAt,
    };
  }

  /**
   * Rewrites a time log in place: the row is replaced, keeping its original
   * timestamp, and the undo drops the replacement before restoring the old
   * entry.
   */
  replaceTimeLog(
    taskId: number,
    log: { id: number; duration: number; note: string; loggedAt: GoTime },
    duration: number,
    note: string,
  ): UndoAction {
    const removed = this.deleteTimeLog(taskId, log);
    this.tasks.restoreTimeLog(taskId, duration, note, log.loggedAt);
    const row = this.db.query("SELECT last_insert_rowid() AS id").get() as {
      id: number;
    };
    return {
      kind: "bulk",
      label: "Edited time log",
      actions: [
        removed,
        { kind: "timelog-added", label: "Added time log", logId: row.id },
      ],
    };
  }

  addJournalEntry(body: string, dateStr?: string): Note {
    const note = dateStr
      ? this.journal.getOrCreate(dateStr)
      : this.journal.getOrCreateToday();
    this.journal.addEntry(note.id, body);
    return note;
  }

  editJournalEntry(entryId: number, body: string): void {
    this.journal.updateEntry(entryId, body);
  }

  deleteJournalEntry(entry: {
    id: number;
    noteId: number;
    body: string;
    createdAt: GoTime;
  }): UndoAction {
    this.journal.deleteEntry(entry.id);
    return {
      kind: "entry",
      label: "Deleted journal entry",
      noteId: entry.noteId,
      body: entry.body,
      createdAt: entry.createdAt,
    };
  }

  toggleNoteHidden(noteId: number): void {
    this.journal.toggleHidden(noteId);
  }

  undo(action: UndoAction): void {
    switch (action.kind) {
      case "task":
        this.tasks.restore(action.task);
        break;
      case "subtask":
        this.tasks.restoreSubtask(
          action.taskId,
          action.title,
          action.completed,
          action.position,
        );
        break;
      case "entry":
        this.journal.restoreEntry(action.noteId, action.body, action.createdAt);
        break;
      case "status": {
        const task = this.tasks.getById(action.taskId);
        if (task) {
          task.status = action.prevStatus;
          this.tasks.update(task);
          this.tasks.updateRecurrence(
            task.id,
            action.prevRecurFreq,
            action.prevRecurInterval,
          );
        }
        if (action.spawnedId !== null) this.tasks.delete(action.spawnedId);
        break;
      }
      case "note":
        this.tasks.restoreNote(action.taskId, action.body, action.createdAt);
        break;
      case "timelog":
        this.tasks.restoreTimeLog(
          action.taskId,
          action.duration,
          action.note,
          action.loggedAt,
        );
        break;
      case "timelog-added":
        this.tasks.deleteTimeLog(action.logId);
        break;
      case "priority": {
        const task = this.tasks.getById(action.taskId);
        if (!task) break;
        task.priority = action.prev;
        this.tasks.update(task);
        break;
      }
      case "due": {
        const task = this.tasks.getById(action.taskId);
        if (!task) break;
        task.dueDate = action.prev;
        this.tasks.update(task);
        break;
      }
      case "bulk":
        for (let i = action.actions.length - 1; i >= 0; i--) {
          this.undo(action.actions[i]!);
        }
        break;
    }
  }
}
