import type { Config } from "../core/config/config.ts";
import { writeJSON, writeNotes, writeTasks } from "../core/export/export.ts";
import { SessionKind } from "../core/focus/focus.ts";
import { dateTitle, type Note } from "../core/journal/journal.ts";
import { Status, type Task } from "../core/task/task.ts";
import { parseDuration } from "../core/task/timelog.ts";
import { GoTime, parseDueDateInput } from "../core/time.ts";

export type TabId = "all" | "active" | "done" | "journal";

export type TabGroup = "tasks" | "journal";

// Active leads because it is the default view, and All closes the task group
// as the escape hatch for when completed tasks matter. The journal is a
// different kind of thing, so it forms its own group and the header draws a
// divider between the two.
export const TABS: {
  id: TabId;
  label: string;
  icon: string;
  group: TabGroup;
}[] = [
  { id: "active", label: "Active", icon: "◐", group: "tasks" },
  { id: "done", label: "Done", icon: "✓", group: "tasks" },
  { id: "all", label: "All", icon: "▤", group: "tasks" },
  { id: "journal", label: "Journal", icon: "✎", group: "journal" },
];

export type SortKey = "created" | "due" | "priority";

export const SORT_LABELS: Record<SortKey, string> = {
  created: "Created",
  due: "Due date",
  priority: "Priority",
};

export interface Filters {
  query: string;
  tag: string | null;
}

export const emptyFilters: Filters = { query: "", tag: null };

/** Case-insensitive subsequence match with a simple locality score. */
export function fuzzyScore(needle: string, haystack: string): number | null {
  if (needle === "") return 0;
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();

  let score = 0;
  let hIdx = 0;
  let lastMatch = -1;

  for (const ch of n) {
    const found = h.indexOf(ch, hIdx);
    if (found === -1) return null;
    // Consecutive characters score better than scattered ones.
    score += found === lastMatch + 1 ? 3 : 1;
    if (found === 0 || h[found - 1] === " ") score += 2;
    lastMatch = found;
    hIdx = found + 1;
  }
  // Shorter haystacks win ties.
  return score - haystack.length * 0.01;
}

/** Journal notes matching a query, filtered but never re-ranked: the journal
 * reads chronologically, so order is part of its meaning. */
export function visibleNotes(notes: readonly Note[], query: string): Note[] {
  if (query === "") return [...notes];
  return notes.filter((n) => {
    const haystack = `${dateTitle(n)} ${n.entries.map((e) => e.body).join(" ")}`;
    return fuzzyScore(query, haystack) !== null;
  });
}

/** Parses "45m" or "1h30m fixing the build" into a duration plus note. */
export function parseTimeLogInput(raw: string): {
  duration: number;
  note: string;
} {
  const trimmed = raw.trim();
  const space = trimmed.search(/\s/);
  const durationPart = space === -1 ? trimmed : trimmed.slice(0, space);
  const note = space === -1 ? "" : trimmed.slice(space + 1).trim();
  return { duration: parseDuration(durationPart), note };
}

/** Due-date input for the form: same tokens as the CLI due flags. */
export function parseDueInput(raw: string, now: GoTime): GoTime | null {
  return parseDueDateInput(raw, now);
}

/** Toast for the focus toggle, matching what actually starts or stops. */
export function focusStatusMessage(
  running: boolean,
  kind: SessionKind,
  cfg: Config,
): string {
  if (running) return "Focus stopped";
  switch (kind) {
    case SessionKind.ShortBreak:
      return `Break started (${cfg.focus.shortBreakDuration}m)`;
    case SessionKind.LongBreak:
      return `Break started (${cfg.focus.longBreakDuration}m)`;
    default:
      return `Focus started (${cfg.focus.workDuration}m)`;
  }
}

/** Errors deserve more reading time than confirmations. */
export function toastDuration(kind: "info" | "success" | "error"): number {
  return kind === "error" ? 6400 : 3200;
}

/** Full export, both stores, in either format. */
export function exportContent(
  format: "md" | "json",
  tasks: readonly Task[],
  notes: readonly Note[],
): string {
  if (format === "json") return writeJSON(tasks, notes);
  return `${writeTasks(tasks)}\n${writeNotes(notes)}`;
}

/** Tasks shown for a tab, after filtering and sorting. */
export function visibleTasks(
  tasks: readonly Task[],
  tab: TabId,
  filters: Filters,
  sort: SortKey,
): Task[] {
  let out = [...tasks];

  if (tab === "active") {
    out = out.filter((t) => t.status !== Status.Done);
  } else if (tab === "done") {
    out = out.filter((t) => t.status === Status.Done);
  }

  if (filters.tag) {
    const tag = filters.tag.toLowerCase();
    out = out.filter((t) => t.tags.some((x) => x.toLowerCase() === tag));
  }

  if (filters.query !== "") {
    out = out
      .map((t) => ({
        task: t,
        score: fuzzyScore(
          filters.query,
          `${t.title} ${t.description} ${t.tags.join(" ")}`,
        ),
      }))
      .filter((r) => r.score !== null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .map((r) => r.task);
    return out;
  }

  switch (sort) {
    case "due":
      out.sort((a, b) => {
        if (!a.dueDate) return b.dueDate ? 1 : 0;
        if (!b.dueDate) return -1;
        return a.dueDate.ms - b.dueDate.ms;
      });
      break;
    case "priority":
      out.sort((a, b) => b.priority - a.priority || b.createdAt.ms - a.createdAt.ms);
      break;
    default:
      out.sort((a, b) => b.createdAt.ms - a.createdAt.ms || b.id - a.id);
  }
  return out;
}

export interface TabCounts {
  all: number;
  active: number;
  done: number;
  journal: number;
}

export function tabCounts(tasks: readonly Task[], notes: number): TabCounts {
  let active = 0;
  let done = 0;
  for (const t of tasks) {
    if (t.status === Status.Done) done++;
    else active++;
  }
  return { all: tasks.length, active, done, journal: notes };
}

/** All tags in use, sorted by frequency then name. */
export function collectTags(tasks: readonly Task[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const t of tasks) {
    for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function clampIndex(index: number, length: number): number {
  if (length === 0) return 0;
  if (index < 0) return 0;
  if (index >= length) return length - 1;
  return index;
}
