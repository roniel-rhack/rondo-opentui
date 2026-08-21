import { describe, expect, test } from "bun:test";
import { openMemory } from "../src/core/database/db.ts";
import { Minute } from "../src/core/duration.ts";
import {
  DefaultDuration,
  SessionKind,
  isCompleted,
  type Session,
} from "../src/core/focus/focus.ts";
import { FocusStore } from "../src/core/focus/store.ts";
import { DateOnly, GoTime } from "../src/core/time.ts";

function newStore(): FocusStore {
  return new FocusStore(openMemory());
}

function session(fields: Partial<Session> = {}): Session {
  return {
    id: 0,
    taskId: 0,
    duration: DefaultDuration,
    startedAt: GoTime.utcNow(),
    completedAt: null,
    kind: SessionKind.Work,
    cyclePos: 0,
    ...fields,
  };
}

describe("focus store", () => {
  test("create and list by task", () => {
    const store = newStore();
    const sess = session({ taskId: 42, startedAt: GoTime.utcNow() });

    store.create(sess);
    expect(sess.id).not.toBe(0);

    const sessions = store.listByTask(42);
    expect(sessions.length).toBe(1);
    expect(sessions[0]!.id).toBe(sess.id);
    expect(sessions[0]!.taskId).toBe(42);
    expect(sessions[0]!.duration).toBe(DefaultDuration);
    expect(isCompleted(sessions[0]!)).toBe(false);
  });

  test("complete", () => {
    const store = newStore();
    const sess = session({ taskId: 1 });
    store.create(sess);
    store.complete(sess.id);

    const sessions = store.listByTask(1);
    expect(sessions.length).toBe(1);
    expect(isCompleted(sessions[0]!)).toBe(true);
  });

  test("complete unknown session fails", () => {
    const store = newStore();
    expect(() => store.complete(999)).toThrow();
  });

  test("list by task with no sessions", () => {
    const store = newStore();
    expect(store.listByTask(999).length).toBe(0);
  });

  test("list is ordered by started_at desc", () => {
    const store = newStore();
    const base = GoTime.date(2025, 1, 1, 12, 0, 0, 0, "utc");
    for (let i = 0; i < 3; i++) {
      store.create(session({ taskId: 5, startedAt: base.add(i * 60 * Minute) }));
    }

    const sessions = store.listByTask(5);
    expect(sessions.length).toBe(3);
    expect(sessions[0]!.startedAt.after(sessions[1]!.startedAt)).toBe(true);
    expect(sessions[1]!.startedAt.after(sessions[2]!.startedAt)).toBe(true);
  });

  test("today count", () => {
    const store = newStore();
    expect(store.todayCount()).toBe(0);

    const sess = session({
      taskId: 1,
      startedAt: GoTime.utcNow().add(-30 * Minute),
    });
    store.create(sess);
    store.complete(sess.id);

    expect(store.todayCount()).toBe(1);
  });

  test("completions by day ignores incomplete sessions", () => {
    const store = newStore();
    const now = GoTime.utcNow();

    for (let i = 0; i < 2; i++) {
      const s = session({ taskId: 1, startedAt: now.add(-i * 60 * Minute) });
      store.create(s);
      store.complete(s.id);
    }
    store.create(session({ taskId: 1, startedAt: now }));

    const result = store.completionsByDay(7);
    expect(result[now.format(DateOnly)]).toBe(2);
  });

  test("today work count ignores breaks and incomplete sessions", () => {
    const store = newStore();
    expect(store.todayWorkCount()).toBe(0);

    const now = GoTime.utcNow();
    const work = session({
      startedAt: now.add(-30 * Minute),
      kind: SessionKind.Work,
    });
    store.create(work);
    store.complete(work.id);

    const brk = session({
      duration: 5 * Minute,
      startedAt: now.add(-25 * Minute),
      kind: SessionKind.ShortBreak,
    });
    store.create(brk);
    store.complete(brk.id);

    store.create(session({ startedAt: now, kind: SessionKind.Work }));

    expect(store.todayWorkCount()).toBe(1);
  });

  test("weekly summary counts only work sessions", () => {
    const store = newStore();
    const now = GoTime.utcNow();

    for (let i = 0; i < 2; i++) {
      const s = session({
        startedAt: now.add(-i * 60 * Minute),
        kind: SessionKind.Work,
      });
      store.create(s);
      store.complete(s.id);
    }
    const brk = session({
      duration: 5 * Minute,
      startedAt: now,
      kind: SessionKind.ShortBreak,
    });
    store.create(brk);
    store.complete(brk.id);

    const result = store.weeklySummary();
    expect(result[now.format(DateOnly)]).toBe(2);
    expect(Object.values(result).reduce((a, b) => a + b, 0)).toBe(2);
  });

  test("streak", () => {
    const store = newStore();
    expect(store.streak()).toBe(0);

    const s = session({
      startedAt: GoTime.utcNow().add(-30 * Minute),
      kind: SessionKind.Work,
    });
    store.create(s);
    store.complete(s.id);

    expect(store.streak()).toBe(1);
  });

  test("total minutes focused", () => {
    const store = newStore();
    expect(store.totalMinutesFocused(7)).toBe(0);

    const now = GoTime.utcNow();
    for (let i = 0; i < 2; i++) {
      const s = session({
        duration: 25 * Minute,
        startedAt: now.add(-i * 60 * Minute),
        kind: SessionKind.Work,
      });
      store.create(s);
      store.complete(s.id);
    }
    const brk = session({
      duration: 5 * Minute,
      startedAt: now,
      kind: SessionKind.ShortBreak,
    });
    store.create(brk);
    store.complete(brk.id);

    expect(store.totalMinutesFocused(7)).toBe(50);
  });

  test("create with zero task id", () => {
    const store = newStore();
    store.create(session({ taskId: 0 }));

    const sessions = store.listByTask(0);
    expect(sessions.length).toBe(1);
    expect(sessions[0]!.taskId).toBe(0);
  });
});
