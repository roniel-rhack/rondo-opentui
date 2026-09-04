import { cellWidth, fitCells } from "./text.ts";
import type { Config } from "../core/config/config.ts";
import type { Density, PanelLayout, TuiState } from "../core/config/tui-state.ts";
import { writeJSON, writeNotes, writeTasks } from "../core/export/export.ts";
import { SessionKind } from "../core/focus/focus.ts";
import { dateTitle, type Note } from "../core/journal/journal.ts";
import { isBlocked } from "../core/task/deps.ts";
import { RecurFreq } from "../core/task/recur.ts";
import { Priority, Status, statusString, type Task } from "../core/task/task.ts";
import { parseDuration } from "../core/task/timelog.ts";
import { DateOnly, GoTime, parseDueDateInput, sameDay } from "../core/time.ts";
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

export function nextView(view: View): View {
  return VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length]!;
}

export function viewToast(view: View): string {
  return `View: ${VIEW_LABELS[view]}`;
}

/** "3 overdue of 12" for a narrowed view; the caller handles "all". */
export function viewSubtitle(view: View, shown: number, total: number): string {
  return `${shown} ${VIEW_LABELS[view].toLowerCase()} of ${total}`;
}

/** The tag after (or before) `current` in `tags`, with null for "all" at
 * both ends of the cycle, so `]` from the last tag clears the filter. */
export function cycleTag(
  tags: readonly { tag: string }[],
  current: string | null,
  delta: 1 | -1,
): string | null {
  const ring: (string | null)[] = [null, ...tags.map((t) => t.tag)];
  const at = ring.indexOf(current);
  const from = at === -1 ? 0 : at;
  return ring[(from + delta + ring.length) % ring.length] ?? null;
}

