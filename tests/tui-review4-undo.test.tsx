import { expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../src/core/config/config.ts";
import { openMemory } from "../src/core/database/db.ts";
import { Minute } from "../src/core/duration.ts";
import { RecurFreq } from "../src/core/task/recur.ts";
import { newTask } from "../src/core/task/store.ts";
import { Priority, Status, type Task } from "../src/core/task/task.ts";
import { App } from "../src/tui/app.tsx";
import { RondoData, type TaskDraft } from "../src/tui/data.ts";

const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("not wrapped in act")) return;
  originalConsoleError(...args);
};

const draft = (fields: Partial<TaskDraft> = {}): TaskDraft => ({
  title: "Original title",
  description: "",
  priority: Priority.Low,
  dueDate: null,
  tags: [],
  recurFreq: RecurFreq.None,
  ...fields,
});

async function mount(cfg = defaultConfig(), seed?: (data: RondoData, task: Task) => void) {
  process.env.RONDO_HOME = mkdtempSync(join(tmpdir(), "rondo-review4-undo-"));
  const db = openMemory();
  const data = new RondoData(db, cfg);
  const task = newTask({ title: "Original title", priority: Priority.Low });
  data.tasks.create(task);
  seed?.(data, task);
  let setup!: Awaited<ReturnType<typeof testRender>>;
  await act(async () => {
    setup = await testRender(<App data={data} />, {
      width: 120,
      height: 40,
      exitOnCtrlC: false,
    });
  });
  await setup.flush();
  const press = async (key: string, modifiers?: { ctrl?: boolean }) => {
    await act(async () => {
      setup.mockInput.pressKey(key, modifiers);
      if (key === "ESCAPE") await Bun.sleep(120);
    });
    await setup.flush();
  };
  const type = async (text: string) => {
    await act(async () => { await setup.mockInput.typeText(text); });
    await setup.flush();
  };
  const close = () => { setup.renderer.destroy(); db.close(); };
  return { ...setup, data, task, press, type, close };
}

test("undo reverses a title edit before an older priority change", async () => {
  const app = await mount();
  try {
    await app.press("+");
    await app.press("e");
    await app.type(" revised");
    await app.press("RETURN");
    expect(app.data.refreshTask(app.task.id)!.title).toBe("Original title revised");
    await app.press("u");
    expect(app.data.refreshTask(app.task.id)!.title).toBe("Original title");
    expect(app.data.refreshTask(app.task.id)!.priority).toBe(Priority.Medium);
    await app.press("u");
    expect(app.data.refreshTask(app.task.id)!.priority).toBe(Priority.Low);
  } finally { app.close(); }
});

test("undo removes a created task before changing an older task", async () => {
  const app = await mount();
  try {
    await app.press("+");
    await app.press("a");
    await app.type("Fresh capture");
    await app.press("RETURN");
    expect(app.data.listTasks()).toHaveLength(2);
    await app.press("u");
    expect(app.data.listTasks().map((task) => task.title)).toEqual(["Original title"]);
    expect(app.data.refreshTask(app.task.id)!.priority).toBe(Priority.Medium);
  } finally { app.close(); }
});

test("deleted task restoration preserves child ids for earlier edit undos", () => {
  const db = openMemory();
  const data = new RondoData(db, defaultConfig());
  try {
    const task = data.createTask(draft());
    data.addSubtask(task.id, "Original step");
    data.addTaskNote(task.id, "Original note");
    data.logTime(task.id, Minute, "Original log");
    const before = data.refreshTask(task.id)!;
    const subtask = before.subtasks[0]!;
    const note = before.notes[0]!;
    const log = before.timeLogs[0]!;
    const deletion = data.deleteTask(before);
    data.undo(deletion);
    const restored = data.refreshTask(task.id)!;
    expect(restored.subtasks[0]!.id).toBe(subtask.id);
    expect(restored.notes[0]!.id).toBe(note.id);
    expect(restored.timeLogs[0]!.id).toBe(log.id);
    expect(restored.subtasks[0]!.title).toBe("Original step");
  } finally { db.close(); }
});

