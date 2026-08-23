import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../src/core/config/config.ts";
import { Minute } from "../src/core/duration.ts";
import { openMemory } from "../src/core/database/db.ts";
import { RecurFreq } from "../src/core/task/recur.ts";
import { Priority, Status } from "../src/core/task/task.ts";
import { GoTime } from "../src/core/time.ts";
import { RondoData, type TaskDraft } from "../src/tui/data.ts";

function newData(): RondoData {
  return new RondoData(openMemory(), defaultConfig());
}

function draft(fields: Partial<TaskDraft> = {}): TaskDraft {
  return {
    title: "Task",
    description: "",
    priority: Priority.Low,
    dueDate: null,
    tags: [],
    recurFreq: RecurFreq.None,
    ...fields,
  };
}

describe("RondoData recurrence", () => {
  test("completing a recurring task spawns exactly one next occurrence", () => {
    const data = newData();
    const t = data.createTask(
      draft({
        title: "Water the plants",
        recurFreq: RecurFreq.Daily,
        dueDate: GoTime.date(2026, 8, 21, 0, 0, 0, 0, "utc"),
      }),
    );

    data.toggleInProgress(t); // Pending -> InProgress
    data.toggleDone(t); // InProgress -> Done, spawns the next occurrence

    expect(data.listTasks().length).toBe(2);
  });

  test("re-completing the same task does not spawn a duplicate", () => {
    const data = newData();
    const t = data.createTask(
      draft({
        title: "Water the plants",
        recurFreq: RecurFreq.Daily,
        dueDate: GoTime.date(2026, 8, 21, 0, 0, 0, 0, "utc"),
      }),
    );

    data.toggleInProgress(t); // Pending -> InProgress
    data.toggleDone(t); // InProgress -> Done, spawns
    data.toggleDone(t); // Done -> Pending (accidental extra press)
    data.toggleInProgress(t); // Pending -> InProgress
    data.toggleDone(t); // InProgress -> Done again

    expect(data.listTasks().length).toBe(2);
  });

  test("recurrence moves to the spawned occurrence", () => {
    const data = newData();
    const t = data.createTask(
      draft({
        title: "Weekly review",
        recurFreq: RecurFreq.Weekly,
        dueDate: GoTime.date(2026, 8, 21, 0, 0, 0, 0, "utc"),
      }),
    );

    data.toggleInProgress(t);
    data.toggleDone(t);

    const completed = data.tasks.getById(t.id)!;
    expect(completed.status).toBe(Status.Done);
    expect(completed.recurFreq).toBe(RecurFreq.None);

    const spawned = data.listTasks().find((x) => x.id !== t.id)!;
    expect(spawned.recurFreq).toBe(RecurFreq.Weekly);
  });
});

describe("RondoData dependencies", () => {
  test("addDependency blocks a task and removeDependency clears it", () => {
    const data = newData();
    const a = data.createTask(draft({ title: "Deploy" }));
    const b = data.createTask(draft({ title: "Write tests" }));

    data.addDependency(a.id, b.id);
    expect(data.tasks.getById(a.id)!.blockedByIds).toEqual([b.id]);

    data.removeDependency(a.id, b.id);
    expect(data.tasks.getById(a.id)!.blockedByIds).toEqual([]);
  });

  test("addDependency rejects cycles", () => {
    const data = newData();
    const a = data.createTask(draft({ title: "A" }));
    const b = data.createTask(draft({ title: "B" }));

    data.addDependency(a.id, b.id);
    expect(() => data.addDependency(b.id, a.id)).toThrow(/cycle/);
  });

  test("addDependency rejects self-blocking", () => {
    const data = newData();
    const a = data.createTask(draft({ title: "A" }));
    expect(() => data.addDependency(a.id, a.id)).toThrow();
  });
});

