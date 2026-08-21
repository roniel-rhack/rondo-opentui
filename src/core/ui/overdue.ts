import { GoTime } from "../time.ts";
import { theme } from "./colors.ts";

/** How close a due date is. */
export enum DueLevel {
  None = 0,
  Far = 1,
  Soon = 2,
  Today = 3,
  Overdue = 4,
}

/** Classifies a due date relative to today. */
export function dueStatus(dueDate: GoTime, now = GoTime.now()): DueLevel {
  const today = now.truncateDay();
  const due = dueDate.truncateDay();
  const days = Math.trunc(due.sub(today) / 1e6 / (24 * 60 * 60 * 1000));

  if (days < 0) return DueLevel.Overdue;
  if (days === 0) return DueLevel.Today;
  if (days <= 3) return DueLevel.Soon;
  return DueLevel.Far;
}

export function dueColor(level: DueLevel): string {
  switch (level) {
    case DueLevel.Overdue:
      return theme.red;
    case DueLevel.Today:
      return theme.yellow;
    case DueLevel.Soon:
      return theme.orange;
    default:
      return theme.gray;
  }
}

export function dueBold(level: DueLevel): boolean {
  return (
    level === DueLevel.Overdue ||
    level === DueLevel.Today ||
    level === DueLevel.Soon
  );
}

export function dueBadge(level: DueLevel): string {
  switch (level) {
    case DueLevel.Overdue:
      return "OVERDUE";
    case DueLevel.Today:
      return "TODAY";
    case DueLevel.Soon:
      return "SOON";
    default:
      return "";
  }
}
