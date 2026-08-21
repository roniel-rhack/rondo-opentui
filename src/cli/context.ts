import type { Config } from "../core/config/config.ts";
import { defaultConfig } from "../core/config/config.ts";
import type { FocusStore } from "../core/focus/store.ts";
import type { JournalStore } from "../core/journal/store.ts";
import type { TaskStore } from "../core/task/store.ts";
import type { Task } from "../core/task/task.ts";
import { NotFoundError } from "./errors.ts";
import { Printer } from "./printer.ts";
import { stderrWriter, stdoutWriter, type Writer } from "./writer.ts";

export interface CLIContext {
  taskStore: TaskStore | null;
  journalStore: JournalStore | null;
  focusStore: FocusStore | null;
  cfg: Config;
  stdout: Writer;
  stderr: Writer;
  /** Newline-delimited stdin content, used by `batch`. */
  stdin: () => string;
  format: string;
  quiet: boolean;
  noColor: boolean;
  /** Overridable for tests; defaults to ~/.todo-app/config.json. */
  configPath?: string;
}

export function newContext(partial: Partial<CLIContext> = {}): CLIContext {
  return {
    taskStore: null,
    journalStore: null,
    focusStore: null,
    cfg: defaultConfig(),
    stdout: stdoutWriter(),
    stderr: stderrWriter(),
    stdin: () => "",
    format: "table",
    quiet: false,
    noColor: false,
    ...partial,
  };
}

export function printer(ctx: CLIContext, w: Writer = ctx.stdout): Printer {
  return new Printer(w, {
    format: ctx.format,
    quiet: ctx.quiet,
    noColor: ctx.noColor,
  });
}

export function isJSON(ctx: CLIContext): boolean {
  return ctx.format.toLowerCase() === "json";
}

export function requireTaskStore(ctx: CLIContext): TaskStore {
  if (!ctx.taskStore) throw new Error("task store is not available");
  return ctx.taskStore;
}

export function requireJournalStore(ctx: CLIContext): JournalStore {
  if (!ctx.journalStore) throw new Error("journal store is not available");
  return ctx.journalStore;
}

export function requireFocusStore(ctx: CLIContext): FocusStore {
  if (!ctx.focusStore) throw new Error("focus store is not available");
  return ctx.focusStore;
}

export function getTaskOrNotFound(ctx: CLIContext, id: number): Task {
  const t = requireTaskStore(ctx).getById(id);
  if (!t) throw new NotFoundError("task", id);
  return t;
}

export function parseId(raw: string, label = "task"): number {
  const id = Number(raw);
  if (!Number.isInteger(id)) {
    throw new Error(`invalid ${label} ID "${raw}": expected an integer`);
  }
  return id;
}
