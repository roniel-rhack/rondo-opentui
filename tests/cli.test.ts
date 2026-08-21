import { describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { zeroConfig } from "../src/core/config/config.ts";
import { openMemory } from "../src/core/database/db.ts";
import { JournalStore } from "../src/core/journal/store.ts";
import { TaskStore } from "../src/core/task/store.ts";
import { newContext, runCLI, type CLIContext } from "../src/cli/index.ts";
import { filterTasks } from "../src/cli/commands/tasks.ts";
import { BufferWriter } from "../src/cli/writer.ts";
import { configKeys } from "../src/cli/commands/config-cmd.ts";
import {
  DateFormatPresets,
  TimeFormatPresets,
  DateTimeFormatPresets,
  defaultConfig,
  resolvePreset,
} from "../src/core/config/config.ts";

export interface TestCLI {
  ctx: CLIContext;
  out: BufferWriter;
  err: BufferWriter;
  db: Database;
  run: (args: string[]) => void;
  output: () => string;
}

export function newTestCLI(overrides: Partial<CLIContext> = {}): TestCLI {
  const db = openMemory();
  const out = new BufferWriter();
  const err = new BufferWriter();
  const ctx = newContext({
    taskStore: new TaskStore(db),
    journalStore: new JournalStore(db),
    cfg: zeroConfig(),
    stdout: out,
    stderr: err,
    ...overrides,
  });
  return {
    ctx,
    out,
    err,
    db,
    run: (args) => runCLI(args, ctx),
    output: () => out.toString(),
  };
}

/** Runs with no stores at all, like Go's `Run(args, nil, nil, nil, cfg)`. */
function runBare(args: string[]): void {
  const ctx = newContext({
    cfg: zeroConfig(),
    stdout: new BufferWriter(),
    stderr: new BufferWriter(),
  });
  runCLI(args, ctx);
}

describe("dispatch", () => {
  test("no args", () => {
    expect(() => runBare([])).toThrow();
  });

  test("unknown command", () => {
    expect(() => runBare(["foobar"])).toThrow();
  });
});

describe("argument validation", () => {
  test("add without a title", () => {
    expect(() => runBare(["add"])).toThrow();
  });

  test("add with an invalid priority", () => {
    expect(() => runBare(["add", "--priority", "extreme", "my task"])).toThrow(
      /invalid priority/,
    );
  });

  test("add with an invalid due date", () => {
    expect(() => runBare(["add", "--due", "not-a-date", "my task"])).toThrow(
      /invalid due date/,
    );
  });

  test("done without an ID", () => {
    expect(() => runBare(["done"])).toThrow();
  });

  test("done with an invalid ID", () => {
    expect(() => runBare(["done", "abc"])).toThrow();
  });

  test("list with an invalid priority", () => {
    const cli = newTestCLI();
    cli.run(["add", "Task"]);
    expect(() => cli.run(["list", "--priority", "extreme"])).toThrow(
      /invalid priority/,
    );
  });

  test("journal without text", () => {
    expect(() => runBare(["journal"])).toThrow(/no text provided/);
  });

  test("export with an invalid format", () => {
    const cli = newTestCLI();
    expect(() => cli.run(["export", "--format", "csv"])).toThrow(
      /invalid format/,
    );
  });
});

describe("filterTasks", () => {
  test("returns null for null input", () => {
    for (const status of ["all", "pending", "done", "active"]) {
      expect(filterTasks(null, status)).toBeNull();
    }
  });
});

describe("config presets", () => {
  test("date presets", () => {
    const cases: [string, string][] = [
      ["iso", "2006-01-02"],
      ["EUROPEAN", "02.01.2006"],
      ["eu", "02.01.2006"],
      ["us", "01/02/2006"],
      ["02-01-2006", "02-01-2006"],
    ];
    for (const [input, want] of cases) {
      expect(resolvePreset(input, DateFormatPresets)).toBe(want);
    }
  });

  test("time presets", () => {
    const cases: [string, string][] = [
      ["24h", "15:04"],
      ["12h", "3:04 PM"],
      ["15:04:05", "15:04:05"],
    ];
    for (const [input, want] of cases) {
      expect(resolvePreset(input, TimeFormatPresets)).toBe(want);
    }
  });

  test("datetime presets", () => {
    expect(resolvePreset("iso", DateTimeFormatPresets)).toBe("2006-01-02 15:04");
  });

  test("date setter accepts a preset", () => {
    const cfg = defaultConfig();
    configKeys.date_format!.set(cfg, "european");
    expect(cfg.dateFormat).toBe("02.01.2006");
  });

  test("time setter accepts a preset", () => {
    const cfg = defaultConfig();
    configKeys.time_format!.set(cfg, "12h");
    expect(cfg.timeFormat).toBe("3:04 PM");
  });

  test("datetime setter accepts a preset", () => {
    const cfg = defaultConfig();
    configKeys.datetime_format!.set(cfg, "iso");
    expect(cfg.dateTimeFormat).toBe("2006-01-02 15:04");
  });

  test("setters reject invalid layouts", () => {
    const cfg = defaultConfig();
    expect(() => configKeys.date_format!.set(cfg, "DD/MM/YYYY")).toThrow();
    expect(() => configKeys.panel_ratio!.set(cfg, "5")).toThrow();
    expect(() => configKeys["focus.work_duration_min"]!.set(cfg, "999")).toThrow();
    expect(() => configKeys["focus.sound"]!.set(cfg, "maybe")).toThrow();
  });
});
