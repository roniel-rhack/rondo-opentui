import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RecurFreq } from "../src/core/task/recur.ts";
import { Priority, Status } from "../src/core/task/task.ts";
import { newTestCLI } from "./cli.test.ts";

function tempPath(name: string): string {
  return join(mkdtempSync(join(tmpdir(), "rondo-cli-")), name);
}

describe("add", () => {
  test("basic", () => {
    const cli = newTestCLI();
    cli.run(["add", "Buy milk"]);

    const tasks = cli.ctx.taskStore!.list();
    expect(tasks.length).toBe(1);
    expect(tasks[0]!.title).toBe("Buy milk");
    expect(tasks[0]!.priority).toBe(Priority.Low);
    expect(tasks[0]!.status).toBe(Status.Pending);
  });

  test("all flags", () => {
    const cli = newTestCLI();
    cli.run([
      "add",
      "--priority",
      "high",
      "--due",
      "2026-03-15",
      "--tags",
      "home,shopping",
      "Big task",
    ]);

    const t = cli.ctx.taskStore!.list()[0]!;
    expect(t.title).toBe("Big task");
    expect(t.priority).toBe(Priority.High);
    expect(t.dueDate?.format("2006-01-02")).toBe("2026-03-15");
    expect(t.tags).toEqual(["home", "shopping"]);
  });

  test("multiple tasks", () => {
    const cli = newTestCLI();
    for (const title of ["Task 1", "Task 2", "Task 3"]) cli.run(["add", title]);
    expect(cli.ctx.taskStore!.list().length).toBe(3);
  });

  test("with description", () => {
    const cli = newTestCLI();
    cli.run(["add", "--desc", "Some description", "Task with desc"]);
    expect(cli.ctx.taskStore!.list()[0]!.description).toBe("Some description");
  });

  test("with recurrence", () => {
    const cli = newTestCLI();
    cli.run(["add", "--recur", "weekly", "Weekly review"]);
    expect(cli.ctx.taskStore!.list()[0]!.recurFreq).toBe(RecurFreq.Weekly);
  });

  test("invalid recurrence", () => {
    const cli = newTestCLI();
    expect(() => cli.run(["add", "--recur", "hourly", "Bad recur"])).toThrow(
      /invalid recurrence/,
    );
  });

  test("metadata flags", () => {
    const cli = newTestCLI();
    cli.run(["add", "--meta", "source=cli", "--meta", "group=main", "Meta task"]);
    expect(cli.ctx.taskStore!.list()[0]!.metadata).toEqual({
      source: "cli",
      group: "main",
    });
  });
});

describe("done", () => {
  test("marks a task done", () => {
    const cli = newTestCLI();
    cli.run(["add", "Finish report"]);
    const id = cli.ctx.taskStore!.list()[0]!.id;

    cli.run(["done", String(id)]);

    expect(cli.ctx.taskStore!.getById(id)!.status).toBe(Status.Done);
  });

  test("not found", () => {
    const cli = newTestCLI();
    expect(() => cli.run(["done", "999"])).toThrow(/not found/);
  });

  test("multiple IDs", () => {
    const cli = newTestCLI();
    cli.run(["add", "Task A"]);
    cli.run(["add", "Task B"]);
    const ids = cli.ctx.taskStore!.list().map((t) => String(t.id));

    cli.run(["done", ...ids]);

    for (const t of cli.ctx.taskStore!.list()) {
      expect(t.status).toBe(Status.Done);
    }
  });

  test("recurring task spawns the next occurrence", () => {
    const cli = newTestCLI();
    cli.run(["add", "--recur", "daily", "Daily standup"]);
    const id = cli.ctx.taskStore!.list()[0]!.id;

    cli.run(["done", String(id)]);

    expect(cli.ctx.taskStore!.list().length).toBe(2);
  });
});

