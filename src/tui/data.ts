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
  type Subtask,
} from "../core/task/task.ts";
import type { Note } from "../core/journal/journal.ts";
import { DateOnly, GoTime, RFC3339 } from "../core/time.ts";

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
  | { kind: "task-created"; label: string; taskId: number }
  | { kind: "task-edited"; label: string; task: Task }
  | { kind: "subtask"; label: string; id: number; taskId: number; title: string; completed: boolean; position: number }
  | { kind: "subtask-added"; label: string; id: number }
  | { kind: "subtask-edited"; label: string; subtask: Subtask }
  | { kind: "entry"; label: string; id: number; noteId: number; body: string; createdAt: GoTime }
  | { kind: "entry-added"; label: string; id: number; noteId: number; createdNote: boolean }
  | { kind: "entry-edited"; label: string; id: number; body: string }
  | { kind: "note-hidden"; label: string; noteId: number; hidden: boolean }
  | { kind: "dependency"; label: string; taskId: number; blockerId: number; existed: boolean }
  | {
      kind: "status";
      label: string;
      taskId: number;
      prevStatus: Status;
      prevRecurFreq: RecurFreq;
      prevRecurInterval: number;
      spawnedId: number | null;
    }
  | { kind: "note"; label: string; id: number; taskId: number; body: string; createdAt: GoTime }
  | { kind: "note-added"; label: string; id: number }
  | { kind: "note-edited"; label: string; id: number; body: string }
  | { kind: "timelog"; label: string; id: number; taskId: number; duration: number; note: string; loggedAt: GoTime }
  | { kind: "timelog-edited"; label: string; id: number; duration: number; note: string }
  | { kind: "timelog-added"; label: string; logId: number }
  | { kind: "priority"; label: string; taskId: number; prev: Priority }
  | { kind: "due"; label: string; taskId: number; prev: GoTime | null }
  | { kind: "tags"; label: string; taskId: number; prev: string[] }
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

  updateTask(task: Task, draft: TaskDraft): UndoAction {
    const previous = { ...task, tags: [...task.tags] };
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
    return {
      kind: "task-edited",
      label: `Edited "${previous.title}"`,
      task: previous,
    };
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

  editTags(taskId: number, changes: { add: string[]; remove: string[] }): UndoAction | null {
    const task = this.tasks.getById(taskId);
    if (!task) return null;
    const normalize = (tags: string[]) => [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
    const removed = new Set(normalize(changes.remove));
    const tags = normalize([...task.tags.filter((tag) => !removed.has(tag)), ...changes.add]);
    if (tags.length === task.tags.length && tags.every((tag, index) => tag === task.tags[index])) return null;
    const prev = [...task.tags];
    task.tags = tags;
    this.tasks.update(task);
    return { kind: "tags", label: `Edited tags for #${task.id}`, taskId, prev };
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
  addDependency(taskId: number, blockerId: number): UndoAction | null {
    if (this.tasks.listBlockerIds(taskId).includes(blockerId)) return null;
    if (
      hasCycle(taskId, [blockerId], (id) => this.tasks.listBlockerIds(id))
    ) {
      throw new Error("that would create a dependency cycle");
    }
    this.tasks.setBlocker(taskId, blockerId);
    return {
      kind: "dependency",
      label: `Blocked #${taskId} on #${blockerId}`,
      taskId,
      blockerId,
      existed: false,
    };
  }

  removeDependency(taskId: number, blockerId: number): UndoAction | null {
    if (!this.tasks.listBlockerIds(taskId).includes(blockerId)) return null;
    this.tasks.removeBlocker(taskId, blockerId);
    return {
      kind: "dependency",
      label: `Unblocked #${taskId} from #${blockerId}`,
      taskId,
      blockerId,
      existed: true,
    };
  }

  /** Null when the task is gone — deleted from another connection while a
   * prompt for it was open — so the caller can say so instead of letting a
   * foreign-key error escape. */
  addSubtask(taskId: number, title: string): UndoAction | null {
    if (!this.tasks.getById(taskId)) return null;
    this.tasks.addSubtask(taskId, title);
    return {
      kind: "subtask-added",
      label: `Added subtask "${title}"`,
      id: this.insertedId(),
    };
  }

  toggleSubtask(id: number): UndoAction | null {
    const subtask = this.subtaskById(id);
    if (!subtask) return null;
    this.tasks.toggleSubtask(id);
    return {
      kind: "subtask-edited",
      label: `Toggled subtask "${subtask.title}"`,
      subtask,
    };
  }

  editSubtask(id: number, title: string): UndoAction | null {
    const subtask = this.subtaskById(id);
    if (!subtask) return null;
    this.tasks.updateSubtask(id, title);
    return {
      kind: "subtask-edited",
      label: `Edited subtask "${subtask.title}"`,
      subtask,
    };
  }

  deleteSubtask(
    taskId: number,
    subtask: { id: number; title: string; completed: boolean; position: number },
  ): UndoAction {
    this.tasks.deleteSubtask(subtask.id);
    return {
      kind: "subtask",
      label: `Deleted subtask "${subtask.title}"`,
      id: subtask.id,
      taskId,
      title: subtask.title,
      completed: subtask.completed,
      position: subtask.position,
    };
  }

  /** Null when the task no longer exists; see `addSubtask`. */
  addTaskNote(taskId: number, body: string): UndoAction | null {
    if (!this.tasks.getById(taskId)) return null;
    this.tasks.addNote(taskId, body);
    return { kind: "note-added", label: "Added note", id: this.insertedId() };
  }

  editTaskNote(noteId: number, body: string): UndoAction | null {
    const previous = this.db
      .query("SELECT body FROM task_notes WHERE id = ?")
      .get(noteId) as { body: string } | null;
    if (!previous) return null;
    this.tasks.updateNote(noteId, body);
    return {
      kind: "note-edited",
      label: "Edited note",
      id: noteId,
      body: previous.body,
    };
  }

  deleteTaskNote(
    taskId: number,
    note: { id: number; body: string; createdAt: GoTime },
  ): UndoAction {
    this.tasks.deleteNote(note.id);
    return {
      kind: "note",
      label: "Deleted note",
      id: note.id,
      taskId,
      body: note.body,
      createdAt: note.createdAt,
    };
  }

  /** Null when the task no longer exists; see `addSubtask`. */
  logTime(taskId: number, duration: number, note: string): UndoAction | null {
    if (!this.tasks.getById(taskId)) return null;
    this.tasks.addTimeLog(taskId, duration, note);
    return { kind: "timelog-added", label: "Added time log", logId: this.insertedId() };
  }

  deleteTimeLog(
    taskId: number,
    log: { id: number; duration: number; note: string; loggedAt: GoTime },
  ): UndoAction {
    this.tasks.deleteTimeLog(log.id);
    return {
      kind: "timelog",
      label: "Deleted time log",
      id: log.id,
      taskId,
      duration: log.duration,
      note: log.note,
      loggedAt: log.loggedAt,
    };
  }

  replaceTimeLog(
    taskId: number,
    log: { id: number; duration: number; note: string; loggedAt: GoTime },
    duration: number,
    note: string,
  ): UndoAction {
    const previous = this.tasks.listTimeLogs(taskId).find((row) => row.id === log.id);
    if (!previous) throw new Error(`time log ${log.id} not found`);
    this.db.run("UPDATE time_logs SET duration = ?, note = ? WHERE id = ?", [
      duration,
      note,
      log.id,
    ]);
    return {
      kind: "timelog-edited",
      label: "Edited time log",
      id: log.id,
      duration: previous.duration,
      note: previous.note,
    };
  }

  addJournalEntry(
    body: string,
    dateStr = GoTime.now().format(DateOnly),
  ): { note: Note; undo: UndoAction } {
    const existed = this.db
      .query("SELECT id FROM journal_notes WHERE date = ?")
      .get(dateStr) !== null;
    const note = this.journal.getOrCreate(dateStr);
    this.journal.addEntry(note.id, body);
    return {
      note,
      undo: {
        kind: "entry-added",
        label: "Added journal entry",
        id: this.insertedId(),
        noteId: note.id,
        createdNote: !existed,
      },
    };
  }

  editJournalEntry(entryId: number, body: string): UndoAction {
    const previous = this.db
      .query("SELECT body FROM journal_entries WHERE id = ?")
      .get(entryId) as { body: string } | null;
    if (!previous) throw new Error(`entry ${entryId} not found`);
    this.journal.updateEntry(entryId, body);
    return {
      kind: "entry-edited",
      label: "Edited journal entry",
      id: entryId,
      body: previous.body,
    };
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
      id: entry.id,
      noteId: entry.noteId,
      body: entry.body,
      createdAt: entry.createdAt,
    };
  }

  toggleNoteHidden(noteId: number): UndoAction {
    const previous = this.db
      .query("SELECT hidden FROM journal_notes WHERE id = ?")
      .get(noteId) as { hidden: number } | null;
    if (!previous) throw new Error(`note ${noteId} not found`);
    this.journal.toggleHidden(noteId);
    return {
      kind: "note-hidden",
      label: previous.hidden ? "Restored journal day" : "Hid journal day",
      noteId,
      hidden: previous.hidden !== 0,
    };
  }

  private insertedId(): number {
    return (this.db.query("SELECT last_insert_rowid() AS id").get() as {
      id: number;
    }).id;
  }

  private subtaskById(id: number): Subtask | null {
    const row = this.db
      .query("SELECT id, title, completed, position FROM subtasks WHERE id = ?")
      .get(id) as (Omit<Subtask, "completed"> & { completed: number }) | null;
    return row ? { ...row, completed: row.completed !== 0 } : null;
  }

  undo(action: UndoAction): void {
    this.db.transaction(() => this.restoreAction(action))();
  }

  private restoreAction(action: UndoAction): void {
    switch (action.kind) {
      case "task":
        this.tasks.restore({ ...action.task, subtasks: [], notes: [], timeLogs: [] });
        for (const subtask of action.task.subtasks) {
          this.restoreAction({ kind: "subtask", label: action.label, taskId: action.task.id, ...subtask });
        }
        for (const note of action.task.notes) {
          this.restoreAction({ kind: "note", label: action.label, ...note });
        }
        for (const log of action.task.timeLogs) {
          this.restoreAction({ kind: "timelog", label: action.label, ...log });
        }
        break;
      case "task-created":
        this.tasks.delete(action.taskId);
        break;
      case "task-edited": {
        const task = this.tasks.getById(action.task.id);
        if (!task) break;
        this.updateTask(task, action.task);
        this.tasks.updateRecurrence(task.id, action.task.recurFreq, action.task.recurInterval);
        break;
      }
      case "subtask":
        this.db.run("INSERT INTO subtasks (id, task_id, title, completed, position) VALUES (?,?,?,?,?)", [action.id, action.taskId, action.title, action.completed ? 1 : 0, action.position]);
        break;
      case "subtask-added":
        this.tasks.deleteSubtask(action.id);
        break;
      case "subtask-edited":
        this.db.run("UPDATE subtasks SET title = ?, completed = ?, position = ? WHERE id = ?", [action.subtask.title, action.subtask.completed ? 1 : 0, action.subtask.position, action.subtask.id]);
        break;
      case "entry":
        this.db.run("INSERT INTO journal_entries (id, note_id, body, created_at) VALUES (?,?,?,?)", [action.id, action.noteId, action.body, action.createdAt.format(RFC3339)]);
        break;
      case "entry-added":
        this.journal.deleteEntry(action.id);
        if (action.createdNote) {
          this.db.run("DELETE FROM journal_notes WHERE id = ? AND NOT EXISTS (SELECT 1 FROM journal_entries WHERE note_id = ?)", [action.noteId, action.noteId]);
        }
        break;
      case "entry-edited":
        this.journal.updateEntry(action.id, action.body);
        break;
      case "note-hidden":
        this.db.run("UPDATE journal_notes SET hidden = ? WHERE id = ?", [action.hidden ? 1 : 0, action.noteId]);
        break;
      case "dependency":
        if (action.existed) this.addDependency(action.taskId, action.blockerId);
        else this.tasks.removeBlocker(action.taskId, action.blockerId);
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
        this.db.run("INSERT INTO task_notes (id, task_id, body, created_at) VALUES (?,?,?,?)", [action.id, action.taskId, action.body, action.createdAt.format(RFC3339)]);
        break;
      case "note-added":
        this.tasks.deleteNote(action.id);
        break;
      case "note-edited":
        this.tasks.updateNote(action.id, action.body);
        break;
      case "timelog":
        this.db.run("INSERT INTO time_logs (id, task_id, duration, note, logged_at) VALUES (?,?,?,?,?)", [action.id, action.taskId, action.duration, action.note, action.loggedAt.format(RFC3339)]);
        break;
      case "timelog-edited":
        this.db.run("UPDATE time_logs SET duration = ?, note = ? WHERE id = ?", [action.duration, action.note, action.id]);
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
      case "tags": {
        const task = this.tasks.getById(action.taskId);
        if (!task) break;
        task.tags = [...action.prev];
        this.tasks.update(task);
        break;
      }
      case "bulk":
        for (let i = action.actions.length - 1; i >= 0; i--) {
          this.restoreAction(action.actions[i]!);
        }
        break;
    }
  }
}
