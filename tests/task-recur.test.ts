import { describe, expect, test } from "bun:test";
import {
  RecurFreq,
  nextDueDate,
  parseRecurFreq,
  recurFreqString,
} from "../src/core/task/recur.ts";
import { newTask } from "../src/core/task/store.ts";
import { GoTime } from "../src/core/time.ts";

describe("RecurFreq", () => {
  test("string", () => {
    expect(recurFreqString(RecurFreq.None)).toBe("none");
    expect(recurFreqString(RecurFreq.Daily)).toBe("daily");
    expect(recurFreqString(RecurFreq.Weekly)).toBe("weekly");
    expect(recurFreqString(RecurFreq.Monthly)).toBe("monthly");
    expect(recurFreqString(RecurFreq.Yearly)).toBe("yearly");
    expect(recurFreqString(99 as RecurFreq)).toBe("none");
  });

  test("parse", () => {
    expect(parseRecurFreq("none")).toBe(RecurFreq.None);
    expect(parseRecurFreq("daily")).toBe(RecurFreq.Daily);
    expect(parseRecurFreq("weekly")).toBe(RecurFreq.Weekly);
    expect(parseRecurFreq("monthly")).toBe(RecurFreq.Monthly);
    expect(parseRecurFreq("yearly")).toBe(RecurFreq.Yearly);
    expect(parseRecurFreq("")).toBe(RecurFreq.None);
    expect(parseRecurFreq("invalid")).toBe(RecurFreq.None);
  });

  test("round-trip", () => {
    for (const f of [
      RecurFreq.None,
      RecurFreq.Daily,
      RecurFreq.Weekly,
      RecurFreq.Monthly,
      RecurFreq.Yearly,
    ]) {
      expect(parseRecurFreq(recurFreqString(f))).toBe(f);
    }
  });
});

describe("nextDueDate", () => {
  test("daily", () => {
    const base = GoTime.date(2025, 3, 15);
    const t = newTask({
      dueDate: base,
      recurFreq: RecurFreq.Daily,
      recurInterval: 1,
    });
    expect(nextDueDate(t).equal(GoTime.date(2025, 3, 16))).toBe(true);
  });

  test("daily with interval 3", () => {
    const base = GoTime.date(2025, 3, 15);
    const t = newTask({
      dueDate: base,
      recurFreq: RecurFreq.Daily,
      recurInterval: 3,
    });
    expect(nextDueDate(t).equal(GoTime.date(2025, 3, 18))).toBe(true);
  });

  test("weekly", () => {
    const t = newTask({
      dueDate: GoTime.date(2025, 3, 15),
      recurFreq: RecurFreq.Weekly,
      recurInterval: 1,
    });
    expect(nextDueDate(t).equal(GoTime.date(2025, 3, 22))).toBe(true);
  });

  test("monthly normalizes February overflow", () => {
    const t = newTask({
      dueDate: GoTime.date(2025, 1, 31),
      recurFreq: RecurFreq.Monthly,
      recurInterval: 1,
    });
    expect(nextDueDate(t).equal(GoTime.date(2025, 3, 3))).toBe(true);
  });

  test("monthly with interval 2", () => {
    const t = newTask({
      dueDate: GoTime.date(2025, 3, 15),
      recurFreq: RecurFreq.Monthly,
      recurInterval: 2,
    });
    expect(nextDueDate(t).equal(GoTime.date(2025, 5, 15))).toBe(true);
  });

  test("yearly from a leap day", () => {
    const t = newTask({
      dueDate: GoTime.date(2024, 2, 29),
      recurFreq: RecurFreq.Yearly,
      recurInterval: 1,
    });
    expect(nextDueDate(t).equal(GoTime.date(2025, 3, 1))).toBe(true);
  });

  test("no due date uses now", () => {
    const t = newTask({ recurFreq: RecurFreq.Daily, recurInterval: 1 });
    const before = GoTime.now();
    const got = nextDueDate(t);
    const after = GoTime.now().addDate(0, 0, 1).addMs(1000);
    expect(got.before(before)).toBe(false);
    expect(got.after(after)).toBe(false);
  });

  test("RecurNone leaves the date untouched", () => {
    const base = GoTime.date(2025, 6, 1);
    const t = newTask({ dueDate: base, recurFreq: RecurFreq.None });
    expect(nextDueDate(t).equal(base)).toBe(true);
  });

  test("zero interval is treated as 1", () => {
    const t = newTask({
      dueDate: GoTime.date(2025, 6, 1),
      recurFreq: RecurFreq.Daily,
      recurInterval: 0,
    });
    expect(nextDueDate(t).equal(GoTime.date(2025, 6, 2))).toBe(true);
  });
});