describe("list", () => {
  test("table output", () => {
    const cli = newTestCLI();
    cli.run(["add", "Alpha"]);
    cli.run(["add", "Beta"]);
    cli.out.clear();

    cli.run(["list"]);
    const out = cli.output();

    expect(out).toContain("Alpha");
    expect(out).toContain("Beta");
    expect(out).toContain("TITLE");
  });

  test("JSON output", () => {
    const cli = newTestCLI();
    cli.run(["add", "JSON task"]);
    cli.out.clear();

    cli.run(["list", "--format", "json"]);
    const out = cli.output();

    expect(() => JSON.parse(out)).not.toThrow();
    expect(out).toContain("JSON task");
  });

  test("filter by done status", () => {
    const cli = newTestCLI();
    cli.run(["add", "Stay pending"]);
    cli.run(["add", "Mark done"]);
    cli.run(["done", "2"]);
    cli.out.clear();

    cli.run(["list", "--status", "done"]);
    const out = cli.output();

    expect(out).toContain("Mark done");
    expect(out).not.toContain("Stay pending");
  });

  test("filter by pending status", () => {
    const cli = newTestCLI();
    cli.run(["add", "Pending one"]);
    cli.run(["add", "Done one"]);
    cli.run(["done", "2"]);
    cli.out.clear();

    cli.run(["list", "--status", "pending"]);
    const out = cli.output();

    expect(out).toContain("Pending one");
    expect(out).not.toContain("Done one");
  });

  test("filter by priority", () => {
    const cli = newTestCLI();
    cli.run(["add", "--priority", "urgent", "Urgent task"]);
    cli.run(["add", "--priority", "low", "Low task"]);
    cli.out.clear();

    cli.run(["list", "--priority", "urgent"]);
    const out = cli.output();

    expect(out).toContain("Urgent task");
    expect(out).not.toContain("Low task");
  });

  test("filter by tag", () => {
    const cli = newTestCLI();
    cli.run(["add", "--tags", "work,golang", "Work task"]);
    cli.run(["add", "--tags", "personal", "Personal task"]);
    cli.out.clear();

    cli.run(["list", "--tag", "work"]);
    const out = cli.output();

    expect(out).toContain("Work task");
    expect(out).not.toContain("Personal task");
  });

  test("search", () => {
    const cli = newTestCLI();
    cli.run(["add", "Buy groceries"]);
    cli.run(["add", "Write tests"]);
    cli.out.clear();

    cli.run(["list", "--search", "groceries"]);
    const out = cli.output();

    expect(out).toContain("Buy groceries");
    expect(out).not.toContain("Write tests");
  });

  test("limit", () => {
    const cli = newTestCLI();
    for (let i = 0; i < 5; i++) cli.run(["add", "Task"]);
    cli.out.clear();

    cli.run(["list", "--limit", "2"]);

    const dataLines = cli
      .output()
      .trim()
      .split("\n")
      .filter((l) => l.includes("Task") && !l.includes("TITLE"));
    expect(dataLines.length).toBeLessThanOrEqual(2);
  });

  test("sort by priority", () => {
    const cli = newTestCLI();
    cli.run(["add", "--priority", "low", "Low"]);
    cli.run(["add", "--priority", "urgent", "Urgent"]);
    cli.out.clear();

    cli.run(["list", "--sort", "priority"]);
    const out = cli.output();

    expect(out.indexOf("Urgent")).toBeGreaterThanOrEqual(0);
    expect(out.indexOf("Urgent")).toBeLessThan(out.indexOf("Low"));
  });

  test("JSON contains every field", () => {
    const cli = newTestCLI();
    cli.run(["add", "--desc", "desc", "--tags", "a,b", "Full task"]);
    cli.out.clear();

    cli.run(["list", "--format", "json"]);
    const result = JSON.parse(cli.output());

    expect(result.length).toBe(1);
    for (const field of [
      "description",
      "subtasks",
      "time_logs",
      "blocked_by",
      "created_at",
      "updated_at",
    ]) {
      expect(result[0]).toHaveProperty(field);
    }
  });

  test("--json shorthand", () => {
    const cli = newTestCLI();
    cli.run(["add", "Shorthand"]);
    cli.out.clear();

    cli.run(["list", "--json"]);
    expect(() => JSON.parse(cli.output())).not.toThrow();
  });

  test("--json and --format together fail", () => {
    const cli = newTestCLI();
    expect(() => cli.run(["list", "--json", "--format", "json"])).toThrow(
      /cannot be used together/,
    );
  });
});

