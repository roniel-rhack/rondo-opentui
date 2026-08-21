import { describe, expect, test } from "bun:test";
import { newTask } from "../src/core/task/store.ts";
import { Priority, Status } from "../src/core/task/task.ts";
import { GoTime } from "../src/core/time.ts";
import {
  clampIndex,
  collectTags,
  fuzzyScore,
  tabCounts,
  visibleTasks,
  emptyFilters,
} from "../src/tui/state.ts";

function task(fields: Parameters<typeof newTask>[0]) {
  return newTask({ createdAt: GoTime.now(), ...fields });
}

const sample = [
  task({
    id: 1,
    title: "Write report",
    status: Status.Pending,
    priority: Priority.High,
    tags: ["work"],
    createdAt: GoTime.date(2026, 3, 1),
    dueDate: GoTime.date(2026, 3, 10),
  }),
  task({
    id: 2,
    title: "Buy milk",
    status: Status.Done,
    priority: Priority.Low,
    tags: ["home"],
    createdAt: GoTime.date(2026, 3, 2),
  }),
  task({
    id: 3,
    title: "Refactor parser",
    status: Status.InProgress,
    priority: Priority.Urgent,
    tags: ["work", "code"],
    createdAt: GoTime.date(2026, 3, 3),
    dueDate: GoTime.date(2026, 3, 5),
  }),
];

describe("fuzzyScore", () => {
  test("matches subsequences and rejects misses", () => {
    expect(fuzzyScore("wr", "Write report")).not.toBeNull();
    expect(fuzzyScore("zzz", "Write report")).toBeNull();
    expect(fuzzyScore("", "anything")).toBe(0);
  });

  test("prefers consecutive matches", () => {
    const consecutive = fuzzyScore("rep", "report")!;
    const scattered = fuzzyScore("rep", "rxexp")!;
    expect(consecutive).toBeGreaterThan(scattered);
  });
});

describe("visibleTasks", () => {
  test("all tab keeps everything sorted by creation desc", () => {
    const out = visibleTasks(sample, "all", emptyFilters, "created");
    expect(out.map((t) => t.id)).toEqual([3, 2, 1]);
  });

  test("active tab hides done tasks", () => {
    const out = visibleTasks(sample, "active", emptyFilters, "created");
    expect(out.map((t) => t.id)).toEqual([3, 1]);
  });

  test("done tab keeps only completed tasks", () => {
    const out = visibleTasks(sample, "done", emptyFilters, "created");
    expect(out.map((t) => t.id)).toEqual([2]);
  });

  test("tag filter", () => {
    const out = visibleTasks(
      sample,
      "all",
      { query: "", tag: "code" },
      "created",
    );
    expect(out.map((t) => t.id)).toEqual([3]);
  });

  test("query filter ranks matches", () => {
    const out = visibleTasks(
      sample,
      "all",
      { query: "refac", tag: null },
      "created",
    );
    expect(out.map((t) => t.id)).toEqual([3]);
  });

  test("sort by priority then due date", () => {
    expect(
      visibleTasks(sample, "all", emptyFilters, "priority").map((t) => t.id),
    ).toEqual([3, 1, 2]);
    expect(
      visibleTasks(sample, "all", emptyFilters, "due").map((t) => t.id),
    ).toEqual([3, 1, 2]);
  });
});

describe("helpers", () => {
  test("tabCounts", () => {
    expect(tabCounts(sample, 4)).toEqual({
      all: 3,
      active: 2,
      done: 1,
      journal: 4,
    });
  });

  test("collectTags sorts by frequency", () => {
    expect(collectTags(sample)).toEqual([
      { tag: "work", count: 2 },
      { tag: "code", count: 1 },
      { tag: "home", count: 1 },
    ]);
  });

  test("clampIndex", () => {
    expect(clampIndex(-3, 5)).toBe(0);
    expect(clampIndex(9, 5)).toBe(4);
    expect(clampIndex(2, 5)).toBe(2);
    expect(clampIndex(2, 0)).toBe(0);
  });
});
