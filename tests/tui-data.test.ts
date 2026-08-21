import { describe, expect, test } from "bun:test";
import { defaultConfig } from "../src/core/config/config.ts";
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

    data.cycleStatus(t); // Pending -> InProgress
    data.cycleStatus(t); // InProgress -> Done, spawns the next occurrence

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

    data.cycleStatus(t); // Pending -> InProgress
    data.cycleStatus(t); // InProgress -> Done, spawns
    data.cycleStatus(t); // Done -> Pending (accidental extra press)
    data.cycleStatus(t); // Pending -> InProgress
    data.cycleStatus(t); // InProgress -> Done again

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

    data.cycleStatus(t);
    data.cycleStatus(t);

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
