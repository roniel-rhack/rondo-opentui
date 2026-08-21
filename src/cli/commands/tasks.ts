import {
  formatDate,
  formatDateTime,
} from "../../core/config/config.ts";
import { RecurFreq, nextDueDate, parseRecurFreq, recurFreqString } from "../../core/task/recur.ts";
import { newTask } from "../../core/task/store.ts";
import {
  Priority,
  Status,
  priorityString,
  statusNext,
  statusString,
  type Task,
} from "../../core/task/task.ts";
import { formatDuration, totalDuration } from "../../core/task/timelog.ts";
import { DateOnly, GoTime, RFC3339, parseDateOnly } from "../../core/time.ts";
import { theme } from "../../core/ui/colors.ts";
import {
  Command,
  exactArgs,
  minimumNArgs,
  noArgs,
  rangeArgs,
} from "../command.ts";
import { confirm } from "../confirm.ts";
import {
  getTaskOrNotFound,
  isJSON,
  parseId,
  printer,
  requireTaskStore,
  type CLIContext,
} from "../context.ts";
import type { Printer } from "../printer.ts";

export function parsePriority(s: string): Priority {
  switch (s.toLowerCase()) {
    case "low":
      return Priority.Low;
    case "medium":
    case "med":
      return Priority.Medium;
    case "high":
      return Priority.High;
    case "urgent":
      return Priority.Urgent;
    default:
      throw new Error(
        `invalid priority "${s}": must be low, medium, high, or urgent`,
      );
  }
}

export function parseMetaFlags(
  raw: string[],
): Record<string, string> | null {
  if (raw.length === 0) return null;
  const m: Record<string, string> = {};
  for (const kv of raw) {
    const eq = kv.indexOf("=");
    if (eq < 1) throw new Error(`invalid --meta "${kv}": expected key=value`);
    m[kv.slice(0, eq)] = kv.slice(eq + 1);
  }
  return m;
}

export function parseBlocksFlag(s: string): number[] {
  if (s === "") return [];
  const ids: number[] = [];
  for (const part of s.split(",")) {
    const p = part.trim();
    if (p === "") continue;
    const id = Number(p);
    if (!Number.isInteger(id)) {
      throw new Error(`invalid task ID "${p}" in --blocks`);
    }
    if (id <= 0) {
      throw new Error(`invalid task ID "${p}" in --blocks: must be positive`);
    }
    ids.push(id);
  }
  return ids;
}

function parseDueFlag(due: string): GoTime {
  try {
    return parseDateOnly(due, "utc");
  } catch {
    throw new Error(`invalid due date "${due}": expected YYYY-MM-DD`);
  }
}

function splitTags(tags: string): string[] {
  return tags
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "");
}

export function addCmd(ctx: CLIContext): Command {
  return new Command({
    use: 'add "task title" [flags]',
    short: "Add a new task",
    args: exactArgs(1),
    flags: {
      priority: {
        type: "string",
        default: "low",
        usage: "Priority: low, medium, high, urgent",
      },
      due: { type: "string", usage: "Due date (YYYY-MM-DD)" },
      tags: { type: "string", usage: "Comma-separated tags" },
      desc: { type: "string", usage: "Task description" },
      recur: {
        type: "string",
        usage: "Recurrence: daily, weekly, monthly, yearly",
      },
      meta: { type: "stringSlice", usage: "Metadata key=value (repeatable)" },
      blocks: {
        type: "string",
        usage: "Comma-separated task IDs this task blocks",
      },
    },
    run: (args, flags) => {
      const t = newTask({ title: args[0]!, description: flags.string("desc") });
      t.priority = parsePriority(flags.string("priority"));

      const due = flags.string("due");
      if (due !== "") t.dueDate = parseDueFlag(due);

      const tags = flags.string("tags");
      if (tags !== "") t.tags = splitTags(tags);

      t.metadata = parseMetaFlags(flags.stringSlice("meta"));

      const recur = flags.string("recur");
      let freq = RecurFreq.None;
      if (recur !== "" && recur.toLowerCase() !== "none") {
        freq = parseRecurFreq(recur.toLowerCase());
        if (freq === RecurFreq.None) {
          throw new Error(
            `invalid recurrence "${recur}": must be daily, weekly, monthly, or yearly`,
          );
        }
      }

      const store = requireTaskStore(ctx);
      store.create(t);

      const blocks = flags.string("blocks");
      if (blocks !== "") {
        for (const bid of parseBlocksFlag(blocks)) store.setBlocker(bid, t.id);
      }

      if (freq !== RecurFreq.None) store.updateRecurrence(t.id, freq, 1);

      if (ctx.quiet) {
        ctx.stdout.write(`${t.id}\n`);
      } else {
        printer(ctx).success(`Created task #${t.id}: ${t.title}`);
      }
    },
  });
}