test("a replaced time log keeps its id through edit and undo", () => {
  const db = openMemory();
  const data = new RondoData(db, defaultConfig());
  try {
    const task = data.createTask(draft());
    data.logTime(task.id, Minute, "Original log");
    const log = data.refreshTask(task.id)!.timeLogs[0]!;
    const action = data.replaceTimeLog(task.id, log, 2 * Minute, "Revised log");
    expect(data.refreshTask(task.id)!.timeLogs[0]!.id).toBe(log.id);
    data.undo(action);
    const restored = data.refreshTask(task.id)!.timeLogs[0]!;
    expect(restored.id).toBe(log.id);
    expect(restored.duration).toBe(Minute);
    expect(restored.note).toBe("Original log");
    expect(data.refreshTask(task.id)!.status).toBe(Status.Pending);
  } finally { db.close(); }
});

test("the palette names the next edit that undo will reverse", async () => {
  const app = await mount();
  try {
    await app.press("+");
    await app.press("e");
    await app.type(" revised");
    await app.press("RETURN");
    await app.press("k", { ctrl: true });
    await app.type("undo");
    expect(app.captureCharFrame()).toContain('Undo: Edited "Original title"');
    await app.press("RETURN");
    expect(app.data.refreshTask(app.task.id)!.title).toBe("Original title");
  } finally { app.close(); }
});

test("undo removes a completed focus log without rewinding the focus cycle", async () => {
  const cfg = defaultConfig();
  cfg.focus.workDuration = 0.001;
  cfg.focus.autoStartBreak = false;
  const app = await mount(cfg);
  try {
    await app.press("+");
    await app.press("f");
    await act(async () => { await Bun.sleep(150); });
    await app.flush();
    expect(app.data.refreshTask(app.task.id)!.timeLogs).toHaveLength(1);
    await app.press("u");
    expect(app.data.refreshTask(app.task.id)!.timeLogs).toHaveLength(0);
    expect(app.data.refreshTask(app.task.id)!.priority).toBe(Priority.Medium);
    expect(app.data.focus.listByTask(app.task.id)[0]!.completedAt).not.toBeNull();
    expect(app.captureCharFrame()).toContain("Break");
  } finally { app.close(); }
});

test("subtask add edit toggle and delete undo in actual input order", async () => {
  const app = await mount();
  try {
    await app.press("t");
    await app.type("Original step");
    await app.press("RETURN");
    await app.press("ESCAPE");
    const subtask = app.data.refreshTask(app.task.id)!.subtasks[0]!;
    expect(subtask.title).toBe("Original step");
    await app.press("RETURN");
    await app.press("e");
    await app.type(" revised");
    await app.press("RETURN");
    await app.press(" ");
    expect(app.data.refreshTask(app.task.id)!.subtasks[0]!.completed).toBe(true);
    await app.press("d");
    expect(app.data.refreshTask(app.task.id)!.subtasks).toHaveLength(0);
    await app.press("u");
    expect(app.data.refreshTask(app.task.id)!.subtasks[0]!.id).toBe(subtask.id);
    await app.press("u");
    expect(app.data.refreshTask(app.task.id)!.subtasks[0]!.completed).toBe(false);
    await app.press("u");
    expect(app.data.refreshTask(app.task.id)!.subtasks[0]!.title).toBe("Original step");
    await app.press("u");
    expect(app.data.refreshTask(app.task.id)!.subtasks).toHaveLength(0);
  } finally { app.close(); }
});

