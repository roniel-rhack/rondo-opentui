import { GoTime } from "../time.ts";
import type { Task } from "./task.ts";

export enum RecurFreq {
  None = 0,
  Daily = 1,
  Weekly = 2,
  Monthly = 3,
  Yearly = 4,
}

export function recurFreqString(f: RecurFreq): string {
  switch (f) {
    case RecurFreq.Daily:
      return "daily";
    case RecurFreq.Weekly:
      return "weekly";
    case RecurFreq.Monthly:
      return "monthly";
    case RecurFreq.Yearly:
      return "yearly";
    default:
      return "none";
  }
}

export function parseRecurFreq(s: string): RecurFreq {
  switch (s) {
    case "daily":
      return RecurFreq.Daily;
    case "weekly":
      return RecurFreq.Weekly;
    case "monthly":
      return RecurFreq.Monthly;
    case "yearly":
      return RecurFreq.Yearly;
    default:
      return RecurFreq.None;
  }
}

/**
 * Calculates the next due date from the task's recurrence settings. Tasks
 * without a due date use the current time as base and an interval of 0 is
 * treated as 1.
 */
export function nextDueDate(
  t: Pick<Task, "dueDate" | "recurFreq" | "recurInterval">,
): GoTime {
  const base = t.dueDate ?? GoTime.now();
  const interval = t.recurInterval > 0 ? t.recurInterval : 1;

  switch (t.recurFreq) {
    case RecurFreq.Daily:
      return base.addDate(0, 0, interval);
    case RecurFreq.Weekly:
      return base.addDate(0, 0, 7 * interval);
    case RecurFreq.Monthly:
      return base.addDate(0, interval, 0);
    case RecurFreq.Yearly:
      return base.addDate(interval, 0, 0);
    default:
      return base;
  }
}