/** A copy of `set` with `id` added or removed. */
export function toggleInSet(set: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** "3 tasks → Done · u undo": one toast for a bulk action. */
export function bulkToast(count: number, what: string): string {
  return `${plural(count, "task")} → ${what} · u undo`;
}

/** `tasks` with the entries for `fresh` ids swapped for their new copies
 * and the ones that came back null dropped; every other object keeps its
 * identity, so memoized rows stay put. */
export function withTasks(
  tasks: readonly Task[],
  fresh: ReadonlyMap<number, Task | null>,
): Task[] {
  const out: Task[] = [];
  for (const t of tasks) {
    if (!fresh.has(t.id)) {
      out.push(t);
      continue;
    }
    const next = fresh.get(t.id);
    if (next) out.push(next);
  }
  return out;
}

export interface RestoredTuiState {
  tab: TabId;
  sort: SortKey;
  tagBar: boolean;
  tag: string | null;
  view: View;
  selectedTaskId: number | null;
  selectedNoteDate: string | null;
  density: Density;
  layout?: PanelLayout;
  reducedMotion?: boolean;
}

const SORT_KEYS: readonly SortKey[] = ["created", "due", "priority"];

/** Narrows a saved state to values the app knows; anything else falls back
 * to the default, so an edited file cannot put the app in a state it has no
 * key for. */
export function restoreTuiState(saved: TuiState): RestoredTuiState {
  return {
    tab: TABS.some((t) => t.id === saved.tab) ? (saved.tab as TabId) : "active",
    sort: SORT_KEYS.includes(saved.sort as SortKey) ? (saved.sort as SortKey) : "due",
    tagBar: saved.tagBar,
    tag: saved.tag,
    view: VIEWS.includes(saved.view as View) ? (saved.view as View) : "all",
    selectedTaskId: saved.selectedTaskId,
    selectedNoteDate: saved.selectedNoteDate,
    density: saved.density,
    ...(saved.layout ? { layout: saved.layout } : {}),
    ...(saved.reducedMotion !== undefined ? { reducedMotion: saved.reducedMotion } : {}),
  };
}

/** A restored tag filter, dropped when no task carries the tag any more: a
 * tag renamed from the CLI would otherwise come back as an empty list with
 * nothing on screen naming the filter. */
export function restoredTag(
  tag: string | null,
  tasks: readonly Task[],
): string | null {
  if (tag === null) return null;
  const wanted = tag.toLowerCase();
  const known = tasks.some((t) =>
    t.tags.some((x) => x.toLowerCase() === wanted),
  );
  return known ? tag : null;
}

/** Positions of `needle` in `haystack`, both lowercased: the needle as one
 * run when it occurs whole, else the greedy left-to-right subsequence. The
 * whole run is tried first so "subt" lands on "subtask" rather than on a
 * stray s two words earlier. */
function matchIndices(needle: string, haystack: string): number[] | null {
  const at = haystack.indexOf(needle);
  if (at !== -1) return Array.from({ length: needle.length }, (_, i) => at + i);
  const out: number[] = [];
  let hIdx = 0;
  for (const ch of needle) {
    const found = haystack.indexOf(ch, hIdx);
    if (found === -1) return null;
    out.push(found);
    hIdx = found + 1;
  }
  return out;
}

/** Case-insensitive subsequence match with a simple locality score. */
export function fuzzyScore(needle: string, haystack: string): number | null {
  if (needle === "") return 0;
  const h = haystack.toLowerCase();
  const hits = matchIndices(needle.toLowerCase(), h);
  if (hits === null) return null;

  let score = 0;
  let lastMatch = -1;
  for (const found of hits) {
    // Consecutive characters score better than scattered ones.
    score += found === lastMatch + 1 ? 3 : 1;
    if (found === 0 || h[found - 1] === " ") score += 2;
    lastMatch = found;
  }
  // An early match beats a late one of the same shape: the title comes
  // before the description, and "re" should mean Refactor before report.
  // Shorter haystacks win what is left.
  return score - (hits[0] ?? 0) * 0.05 - haystack.length * 0.01;
}

/** Positions in `haystack` that `fuzzyScore` counted, so what a row lights
 * up is what ranked it. Null when there is no match; empty for an empty
 * needle. */
export function fuzzyIndices(needle: string, haystack: string): number[] | null {
  if (needle === "") return [];
  return matchIndices(needle.toLowerCase(), haystack.toLowerCase());
}

/** Highlight positions for a row ranked as `prefix + text` that only draws
 * `text`: the text alone is tried first, so a query that fits the label
 * lights the label; only a match that needed the prefix ("#12 fix") falls
 * back to the shared walk, re-based on the text. */
export function fuzzyIndicesAfter(
  needle: string,
  prefix: string,
  text: string,
): number[] {
  const own = fuzzyIndices(needle, text);
  if (own !== null) return own;
  const hits = fuzzyIndices(needle, `${prefix}${text}`) ?? [];
  return hits.filter((i) => i >= prefix.length).map((i) => i - prefix.length);
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

/** Toast for the focus toggle, matching what actually starts or stops. A
 * work session names the task it is attached to, since that is what the
 * timer will log to when it ends. */
export function focusStatusMessage(
  running: boolean,
  kind: SessionKind,
  cfg: Config,
  task?: { id: number; title: string } | null,
): string {
  if (running) return "Focus stopped";
  switch (kind) {
    case SessionKind.ShortBreak:
      return `Break started (${cfg.focus.shortBreakDuration}m)`;
    case SessionKind.LongBreak:
      return `Break started (${cfg.focus.longBreakDuration}m)`;
    default: {
      const on = task ? ` · #${task.id} ${excerptOf(task.title, 40)}` : "";
      return `Focus started (${cfg.focus.workDuration}m)${on}`;
    }
  }
}

export type ToastKind = "info" | "success" | "error" | "undo";

/** Errors deserve more reading time than confirmations, and so does a
 * delete that went through without asking: the toast is the undo window. */
export function toastDuration(kind: ToastKind): number {
  return kind === "error" || kind === "undo" ? 6400 : 3200;
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

/** Tasks only, the CLI's `export` without `--journal`. */
export function exportTasksContent(
  format: "md" | "json",
  tasks: readonly Task[],
): string {
  if (format === "json") return writeJSON(tasks, null);
  return writeTasks(tasks);
}

/** Dated default name, so a daily export never lands on yesterday's file. */
export function exportFileName(format: "md" | "json", now: GoTime): string {
  return `rondo-${now.format(DateOnly)}.${format}`;
}

/** `path`, or the first of `path-2`, `path-3`… that does not exist yet, so
 * an export never overwrites a file silently. */
export function uniquePath(path: string, exists: (p: string) => boolean): string {
  if (!exists(path)) return path;
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");
  const stem = dot > slash ? path.slice(0, dot) : path;
  const ext = dot > slash ? path.slice(dot) : "";
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`;
    if (!exists(candidate)) return candidate;
  }
}

/** Toast for a status change. Completing a recurring task spawns the next
 * occurrence, and undo removes it again, so the toast says which one. */
export function statusToast(
  taskId: number,
  status: Status,
  spawnedId: number | null,
): string {
  const spawn = spawnedId !== null ? ` · next is #${spawnedId}` : "";
  return `#${taskId} → ${statusString(status)}${spawn} · u undo`;
}

/** The sort still applies under a query (the score only breaks ties), but
 * the rows may not visibly move, so the toast says why. */
export function sortToast(sort: SortKey, filtered: boolean): string {
  return `Sorted by ${SORT_LABELS[sort].toLowerCase()}${filtered ? " (filter active)" : ""}`;
}

/** One step along the scale, or null at either end. */
export function stepPriority(priority: Priority, delta: 1 | -1): Priority | null {
  const next = priority + delta;
  if (next < Priority.Low || next > Priority.Urgent) return null;
  return next as Priority;
}

/** Quick answers for the due-date prompt; every value is a token the
 * parser accepts, so a chip and a typed word take the same path. */
export const DUE_CHIPS: { key: string; label: string; value: string }[] = [
  { key: "t", label: "today", value: "today" },
  { key: "m", label: "tomorrow", value: "tomorrow" },
  { key: "w", label: "+1w", value: "+1w" },
  { key: "n", label: "none", value: "none" },
];

/** Go-style duration without spaces, the form parseDuration reads back:
 * formatDuration's "1h 30m" would split into a 1h log with note "30m". */
export function durationInput(d: number): string {
  const totalMinutes = Math.max(0, Math.trunc(d / 60_000_000_000));
  const hours = Math.trunc(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours}h${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

/** What the time-log prompt shows when re-editing an entry. */
export function timeLogInput(log: { duration: number; note: string }): string {
  return `${durationInput(log.duration)} ${log.note}`.trim();
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
    const cost = cellWidth(t.tag) + String(t.count).length + 4;
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

/** Plain-language distance to a due date, for the detail panel's due line:
 * the list's `relativeDue` is a column, this one is a sentence. */
export function dueSentence(due: GoTime, now: GoTime): string {
  const days = dayOffset(due, now);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days < 0) return `${plural(-days, "day")} overdue`;
  return `in ${plural(days, "day")}`;
}

// Done closes the due list: a finished task is not overdue, whatever its
// date says, so it never inflates the Overdue count.
const DUE_GROUPS = ["Overdue", "Today", "This week", "Later", "No date", "Done"];
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
        if (t.status === Status.Done) return "Done";
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

/** Position of the note for `date` (YYYY-MM-DD), or the clamped fallback. */
export function indexOfNoteDate(
  notes: readonly Note[],
  date: string | null,
  fallback: number,
): number {
  if (date !== null) {
    const idx = notes.findIndex((n) => n.date.format(DateOnly) === date);
    if (idx !== -1) return idx;
  }
  return clampIndex(fallback, notes.length);
}

/** Narrowest list that still shows a readable title next to its glyphs. */
const LIST_MIN_WIDTH = 34;
/** Narrowest detail panel whose fields fit beside their labels. */
const DETAIL_MIN_WIDTH = 40;

/** Panel ratio kept inside what the terminal can show: neither panel drops
 * below its minimum. On a terminal too narrow for both the list wins. */
export function clampRatio(ratio: number, width: number): number {
  const min = LIST_MIN_WIDTH / width;
  const max = Math.max(min, (width - DETAIL_MIN_WIDTH - 1) / width);
  return Math.min(Math.max(ratio, min), max);
}

/** List columns for a ratio, clamped the same way so a ratio saved from a
 * wider terminal cannot squeeze either panel. */
export function listWidthFor(ratio: number, width: number): number {
  return Math.round(width * clampRatio(ratio, width));
}

/** Panel borders, rail indent and the scrollbar gutter around a list row. */
const META_CHROME = 8;

/** Columns a list of `width` leaves to a row's metadata cells. */
export function metaWidthFor(width: number): number {
  return Math.max(width - META_CHROME, 10);
}

/** Blank line between rows, the one thing density changes: a row is always
 * its title plus a metadata line, whatever the width. It is the density that
 * decides, not the height: "comfortable" keeps the line on a short terminal,
 * which is the point of asking for it. */
export function rowGap(density: Density, height: number): number {
  if (density === "comfortable") return 1;
  if (density === "dense") return 0;
  return height < 30 ? 0 : 1;
}

/** How many chip labels fit in `available` columns, given each chip's one
 * column of padding on both sides and the gap after it. */
export function fitChips(labels: readonly string[], available: number): number {
  let used = 0;
  let n = 0;
  for (const label of labels) {
    used += cellWidth(label) + 3;
    if (used > available) break;
    n++;
  }
  return n;
}

export function cycleDensity(density: Density): Density {
  switch (density) {
    case "auto":
      return "dense";
    case "dense":
      return "comfortable";
    default:
      return "auto";
  }
}

/** Open tasks before done ones, each group in its incoming order. */
export function openFirst(tasks: readonly Task[]): Task[] {
  return [
    ...tasks.filter((t) => t.status !== Status.Done),
    ...tasks.filter((t) => t.status === Status.Done),
  ];
}

/** One line of at most `max` terminal cells, for quoting what a dialog acts on. */
export function excerptOf(text: string, max = 48): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return fitCells(flat, max);
}

/** `excerptOf` with the markdown the app renders stripped first, so a
 * journal day's preview reads as prose rather than as `**` and `#`. */
export function plainExcerpt(text: string, max = 48): string {
  const plain = text
    .split("\n")
    .map((line) => line.replace(/^\s*(#{1,6}\s+|>\s+|[-*]\s+)/, ""))
    .join(" ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1");
  return excerptOf(plain, max);
}

export type HintAction =
  | "add"
  | "addDay"
  | "edit"
  | "editTask"
  | "editTags"
  | "foldDescription"
  | "delete"
  | "done"
  | "start"
  | "due"
  | "toggle"
  | "subtask"
  | "note"
  | "time"
  | "filter"
  | "view"
  | "tag"
  | "mark"
  | "clearMarks"
  | "focus"
  | "block"
  | "back"
  | "details"
  | "hide"
  | "hidden"
  | "keep"
  | "clear"
  | "palette"
  | "help"
  | "closeModal"
  | "previousMatch"
  | "nextMatch";

export interface HintSpec {
  key: string;
  label: string;
  /** What the keycap runs when clicked; null for keys that only describe. */
  action: HintAction | null;
}

export interface HintContext {
  tab: TabId;
  panel: 0 | 1;
  compact: boolean;
  searching: boolean;
  modal?: string;
  creating?: boolean;
  multiline?: boolean;
  presets?: boolean;
  drafts?: boolean;
  hasMatches?: boolean;
  /** Kind of the detail row under the cursor; null or absent when the
   * detail panel has no rows to walk. */
  row?: DetailRow["kind"] | null;
  /** Tasks marked for a bulk action; the list keys then act on all of them. */
  marked?: number;
  /** Whether the selected task is completed, so space and s name what they
   * would actually do to it. */
  done?: boolean;
}

const HINT_TAIL: HintSpec[] = [
  { key: "^k", label: "palette", action: "palette" },
  { key: "?", label: "help", action: "help" },
];

/** Status-bar hints for the focused surface, most useful first so trimming
 * from the end keeps the keys that matter; the palette and help close every
 * list. */
export function hintSpecs(ctx: HintContext): HintSpec[] {
  if (ctx.modal && ctx.modal !== "none") {
    const cancel: HintSpec = { key: "esc", label: "close", action: "closeModal" };
    if (ctx.modal === "task-form") return [
      { key: "^s", label: "save", action: null },
      ...(ctx.creating ? [{ key: "^n", label: "save + new", action: null }] : []),
      { key: "tab", label: "field", action: null },
      { key: "^r", label: "discard", action: null }, cancel,
    ];
    if (ctx.modal === "prompt") return [
      ...(ctx.presets ? [{ key: "↑↓", label: "presets", action: null }] : []),
      { key: ctx.multiline ? "^s" : "enter", label: "save", action: null },
      ...(ctx.drafts ? [{ key: "^r", label: "discard", action: null }] : []), cancel,
    ];
    if (ctx.modal === "tag-edit") return [
      { key: "enter", label: "toggle", action: null },
      { key: "^s", label: "save", action: null },
      { key: "tab", label: "search/list", action: null }, cancel,
    ];
    if (ctx.modal === "confirm") return [
      { key: "y", label: "confirm", action: null },
      { key: "n", label: "cancel", action: "closeModal" }, cancel,
    ];
    if (ctx.modal === "help" || ctx.modal === "stats") return [
      { key: "↑↓", label: "scroll", action: null }, cancel,
    ];
    return [
      { key: "↑↓", label: "move", action: null },
      { key: "enter", label: ctx.modal === "settings" ? "save" : "select", action: null }, cancel,
    ];
  }
  if (ctx.searching) {
    return [
      { key: "↑↓", label: "move", action: null },
      { key: "enter", label: "keep", action: "keep" },
      { key: "esc", label: "clear", action: "clear" },
      ...HINT_TAIL,
    ];
  }
  if (ctx.tab === "journal") {
    if (ctx.panel === 1) {
      return [
        ...(ctx.hasMatches ? [
          { key: "{", label: "prev", action: "previousMatch" as const },
          { key: "}", label: "next", action: "nextMatch" as const },
        ] : []),
        { key: "e", label: "edit", action: "edit" },
        { key: "d", label: "delete", action: "delete" },
        { key: "a", label: "add", action: "add" },
        { key: "h", label: "back", action: "back" },
        ...HINT_TAIL,
      ];
    }
    return [
      ...(ctx.compact ? [{ key: "l", label: "entries", action: "details" as const }] : []),
      { key: "a", label: "add", action: "add" },
      { key: "A", label: "add to day", action: "addDay" },
      { key: "/", label: "search", action: "filter" },
      { key: "x", label: "hide", action: "hide" },
      { key: "H", label: "hidden", action: "hidden" },
      ...HINT_TAIL,
    ];
  }
  if (ctx.panel === 1) {
    // Only a subtask toggles; notes and logs edit and delete. The add keys
    // lead with the one that matches the row, so the bar reads as "more of
    // these".
    const row = ctx.row ?? null;
    const adders: HintSpec[] = [
      { key: "t", label: "subtask", action: "subtask" },
      { key: "n", label: "note", action: "note" },
      { key: "L", label: "time", action: "time" },
    ];
    const lead = row === "note" ? 1 : row === "timelog" ? 2 : 0;
    const ordered = [...adders.slice(lead), ...adders.slice(0, lead)];
    return [
      ...(row === "subtask"
        ? [{ key: "space", label: "toggle", action: "toggle" as const }]
        : []),
      ...(row !== null
        ? [
            { key: "enter", label: "edit", action: "edit" as const },
            { key: "d", label: "delete", action: "delete" as const },
          ]
        : []),
      ...ordered,
      { key: "E", label: "edit task", action: "editTask" },
      { key: "D", label: "description", action: "foldDescription" },
      { key: ",", label: "tags", action: "editTags" },
      { key: "h", label: "back", action: "back" },
      ...HINT_TAIL,
    ];
  }
  if ((ctx.marked ?? 0) > 0) {
    return [
      { key: "space", label: "done", action: "done" },
      { key: "d", label: "delete", action: "delete" },
      { key: "+ -", label: "priority", action: null },
      { key: "@", label: "due", action: "due" },
      { key: ",", label: "tags", action: "editTags" },
      { key: "esc", label: "clear marks", action: "clearMarks" },
      { key: "m", label: "mark", action: "mark" },
      ...HINT_TAIL,
    ];
  }
  return [
    { key: "a", label: "add", action: "add" },
    // The Done tab's keys do the opposite of what they do elsewhere, and the
    // bar is where that has to be said.
    { key: "space", label: ctx.done ? "reopen" : "done", action: "done" },
    { key: "/", label: "search", action: "filter" },
    { key: "e", label: "edit", action: "edit" },
    ...(ctx.compact ? [{ key: "enter", label: "details", action: "details" as const }] : []),
    { key: "s", label: ctx.done ? "restart" : "start", action: "start" },
    { key: "d", label: "delete", action: "delete" },
    { key: "t", label: "subtask", action: "subtask" },
    { key: "v", label: "view", action: "view" },
    { key: "#", label: "filter tag", action: "tag" },
    { key: ",", label: "tags", action: "editTags" },
    { key: "m", label: "mark", action: "mark" },
    { key: "@", label: "due", action: "due" },
    { key: "+ -", label: "priority", action: null },
    { key: "b", label: "block", action: "block" },
    { key: "f", label: "focus", action: "focus" },
    ...HINT_TAIL,
  ];
}

/** One help block: a heading and its key / meaning rows. */
export type HelpSection = [string, [string, string][]];

// Global first: a first-time user at 80×24 sees help, palette and quit
// without scrolling. The rows describe the key map the app routes, and
// `hintKeysMissingFromHelp` keeps them honest against `hintSpecs`.
export const HELP_SECTIONS: HelpSection[] = [
  [
    "Global",
    [
      ["?", "This help"],
      ["^k", "Command palette"],
      ["1 2 3 4", "Active / Done / All / Journal"],
      ["u", "Undo"],
      ["R", "Reload from disk"],
      ["T", "Light / dark theme"],
      ["P", "Settings"],
      ["S", "Statistics"],
      ["f", "Start / stop focus"],
      ["z", "Density"],
      ["< >, drag", "Resize panels"],
      ["\\", "Layout: auto / single / split"],
      ["y / n", "Confirm / cancel a dialog"],
      ["q, ctrl+c", "Quit (asks while focus runs)"],
    ],
  ],
  [
    "Navigation",
    [
      ["j k ↑ ↓", "Move selection"],
      ["g G Home End", "First / last"],
      ["PgUp PgDn ^u ^d", "Page up / down"],
      ["h l ← →", "Switch panel"],
      ["tab shift+tab", "Next / previous tab"],
      ["enter", "Open detail / edit row"],
      ["backspace", "Return after a global jump"],
      ["esc", "Marks, then detail, then filter,"],
      ["", "then view"],
      ["click, wheel", "Select row, scroll"],
    ],
  ],
  [
    "Detail panel",
    [
      ["space", "Toggle subtask"],
      ["E", "Edit whole task"],
      ["D", "Fold / unfold description"],
      ["enter, e", "Edit subtask, note or log"],
      ["d", "Delete row"],
      ["t n L", "Add subtask / note / log"],
      ["h, esc", "Back to list"],
    ],
  ],
  [
    "Tasks",
    [
      ["a", "Add task"],
      ["ctrl+n", "Save new task and add another"],
      ["e", "Edit task"],
      ["E", "Edit whole task from either panel"],
      [",", "Edit tags (also marked tasks)"],
      ["V", "View task created outside filter"],
      ["d", "Delete (undo with u)"],
      ["space", "Mark done / reopen"],
      ["s", "Start / stop"],
      ["+ -", "Priority up / down"],
      ["@", "Due date"],
      ["#", "Tag picker"],
      ["t", "Add subtask"],
      ["n", "Add note"],
      ["L", "Log time (\"45m note\")"],
      ["b B", "Block on… / remove blocker…"],
      ["m", "Mark for bulk action"],
      ["o, F1 F2 F3", "Sort: cycle, created, due, priority"],
    ],
  ],
  [
    "Journal",
    [
      ["a", "Add entry to today"],
      ["A", "Add entry to selected day"],
      ["e", "Edit entry"],
      ["d", "Delete entry"],
      ["x", "Hide note"],
      ["H", "Show hidden"],
      ["/", "Search entries"],
      ["{ }", "Previous / next search match"],
    ],
  ],
  [
    "Views & filters",
    [
      ["/", "Filter: text, #tag, !high,"],
      ["", "due:today, is:blocked"],
      ["v", "Cycle view: all, today, overdue,"],
      ["", "week, blocked"],
      ["#", "Tag picker"],
      ["[ ]", "Previous / next tag"],
    ],
  ],
  [
    "Marks",
    [
      ["m", "Mark task for bulk action"],
      ["M", "Select all visible tasks"],
      ["J K", "Extend selection down / up"],
      ["space d + - @ ,", "Act on every marked task"],
      ["esc", "Clear marks"],
    ],
  ],
  ["Forms", [["^s", "Save"], ["^n", "Save new task and add another"], ["^r", "Discard editor draft"], ["↑ ↓", "Choose date preset; enter saves"], ["tab", "Next field / more options"], ["esc", "Cancel / close"]]],
];

/** Every surface the status bar draws hints for, so the check below sees the
 * same keys the user does. */
const HINT_CONTEXTS: HintContext[] = [
  ...["task-form", "prompt", "confirm", "help", "stats", "settings", "palette", "tag-edit"].map((modal) => ({ tab: "active" as const, panel: 0 as const, compact: false, searching: false, modal, creating: true, multiline: true })),
  { tab: "journal", panel: 1, compact: false, searching: false, hasMatches: true },
  { tab: "active", panel: 0, compact: false, searching: false },
  { tab: "active", panel: 0, compact: true, searching: false },
  { tab: "active", panel: 0, compact: false, searching: false, marked: 2 },
  { tab: "done", panel: 0, compact: false, searching: false, done: true },
  { tab: "active", panel: 1, compact: false, searching: false, row: null },
  { tab: "active", panel: 1, compact: false, searching: false, row: "subtask" },
  { tab: "active", panel: 1, compact: false, searching: false, row: "note" },
  { tab: "active", panel: 1, compact: false, searching: false, row: "timelog" },
  { tab: "journal", panel: 0, compact: false, searching: false },
  { tab: "journal", panel: 0, compact: true, searching: false },
  { tab: "journal", panel: 1, compact: false, searching: false },
  { tab: "active", panel: 0, compact: false, searching: true },
];

/** Hint keys the help overlay does not document. Both tables are written by
 * hand — this is what keeps a new hint from silently missing its help row. */
export function hintKeysMissingFromHelp(): string[] {
  const tokens = new Set<string>();
  for (const [, rows] of HELP_SECTIONS) {
    for (const [key] of rows) {
      if (key === ",") tokens.add(key);
      for (const part of key.split(/[\s,]+/)) if (part !== "") tokens.add(part);
    }
  }
  // A multi-key hint such as "+ -" or "↑↓" counts as documented once every
  // key it names appears somewhere in the table.
  const documented = (key: string) =>
    key
      .split(/\s+/)
      .every(
        (part) => tokens.has(part) || [...part].every((ch) => tokens.has(ch)),
      );

  const missing: string[] = [];
  for (const ctx of HINT_CONTEXTS) {
    for (const spec of hintSpecs(ctx)) {
      if (!documented(spec.key) && !missing.includes(spec.key)) {
        missing.push(spec.key);
      }
    }
  }
  return missing;
}