test("journal creation edit delete and hidden state undo without changing entry ids", async () => {
  const app = await mount();
  try {
    await app.press("TAB");
    await app.press("TAB");
    await app.press("TAB");
    await app.press("a");
    await app.type("Original entry");
    await app.press("s", { ctrl: true });
    const entry = app.data.listNotes(false)[0]!.entries[0]!;
    await app.press("l");
    await app.press("e");
    await app.type(" revised");
    await app.press("s", { ctrl: true });
    expect(app.data.listNotes(false)[0]!.entries[0]!.body).toBe("Original entry revised");
    await app.press("d");
    expect(app.data.listNotes(false)[0]!.entries).toHaveLength(0);
    await app.press("u");
    expect(app.data.listNotes(false)[0]!.entries[0]!.id).toBe(entry.id);
    await app.press("u");
    expect(app.data.listNotes(false)[0]!.entries[0]!.body).toBe("Original entry");
    await app.press("h");
    await app.press("x");
    expect(app.data.listNotes(false)).toHaveLength(0);
    await app.press("u");
    expect(app.data.listNotes(false)[0]!.entries[0]!.id).toBe(entry.id);
    await app.press("u");
    expect(app.data.listNotes(true)).toHaveLength(0);
  } finally { app.close(); }
});

test("task notes preserve identity through add edit delete and task deletion", () => {
  const db = openMemory();
  const data = new RondoData(db, defaultConfig());
  try {
    const task = data.createTask(draft());
    const added = data.addTaskNote(task.id, "Original note")!;
    const note = data.refreshTask(task.id)!.notes[0]!;
    const edited = data.editTaskNote(note.id, "Revised note")!;
    const removed = data.deleteTaskNote(task.id, data.refreshTask(task.id)!.notes[0]!);
    data.undo(removed);
    const taskRemoved = data.deleteTask(data.refreshTask(task.id)!);
    data.undo(taskRemoved);
    data.undo(edited);
    expect(data.refreshTask(task.id)!.notes[0]!.id).toBe(note.id);
    expect(data.refreshTask(task.id)!.notes[0]!.body).toBe("Original note");
    data.undo(added);
    expect(data.refreshTask(task.id)!.notes).toHaveLength(0);
  } finally { db.close(); }
});

test("dependency mutations undo without recording no-op changes", () => {
  const db = openMemory();
  const data = new RondoData(db, defaultConfig());
  try {
    const task = data.createTask(draft());
    const blocker = data.createTask(draft({ title: "Blocker" }));
    const added = data.addDependency(task.id, blocker.id)!;
    expect(data.addDependency(task.id, blocker.id)).toBeNull();
    const removed = data.removeDependency(task.id, blocker.id)!;
    expect(data.removeDependency(task.id, blocker.id)).toBeNull();
    data.undo(removed);
    expect(data.refreshTask(task.id)!.blockedByIds).toEqual([blocker.id]);
    data.undo(added);
    expect(data.refreshTask(task.id)!.blockedByIds).toEqual([]);
  } finally { db.close(); }
});

test("mixed recurring completion bulk deletion and edits undo without losing relations", () => {
  const db = openMemory();
  const data = new RondoData(db, defaultConfig());
  try {
    const task = data.createTask(draft({ recurFreq: RecurFreq.Weekly }));
    const other = data.createTask(draft({ title: "Dependent" }));
    data.addDependency(other.id, task.id);
    const edit = data.updateTask(task, draft({ title: "Revised recurring", recurFreq: RecurFreq.Daily }));
    const completion = data.toggleDone(data.refreshTask(task.id)!);
    expect(data.listTasks()).toHaveLength(3);
    const targets = [data.refreshTask(task.id)!, data.refreshTask(other.id)!];
    const deletion = { kind: "bulk" as const, label: "Deleted tasks", actions: targets.map((row) => data.deleteTask(row)) };
    data.undo(deletion);
    expect(data.refreshTask(other.id)!.blockedByIds).toEqual([task.id]);
    data.undo(completion.undo);
    expect(data.listTasks()).toHaveLength(2);
    expect(data.refreshTask(task.id)!.status).toBe(Status.Pending);
    expect(data.refreshTask(task.id)!.recurFreq).toBe(RecurFreq.Daily);
    data.undo(edit);
    expect(data.refreshTask(task.id)!.title).toBe("Original title");
    expect(data.refreshTask(task.id)!.recurFreq).toBe(RecurFreq.Weekly);
  } finally { db.close(); }
});
