import { describe, expect, test } from "bun:test";
import { openMemory } from "../src/core/database/db.ts";
import {
  TaskStore,
  marshalMetadata,
  newTask,
  parseMetadata,
} from "../src/core/task/store.ts";
import type { Task } from "../src/core/task/task.ts";

function newTestStore(): TaskStore {
  return new TaskStore(openMemory());
}

function createTestTask(store: TaskStore, title: string): Task {
  const t = newTask({ title });
  store.create(t);
  return t;
}

describe("task notes", () => {
  test("add and list", () => {
    const store = newTestStore();
    const task = createTestTask(store, "test task");

    store.addNote(task.id, "first note");
    const notes = store.listNotes(task.id);

    expect(notes.length).toBe(1);
    expect(notes[0]!.body).toBe("first note");
    expect(notes[0]!.taskId).toBe(task.id);
  });

  test("update", () => {
    const store = newTestStore();
    const task = createTestTask(store, "test task");
    store.addNote(task.id, "original");

    const notes = store.listNotes(task.id);
    store.updateNote(notes[0]!.id, "updated");

    expect(store.listNotes(task.id)[0]!.body).toBe("updated");
  });

  test("delete", () => {
    const store = newTestStore();
    const task = createTestTask(store, "test task");
    store.addNote(task.id, "note to delete");

    const notes = store.listNotes(task.id);
    store.deleteNote(notes[0]!.id);

    expect(store.listNotes(task.id).length).toBe(0);
  });

  test("restore", () => {
    const store = newTestStore();
    const task = createTestTask(store, "test task");
    store.addNote(task.id, "restore me");

    const original = store.listNotes(task.id)[0]!;
    store.deleteNote(original.id);
    store.restoreNote(task.id, original.body, original.createdAt);

    const notes = store.listNotes(task.id);
    expect(notes.length).toBe(1);
    expect(notes[0]!.body).toBe("restore me");
  });
});

describe("dependencies", () => {
  test("listBlocksIds", () => {
    const store = newTestStore();
    const a = createTestTask(store, "blocker");
    const b = createTestTask(store, "blocked1");
    const c = createTestTask(store, "blocked2");

    store.setBlocker(b.id, a.id);
    store.setBlocker(c.id, a.id);

    expect(store.listBlocksIds(a.id).length).toBe(2);
  });

  test("setBlocker rejects self-block", () => {
    const store = newTestStore();
    const task = createTestTask(store, "self block");
    expect(() => store.setBlocker(task.id, task.id)).toThrow();
  });

  test("setBlockers skips self-block", () => {
    const store = newTestStore();
    const a = createTestTask(store, "task A");
    const b = createTestTask(store, "task B");

    store.setBlockers(a.id, [a.id, b.id]);

    const ids = store.listBlockerIds(a.id);
    expect(ids.length).toBe(1);
    expect(ids[0]).toBe(b.id);
  });

  test("setBlocksIds replaces the set", () => {
    const store = newTestStore();
    const a = createTestTask(store, "blocker");
    const b = createTestTask(store, "blocked1");
    const c = createTestTask(store, "blocked2");

    store.setBlocksIds(a.id, [b.id, c.id]);
    expect(store.listBlocksIds(a.id).length).toBe(2);

    store.setBlocksIds(a.id, [c.id]);
    const ids = store.listBlocksIds(a.id);
    expect(ids.length).toBe(1);
    expect(ids[0]).toBe(c.id);
  });

  test("setBlocksIds skips self-block", () => {
    const store = newTestStore();
    const a = createTestTask(store, "task A");
    const b = createTestTask(store, "task B");

    store.setBlocksIds(a.id, [a.id, b.id]);
    expect(store.listBlocksIds(a.id).length).toBe(1);
  });

  test("delete guard sees blocked tasks", () => {
    const store = newTestStore();
    const a = createTestTask(store, "blocker");
    const b = createTestTask(store, "blocked");

    store.setBlocker(b.id, a.id);

    expect(store.listBlocksIds(a.id)).toEqual([b.id]);
  });
});