export function doneCmd(ctx: CLIContext): Command {
  return new Command({
    use: "done <task-id> [task-id...]",
    short: "Mark one or more tasks as done",
    args: minimumNArgs(1),
    run: (args) => {
      const store = requireTaskStore(ctx);
      for (const arg of args) {
        const id = parseId(arg);
        const t = getTaskOrNotFound(ctx, id);

        // Spawn the next occurrence before completing the current task.
        if (t.recurFreq !== RecurFreq.None) {
          const interval = t.recurInterval > 0 ? t.recurInterval : 1;
          const next = newTask({
            title: t.title,
            description: t.description,
            priority: t.priority,
            dueDate: nextDueDate(t),
            tags: t.tags,
            recurFreq: t.recurFreq,
            recurInterval: interval,
          });
          store.create(next);
          store.updateRecurrence(next.id, next.recurFreq, interval);
        }

        t.status = Status.Done;
        store.update(t);
        printer(ctx).success(`Marked task #${t.id} as done: ${t.title}`);
      }
    },
  });
}

export function showCmd(ctx: CLIContext): Command {
  return new Command({
    use: "show <task-id>",
    short: "Show full task details",
    args: exactArgs(1),
    run: (args) => {
      const t = getTaskOrNotFound(ctx, parseId(args[0]!));
      if (isJSON(ctx)) {
        printTaskJSON(ctx, t);
        return;
      }
      printTaskDetail(ctx, printer(ctx), t);
    },
  });
}

export function editCmd(ctx: CLIContext): Command {
  return new Command({
    use: "edit <task-id> [flags]",
    short: "Edit a task (only specified flags are updated)",
    args: exactArgs(1),
    flags: {
      title: { type: "string", usage: "New title" },
      desc: { type: "string", usage: "New description" },
      priority: {
        type: "string",
        usage: "New priority: low, medium, high, urgent",
      },
      due: { type: "string", usage: "New due date (YYYY-MM-DD)" },
      tags: { type: "string", usage: "New comma-separated tags" },
      recur: {
        type: "string",
        usage: "Recurrence: none, daily, weekly, monthly, yearly",
      },
      "clear-due": { type: "bool", usage: "Remove the due date" },
      meta: {
        type: "stringSlice",
        usage: "Metadata key=value (repeatable, merges with existing)",
      },
      blocks: {
        type: "string",
        usage: "Comma-separated task IDs this task blocks (replaces existing)",
      },
      "clear-blocks": {
        type: "bool",
        usage: "Remove all tasks this task blocks",
      },
    },
    run: (args, flags) => {
      const id = parseId(args[0]!);
      const t = getTaskOrNotFound(ctx, id);
      const store = requireTaskStore(ctx);
      let changed = false;

      if (flags.changed("title")) {
        t.title = flags.string("title");
        changed = true;
      }
      if (flags.changed("desc")) {
        t.description = flags.string("desc");
        changed = true;
      }
      if (flags.changed("priority")) {
        t.priority = parsePriority(flags.string("priority"));
        changed = true;
      }
      if (flags.bool("clear-due")) {
        t.dueDate = null;
        changed = true;
      } else if (flags.changed("due")) {
        t.dueDate = parseDueFlag(flags.string("due"));
        changed = true;
      }
      if (flags.changed("tags")) {
        t.tags = splitTags(flags.string("tags"));
        changed = true;
      }
      if (flags.changed("meta")) {
        const newMeta = parseMetaFlags(flags.stringSlice("meta")) ?? {};
        t.metadata = { ...(t.metadata ?? {}), ...newMeta };
        changed = true;
      }

      const blocksChanged = flags.bool("clear-blocks") || flags.changed("blocks");
      const recurChanged = flags.changed("recur");
      if (!changed && !recurChanged && !blocksChanged) {
        throw new Error(
          "no changes specified: use --title, --desc, --priority, --due, --tags, --meta, --blocks, --recur, --clear-due, or --clear-blocks",
        );
      }

      if (changed) store.update(t);

      if (flags.bool("clear-blocks")) {
        store.setBlocksIds(id, null);
      } else if (flags.changed("blocks")) {
        store.setBlocksIds(id, parseBlocksFlag(flags.string("blocks")));
      }

      if (recurChanged) {
        const freq = parseRecurFreq(flags.string("recur").toLowerCase());
        const interval = t.recurInterval > 0 ? t.recurInterval : 1;
        store.updateRecurrence(id, freq, interval);
      }

      printer(ctx).success(`Updated task #${t.id}: ${t.title}`);
    },
  });
}

