import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  DateFormatPresets,
  DateTimeFormatPresets,
  TimeFormatPresets,
  configPath,
  defaultConfig,
  formatDate,
  formatDateShort,
  formatDateTime,
  formatDetailDate,
  formatNoteTitle,
  formatTime,
  fromJSON,
  isValidTimeLayout,
  load,
  resolvePreset,
  save,
  stripYear,
  toJSON,
  validateTimeLayout,
  validateWithWarnings,
  zeroConfig,
  type Config,
} from "../src/core/config/config.ts";
import { GoTime } from "../src/core/time.ts";

function tempFile(name: string): string {
  return join(mkdtempSync(join(tmpdir(), "rondo-cfg-")), name);
}

function withPanelRatio(ratio: number): Config {
  const cfg = zeroConfig();
  cfg.panelRatio = ratio;
  return cfg;
}

describe("defaults", () => {
  test("defaultConfig", () => {
    const cfg = defaultConfig();
    expect(cfg.panelRatio).toBe(0.4);
    expect(cfg.dateFormat).toBe("Jan 02, 2006");
    expect(cfg.timeFormat).toBe("3:04 PM");
    expect(cfg.dateTimeFormat).toBe("Jan 02, 2006 3:04 PM");
  });

  test("focus defaults", () => {
    const { focus } = defaultConfig();
    expect(focus.workDuration).toBe(25);
    expect(focus.shortBreakDuration).toBe(5);
    expect(focus.longBreakDuration).toBe(15);
    expect(focus.longBreakInterval).toBe(4);
    expect(focus.dailyGoal).toBe(8);
    expect(focus.sound).toBe(true);
  });

  test("path points at ~/.todo-app/config.json", () => {
    const p = configPath();
    expect(basename(p)).toBe("config.json");
    expect(basename(dirname(p))).toBe(".todo-app");
  });
});

describe("validation", () => {
  test("clamps the panel ratio", () => {
    const cases: [number, number][] = [
      [0, 0.4],
      [0.1, 0.2],
      [0.2, 0.2],
      [0.5, 0.5],
      [0.8, 0.8],
      [0.95, 0.8],
    ];
    for (const [input, want] of cases) {
      const cfg = withPanelRatio(input);
      validateWithWarnings(cfg);
      expect(cfg.panelRatio).toBe(want);
    }
  });

  test("applies focus defaults for zero values", () => {
    const cfg = zeroConfig();
    validateWithWarnings(cfg);
    expect(cfg.focus).toMatchObject({
      workDuration: 25,
      shortBreakDuration: 5,
      longBreakDuration: 15,
      longBreakInterval: 4,
      dailyGoal: 8,
    });
  });

  test("keeps non-zero focus values", () => {
    const cfg = zeroConfig();
    cfg.focus = {
      workDuration: 30,
      shortBreakDuration: 10,
      longBreakDuration: 20,
      longBreakInterval: 3,
      dailyGoal: 12,
      autoStartBreak: false,
      sound: false,
    };
    validateWithWarnings(cfg);
    expect(cfg.focus).toMatchObject({
      workDuration: 30,
      shortBreakDuration: 10,
      longBreakDuration: 20,
      longBreakInterval: 3,
      dailyGoal: 12,
    });
  });

  test("clamps focus values", () => {
    const cases: [Partial<Config["focus"]>, Partial<Config["focus"]>][] = [
      [{ workDuration: -5 }, { workDuration: 1 }],
      [{ workDuration: 200 }, { workDuration: 120 }],
      [{ longBreakInterval: 15 }, { longBreakInterval: 10 }],
      [{ shortBreakDuration: -1 }, { shortBreakDuration: 1 }],
      [{ longBreakDuration: -3 }, { longBreakDuration: 1 }],
    ];
    for (const [input, want] of cases) {
      const cfg = zeroConfig();
      cfg.focus = {
        workDuration: 25,
        shortBreakDuration: 5,
        longBreakDuration: 15,
        longBreakInterval: 4,
        dailyGoal: 8,
        autoStartBreak: false,
        sound: false,
        ...input,
      };
      validateWithWarnings(cfg);
      expect(cfg.focus).toMatchObject(want);
    }
  });

  test("invalid layouts fall back to defaults", () => {
    const cfg = zeroConfig();
    cfg.panelRatio = 0.5;
    cfg.dateFormat = "DD/MM/YYYY";
    cfg.timeFormat = "hh:mm";
    cfg.dateTimeFormat = "YYYY-MM-DD hh:mm";
    validateWithWarnings(cfg);

    expect(cfg.dateFormat).toBe("Jan 02, 2006");
    expect(cfg.timeFormat).toBe("3:04 PM");
    expect(cfg.dateTimeFormat).toBe("Jan 02, 2006 3:04 PM");
  });

  test("warnings are reported for invalid formats", () => {
    const cfg = zeroConfig();
    cfg.panelRatio = 0.5;
    cfg.dateFormat = "DD/MM/YYYY";
    cfg.timeFormat = "hh:mm";
    expect(validateWithWarnings(cfg).length).toBe(2);
  });

  test("valid formats produce no warnings", () => {
    expect(validateWithWarnings(defaultConfig()).length).toBe(0);
  });

  test("legacy config gets format defaults", () => {
    const cfg = fromJSON(JSON.parse(`{"panel_ratio":0.55}`));
    validateWithWarnings(cfg);
    expect(cfg.dateFormat).not.toBe("");
    expect(cfg.timeFormat).not.toBe("");
    expect(cfg.dateTimeFormat).not.toBe("");
  });

  test("validateTimeLayout", () => {
    const cases: [string, boolean][] = [
      ["2006-01-02", false],
      ["3:04 PM", false],
      ["DD/MM/YYYY", true],
      ["", true],
      ["   ", true],
      ["Hello World", true],
      ["My Date", true],
      ["2006", false],
      ["January", false],
      ["02", false],
      ["15", false],
      ["Jan 02, 2006", false],
    ];
    for (const [layout, wantErr] of cases) {
      if (wantErr) {
        expect(() => validateTimeLayout(layout)).toThrow();
      } else {
        expect(() => validateTimeLayout(layout)).not.toThrow();
        expect(isValidTimeLayout(layout)).toBe(true);
      }
    }
  });
});

