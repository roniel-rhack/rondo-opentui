import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../package.json";
import { FocusStore } from "../src/core/focus/store.ts";
import { DateOnly, GoTime } from "../src/core/time.ts";
import { isNotFound } from "../src/cli/errors.ts";
import { BufferWriter } from "../src/cli/writer.ts";
import { newTestCLI } from "./cli.test.ts";

function json(cli: { output: () => string }): unknown {
  return JSON.parse(cli.output());
}

describe("agent-friendly due dates", () => {
  test("add accepts relative tokens", () => {
    const cli = newTestCLI();
    cli.run(["add", "Ship it", "--due", "tomorrow"]);
    const t = cli.ctx.taskStore!.list()[0]!;
    expect(t.dueDate!.format(DateOnly)).toBe(
      GoTime.now().addDate(0, 0, 1).format(DateOnly),
    );
  });

  test("list due windows accept tokens", () => {
    const cli = newTestCLI();
    cli.run(["add", "Later", "--due", "+3d"]);
    cli.out.clear();
    cli.run(["list", "--due-before", "today", "--json"]);
    expect(json(cli)).toEqual([]);
  });
});

describe("idempotent done", () => {
  test("re-completing a recurring task spawns nothing", () => {
    const cli = newTestCLI();
    cli.run(["add", "Water plants", "--recur", "daily", "--due", "today"]);
    cli.run(["done", "1"]);
    cli.run(["done", "1"]);

    expect(cli.ctx.taskStore!.list().length).toBe(2);
    expect(cli.output()).toContain("already done");
  });
});

describe("JSON mutations", () => {
  test("add --json returns the created task", () => {
    const cli = newTestCLI();
    cli.run(["add", "Ship it", "--json"]);
    const t = json(cli) as { id: number; title: string };
    expect(t.id).toBe(1);
    expect(t.title).toBe("Ship it");
  });

  test("done --json returns id and status", () => {
    const cli = newTestCLI();
    cli.run(["add", "Ship it"]);
    cli.out.clear();
    cli.run(["done", "1", "--json"]);
    expect(json(cli)).toEqual([{ id: 1, status: "Done" }]);
  });

  test("status --json returns the new status", () => {
    const cli = newTestCLI();
    cli.run(["add", "Ship it"]);
    cli.out.clear();
    cli.run(["status", "1", "active", "--json"]);
    expect(json(cli)).toEqual({ id: 1, status: "In Progress" });
  });

  test("delete --json confirms the deletion", () => {
    const cli = newTestCLI();
    cli.run(["add", "Ship it"]);
    cli.out.clear();
    cli.run(["delete", "1", "--force", "--json"]);
    expect(json(cli)).toEqual({ id: 1, deleted: true, unblocked: [] });
  });
});

describe("dependencies from the CLI", () => {
  test("block and unblock manage a single blocker", () => {
    const cli = newTestCLI();
    cli.run(["add", "Deploy"]);
    cli.run(["add", "Write tests"]);

    cli.run(["block", "1", "2"]);
    expect(cli.ctx.taskStore!.getById(1)!.blockedByIds).toEqual([2]);

    cli.run(["unblock", "1", "2"]);
    expect(cli.ctx.taskStore!.getById(1)!.blockedByIds).toEqual([]);
  });

  test("block refuses cycles", () => {
    const cli = newTestCLI();
    cli.run(["add", "A"]);
    cli.run(["add", "B"]);
    cli.run(["block", "1", "2"]);
    expect(() => cli.run(["block", "2", "1"])).toThrow(/cycle/);
  });
});

describe("focus ergonomics", () => {
  function withFocus() {
    const cli = newTestCLI();
    cli.ctx.focusStore = new FocusStore(cli.db);
    return cli;
  }

  test("--task works as an alias for --task-id", () => {
    const cli = withFocus();
    cli.run(["add", "Deep work"]);
    cli.run(["focus", "start", "--task", "1"]);
    expect(cli.ctx.focusStore!.listByTask(1).length).toBe(1);
  });

  test("focus log is an alias for focus start", () => {
    const cli = withFocus();
    cli.run(["focus", "log", "--duration", "25m"]);
    expect(cli.ctx.focusStore!.todayWorkCount()).toBe(1);
  });
});

describe("version", () => {
  test("the version command prints the package version", () => {
    const cli = newTestCLI();
    cli.run(["version"]);
    expect(cli.output()).toContain(pkg.version);
  });

  test("--version works too", () => {
    const cli = newTestCLI();
    cli.run(["--version"]);
    expect(cli.output()).toContain(pkg.version);
  });
});

describe("batch returns output", () => {
  test("each result carries the command's output and parsed data", () => {
    const cli = newTestCLI({
      stdin: () =>
        '{"cmd":"add","args":["From batch"]}\n{"cmd":"list","args":["--json"]}\n',
    });
    cli.run(["batch"]);

    const results = json(cli) as {
      cmd: string;
      ok: boolean;
      output?: string;
      data?: unknown;
    }[];
    expect(results.length).toBe(2);
    expect(results[0]!.output).toContain("Created task #1");
    const data = results[1]!.data as { id: number }[];
    expect(data.length).toBe(1);
    expect(data[0]!.id).toBe(1);
  });
});

describe("plain format", () => {
  test("--format plain skips table borders even on a TTY", () => {
    const tty = new BufferWriter(true);
    const cli = newTestCLI({ stdout: tty });
    cli.run(["add", "Ship it", "--quiet"]);
    cli.run(["list", "--format", "plain"]);
    expect(tty.toString()).not.toContain("╭");
    expect(tty.toString()).toContain("Ship it");
  });
});

describe("journal misses are not-found errors", () => {
  test("journal show for an absent date exits like other not-founds", () => {
    const cli = newTestCLI();
    try {
      cli.run(["journal", "show", "2020-01-01"]);
      throw new Error("expected journal show to throw");
    } catch (err) {
      expect(isNotFound(err)).toBe(true);
    }
  });
});

describe("edit guardrails", () => {
  test("--clear-due and --due together is an error", () => {
    const cli = newTestCLI();
    cli.run(["add", "Ship it", "--due", "today"]);
    expect(() =>
      cli.run(["edit", "1", "--clear-due", "--due", "2026-12-24"]),
    ).toThrow(/clear-due/);
  });
});

describe("theme from the CLI", () => {
  test("config set theme persists and validates", () => {
    const cli = newTestCLI();
    cli.ctx.configPath = join(mkdtempSync(join(tmpdir(), "rondo-cfg-")), "config.json");
    cli.run(["config", "set", "theme", "dark"]);
    cli.out.clear();
    cli.run(["config", "get", "theme"]);
    expect(cli.output()).toContain("dark");
    expect(() => cli.run(["config", "set", "theme", "blue"])).toThrow();
  });
});
