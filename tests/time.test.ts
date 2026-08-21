import { describe, expect, test } from "bun:test";
import { GoTime, parseDateOnly, parseRFC3339, RFC3339 } from "../src/core/time.ts";

describe("GoTime.format", () => {
  const t = GoTime.date(2026, 3, 2, 21, 7, 5, 0, "utc");

  test("reference layouts", () => {
    expect(t.format("2006-01-02")).toBe("2026-03-02");
    expect(t.format("02.01.2006")).toBe("02.03.2026");
    expect(t.format("01/02/2006")).toBe("03/02/2026");
    expect(t.format("Jan 02, 2006")).toBe("Mar 02, 2026");
    expect(t.format("January 2, 2006")).toBe("March 2, 2026");
    expect(t.format("15:04")).toBe("21:07");
    expect(t.format("3:04 PM")).toBe("9:07 PM");
    expect(t.format("Mon, Jan 02, 2006")).toBe("Mon, Mar 02, 2026");
    expect(t.format("Monday")).toBe("Monday");
    expect(t.format(RFC3339)).toBe("2026-03-02T21:07:05Z");
  });

  test("midnight uses 12 in 12h clock", () => {
    const midnight = GoTime.date(2026, 3, 2, 0, 30, 0, 0, "utc");
    expect(midnight.format("3:04 PM")).toBe("12:30 AM");
  });
});

describe("GoTime.addDate", () => {
  test("normalizes month overflow like Go", () => {
    const jan31 = GoTime.date(2025, 1, 31);
    expect(jan31.addDate(0, 1, 0).format("2006-01-02")).toBe("2025-03-03");
  });

  test("normalizes leap day", () => {
    const leap = GoTime.date(2024, 2, 29);
    expect(leap.addDate(1, 0, 0).format("2006-01-02")).toBe("2025-03-01");
  });

  test("adds days across month boundaries", () => {
    expect(
      GoTime.date(2025, 3, 30).addDate(0, 0, 7).format("2006-01-02"),
    ).toBe("2025-04-06");
  });
});

describe("parsing", () => {
  test("parseDateOnly keeps UTC midnight", () => {
    const d = parseDateOnly("2026-03-15", "utc");
    expect(d.format("2006-01-02")).toBe("2026-03-15");
    expect(d.parts.hour).toBe(0);
  });

  test("parseDateOnly rejects invalid input", () => {
    expect(() => parseDateOnly("not-a-date")).toThrow();
    expect(() => parseDateOnly("2026-13-01")).toThrow();
    expect(() => parseDateOnly("2026-02-30")).toThrow();
  });

  test("parseRFC3339 round-trips UTC timestamps", () => {
    const t = parseRFC3339("2026-02-15T10:00:00Z");
    expect(t.format(RFC3339)).toBe("2026-02-15T10:00:00Z");
    expect(t.loc).toBe("utc");
  });
});

describe("truncateDay", () => {
  test("floors to UTC midnight", () => {
    const t = GoTime.date(2026, 3, 2, 21, 7, 5, 0, "utc");
    expect(t.truncateDay().format(RFC3339)).toBe("2026-03-02T00:00:00Z");
  });
});
