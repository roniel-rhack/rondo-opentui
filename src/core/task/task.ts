import type { GoTime } from "../time.ts";
import type { Duration } from "../duration.ts";
import type { RecurFreq } from "./recur.ts";

export enum Status {
  Pending = 0,
  InProgress = 1,
  Done = 2,
}

export function statusString(s: Status): string {
  switch (s) {
    case Status.InProgress:
      return "In Progress";
    case Status.Done:
      return "Done";
    default:
      return "Pending";
  }
}

export function statusIcon(s: Status): string {
  switch (s) {
    case Status.InProgress:
      return "◐";
    case Status.Done:
      return "✓";
    default:
      return "○";
  }
}

export function statusNext(s: Status): Status {
  switch (s) {
    case Status.Pending:
      return Status.InProgress;
    case Status.InProgress:
      return Status.Done;
    default:
      return Status.Pending;
  }
}

export enum Priority {
  Low = 0,
  Medium = 1,
  High = 2,
  Urgent = 3,
}

export function priorityString(p: Priority): string {
  switch (p) {
    case Priority.Medium:
      return "Medium";
    case Priority.High:
      return "High";
    case Priority.Urgent:
      return "Urgent";
    default:
      return "Low";
  }
}

export function priorityLabel(p: Priority): string {
  switch (p) {
    case Priority.Medium:
      return "MED";
    case Priority.High:
      return "HIGH";
    case Priority.Urgent:
      return "URG!";
    default:
      return "LOW";
  }
}

export interface Subtask {
  id: number;
  title: string;
  completed: boolean;
  position: number;
}

export interface TaskNote {
  id: number;
  taskId: number;
  body: string;
  createdAt: GoTime;
}

export interface TimeLog {
  id: number;
  taskId: number;
  duration: Duration;
  note: string;
  loggedAt: GoTime;
}

export interface Task {
  id: number;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  dueDate: GoTime | null;
  createdAt: GoTime;
  updatedAt: GoTime;
  subtasks: Subtask[];
  tags: string[];
  metadata: Record<string, string> | null;
  recurFreq: RecurFreq;
  recurInterval: number;
  timeLogs: TimeLog[];
  notes: TaskNote[];
  blockedByIds: number[];
  blocksIds: number[];
}

export function completedSubtasks(t: Task): number {
  return t.subtasks.filter((s) => s.completed).length;
}

export function subtaskProgress(t: Task): number {
  if (t.subtasks.length === 0) return 0;
  return completedSubtasks(t) / t.subtasks.length;
}
