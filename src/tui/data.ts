import type { Database } from "bun:sqlite";
import type { Config } from "../core/config/config.ts";
import { FocusStore } from "../core/focus/store.ts";
import { JournalStore } from "../core/journal/store.ts";
import { TaskStore, newTask } from "../core/task/store.ts";
import { hasCycle } from "../core/task/deps.ts";
import { RecurFreq, nextDueDate } from "../core/task/recur.ts";
import {
  Status,
  type Priority,
  type Task,
} from "../core/task/task.ts";
import type { Note } from "../core/journal/journal.ts";
import { GoTime } from "../core/time.ts";

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
  | { kind: "entry"; label: string; noteId: number; body: string; createdAt: GoTime };

/**
 * Everything the TUI needs from storage, in one place, so components never
 * touch SQLite directly.
 */
export class RondoData {
  readonly tasks: TaskStore;
  readonly journal: JournalStore;
  readonly focus: FocusStore;

  constructor(
    db: Database,
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

  /** Cycles status and spawns the next occurrence for recurring tasks. */
  cycleStatus(task: Task): Status {
    const next =
      task.status === Status.Pending
        ? Status.InProgress
        : task.status === Status.InProgress
          ? Status.Done
          : Status.Pending;

    if (next === Status.Done && task.recurFreq !== RecurFreq.None) {
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
      // The recurrence lives on in the spawned occurrence. Clearing it here
      // keeps a later Done → Pending → Done bounce from spawning duplicates.
      this.tasks.updateRecurrence(task.id, RecurFreq.None, 0);
      task.recurFreq = RecurFreq.None;
      task.recurInterval = 0;
    }

    task.status = next;
    this.tasks.update(task);
    return next;
  }

  setStatus(task: Task, status: Status): void {
    task.status = status;
    this.tasks.update(task);
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

  addSubtask(taskId: number, title: string): void {
    this.tasks.addSubtask(taskId, title);
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

  addTaskNote(taskId: number, body: string): void {
    this.tasks.addNote(taskId, body);
  }

  logTime(taskId: number, duration: number, note: string): void {
    this.tasks.addTimeLog(taskId, duration, note);
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
    }
  }
}