describe("RondoData status", () => {
  test("setStatus to Done on a recurring task spawns and reports the id", () => {
    const data = newData();
    const t = data.createTask(
      draft({
        title: "Water the plants",
        recurFreq: RecurFreq.Daily,
        dueDate: GoTime.date(2026, 8, 21, 0, 0, 0, 0, "utc"),
      }),
    );

    const { spawnedId } = data.setStatus(t, Status.Done);

    expect(spawnedId).not.toBeNull();
    expect(data.tasks.getById(spawnedId!)!.recurFreq).toBe(RecurFreq.Daily);
    expect(data.tasks.getById(t.id)!.recurFreq).toBe(RecurFreq.None);
    expect(data.setStatus(t, Status.Pending).spawnedId).toBeNull();
  });

  test("setStatus does not spawn when the task is already Done", () => {
    const data = newData();
    const t = data.createTask(draft({ title: "Done already" }));
    data.setStatus(t, Status.Done);
    data.tasks.updateRecurrence(t.id, RecurFreq.Daily, 1);
    t.recurFreq = RecurFreq.Daily;
    t.recurInterval = 1;

    expect(data.setStatus(t, Status.Done).spawnedId).toBeNull();
    expect(data.listTasks().length).toBe(1);
  });

  test("toggleDone flips between Done and Pending", () => {
    const data = newData();
    const t = data.createTask(draft({ title: "Toggle" }));

    expect(data.toggleDone(t).status).toBe(Status.Done);
    expect(data.toggleDone(t).status).toBe(Status.Pending);
    data.toggleInProgress(t);
    expect(data.toggleDone(t).status).toBe(Status.Done);
    expect(data.tasks.getById(t.id)!.status).toBe(Status.Done);
  });

  test("toggleInProgress flips Pending/InProgress and reopens Done", () => {
    const data = newData();
    const t = data.createTask(draft({ title: "Toggle" }));

    expect(data.toggleInProgress(t).status).toBe(Status.InProgress);
    expect(data.toggleInProgress(t).status).toBe(Status.Pending);
    data.setStatus(t, Status.Done);
    const { status, undo } = data.toggleInProgress(t);
    expect(status).toBe(Status.InProgress);
    expect(data.tasks.getById(t.id)!.status).toBe(Status.InProgress);

    data.undo(undo);
    expect(data.tasks.getById(t.id)!.status).toBe(Status.Done);
  });

  test("the status undo restores recurrence and removes the spawn", () => {
    const data = newData();
    const t = data.createTask(
      draft({
        title: "Weekly review",
        recurFreq: RecurFreq.Weekly,
        dueDate: GoTime.date(2026, 8, 21, 0, 0, 0, 0, "utc"),
      }),
    );
    const { spawnedId, undo } = data.setStatus(t, Status.Done);
    expect(undo.kind).toBe("status");
    if (undo.kind !== "status") throw new Error("unreachable");
    expect(undo.prevStatus).toBe(Status.Pending);
    expect(undo.prevRecurFreq).toBe(RecurFreq.Weekly);
    expect(undo.spawnedId).toBe(spawnedId);

    data.undo(undo);

    const restored = data.tasks.getById(t.id)!;
    expect(restored.status).toBe(Status.Pending);
    expect(restored.recurFreq).toBe(RecurFreq.Weekly);
    expect(restored.recurInterval).toBe(1);
    expect(data.tasks.getById(spawnedId!)).toBeNull();
    expect(data.listTasks().length).toBe(1);
  });
});

describe("RondoData priority and due", () => {
  test("setPriority writes the column and its undo puts the old value back", () => {
    const data = newData();
    const t = data.createTask(draft({ title: "P", priority: Priority.Low }));

    const action = data.setPriority(t, Priority.High);
    expect(data.tasks.getById(t.id)!.priority).toBe(Priority.High);
    expect(t.priority).toBe(Priority.High);

    data.undo(action);
    expect(data.tasks.getById(t.id)!.priority).toBe(Priority.Low);
  });

  test("setDue writes the date, clears it, and undo restores either", () => {
    const data = newData();
    const t = data.createTask(draft({ title: "D" }));
    const due = GoTime.date(2026, 9, 1, 0, 0, 0, 0, "utc");

    const set = data.setDue(t, due);
    expect(data.tasks.getById(t.id)!.dueDate!.equal(due)).toBe(true);

    const cleared = data.setDue(t, null);
    expect(data.tasks.getById(t.id)!.dueDate).toBeNull();

    data.undo(cleared);
    expect(data.tasks.getById(t.id)!.dueDate!.equal(due)).toBe(true);
    data.undo(set);
    expect(data.tasks.getById(t.id)!.dueDate).toBeNull();
  });
});

