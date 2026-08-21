import { describe, expect, test } from "bun:test";
import { defaultConfig } from "../src/core/config/config.ts";
import { Hour, Minute } from "../src/core/duration.ts";
import { SessionKind } from "../src/core/focus/focus.ts";
import type { Entry, Note } from "../src/core/journal/journal.ts";
import { newTask } from "../src/core/task/store.ts";
import { DateOnly, GoTime } from "../src/core/time.ts";
import { priorityColors, tuiTheme } from "../src/tui/theme.ts";
import {
  exportContent,
  focusStatusMessage,
  parseDueInput,
  parseTimeLogInput,
  toastDuration,
  visibleNotes,
} from "../src/tui/state.ts";

describe("parseTimeLogInput", () => {
  test("duration only", () => {
    expect(parseTimeLogInput("45m")).toEqual({ duration: 45 * Minute, note: "" });
  });

  test("duration followed by a note", () => {
    expect(parseTimeLogInput("1h30m fixing the build")).toEqual({
      duration: Hour + 30 * Minute,
      note: "fixing the build",
    });
  });

  test("invalid duration throws", () => {
    expect(() => parseTimeLogInput("soon")).toThrow();
  });
});

describe("parseDueInput", () => {
  const now = GoTime.date(2026, 8, 21, 15, 0, 0, 0, "utc");

  test("empty and none mean no due date", () => {
    expect(parseDueInput("", now)).toBeNull();
    expect(parseDueInput("none", now)).toBeNull();
  });

  test("today and tomorrow", () => {
    expect(parseDueInput("today", now)!.format(DateOnly)).toBe("2026-08-21");
    expect(parseDueInput("tomorrow", now)!.format(DateOnly)).toBe("2026-08-22");
  });

  test("relative day and week offsets", () => {
    expect(parseDueInput("+3d", now)!.format(DateOnly)).toBe("2026-08-24");
    expect(parseDueInput("+1w", now)!.format(DateOnly)).toBe("2026-08-28");
  });

  test("plain dates still parse", () => {
    expect(parseDueInput("2026-12-24", now)!.format(DateOnly)).toBe("2026-12-24");
  });

  test("garbage throws", () => {
    expect(() => parseDueInput("someday", now)).toThrow();
  });
});

describe("focusStatusMessage", () => {
  const cfg = defaultConfig();

  test("stopping", () => {
    expect(focusStatusMessage(true, SessionKind.Work, cfg)).toBe("Focus stopped");
  });

  test("starting a work session uses the work duration", () => {
    expect(focusStatusMessage(false, SessionKind.Work, cfg)).toBe(
      "Focus started (25m)",
    );
  });

  test("starting a break says break, with the break duration", () => {
    expect(focusStatusMessage(false, SessionKind.ShortBreak, cfg)).toBe(
      "Break started (5m)",
    );
    expect(focusStatusMessage(false, SessionKind.LongBreak, cfg)).toBe(
      "Break started (15m)",
    );
  });
});

describe("visibleNotes", () => {
  let nextId = 1;
  function note(dateStr: string, bodies: string[]): Note {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = GoTime.date(y!, m!, d!, 0, 0, 0, 0, "utc");
    const entries: Entry[] = bodies.map((body, i) => ({
      id: nextId * 100 + i,
      noteId: nextId,
      body,
      createdAt: date,
    }));
    return {
      id: nextId++,
      date,
      hidden: false,
      createdAt: date,
      updatedAt: date,
      entries,
    };
  }

  const notes = [
    note("2026-08-21", ["Shipped the opentui port"]),
    note("2026-08-20", ["Landing page wireframes done"]),
    note("2026-08-19", ["Read about sqlite vacuum"]),
  ];

  test("empty query keeps every note in order", () => {
    expect(visibleNotes(notes, "").map((n) => n.id)).toEqual(
      notes.map((n) => n.id),
    );
  });

  test("query filters by entry body, preserving date order", () => {
    const hits = visibleNotes(notes, "sqlite");
    expect(hits.length).toBe(1);
    expect(hits[0]!.id).toBe(notes[2]!.id);
  });

  test("no matches yields an empty list", () => {
    expect(visibleNotes(notes, "zzzz")).toEqual([]);
  });
});

describe("toastDuration", () => {
  test("errors linger longer than info and success", () => {
    expect(toastDuration("error")).toBeGreaterThan(toastDuration("info"));
    expect(toastDuration("info")).toBe(toastDuration("success"));
  });
});

describe("exportContent", () => {
  const tasks = [newTask({ title: "Write the report" })];
  const notes = [
    {
      id: 1,
      date: GoTime.date(2026, 8, 21, 0, 0, 0, 0, "utc"),
      hidden: false,
      createdAt: GoTime.date(2026, 8, 21, 9, 0, 0, 0, "utc"),
      updatedAt: GoTime.date(2026, 8, 21, 9, 0, 0, 0, "utc"),
      entries: [
        {
          id: 1,
          noteId: 1,
          body: "Shipped the opentui port",
          createdAt: GoTime.date(2026, 8, 21, 9, 0, 0, 0, "utc"),
        },
      ],
    },
  ];

  test("markdown includes both tasks and the journal", () => {
    const md = exportContent("md", tasks, notes);
    expect(md).toContain("Write the report");
    expect(md).toContain("# Journal");
    expect(md).toContain("Shipped the opentui port");
  });

  test("json includes the journal too", () => {
    const parsed = JSON.parse(exportContent("json", tasks, notes));
    expect(parsed.journal.length).toBe(1);
  });
});

describe("theme accessibility", () => {
  test("muted text meets 4.5:1 on the page background", () => {
    expect(tuiTheme(true).textMuted).toBe("#8a8a8a");
    expect(tuiTheme(false).textMuted).toBe("#667089");
  });

  test("Low priority uses the readable dim tone", () => {
    const dark = tuiTheme(true);
    expect(priorityColors(dark)[0]).toBe(dark.textDim);
  });
});