export function deleteCmd(ctx: CLIContext): Command {
  return new Command({
    use: "delete <task-id>",
    short: "Delete a task",
    aliases: ["del", "rm"],
    args: exactArgs(1),
    flags: {
      force: { type: "bool", shorthand: "y", usage: "Skip confirmation prompt" },
      cascade: {
        type: "bool",
        usage: "Delete even if this task blocks others (unblocks them)",
      },
    },
    run: (args, flags) => {
      const id = parseId(args[0]!);
      const t = getTaskOrNotFound(ctx, id);
      const store = requireTaskStore(ctx);

      const blocksIds = store.listBlocksIds(id);
      if (blocksIds.length > 0 && !flags.bool("cascade")) {
        const list = blocksIds.map((b) => `#${b}`).join(", ");
        throw new Error(
          `task #${id} blocks ${list}. Use --cascade to delete and unblock them`,
        );
      }

      if (!confirm(ctx, `Delete task #${id} "${t.title}"?`, flags.bool("force"))) {
        ctx.stderr.write("Cancelled.\n");
        return;
      }

      store.delete(id);

      const p = printer(ctx);
      if (blocksIds.length > 0) {
        const list = blocksIds.map((b) => `#${b}`).join(", ");
        p.success(`Deleted task #${id}: ${t.title} (unblocked ${list})`);
      } else {
        p.success(`Deleted task #${id}: ${t.title}`);
      }
    },
  });
}

export function statusCmd(ctx: CLIContext): Command {
  return new Command({
    use: "status <task-id> [pending|active|done]",
    short: "Set or cycle task status",
    args: rangeArgs(1, 2),
    run: (args) => {
      const id = parseId(args[0]!);
      const t = getTaskOrNotFound(ctx, id);

      if (args.length === 2) {
        switch (args[1]!.toLowerCase()) {
          case "pending":
            t.status = Status.Pending;
            break;
          case "active":
          case "in-progress":
          case "inprogress":
            t.status = Status.InProgress;
            break;
          case "done":
            t.status = Status.Done;
            break;
          default:
            throw new Error(
              `invalid status "${args[1]}": must be pending, active, or done`,
            );
        }
      } else {
        t.status = statusNext(t.status);
      }

      requireTaskStore(ctx).update(t);
      printer(ctx).success(`Task #${t.id} status: ${statusString(t.status)}`);
    },
  });
}

export interface TaskFilterOpts {
  status: string;
  priority: string;
  tags: string[];
  metaFilter: string[];
  dueBefore: string;
  dueAfter: string;
  overdue: boolean;
  search: string;
}

export function filterTasks(
  tasks: Task[] | null,
  status: string,
): Task[] | null {
  if (!tasks) return null;
  switch (status.toLowerCase()) {
    case "pending":
      return tasks.filter((t) => t.status === Status.Pending);
    case "active":
    case "in-progress":
    case "inprogress":
      return tasks.filter((t) => t.status === Status.InProgress);
    case "done":
      return tasks.filter((t) => t.status === Status.Done);
    default:
      return tasks;
  }
}

export function taskHasAnyTag(t: Task, filterTags: string[]): boolean {
  const tagSet = new Set(t.tags.map((tag) => tag.toLowerCase()));
  return filterTags.some((ft) => tagSet.has(ft.toLowerCase()));
}