describe("formatting", () => {
  test("date, time and datetime", () => {
    const cfg = zeroConfig();
    cfg.dateFormat = "02.01.2006";
    cfg.timeFormat = "15:04";
    cfg.dateTimeFormat = "02.01.2006 15:04";
    validateWithWarnings(cfg);

    const ts = GoTime.date(2026, 3, 2, 21, 7, 0, 0);
    expect(formatDate(cfg, ts)).toBe("02.03.2026");
    expect(formatTime(cfg, ts)).toBe("21:07");
    expect(formatDateTime(cfg, ts)).toBe("02.03.2026 21:07");
  });

  test("changing the time format does not affect dates", () => {
    const cfg = defaultConfig();
    cfg.timeFormat = "15:04";
    validateWithWarnings(cfg);
    expect(formatDate(cfg, GoTime.date(2026, 3, 2))).toBe("Mar 02, 2026");
  });

  test("stripYear", () => {
    const cases: [string, string][] = [
      ["Jan 02, 2006", "Jan 02"],
      ["2006-01-02", "01-02"],
      ["02.01.2006", "02.01"],
      ["01/02/2006", "01/02"],
      ["Jan 02", "Jan 02"],
      ["2006", ""],
    ];
    for (const [layout, want] of cases) {
      expect(stripYear(layout)).toBe(want);
    }
  });

  test("formatDateShort", () => {
    const now = GoTime.date(2026, 3, 15);
    const sameYear = GoTime.date(2026, 7, 4);
    const diffYear = GoTime.date(2025, 12, 25);

    const cases: [string, GoTime, string][] = [
      ["Jan 02, 2006", sameYear, "Jul 04"],
      ["Jan 02, 2006", diffYear, "Dec 25, 2025"],
      ["2006-01-02", sameYear, "07-04"],
      ["2006-01-02", diffYear, "2025-12-25"],
      ["02.01.2006", sameYear, "04.07"],
      ["01/02/2006", sameYear, "07/04"],
    ];
    for (const [dateFormat, date, want] of cases) {
      const cfg = zeroConfig();
      cfg.dateFormat = dateFormat;
      expect(formatDateShort(cfg, date, now)).toBe(want);
    }
  });

  test("formatNoteTitle", () => {
    const now = GoTime.date(2026, 3, 15, 14, 0, 0);
    const cfg = defaultConfig();

    expect(formatNoteTitle(cfg, GoTime.date(2026, 3, 15), now)).toBe(
      "Today, Mar 15",
    );
    expect(formatNoteTitle(cfg, GoTime.date(2026, 3, 14), now)).toBe(
      "Yesterday, Mar 14",
    );
    expect(formatNoteTitle(cfg, GoTime.date(2026, 3, 10), now)).toBe(
      "Tue, Mar 10",
    );
    expect(formatNoteTitle(cfg, GoTime.date(2026, 1, 5), now)).toBe("Jan 05");
    expect(formatNoteTitle(cfg, GoTime.date(2025, 12, 25), now)).toBe(
      "Dec 25, 2025",
    );
  });

  test("formatNoteTitle with a custom format", () => {
    const now = GoTime.date(2026, 3, 15, 14, 0, 0);
    const cfg = zeroConfig();
    cfg.dateFormat = "02.01.2006";

    expect(formatNoteTitle(cfg, GoTime.date(2026, 3, 15), now)).toBe(
      "Today, 15.03",
    );
    expect(formatNoteTitle(cfg, GoTime.date(2025, 6, 1), now)).toBe(
      "01.06.2025",
    );
  });

  test("formatNoteTitle is timezone robust", () => {
    const now = GoTime.now();
    const p = now.parts;
    const today = GoTime.date(p.year, p.month, p.day);
    expect(formatNoteTitle(defaultConfig(), today, now).slice(0, 5)).toBe(
      "Today",
    );
  });

  test("formatDetailDate", () => {
    expect(formatDetailDate(defaultConfig(), GoTime.date(2026, 3, 15))).toBe(
      "Sun, Mar 15, 2026",
    );
  });
});