describe("journal", () => {
  test("adds an entry to today", () => {
    const cli = newTestCLI();
    cli.run(["journal", "Great day"]);

    const notes = cli.ctx.journalStore!.listNotes(false);
    expect(notes.length).toBe(1);
    expect(notes[0]!.entries.length).toBe(1);
    expect(notes[0]!.entries[0]!.body).toBe("Great day");
  });

  test("joins multiple words", () => {
    const cli = newTestCLI();
    cli.run(["journal", "Hello", "world"]);
    expect(cli.ctx.journalStore!.listNotes(false)[0]!.entries[0]!.body).toBe(
      "Hello world",
    );
  });

  test("add with an explicit date", () => {
    const cli = newTestCLI();
    cli.run(["journal", "add", "--date", "2026-03-01", "Backdated"]);

    const notes = cli.ctx.journalStore!.listNotes(false);
    expect(notes[0]!.date.format("2006-01-02")).toBe("2026-03-01");
  });

  test("list and show", () => {
    const cli = newTestCLI();
    cli.run(["journal", "add", "--date", "2026-03-01", "Entry one"]);
    cli.out.clear();

    cli.run(["journal", "list", "--format", "json"]);
    const notes = JSON.parse(cli.output());
    expect(notes[0].date).toBe("2026-03-01");
    expect(notes[0].entry_count).toBe(1);

    cli.out.clear();
    cli.run(["journal", "show", "2026-03-01", "--format", "json"]);
    const shown = JSON.parse(cli.output());
    expect(shown.entries[0].body).toBe("Entry one");
  });

  test("edit, hide and delete", () => {
    const cli = newTestCLI();
    cli.run(["journal", "add", "--date", "2026-03-01", "Original"]);
    const note = cli.ctx.journalStore!.listNotes(false)[0]!;
    const entryId = note.entries[0]!.id;

    cli.run(["journal", "edit", String(entryId), "Edited"]);
    expect(cli.ctx.journalStore!.listEntries(note.id)[0]!.body).toBe("Edited");

    cli.run(["journal", "hide", "2026-03-01"]);
    expect(cli.ctx.journalStore!.listNotes(false).length).toBe(0);

    cli.run(["journal", "delete", "--force", String(entryId)]);
    expect(cli.ctx.journalStore!.listEntries(note.id).length).toBe(0);
  });

  test("show for a missing date fails", () => {
    const cli = newTestCLI();
    expect(() => cli.run(["journal", "show", "2020-01-01"])).toThrow(
      /note 2020-01-01 not found/,
    );
  });
});

describe("export", () => {
  test("markdown", () => {
    const cli = newTestCLI();
    cli.run(["add", "Export me"]);
    cli.out.clear();

    cli.run(["export", "--format", "md"]);
    const out = cli.output();

    expect(out).toContain("# Tasks");
    expect(out).toContain("Export me");
  });

  test("json", () => {
    const cli = newTestCLI();
    cli.run(["add", "JSON export"]);
    cli.out.clear();

    cli.run(["export", "--format", "json"]);
    const out = cli.output();

    expect(() => JSON.parse(out)).not.toThrow();
    expect(out).toContain("JSON export");
  });

  test("to file", () => {
    const cli = newTestCLI();
    cli.run(["add", "File export"]);
    const path = tempPath("export.md");

    cli.run(["export", "--format", "md", "--output", path]);

    const content = readFileSync(path, "utf8");
    expect(content).toContain("# Tasks");
    expect(content).toContain("File export");
  });

  test("with journal", () => {
    const cli = newTestCLI();
    cli.run(["add", "My task"]);
    cli.run(["journal", "My entry"]);
    cli.out.clear();

    cli.run(["export", "--format", "md", "--journal"]);
    const out = cli.output();

    expect(out).toContain("# Tasks");
    expect(out).toContain("# Journal");
  });
});