export function taskMatchesMeta(
  t: Task,
  filter: Record<string, string>,
): boolean {
  if (!t.metadata) return false;
  return Object.entries(filter).every(([k, v]) => t.metadata![k] === v);
}

export function applyTaskFilters(
  tasks: Task[],
  opts: TaskFilterOpts,
): Task[] {
  let out = filterTasks(tasks, opts.status) ?? [];

  if (opts.priority !== "") {
    const prio = parsePriority(opts.priority);
    out = out.filter((t) => t.priority === prio);
  }

  if (opts.tags.length > 0) {
    out = out.filter((t) => taskHasAnyTag(t, opts.tags));
  }

  if (opts.metaFilter.length > 0) {
    const metaKV = parseMetaFlags(opts.metaFilter) ?? {};
    out = out.filter((t) => taskMatchesMeta(t, metaKV));
  }

  if (opts.search !== "") {
    const lower = opts.search.toLowerCase();
    out = out.filter(
      (t) =>
        t.title.toLowerCase().includes(lower) ||
        t.description.toLowerCase().includes(lower),
    );
  }

  if (opts.overdue) {
    const now = GoTime.now();
    out = out.filter(
      (t) => t.dueDate !== null && t.dueDate.before(now) && t.status !== Status.Done,
    );
  }

  if (opts.dueBefore !== "") {
    try {
      const cutoff = parseDateOnly(opts.dueBefore, "utc");
      out = out.filter((t) => t.dueDate !== null && !t.dueDate.after(cutoff));
    } catch {
      // Go ignores unparseable cutoffs.
    }
  }

  if (opts.dueAfter !== "") {
    try {
      const cutoff = parseDateOnly(opts.dueAfter, "utc");
      out = out.filter((t) => t.dueDate !== null && !t.dueDate.before(cutoff));
    } catch {
      // Go ignores unparseable cutoffs.
    }
  }

  return out;
}

export function sortTasks(tasks: Task[], sortBy: string): void {
  switch (sortBy.toLowerCase()) {
    case "due":
      tasks.sort((a, b) => {
        if (!a.dueDate) return b.dueDate ? 1 : 0;
        if (!b.dueDate) return -1;
        return a.dueDate.ms - b.dueDate.ms;
      });
      break;
    case "priority":
      tasks.sort((a, b) => b.priority - a.priority);
      break;
    default:
      tasks.sort((a, b) => b.createdAt.ms - a.createdAt.ms || b.id - a.id);
  }
}

export function listCmd(ctx: CLIContext): Command {
  return new Command({
    use: "list [flags]",
    short: "List tasks",
    args: noArgs,
    flags: {
      status: {
        type: "string",
        default: "all",
        usage: "Filter: pending, active, done, all",
      },
      priority: {
        type: "string",
        usage: "Filter by priority: low, medium, high, urgent",
      },
      tag: { type: "stringSlice", usage: "Filter by tag (repeatable)" },
      meta: {
        type: "stringSlice",
        usage: "Filter by metadata key=value (repeatable, AND logic)",
      },
      sort: {
        type: "string",
        default: "created",
        usage: "Sort order: created, due, priority",
      },
      "due-before": {
        type: "string",
        usage: "Show tasks due on or before YYYY-MM-DD",
      },
      "due-after": {
        type: "string",
        usage: "Show tasks due on or after YYYY-MM-DD",
      },
      overdue: { type: "bool", usage: "Show only overdue tasks" },
      search: {
        type: "string",
        usage: "Substring match on title and description",
      },
      limit: {
        type: "int",
        usage: "Maximum number of tasks to show (0 = unlimited)",
      },
    },
    run: (_args, flags) => {
      const tasks = requireTaskStore(ctx).list();
      let filtered = applyTaskFilters(tasks, {
        status: flags.string("status"),
        priority: flags.string("priority"),
        tags: flags.stringSlice("tag"),
        metaFilter: flags.stringSlice("meta"),
        dueBefore: flags.string("due-before"),
        dueAfter: flags.string("due-after"),
        overdue: flags.bool("overdue"),
        search: flags.string("search"),
      });

      sortTasks(filtered, flags.string("sort"));

      const limit = flags.int("limit");
      if (limit > 0 && filtered.length > limit) filtered = filtered.slice(0, limit);

      if (isJSON(ctx)) {
        printTasksJSON(ctx, filtered);
        return;
      }
      printTasksTable(ctx, printer(ctx), filtered);
    },
  });
}

