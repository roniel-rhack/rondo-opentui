import { describe, expect, test } from "bun:test";
import { Minute, Second } from "../src/core/duration.ts";
import {
  DefaultDuration,
  SessionKind,
  elapsed,
  formatTimer,
  isCompleted,
  remaining,
  sessionKindLabel,
  sessionKindString,
  type Session,
} from "../src/core/focus/focus.ts";
import { GoTime } from "../src/core/time.ts";

function session(fields: Partial<Session> = {}): Session {
  return {
    id: 0,
    taskId: 0,
    duration: DefaultDuration,
    startedAt: GoTime.zero(),
    completedAt: null,
    kind: SessionKind.Work,
    cyclePos: 0,
    ...fields,
  };
}

describe("session state", () => {
  test("isCompleted", () => {
    const s = session();
    expect(isCompleted(s)).toBe(false);
    s.completedAt = GoTime.now();
    expect(isCompleted(s)).toBe(true);
  });

  const start = GoTime.date(2025, 1, 1, 12, 0, 0, 0, "utc");
  const s = session({ duration: 25 * Minute, startedAt: start });

  test("elapsed", () => {
    expect(elapsed(s, start)).toBe(0);
    expect(elapsed(s, start.add(5 * Minute))).toBe(5 * Minute);
    expect(elapsed(s, start.add(25 * Minute))).toBe(25 * Minute);
    expect(elapsed(s, start.add(30 * Minute))).toBe(25 * Minute);
    expect(elapsed(s, start.add(-1 * Minute))).toBe(0);
  });

  test("remaining", () => {
    expect(remaining(s, start)).toBe(25 * Minute);
    expect(remaining(s, start.add(10 * Minute))).toBe(15 * Minute);
    expect(remaining(s, start.add(25 * Minute))).toBe(0);
    expect(remaining(s, start.add(30 * Minute))).toBe(0);
  });
});

describe("session kind", () => {
  test("string", () => {
    expect(sessionKindString(SessionKind.Work)).toBe("Work");
    expect(sessionKindString(SessionKind.ShortBreak)).toBe("Short Break");
    expect(sessionKindString(SessionKind.LongBreak)).toBe("Long Break");
    expect(sessionKindString(99 as SessionKind)).toBe("Unknown");
  });

  test("label", () => {
    expect(sessionKindLabel(SessionKind.Work)).toBe("Focus");
    expect(sessionKindLabel(SessionKind.ShortBreak)).toBe("Break");
    expect(sessionKindLabel(SessionKind.LongBreak)).toBe("Long Break");
    expect(sessionKindLabel(99 as SessionKind)).toBe("Unknown");
  });
});

describe("formatTimer", () => {
  test("formats mm:ss", () => {
    expect(formatTimer(25 * Minute)).toBe("25:00");
    expect(formatTimer(4 * Minute + 30 * Second)).toBe("04:30");
    expect(formatTimer(0)).toBe("00:00");
    expect(formatTimer(59 * Second)).toBe("00:59");
    expect(formatTimer(-5 * Minute)).toBe("00:00");
    expect(formatTimer(60 * Minute)).toBe("60:00");
    expect(formatTimer(90 * Second)).toBe("01:30");
  });
});
