import { describe, expect, test } from "bun:test";
import { Hour, Minute, Second } from "../src/core/duration.ts";
import {
  formatDuration,
  parseDuration,
  totalDuration,
} from "../src/core/task/timelog.ts";
import type { TimeLog } from "../src/core/task/task.ts";
import { GoTime } from "../src/core/time.ts";

function log(duration: number): TimeLog {
  return {
    id: 0,
    taskId: 0,
    duration,
    note: "",
    loggedAt: GoTime.zero(),
  };
}

describe("parseDuration", () => {
  test("valid inputs", () => {
    expect(parseDuration("1h30m")).toBe(90 * Minute);
    expect(parseDuration("45m")).toBe(45 * Minute);
    expect(parseDuration("2h")).toBe(2 * Hour);
    expect(parseDuration("1h0m0s")).toBe(Hour);
    expect(parseDuration("30s")).toBe(30 * Second);
  });

  test("invalid inputs", () => {
    expect(() => parseDuration("")).toThrow();
    expect(() => parseDuration("abc")).toThrow();
    expect(() => parseDuration("-1h")).toThrow();
  });
});

describe("formatDuration", () => {
  test("formats hours and minutes", () => {
    expect(formatDuration(90 * Minute)).toBe("1h 30m");
    expect(formatDuration(2 * Hour)).toBe("2h");
    expect(formatDuration(45 * Minute)).toBe("45m");
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(Hour + Minute)).toBe("1h 1m");
    expect(formatDuration(3 * Hour + 15 * Minute)).toBe("3h 15m");
    expect(formatDuration(-10 * Minute)).toBe("0m");
  });
});

describe("totalDuration", () => {
  test("sums log durations", () => {
    const logs = [log(30 * Minute), log(Hour), log(15 * Minute)];
    expect(totalDuration(logs)).toBe(Hour + 45 * Minute);
  });

  test("empty is zero", () => {
    expect(totalDuration(null)).toBe(0);
    expect(totalDuration([])).toBe(0);
  });
});