function formatStatus(p: Printer, s: Status): string {
  switch (s) {
    case Status.InProgress:
      return p.colored("● Active", theme.cyan);
    case Status.Done:
      return p.colored("✓ Done", theme.green);
    default:
      return p.colored("○ Pending", theme.gray);
  }
}

function formatPriority(p: Printer, pr: Priority): string {
  switch (pr) {
    case Priority.Urgent:
      return p.colored("Urgent", theme.red);
    case Priority.High:
      return p.colored("High", theme.orange);
    case Priority.Medium:
      return p.colored("Medium", theme.yellow);
    default:
      return p.colored("Low", theme.gray);
  }
}

export function printTasksTable(
  ctx: CLIContext,
  p: Printer,
  tasks: Task[],
): void {
  const rows = tasks.map((t) => {
    const due = t.dueDate ? formatDate(ctx.cfg, t.dueDate) : "-";
    const tags = t.tags.length > 0 ? t.tags.join(", ") : "-";
    const completed = t.subtasks.filter((s) => s.completed).length;
    const subs =
      t.subtasks.length > 0 ? `${completed}/${t.subtasks.length}` : "-";
    const notes = t.notes.length > 0 ? String(t.notes.length) : "-";
    return [
      String(t.id),
      formatStatus(p, t.status),
      formatPriority(p, t.priority),
      t.title,
      due,
      tags,
      subs,
      notes,
    ];
  });
  p.table(
    ["ID", "STATUS", "PRIORITY", "TITLE", "DUE", "TAGS", "SUBS", "NOTES"],
    rows,
  );
}

export function printTaskDetail(
  ctx: CLIContext,
  p: Printer,
  t: Task,
): void {
  const due = t.dueDate ? formatDate(ctx.cfg, t.dueDate) : "-";
  const tags = t.tags.length > 0 ? t.tags.join(", ") : "-";
  const completed = t.subtasks.filter((s) => s.completed).length;
  const blockedBy =
    t.blockedByIds.length > 0
      ? t.blockedByIds.map((b) => `#${b}`).join(", ")
      : "-";
  const blocks =
    t.blocksIds.length > 0 ? t.blocksIds.map((b) => `#${b}`).join(", ") : "-";

  let meta = "-";
  if (t.metadata && Object.keys(t.metadata).length > 0) {
    meta = Object.keys(t.metadata)
      .sort()
      .map((k) => `${k}=${t.metadata![k]}`)
      .join(", ");
  }

  p.table(
    ["FIELD", "VALUE"],
    [
      [p.bold("ID"), String(t.id)],
      [p.bold("Title"), t.title],
      [p.bold("Status"), formatStatus(p, t.status)],
      [p.bold("Priority"), formatPriority(p, t.priority)],
      [p.bold("Due Date"), due],
      [p.bold("Tags"), tags],
      [p.bold("Metadata"), meta],
      [p.bold("Recurrence"), recurFreqString(t.recurFreq)],
      [p.bold("Subtasks"), `${completed}/${t.subtasks.length}`],
      [p.bold("Blocked By"), blockedBy],
      [p.bold("Blocks"), blocks],
      [p.bold("Notes"), String(t.notes.length)],
      [p.bold("Time Logged"), formatDuration(totalDuration(t.timeLogs))],
      [p.bold("Created"), formatDateTime(ctx.cfg, t.createdAt)],
      [p.bold("Updated"), formatDateTime(ctx.cfg, t.updatedAt)],
    ],
  );

  if (t.description !== "") {
    p.line();
    p.line(p.bold("Description:"));
    p.line(`  ${t.description}`);
  }
  if (t.subtasks.length > 0) {
    p.line();
    p.line(p.bold("Subtasks:"));
    for (const s of t.subtasks) {
      const check = s.completed
        ? p.colored("✓", theme.green)
        : p.colored("○", theme.gray);
      p.line(`  ${check} [${s.id}] ${s.title}`);
    }
  }
  if (t.timeLogs.length > 0) {
    p.line();
    p.line(p.bold("Time Logs:"));
    for (const tl of t.timeLogs) {
      const note = tl.note !== "" ? ` — ${tl.note}` : "";
      p.line(
        `  ${p.dim(formatDateTime(ctx.cfg, tl.loggedAt))}  [${tl.id}] ${formatDuration(tl.duration)}${note}`,
      );
    }
  }
  if (t.notes.length > 0) {
    p.line();
    p.line(p.bold("Notes:"));
    for (const n of t.notes) {
      p.line(
        `  ${p.dim(formatDateTime(ctx.cfg, n.createdAt))}  [${n.id}] ${n.body}`,
      );
    }
  }
}

