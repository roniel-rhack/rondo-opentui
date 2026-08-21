import { describe, expect, test } from "bun:test";
import { openMemory } from "../src/core/database/db.ts";
import { FocusStore } from "../src/core/focus/store.ts";
import { defaultConfig } from "../src/core/config/config.ts";
import { newTestCLI } from "./cli.test.ts";

function focusCLI() {
  const db = openMemory();
  const cli = newTestCLI({ cfg: defaultConfig() });
  cli.ctx.focusStore = new FocusStore(db);
  return cli;
}

describe("focus command", () => {
  test("start records a completed session with the configured duration", () => {
    const cli = focusCLI();
    cli.run(["focus", "start"]);

    const sessions = cli.ctx.focusStore!.listByTask(0);
    expect(sessions.length).toBe(1);
    expect(sessions[0]!.completedAt).not.toBeNull();
    expect(cli.output()).toContain("25m");
  });

  test("start honours --task-id and --duration", () => {
    const cli = focusCLI();
    cli.run(["focus", "start", "--task-id", "7", "--duration", "45m"]);

    const sessions = cli.ctx.focusStore!.listByTask(7);
    expect(sessions.length).toBe(1);
    expect(cli.output()).toContain("45m");
  });

  test("start rejects invalid durations", () => {
    const cli = focusCLI();
    expect(() => cli.run(["focus", "start", "--duration", "banana"])).toThrow(
      /invalid duration/,
    );
  });

  test("status reports today's progress as JSON", () => {
    const cli = focusCLI();
    cli.run(["focus", "start"]);
    cli.out.clear();

    cli.run(["focus", "status", "--json"]);
    const status = JSON.parse(cli.output());

    expect(status.today).toBe(1);
    expect(status.goal).toBe(8);
    expect(status.streak_days).toBe(1);
    expect(status.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("stats lists completions per day", () => {
    const cli = focusCLI();
    cli.run(["focus", "start"]);
    cli.run(["focus", "start"]);
    cli.out.clear();

    cli.run(["focus", "stats", "--json"]);
    const byDay = JSON.parse(cli.output());

    expect(Object.values(byDay)).toEqual([2]);
  });

  test("stats reports when nothing was recorded", () => {
    const cli = focusCLI();
    cli.run(["focus", "stats"]);
    expect(cli.output()).toContain("no focus sessions");
  });

  test("stats renders a table when sessions exist", () => {
    const cli = focusCLI();
    cli.run(["focus", "start"]);
    cli.out.clear();

    cli.run(["focus", "stats"]);
    expect(cli.output()).toContain("SESSIONS");
  });
});

describe("stats command", () => {
  test("summarises tasks and focus as JSON", () => {
    const cli = focusCLI();
    cli.run(["add", "--priority", "urgent", "Ship it"]);
    cli.run(["focus", "start"]);
    cli.out.clear();

    cli.run(["stats", "--json"]);
    const stats = JSON.parse(cli.output());

    expect(stats.tasks.total).toBe(1);
    expect(stats.tasks.pending).toBe(1);
    expect(stats.tasks.by_priority.urgent).toBe(1);
    expect(stats.focus.today).toBe(1);
    expect(stats.focus.goal).toBe(8);
  });

  test("renders tables by default", () => {
    const cli = focusCLI();
    cli.run(["add", "Something"]);
    cli.out.clear();

    cli.run(["stats"]);
    const out = cli.output();

    expect(out).toContain("TASKS");
    expect(out).toContain("OPEN TASKS BY PRIORITY");
    expect(out).toContain("FOCUS (last 30 days)");
  });
});