describe("show", () => {
  test("table", () => {
    const cli = newTestCLI();
    cli.run(["add", "--desc", "My description", "Show me"]);
    const id = cli.ctx.taskStore!.list()[0]!.id;
    cli.out.clear();

    cli.run(["show", String(id)]);
    const out = cli.output();

    expect(out).toContain("Show me");
    expect(out).toContain("My description");
  });

  test("json", () => {
    const cli = newTestCLI();
    cli.run(["add", "--desc", "desc here", "JSON show"]);
    const id = cli.ctx.taskStore!.list()[0]!.id;
    cli.out.clear();

    cli.run(["show", "--format", "json", String(id)]);
    const out = cli.output();

    expect(() => JSON.parse(out)).not.toThrow();
    expect(out).toContain("JSON show");
    expect(out).toContain("desc here");
  });

  test("not found", () => {
    const cli = newTestCLI();
    expect(() => cli.run(["show", "999"])).toThrow(/not found/);
  });
});

describe("edit", () => {
  test("title", () => {
    const cli = newTestCLI();
    cli.run(["add", "Original title"]);
    const id = cli.ctx.taskStore!.list()[0]!.id;

    cli.run(["edit", String(id), "--title", "Updated title"]);

    expect(cli.ctx.taskStore!.getById(id)!.title).toBe("Updated title");
  });

  test("priority", () => {
    const cli = newTestCLI();
    cli.run(["add", "My task"]);
    const id = cli.ctx.taskStore!.list()[0]!.id;

    cli.run(["edit", String(id), "--priority", "urgent"]);

    expect(cli.ctx.taskStore!.getById(id)!.priority).toBe(Priority.Urgent);
  });

  test("no flags", () => {
    const cli = newTestCLI();
    cli.run(["add", "My task"]);
    const id = cli.ctx.taskStore!.list()[0]!.id;
    expect(() => cli.run(["edit", String(id)])).toThrow(/no changes specified/);
  });

  test("not found", () => {
    const cli = newTestCLI();
    expect(() => cli.run(["edit", "999", "--title", "x"])).toThrow(/not found/);
  });

  test("clear due date", () => {
    const cli = newTestCLI();
    cli.run(["add", "--due", "2026-03-15", "Due task"]);
    const id = cli.ctx.taskStore!.list()[0]!.id;

    cli.run(["edit", String(id), "--clear-due"]);

    expect(cli.ctx.taskStore!.getById(id)!.dueDate).toBeNull();
  });

  test("blocks and clear-blocks", () => {
    const cli = newTestCLI();
    cli.run(["add", "Blocker"]);
    cli.run(["add", "Blocked"]);
    const [blocked, blocker] = cli.ctx.taskStore!.list();

    cli.run(["edit", String(blocker!.id), "--blocks", String(blocked!.id)]);
    expect(cli.ctx.taskStore!.listBlocksIds(blocker!.id)).toEqual([blocked!.id]);

    cli.run(["edit", String(blocker!.id), "--clear-blocks"]);
    expect(cli.ctx.taskStore!.listBlocksIds(blocker!.id)).toEqual([]);
  });
});

describe("delete", () => {
  test("force", () => {
    const cli = newTestCLI();
    cli.run(["add", "Bye"]);
    const id = cli.ctx.taskStore!.list()[0]!.id;

    cli.run(["delete", "--force", String(id)]);

    expect(cli.ctx.taskStore!.list().length).toBe(0);
  });

  test("not found", () => {
    const cli = newTestCLI();
    expect(() => cli.run(["delete", "--force", "999"])).toThrow(/not found/);
  });

  test("guard refuses to delete a blocker", () => {
    const cli = newTestCLI();
    cli.run(["add", "Blocker"]);
    cli.run(["add", "Blocked"]);
    const [blocked, blocker] = cli.ctx.taskStore!.list();
    cli.ctx.taskStore!.setBlocker(blocked!.id, blocker!.id);

    expect(() => cli.run(["delete", "--force", String(blocker!.id)])).toThrow(
      /blocks #/,
    );

    cli.run(["delete", "--force", "--cascade", String(blocker!.id)]);
    expect(cli.ctx.taskStore!.getById(blocker!.id)).toBeNull();
  });
});

