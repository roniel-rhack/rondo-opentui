import type { Config } from "../core/config/config.ts";
import { writeJSON, writeNotes, writeTasks } from "../core/export/export.ts";
import { SessionKind } from "../core/focus/focus.ts";
import { dateTitle, type Note } from "../core/journal/journal.ts";
import { isBlocked } from "../core/task/deps.ts";
import { RecurFreq } from "../core/task/recur.ts";
import { Priority, Status, type Task } from "../core/task/task.ts";
import { parseDuration } from "../core/task/timelog.ts";
import { GoTime, parseDueDateInput, sameDay } from "../core/time.ts";
import { DueLevel } from "../core/ui/overdue.ts";

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
  key: string;
}[] = [
  { id: "active", label: "Active", icon: "◐", group: "tasks", key: "1" },
  { id: "done", label: "Done", icon: "✓", group: "tasks", key: "2" },
  { id: "all", label: "All", icon: "▤", group: "tasks", key: "3" },
  { id: "journal", label: "Journal", icon: "✎", group: "journal", key: "4" },
];

export type SortKey = "created" | "due" | "priority";

export const SORT_LABELS: Record<SortKey, string> = {
  created: "Created",
  due: "Due date",
  priority: "Priority",
};

export type View = "all" | "today" | "overdue" | "week" | "blocked";

export const VIEWS: View[] = ["all", "today", "overdue", "week", "blocked"];

export const VIEW_LABELS: Record<View, string> = {
  all: "All",
  today: "Today",
  overdue: "Overdue",
  week: "This week",
  blocked: "Blocked",
};

export interface Filters {
  query: string;
  tag: string | null;
  view: View;
}

export const emptyFilters: Filters = { query: "", tag: null, view: "all" };

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

const PRIORITY_TOKENS: Record<string, Priority> = {
  "1": Priority.Low,
  "2": Priority.Medium,
  "3": Priority.High,
  "4": Priority.Urgent,
  low: Priority.Low,
  med: Priority.Medium,
  medium: Priority.Medium,
  high: Priority.High,
  urgent: Priority.Urgent,
};

function priorityToken(word: string): Priority | null {
  if (!word.startsWith("!")) return null;
  return PRIORITY_TOKENS[word.slice(1).toLowerCase()] ?? null;
}

function tagToken(word: string): string | null {
  return word.length > 1 && word.startsWith("#") ? word.slice(1) : null;
}

function splitWords(raw: string): string[] {
  return raw.split(/\s+/).filter((w) => w !== "");
}

export interface ParsedQuery {
  text: string;
  tags: string[];
  priority: Priority | null;
  due: "today" | "week" | "overdue" | null;
  is: ("blocked" | "recurring")[];
}

/** Splits a filter query into field tokens and the free text that is left
 * for fuzzy matching. Unknown tokens stay text, so a typo still searches. */
export function parseFilterQuery(raw: string): ParsedQuery {
  const out: ParsedQuery = { text: "", tags: [], priority: null, due: null, is: [] };
  const text: string[] = [];
  for (const word of splitWords(raw)) {
    const tag = tagToken(word);
    const priority = priorityToken(word);
    const lower = word.toLowerCase();
    if (tag !== null) out.tags.push(tag);
    else if (priority !== null) out.priority = priority;
    else if (lower === "due:today" || lower === "due:week" || lower === "due:overdue") {
      out.due = lower.slice(4) as ParsedQuery["due"];
    } else if (lower === "is:blocked" || lower === "is:recurring") {
      const flag = lower.slice(3) as "blocked" | "recurring";
      if (!out.is.includes(flag)) out.is.push(flag);
    } else text.push(word);
  }
  out.text = text.join(" ");
  return out;
}

/** Ids of tasks with at least one open blocker. A blocker missing from the
 * list cannot be open, so it does not block. */