describe("presets", () => {
  test("date presets", () => {
    expect(resolvePreset("iso", DateFormatPresets)).toBe("2006-01-02");
    expect(resolvePreset("EUROPEAN", DateFormatPresets)).toBe("02.01.2006");
    expect(resolvePreset("eu", DateFormatPresets)).toBe("02.01.2006");
    expect(resolvePreset("us", DateFormatPresets)).toBe("01/02/2006");
    expect(resolvePreset("02-01-2006", DateFormatPresets)).toBe("02-01-2006");
  });

  test("time presets", () => {
    expect(resolvePreset("24h", TimeFormatPresets)).toBe("15:04");
    expect(resolvePreset("12h", TimeFormatPresets)).toBe("3:04 PM");
    expect(resolvePreset("15:04:05", TimeFormatPresets)).toBe("15:04:05");
  });

  test("datetime presets", () => {
    expect(resolvePreset("iso", DateTimeFormatPresets)).toBe("2006-01-02 15:04");
  });
});

describe("persistence", () => {
  test("save and load round-trip", () => {
    const path = tempFile("config.json");
    const cfg = defaultConfig();
    cfg.panelRatio = 0.6;
    save(cfg, path);

    const loaded = load(path);
    expect(loaded.panelRatio).toBe(0.6);
    expect(loaded.dateFormat).toBe("Jan 02, 2006");
  });

  test("save creates the parent directory", () => {
    const nested = join(
      mkdtempSync(join(tmpdir(), "rondo-cfg-")),
      "a",
      "b",
      "config.json",
    );
    const cfg = defaultConfig();
    cfg.panelRatio = 0.35;
    save(cfg, nested);
    expect(load(nested).panelRatio).toBe(0.35);
  });

  test("missing file yields defaults", () => {
    const path = tempFile("missing.json");
    expect(load(path).panelRatio).toBe(0.4);
  });

  test("JSON keys match the Go struct tags", () => {
    const path = tempFile("config.json");
    save(defaultConfig(), path);
    const raw = JSON.parse(readFileSync(path, "utf8"));
    expect(Object.keys(raw)).toEqual([
      "panel_ratio",
      "date_format",
      "time_format",
      "datetime_format",
      "focus",
    ]);
    expect(raw.focus.work_duration_min).toBe(25);
  });

  test("invalid JSON is reported", () => {
    const path = tempFile("bad.json");
    writeFileSync(path, "{not json", "utf8");
    expect(() => load(path)).toThrow();
  });

  test("toJSON/fromJSON round-trip", () => {
    const cfg = defaultConfig();
    cfg.panelRatio = 0.55;
    const decoded = fromJSON(toJSON(cfg));
    validateWithWarnings(decoded);
    expect(decoded.panelRatio).toBe(0.55);
  });
});