describe("RondoData notes and time logs", () => {
  test("editTaskNote rewrites the body", () => {
    const data = newData();
    const t = data.createTask(draft({ title: "N" }));
    data.addTaskNote(t.id, "draft");
    const note = data.tasks.getById(t.id)!.notes[0]!;

    data.editTaskNote(note.id, "final");
    expect(data.tasks.getById(t.id)!.notes[0]!.body).toBe("final");
  });

  test("deleteTaskNote returns an undo that restores the note", () => {
    const data = newData();
    const t = data.createTask(draft({ title: "N" }));
    data.addTaskNote(t.id, "keep me");
    const note = data.tasks.getById(t.id)!.notes[0]!;

    const action = data.deleteTaskNote(t.id, note);
    expect(action.kind).toBe("note");
    expect(data.tasks.getById(t.id)!.notes).toEqual([]);

    data.undo(action);
    const back = data.tasks.getById(t.id)!.notes[0]!;
    expect(back.body).toBe("keep me");
    expect(back.createdAt.equal(note.createdAt)).toBe(true);
  });

  test("deleteTimeLog returns an undo that restores the log", () => {
    const data = newData();
    const t = data.createTask(draft({ title: "L" }));
    data.logTime(t.id, 1_500_000_000_000, "pairing");
    const log = data.tasks.getById(t.id)!.timeLogs[0]!;

    const action = data.deleteTimeLog(t.id, log);
    expect(action.kind).toBe("timelog");
    expect(data.tasks.getById(t.id)!.timeLogs).toEqual([]);

    data.undo(action);
    const back = data.tasks.getById(t.id)!.timeLogs[0]!;
    expect(back.duration).toBe(1_500_000_000_000);
    expect(back.note).toBe("pairing");
    expect(back.loggedAt.equal(log.loggedAt)).toBe(true);
  });
});

describe("RondoData time log edit (3.10)", () => {
  test("replaceTimeLog keeps the timestamp and one undo brings the old log back", () => {
    const data = newData();
    const t = data.createTask(draft({ title: "L" }));
    data.logTime(t.id, 45 * Minute, "pairing");
    const log = data.tasks.getById(t.id)!.timeLogs[0]!;

    const action = data.replaceTimeLog(t.id, log, 90 * Minute, "review");
    expect(action.kind).toBe("bulk");
    const edited = data.tasks.getById(t.id)!.timeLogs;
    expect(edited).toHaveLength(1);
    expect(edited[0]!.duration).toBe(90 * Minute);
    expect(edited[0]!.note).toBe("review");
    expect(edited[0]!.loggedAt.equal(log.loggedAt)).toBe(true);

    data.undo(action);
    const back = data.tasks.getById(t.id)!.timeLogs;
    expect(back).toHaveLength(1);
    expect(back[0]!.duration).toBe(45 * Minute);
    expect(back[0]!.note).toBe("pairing");
  });
});

describe("RondoData bulk undo", () => {
  test("undoes the grouped actions in reverse order", () => {
    const data = newData();
    const a = data.createTask(draft({ title: "A" }));
    const b = data.createTask(draft({ title: "B" }));

    const first = data.setPriority(a, Priority.Urgent);
    const second = data.setPriority(a, Priority.Medium);
    const third = data.deleteTask(b);

    data.undo({ kind: "bulk", label: "Bulk", actions: [first, second, third] });

    expect(data.tasks.getById(a.id)!.priority).toBe(Priority.Low);
    expect(data.tasks.getById(b.id)!.title).toBe("B");
  });
});

describe("RondoData refresh", () => {
  test("refreshTask returns a fresh copy or null when the task is gone", () => {
    const data = newData();
    const t = data.createTask(draft({ title: "Fresh" }));
    data.tasks.addSubtask(t.id, "one");

    const fresh = data.refreshTask(t.id)!;
    expect(fresh).not.toBe(t);
    expect(fresh.subtasks.map((s) => s.title)).toEqual(["one"]);
    expect(data.refreshTask(t.id + 99)).toBeNull();
  });

  test("changed() only reports commits made by another connection", () => {
    const dir = mkdtempSync(join(tmpdir(), "rondo-data-version-"));
    const path = join(dir, "todo.db");
    const openFile = () => {
      const db = new Database(path, { create: true });
      db.run("PRAGMA journal_mode=WAL");
      db.run("PRAGMA foreign_keys=ON");
      return db;
    };
    const data = new RondoData(openFile(), defaultConfig());
    const other = new RondoData(openFile(), defaultConfig());

    expect(data.changed()).toBe(false);
    data.createTask(draft({ title: "mine" }));
    expect(data.changed()).toBe(false);

    other.createTask(draft({ title: "theirs" }));
    expect(data.changed()).toBe(true);
    expect(data.changed()).toBe(false);
    expect(data.listTasks().map((t) => t.title).sort()).toEqual([
      "mine",
      "theirs",
    ]);
  });
});
