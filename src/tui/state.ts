import { Status, type Task } from "../core/task/task.ts";

export type TabId = "all" | "active" | "done" | "journal";

export const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "all", label: "All", icon: "▤" },
  { id: "active", label: "Active", icon: "◐" },
  { id: "done", label: "Done", icon: "✓" },
  { id: "journal", label: "Journal", icon: "✎" },
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

export function matchesQuery(t: Task, query: string): boolean {
  if (query === "") return true;
  const haystack = `${t.title} ${t.description} ${t.tags.join(" ")}`;
  return fuzzyScore(query, haystack) !== null;
}

export function statusForTab(tab: TabId): Status | null {
  switch (tab) {
    case "active":
      return Status.InProgress;
    case "done":
      return Status.Done;
    default:
      return null;
  }
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