describe("status", () => {
  test("set explicitly", () => {
    const cli = newTestCLI();
    cli.run(["add", "Work item"]);
    const id = cli.ctx.taskStore!.list()[0]!.id;

    cli.run(["status", String(id), "active"]);

    expect(cli.ctx.taskStore!.getById(id)!.status).toBe(Status.InProgress);
  });

  test("cycles", () => {
    const cli = newTestCLI();
    cli.run(["add", "Cycle me"]);
    const id = cli.ctx.taskStore!.list()[0]!.id;

    cli.run(["status", String(id)]);
    expect(cli.ctx.taskStore!.getById(id)!.status).toBe(Status.InProgress);

    cli.run(["status", String(id)]);
    expect(cli.ctx.taskStore!.getById(id)!.status).toBe(Status.Done);
  });

  test("invalid value", () => {
    const cli = newTestCLI();
    cli.run(["add", "Task"]);
    const id = cli.ctx.taskStore!.list()[0]!.id;
    expect(() => cli.run(["status", String(id), "flying"])).toThrow(
      /invalid status/,
    );
  });
});

describe("subtask", () => {
  test("add, list, toggle, edit and delete", () => {
    const cli = newTestCLI();
    cli.run(["add", "Parent"]);
    const id = cli.ctx.taskStore!.list()[0]!.id;

    cli.run(["subtask", "add", String(id), "Step one"]);
    cli.out.clear();
    cli.run(["subtask", "list", String(id), "--format", "json"]);
    const subs = JSON.parse(cli.output());
    expect(subs.length).toBe(1);
    expect(subs[0].title).toBe("Step one");

    cli.run(["subtask", "done", String(id), String(subs[0].id)]);
    expect(cli.ctx.taskStore!.getById(id)!.subtasks[0]!.completed).toBe(true);

    cli.run(["subtask", "edit", String(id), String(subs[0].id), "Step 1"]);
    expect(cli.ctx.taskStore!.getById(id)!.subtasks[0]!.title).toBe("Step 1");

    cli.run(["subtask", "delete", "--force", String(id), String(subs[0].id)]);
    expect(cli.ctx.taskStore!.getById(id)!.subtasks.length).toBe(0);
  });

  test("subtask from another task is not found", () => {
    const cli = newTestCLI();
    cli.run(["add", "Parent"]);
    const id = cli.ctx.taskStore!.list()[0]!.id;
    expect(() => cli.run(["subtask", "done", String(id), "999"])).toThrow(
      /subtask #999 not found/,
    );
  });
});

describe("note", () => {
  test("add, list, edit and delete", () => {
    const cli = newTestCLI();
    cli.run(["add", "Parent"]);
    const id = cli.ctx.taskStore!.list()[0]!.id;

    cli.run(["note", "add", String(id), "First note"]);
    cli.out.clear();
    cli.run(["note", "list", String(id), "--format", "json"]);
    const notes = JSON.parse(cli.output());
    expect(notes[0].body).toBe("First note");

    cli.run(["note", "edit", String(id), String(notes[0].id), "Edited note"]);
    expect(cli.ctx.taskStore!.getById(id)!.notes[0]!.body).toBe("Edited note");

    cli.run(["note", "delete", "--force", String(id), String(notes[0].id)]);
    expect(cli.ctx.taskStore!.getById(id)!.notes.length).toBe(0);
  });

  test("empty body fails", () => {
    const cli = newTestCLI();
    cli.run(["add", "Parent"]);
    const id = cli.ctx.taskStore!.list()[0]!.id;
    expect(() => cli.run(["note", "add", String(id), "   "])).toThrow(
      /cannot be empty/,
    );
  });
});

describe("timelog", () => {
  test("add, list and summary", () => {
    const cli = newTestCLI();
    cli.run(["add", "Timed"]);
    const id = cli.ctx.taskStore!.list()[0]!.id;

    cli.run(["timelog", "add", String(id), "1h30m", "--note", "deep work"]);
    cli.out.clear();

    cli.run(["timelog", "list", String(id), "--format", "json"]);
    const logs = JSON.parse(cli.output());
    expect(logs[0].duration).toBe("1h 30m");
    expect(logs[0].note).toBe("deep work");

    cli.out.clear();
    cli.run(["timelog", "summary", "--format", "json"]);
    const summary = JSON.parse(cli.output());
    expect(summary[0].task_id).toBe(id);
    expect(summary[0].duration).toBe("1h 30m");
  });

  test("invalid duration", () => {
    const cli = newTestCLI();
    cli.run(["add", "Timed"]);
    const id = cli.ctx.taskStore!.list()[0]!.id;
    expect(() => cli.run(["timelog", "add", String(id), "abc"])).toThrow(
      /invalid duration/,
    );
  });
});

