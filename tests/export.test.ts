import { describe, expect, test } from "bun:test";
import type { Note } from "../src/core/journal/journal.ts";
import { newTask } from "../src/core/task/store.ts";
import { Priority, Status, type Task } from "../src/core/task/task.ts";
import { GoTime } from "../src/core/time.ts";
import { writeJSON, writeNotes, writeTasks } from "../src/core/export/export.ts";

function sampleTasks(): Task[] {
  return [
    newTask({
      id: 1,
      title: "Write tests",
      description: "Unit tests for export package",
      status: Status.InProgress,
      priority: Priority.High,
      dueDate: GoTime.date(2026, 3, 1),
      createdAt: GoTime.date(2026, 2, 15, 10, 0, 0, 0, "utc"),
      subtasks: [
        { id: 1, title: "Markdown tests", completed: true, position: 0 },
        { id: 2, title: "JSON tests", completed: false, position: 1 },
      ],
      tags: ["dev", "testing"],
    }),
    newTask({
      id: 2,
      title: "Deploy app",
      status: Status.Done,
      priority: Priority.Low,
      createdAt: GoTime.date(2026, 2, 16, 12, 0, 0, 0, "utc"),
    }),
  ];
}

function sampleNotes(): Note[] {
  return [
    {
      id: 1,
      date: GoTime.date(2026, 2, 20),
      hidden: false,
      createdAt: GoTime.date(2026, 2, 20, 0, 0, 0, 0, "utc"),
      updatedAt: GoTime.date(2026, 2, 20, 0, 0, 0, 0, "utc"),
      entries: [
        {
          id: 1,
          noteId: 1,
          body: "Started Phase 1A implementation",
          createdAt: GoTime.date(2026, 2, 20, 9, 30, 0, 0, "utc"),
        },
        {
          id: 2,
          noteId: 1,
          body: "Tests passing",
          createdAt: GoTime.date(2026, 2, 20, 14, 15, 0, 0, "utc"),
        },
      ],
    },
    {
      id: 2,
      date: GoTime.date(2026, 2, 19),
      hidden: false,
      createdAt: GoTime.date(2026, 2, 19, 0, 0, 0, 0, "utc"),
      updatedAt: GoTime.date(2026, 2, 19, 0, 0, 0, 0, "utc"),
      entries: [
        {
          id: 3,
          noteId: 2,
          body: "Planning session",
          createdAt: GoTime.date(2026, 2, 19, 11, 0, 0, 0, "utc"),
        },
      ],
    },
  ];
}

describe("writeTasks", () => {
  test("header", () => {
    expect(writeTasks(sampleTasks()).startsWith("# Tasks\n")).toBe(true);
  });

  test("checkbox format", () => {
    const out = writeTasks(sampleTasks());
    expect(out).toContain("- [ ] **Write tests**");
    expect(out).toContain("- [x] **Deploy app**");
  });

  test("metadata", () => {
    const out = writeTasks(sampleTasks());
    expect(out).toContain("High");
    expect(out).toContain("In Progress");
    expect(out).toContain("due 2026-03-01");
    expect(out).toContain("tags: dev, testing");
  });

  test("description", () => {
    expect(writeTasks(sampleTasks())).toContain(
      "> Unit tests for export package",
    );
  });

  test("subtasks", () => {
    const out = writeTasks(sampleTasks());
    expect(out).toContain("  - [x] Markdown tests");
    expect(out).toContain("  - [ ] JSON tests");
  });

  test("empty", () => {
    const out = writeTasks(null);
    expect(out).toContain("# Tasks");
    expect(out).toContain("_No tasks._");
  });
});

describe("writeNotes", () => {
  test("header", () => {
    expect(writeNotes(sampleNotes()).startsWith("# Journal\n")).toBe(true);
  });

  test("date headings", () => {
    const out = writeNotes(sampleNotes());
    expect(out).toContain("## 2026-02-20");
    expect(out).toContain("## 2026-02-19");
  });

  test("entry format", () => {
    const out = writeNotes(sampleNotes());
    expect(out).toContain("**09:30**");
    expect(out).toContain("Started Phase 1A implementation");
    expect(out).toContain("**14:15**");
    expect(out).toContain("Tests passing");
  });

  test("empty", () => {
    const out = writeNotes(null);
    expect(out).toContain("# Journal");
    expect(out).toContain("_No journal entries._");
  });
});

describe("writeJSON", () => {
  test("top level keys", () => {
    const result = JSON.parse(writeJSON(sampleTasks(), sampleNotes()));
    expect(result).toHaveProperty("tasks");
    expect(result).toHaveProperty("journal");
  });

  test("task fields", () => {
    const out = writeJSON(sampleTasks(), null);
    const result = JSON.parse(out);

    expect(result.tasks.length).toBe(2);
    const first = result.tasks[0];
    expect(first.id).toBe(1);
    expect(first.title).toBe("Write tests");
    expect(first.status).toBe("In Progress");
    expect(first.priority).toBe("High");
    expect(first.due_date).toBe("2026-03-01");
    expect(first.subtasks.length).toBe(2);
    expect(first.subtasks[0].completed).toBe(true);
    expect(first.subtasks[1].completed).toBe(false);
    expect(first.tags).toEqual(["dev", "testing"]);

    const second = result.tasks[1];
    expect(second.due_date ?? "").toBe("");
    expect(second.tags ?? []).toEqual([]);
    expect(second.subtasks ?? []).toEqual([]);
  });

  test("note fields", () => {
    const result = JSON.parse(writeJSON(null, sampleNotes()));

    expect(result.journal.length).toBe(2);
    const first = result.journal[0];
    expect(first.date).toBe("2026-02-20");
    expect(first.entries.length).toBe(2);
    expect(first.entries[0].body).toBe("Started Phase 1A implementation");
    expect(first.entries[0].created_at).not.toBe("");
  });

  test("empty inputs are still valid JSON", () => {
    const result = JSON.parse(writeJSON(null, null));
    expect(result).toHaveProperty("tasks");
  });

  test("valid JSON", () => {
    expect(() =>
      JSON.parse(writeJSON(sampleTasks(), sampleNotes())),
    ).not.toThrow();
  });
});