interface JSONTaskRef {
  id: number;
  title: string;
  status: string;
}

interface JSONTask {
  id: number;
  title: string;
  description?: string;
  status: string;
  priority: string;
  due_date?: string;
  tags: string[];
  metadata?: Record<string, string>;
  recurrence?: string;
  subtasks: {
    id: number;
    title: string;
    completed: boolean;
    position: number;
  }[];
  time_logs: {
    id: number;
    duration: string;
    note?: string;
    logged_at: string;
  }[];
  note_count: number;
  notes: { id: number; body: string; created_at: string }[];
  blocked_by: number[];
  blocked_by_detail: JSONTaskRef[];
  blocks: number[];
  blocks_detail: JSONTaskRef[];
  created_at: string;
  updated_at: string;
}

type TaskIndex = Map<number, JSONTaskRef>;

function buildTaskIndex(tasks: Task[]): TaskIndex {
  return new Map(
    tasks.map((t) => [
      t.id,
      { id: t.id, title: t.title, status: statusString(t.status) },
    ]),
  );
}

function resolveRefs(ids: number[], idx: TaskIndex): JSONTaskRef[] {
  return ids.map(
    (id) => idx.get(id) ?? { id, title: "(unknown)", status: "Unknown" },
  );
}

export function taskToJSON(t: Task, idx: TaskIndex): JSONTask {
  const jt: JSONTask = {
    id: t.id,
    title: t.title,
    status: statusString(t.status),
    priority: priorityString(t.priority),
    tags: t.tags ?? [],
    subtasks: t.subtasks.map((s) => ({
      id: s.id,
      title: s.title,
      completed: s.completed,
      position: s.position,
    })),
    time_logs: t.timeLogs.map((tl) => ({
      id: tl.id,
      duration: formatDuration(tl.duration),
      ...(tl.note !== "" ? { note: tl.note } : {}),
      logged_at: tl.loggedAt.format(RFC3339),
    })),
    note_count: t.notes.length,
    notes: t.notes.map((n) => ({
      id: n.id,
      body: n.body,
      created_at: n.createdAt.format(RFC3339),
    })),
    blocked_by: t.blockedByIds ?? [],
    blocked_by_detail: resolveRefs(t.blockedByIds, idx),
    blocks: t.blocksIds ?? [],
    blocks_detail: resolveRefs(t.blocksIds, idx),
    created_at: t.createdAt.format(RFC3339),
    updated_at: t.updatedAt.format(RFC3339),
  };
  if (t.description !== "") jt.description = t.description;
  if (t.metadata) jt.metadata = t.metadata;
  if (t.dueDate) jt.due_date = t.dueDate.format(DateOnly);
  if (t.recurFreq !== RecurFreq.None) {
    jt.recurrence = recurFreqString(t.recurFreq);
  }
  return jt;
}

export function printTasksJSON(ctx: CLIContext, tasks: Task[]): void {
  const idx = buildTaskIndex(tasks);
  printer(ctx).json(tasks.map((t) => taskToJSON(t, idx)));
}

export function printTaskJSON(ctx: CLIContext, t: Task): void {
  const idx: TaskIndex = new Map([
    [t.id, { id: t.id, title: t.title, status: statusString(t.status) }],
  ]);
  const refIds = new Set([...t.blockedByIds, ...t.blocksIds]);
  const store = requireTaskStore(ctx);
  for (const id of refIds) {
    if (id === t.id) continue;
    const ref = store.getById(id);
    if (ref) {
      idx.set(ref.id, {
        id: ref.id,
        title: ref.title,
        status: statusString(ref.status),
      });
    }
  }
  printer(ctx).json(taskToJSON(t, idx));
}