describe("recur", () => {
  test("set and clear", () => {
    const cli = newTestCLI();
    cli.run(["add", "Repeating"]);
    const id = cli.ctx.taskStore!.list()[0]!.id;

    cli.run(["recur", "set", String(id), "weekly"]);
    expect(cli.ctx.taskStore!.getById(id)!.recurFreq).toBe(RecurFreq.Weekly);

    cli.run(["recur", "clear", String(id)]);
    expect(cli.ctx.taskStore!.getById(id)!.recurFreq).toBe(RecurFreq.None);
  });

  test("invalid frequency", () => {
    const cli = newTestCLI();
    cli.run(["add", "Repeating"]);
    const id = cli.ctx.taskStore!.list()[0]!.id;
    expect(() => cli.run(["recur", "set", String(id), "hourly"])).toThrow(
      /invalid frequency/,
    );
  });
});

describe("batch", () => {
  test("runs commands from stdin", () => {
    const lines = [
      JSON.stringify({ cmd: "add", args: ["From batch", "--priority", "high"] }),
      JSON.stringify({ cmd: "batch", args: [] }),
      "{not json",
    ].join("\n");

    const cli = newTestCLI({ stdin: () => lines });
    cli.run(["batch"]);

    const results = JSON.parse(cli.output());
    expect(results[0].cmd).toBe("add");
    expect(results[0].ok).toBe(true);
    expect(results[0].output).toContain("Created task #1");
    expect(results[1].ok).toBe(false);
    expect(results[1].error).toContain("nested");
    expect(results[2].ok).toBe(false);

    const tasks = cli.ctx.taskStore!.list();
    expect(tasks.length).toBe(1);
    expect(tasks[0]!.priority).toBe(Priority.High);
  });
});

describe("completion", () => {
  test("emits a script per shell", () => {
    for (const shell of ["bash", "zsh", "fish"]) {
      const cli = newTestCLI();
      cli.run(["completion", shell]);
      expect(cli.output()).toContain("rondo");
    }
  });

  test("rejects unknown shells", () => {
    const cli = newTestCLI();
    expect(() => cli.run(["completion", "cmd.exe"])).toThrow(
      /unsupported shell/,
    );
  });
});

describe("config command", () => {
  test("set, get and list use the config file", () => {
    const path = tempPath("config.json");
    const cli = newTestCLI({ configPath: path });

    cli.run(["config", "set", "date_format", "european"]);
    cli.out.clear();

    cli.run(["config", "get", "date_format"]);
    expect(cli.output().trim()).toBe("02.01.2006");

    cli.out.clear();
    cli.run(["config", "list", "--format", "json"]);
    const cfg = JSON.parse(cli.output());
    expect(cfg.date_format).toBe("02.01.2006");
  });

  test("unknown keys fail", () => {
    const path = tempPath("config.json");
    const cli = newTestCLI({ configPath: path });
    expect(() => cli.run(["config", "get", "nope"])).toThrow(
      /unknown config key/,
    );
  });

  test("reset restores defaults", () => {
    const path = tempPath("config.json");
    const cli = newTestCLI({ configPath: path });
    cli.run(["config", "set", "panel_ratio", "0.7"]);
    cli.run(["config", "reset", "--force"]);
    cli.out.clear();
    cli.run(["config", "get", "panel_ratio"]);
    expect(cli.output().trim()).toBe("0.40");
  });
});

describe("quiet mode", () => {
  test("add prints only the ID", () => {
    const cli = newTestCLI();
    cli.run(["add", "--quiet", "Silent"]);
    expect(cli.output().trim()).toBe("1");
  });
});