describe("metadata", () => {
  test("marshal/parse round-trip", () => {
    const cases: {
      name: string;
      input: Record<string, string> | null;
      want: Record<string, string> | null;
    }[] = [
      { name: "nil", input: null, want: null },
      { name: "empty", input: {}, want: null },
      { name: "single", input: { key: "val" }, want: { key: "val" } },
      { name: "multi", input: { a: "1", b: "2" }, want: { a: "1", b: "2" } },
      {
        name: "comma in value",
        input: { notes: "a,b,c" },
        want: { notes: "a,b,c" },
      },
    ];

    for (const c of cases) {
      const got = parseMetadata(marshalMetadata(c.input));
      expect(got).toEqual(c.want);
    }
  });

  test("survives a store round-trip", () => {
    const store = newTestStore();
    const task = newTask({
      title: "meta test",
      metadata: { notes: "a,b,c", source: "cli" },
    });
    store.create(task);

    const got = store.getById(task.id)!;
    expect(got.metadata?.notes).toBe("a,b,c");
    expect(got.metadata?.source).toBe("cli");
  });
});

describe("subtasks and tags", () => {
  test("create, toggle and list", () => {
    const store = newTestStore();
    const task = newTask({ title: "parent", tags: ["work", " home "] });
    store.create(task);

    store.addSubtask(task.id, "one");
    store.addSubtask(task.id, "two");

    let got = store.getById(task.id)!;
    expect(got.subtasks.map((s) => s.title)).toEqual(["one", "two"]);
    expect(got.subtasks.map((s) => s.position)).toEqual([0, 1]);
    expect(got.tags).toEqual(["work", "home"]);

    store.toggleSubtask(got.subtasks[0]!.id);
    got = store.getById(task.id)!;
    expect(got.subtasks[0]!.completed).toBe(true);

    store.updateSubtask(got.subtasks[1]!.id, "two-edited");
    store.deleteSubtask(got.subtasks[0]!.id);
    got = store.getById(task.id)!;
    expect(got.subtasks.length).toBe(1);
    expect(got.subtasks[0]!.title).toBe("two-edited");
  });

  test("list batches every relation", () => {
    const store = newTestStore();
    const a = createTestTask(store, "A");
    const b = createTestTask(store, "B");
    store.addSubtask(a.id, "sub");
    store.addNote(a.id, "note");
    store.addTimeLog(a.id, 60_000_000_000, "work");
    store.setBlocker(b.id, a.id);

    const tasks = store.list();
    const byId = new Map(tasks.map((t) => [t.id, t]));

    expect(byId.get(a.id)!.subtasks.length).toBe(1);
    expect(byId.get(a.id)!.notes.length).toBe(1);
    expect(byId.get(a.id)!.timeLogs.length).toBe(1);
    expect(byId.get(a.id)!.blocksIds).toEqual([b.id]);
    expect(byId.get(b.id)!.blockedByIds).toEqual([a.id]);
  });

  test("getById returns null for unknown ids", () => {
    const store = newTestStore();
    expect(store.getById(999)).toBeNull();
  });
});

describe("restore", () => {
  test("re-inserts task with tags and subtasks", () => {
    const store = newTestStore();
    const task = newTask({ title: "restore me", tags: ["x"] });
    store.create(task);
    store.addSubtask(task.id, "s1");
    const snapshot = store.getById(task.id)!;
    snapshot.subtasks[0]!.completed = true;
    store.delete(task.id);

    store.restore(snapshot);

    const got = store.getById(snapshot.id)!;
    expect(got.title).toBe("restore me");
    expect(got.tags).toEqual(["x"]);
    expect(got.subtasks.length).toBe(1);
    expect(got.subtasks[0]!.completed).toBe(true);
  });
});