export function blockedIds(tasks: readonly Task[]): Set<number> {
  const status = new Map<number, Status>();
  for (const t of tasks) status.set(t.id, t.status);
  const out = new Set<number>();
  for (const t of tasks) {
    if (isBlocked(t.blockedByIds, (id) => status.get(id) ?? Status.Done)) {
      out.add(t.id);
    }
  }
  return out;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from now's calendar day to the due date's. Due dates are
 * UTC-anchored and "now" is local, so this compares calendar dates rather
 * than instants: a task due today is still "today" at 23:30. */
function dayOffset(due: GoTime, now: GoTime): number {
  const d = due.parts;
  const n = now.parts;
  return Math.round(
    (Date.UTC(d.year, d.month - 1, d.day) - Date.UTC(n.year, n.month - 1, n.day)) /
      DAY_MS,
  );
}

function levelFor(days: number): DueLevel {
  if (days < 0) return DueLevel.Overdue;
  if (days === 0) return DueLevel.Today;
  if (days <= 3) return DueLevel.Soon;
  return DueLevel.Far;
}

function matchesDue(
  task: Task,
  which: "today" | "week" | "overdue",
  now: GoTime,
): boolean {
  if (!task.dueDate) return false;
  const days = dayOffset(task.dueDate, now);
  switch (which) {
    case "today":
      return days === 0;
    case "overdue":
      return days < 0;
    default:
      return days >= 0 && days <= 7;
  }
}

type Cmp = (a: Task, b: Task) => number;

const dueAsc: Cmp = (a, b) => {
  if (!a.dueDate) return b.dueDate ? 1 : 0;
  if (!b.dueDate) return -1;
  return a.dueDate.ms - b.dueDate.ms;
};
const priorityDesc: Cmp = (a, b) => b.priority - a.priority;
const createdDesc: Cmp = (a, b) => b.createdAt.ms - a.createdAt.ms;
const updatedDesc: Cmp = (a, b) => b.updatedAt.ms - a.updatedAt.ms;
const idDesc: Cmp = (a, b) => b.id - a.id;

function sortChain(tab: TabId, sort: SortKey): Cmp[] {
  switch (sort) {
    case "due":
      return [dueAsc, priorityDesc, createdDesc, idDesc];
    case "priority":
      return [priorityDesc, createdDesc, idDesc];
    default:
      // The Done tab reads as a log of what got finished, so completion
      // time (updatedAt in the common case) beats creation time there.
      return tab === "done" ? [updatedDesc, idDesc] : [createdDesc, idDesc];
  }
}

/** Tasks shown for a tab, after filtering and sorting. A query never takes
 * over the order: the sort key stays primary and the fuzzy score only breaks
 * ties inside it, so `o` and the sort indicator keep their meaning. */
export function visibleTasks(
  tasks: readonly Task[],
  tab: TabId,
  filters: Filters,
  sort: SortKey,
  now: GoTime = GoTime.now(),
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

  const parsed = parseFilterQuery(filters.query);
  const wantBlocked = filters.view === "blocked" || parsed.is.includes("blocked");
  // Blockers may live outside the tab, so the set comes from every task.
  const blocked = wantBlocked ? blockedIds(tasks) : new Set<number>();

  if (filters.view === "blocked") {
    out = out.filter((t) => blocked.has(t.id));
  } else if (filters.view !== "all") {
    const view = filters.view;
    out = out.filter((t) => matchesDue(t, view, now));
  }

  if (parsed.tags.length > 0) {
    const wanted = parsed.tags.map((x) => x.toLowerCase());
    out = out.filter((t) => {
      const own = t.tags.map((x) => x.toLowerCase());
      return wanted.every((x) => own.includes(x));
    });
  }
  if (parsed.priority !== null) {
    out = out.filter((t) => t.priority === parsed.priority);
  }
  if (parsed.due !== null) {
    const which = parsed.due;
    out = out.filter((t) => matchesDue(t, which, now));
  }
  if (parsed.is.includes("blocked")) out = out.filter((t) => blocked.has(t.id));
  if (parsed.is.includes("recurring")) {
    out = out.filter((t) => t.recurFreq !== RecurFreq.None);
  }

  const chain = sortChain(tab, sort);
  if (parsed.text !== "") {
    const scores = new Map<number, number>();
    for (const t of out) {
      const score = fuzzyScore(
        parsed.text,
        `${t.title} ${t.description} ${t.tags.join(" ")}`,
      );
      if (score !== null) scores.set(t.id, score);
    }
    out = out.filter((t) => scores.has(t.id));
    const scoreDesc: Cmp = (a, b) => scores.get(b.id)! - scores.get(a.id)!;
    chain.splice(1, 0, scoreDesc);
  }

  out.sort((a, b) => {
    for (const cmp of chain) {
      const r = cmp(a, b);
      if (r !== 0) return r;
    }
    return 0;
  });
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

export interface Hint {
  key: string;
  label: string;
  run?: () => void;
}

function hintCost(h: Hint): number {
  // Keycap padding on both sides, the gap before the label, trailing space.
  return h.key.length + 2 + 1 + h.label.length + 1;
}

function trimHints(
  hints: readonly Hint[],
  available: number,
  keepKeys: readonly string[],
): Hint[] {
  const out = [...hints];
  let total = out.reduce((n, h) => n + hintCost(h), 0);
  // Least important first: from the end, skipping the keys that must stay
  // visible; only when those alone still overflow do they go too.
  for (const protect of [true, false]) {
    for (let i = out.length - 1; i >= 0 && total > available; i--) {
      if (protect && keepKeys.includes(out[i]!.key)) continue;
      total -= hintCost(out[i]!);
      out.splice(i, 1);
    }
  }
  return out;
}

/** Hints that fit in `available` columns. Drops from the end but keeps the
 * help and palette keys while they fit; when even those overflow with their
 * labels, falls back to bare keycaps. */
export function fitHints(
  hints: readonly Hint[],
  available: number,
  keepKeys: readonly string[] = ["?", "^k"],
): Hint[] {
  const labeled = trimHints(hints, available, keepKeys);
  const mustShow = keepKeys.filter((k) => hints.some((h) => h.key === k));
  if (mustShow.every((k) => labeled.some((h) => h.key === k))) return labeled;
  const caps = hints.map((h) => ({ ...h, label: "" }));
  return trimHints(caps, available, keepKeys);
}

/** Tag chips that fit in `available` columns, reserving room for the
 * "tags " prefix, the "all" chip and a trailing "+N" chip. */
export function fitTags(
  tags: readonly { tag: string; count: number }[],
  available: number,
): { shown: { tag: string; count: number }[]; hidden: number } {
  const budget = available - 5 - 5 - 5;
  const shown: { tag: string; count: number }[] = [];
  let used = 0;
  for (const t of tags) {
    const cost = t.tag.length + String(t.count).length + 4;
    if (used + cost > budget) break;
    used += cost;
    shown.push(t);
  }
  return { shown, hidden: tags.length - shown.length };
}

/** Human distance to a due date, with its urgency level. */
export function relativeDue(
  due: GoTime,
  now: GoTime,
): { label: string; level: DueLevel } {
  const days = dayOffset(due, now);
  const level = levelFor(days);
  if (days === 0) return { label: "today", level };
  if (days === 1) return { label: "tomorrow", level };
  if (days === -1) return { label: "yesterday", level };
  if (days < 0) return { label: `${-days}d late`, level };
  if (days <= 6) return { label: due.format("Mon"), level };
  if (days <= 14) return { label: `in ${days}d`, level };
  return { label: due.format("Jan 02"), level };
}

export interface TaskGroup {
  label: string;
  tasks: Task[];
}

const DUE_GROUPS = ["Overdue", "Today", "This week", "Later", "No date"];
const PRIORITY_GROUPS = ["Urgent", "High", "Medium", "Low"];

/** Section headers for a sorted list. Tasks keep their incoming order inside
 * each group; empty groups are omitted. */
export function groupTasks(
  tasks: readonly Task[],
  sort: SortKey,
  now: GoTime,
): TaskGroup[] {
  if (tasks.length === 0) return [];
  let labels: readonly string[];
  let labelOf: (t: Task) => string;
  switch (sort) {
    case "due":
      labels = DUE_GROUPS;
      labelOf = (t) => {
        if (!t.dueDate) return "No date";
        const days = dayOffset(t.dueDate, now);
        if (days < 0) return "Overdue";
        if (days === 0) return "Today";
        if (days <= 7) return "This week";
        return "Later";
      };
      break;
    case "priority":
      labels = PRIORITY_GROUPS;
      labelOf = (t) => PRIORITY_GROUPS[Priority.Urgent - t.priority] ?? "Low";
      break;
    default:
      return [{ label: "", tasks: [...tasks] }];
  }
  const buckets = new Map<string, Task[]>(labels.map((l) => [l, []]));
  for (const t of tasks) buckets.get(labelOf(t))!.push(t);
  return labels
    .map((label) => ({ label, tasks: buckets.get(label)! }))
    .filter((g) => g.tasks.length > 0);
}

/** Position of `id` in `items`, or the clamped fallback when it is gone. */
export function indexOfId<T extends { id: number }>(
  items: readonly T[],
  id: number | null,
  fallback: number,
): number {
  if (id !== null) {
    const idx = items.findIndex((x) => x.id === id);
    if (idx !== -1) return idx;
  }
  return clampIndex(fallback, items.length);
}

/** Nanoseconds logged after `cutoff`, like `timelog summary --days`. */
export function loggedSince(tasks: readonly Task[], cutoff: GoTime): number {
  let total = 0;
  for (const t of tasks) {
    for (const l of t.timeLogs) if (l.loggedAt.after(cutoff)) total += l.duration;
  }
  return total;
}

/** Done tasks whose last update falls on now's calendar day. */
export function doneToday(tasks: readonly Task[], now: GoTime): number {
  let n = 0;
  for (const t of tasks) {
    if (t.status === Status.Done && sameDay(t.updatedAt.in(now.loc), now)) n++;
  }
  return n;
}

export type DetailRow = {
  kind: "subtask" | "note" | "timelog";
  id: number;
  index: number;
};

/** The detail panel's cursor walks subtasks, notes and time logs as one
 * list; `index` is the position inside its own kind. */
export function detailRows(task: Task): DetailRow[] {
  return [
    ...task.subtasks.map((s, index) => ({ kind: "subtask" as const, id: s.id, index })),
    ...task.notes.map((n, index) => ({ kind: "note" as const, id: n.id, index })),
    ...task.timeLogs.map((l, index) => ({ kind: "timelog" as const, id: l.id, index })),
  ];
}

export interface QuickAdd {
  title: string;
  tags: string[];
  priority: Priority | null;
  /** `undefined` when no token was given, `null` for "@none". */
  due: GoTime | null | undefined;
  recur: RecurFreq | null;
}

const RECUR_TOKENS: Record<string, RecurFreq> = {
  d: RecurFreq.Daily,
  daily: RecurFreq.Daily,
  w: RecurFreq.Weekly,
  weekly: RecurFreq.Weekly,
  m: RecurFreq.Monthly,
  monthly: RecurFreq.Monthly,
  y: RecurFreq.Yearly,
  yearly: RecurFreq.Yearly,
  none: RecurFreq.None,
};

function dueToken(word: string, now: GoTime): GoTime | null | undefined {
  if (!word.startsWith("@") || word.length === 1) return undefined;
  const value = word.slice(1).toLowerCase();
  try {
    return parseDueDateInput(value === "tom" ? "tomorrow" : value, now);
  } catch {
    return undefined;
  }
}

/** Inline capture syntax: whole-word tokens anywhere in the title set tags,
 * due date, priority and recurrence; anything unrecognised stays in the
 * title so an email address or "C#" survives. */
export function parseQuickAdd(raw: string, now: GoTime): QuickAdd {
  const out: QuickAdd = {
    title: "",
    tags: [],
    priority: null,
    due: undefined,
    recur: null,
  };
  const words: string[] = [];
  for (const word of splitWords(raw)) {
    const tag = tagToken(word);
    const priority = priorityToken(word);
    const due = dueToken(word, now);
    const recur = word.startsWith("~")
      ? RECUR_TOKENS[word.slice(1).toLowerCase()]
      : undefined;
    if (tag !== null) {
      if (!out.tags.includes(tag)) out.tags.push(tag);
    } else if (priority !== null) out.priority = priority;
    else if (due !== undefined) out.due = due;
    else if (recur !== undefined) out.recur = recur;
    else words.push(word);
  }
  out.title = words.join(" ");
  return out;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Rows a page key moves by: one screen of rows minus one for context. */
export function pageSize(height: number, rowHeight: number, chrome: number): number {
  return Math.max(1, Math.floor((height - chrome) / rowHeight) - 1);
}
