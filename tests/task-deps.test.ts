import { describe, expect, test } from "bun:test";
import { hasCycle, isBlocked } from "../src/core/task/deps.ts";
import { Status } from "../src/core/task/task.ts";

function blockersFrom(map: Record<number, number[]>) {
  return (id: number) => map[id] ?? [];
}

describe("hasCycle", () => {
  test("no cycle for an independent blocker", () => {
    const get = blockersFrom({ 1: [2], 2: [3], 3: [], 4: [] });
    expect(hasCycle(1, [4], get)).toBe(false);
  });

  test("direct cycle", () => {
    const get = blockersFrom({ 1: [2], 2: [] });
    expect(hasCycle(2, [1], get)).toBe(true);
  });

  test("transitive cycle", () => {
    const get = blockersFrom({ 1: [2], 2: [3], 3: [] });
    expect(hasCycle(3, [1], get)).toBe(true);
  });

  test("self cycle", () => {
    const get = blockersFrom({ 1: [] });
    expect(hasCycle(1, [1], get)).toBe(true);
  });

  test("cycle through one of multiple blockers", () => {
    const get = blockersFrom({ 1: [2, 3], 2: [], 3: [] });
    expect(hasCycle(2, [1], get)).toBe(true);
  });

  test("empty blockers never cycle", () => {
    const get = () => [];
    expect(hasCycle(1, null, get)).toBe(false);
    expect(hasCycle(1, [], get)).toBe(false);
  });
});

describe("isBlocked", () => {
  test("all blockers done", () => {
    expect(isBlocked([1, 2, 3], () => Status.Done)).toBe(false);
  });

  test("one blocker pending", () => {
    const statuses: Record<number, Status> = {
      1: Status.Done,
      2: Status.Pending,
      3: Status.Done,
    };
    expect(isBlocked([1, 2, 3], (id) => statuses[id]!)).toBe(true);
  });

  test("one blocker in progress", () => {
    const statuses: Record<number, Status> = {
      1: Status.Done,
      2: Status.InProgress,
    };
    expect(isBlocked([1, 2], (id) => statuses[id]!)).toBe(true);
  });

  test("no blockers", () => {
    expect(isBlocked(null, () => Status.Pending)).toBe(false);
    expect(isBlocked([], () => Status.Pending)).toBe(false);
  });
});
