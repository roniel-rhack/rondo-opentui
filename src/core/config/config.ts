import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { GoTime, sameDay, type Loc } from "../time.ts";

const DEFAULT_PANEL_RATIO = 0.4;
const MIN_PANEL_RATIO = 0.2;
const MAX_PANEL_RATIO = 0.8;
const DEFAULT_DATE_FORMAT = "Jan 02, 2006";
const DEFAULT_TIME_FORMAT = "3:04 PM";

export const DateFormatPresets: Record<string, string> = {
  iso: "2006-01-02",
  european: "02.01.2006",
  eu: "02.01.2006",
  us: "01/02/2006",
  pretty: "Jan 02, 2006",
};

export const TimeFormatPresets: Record<string, string> = {
  "24h": "15:04",
  "12h": "3:04 PM",
};

export const DateTimeFormatPresets: Record<string, string> = {
  iso: "2006-01-02 15:04",
  european: "02.01.2006 15:04",
  eu: "02.01.2006 15:04",
  us: "01/02/2006 3:04 PM",
  pretty: "Jan 02, 2006 3:04 PM",
};

/** Returns the layout for a preset name, or the value itself when unknown. */
export function resolvePreset(
  val: string,
  presets: Record<string, string>,
): string {
  const trimmed = val.trim();
  const preset = presets[trimmed.toLowerCase()];
  return preset ?? trimmed;
}

export interface FocusConfig {
  workDuration: number;
  shortBreakDuration: number;
  longBreakDuration: number;
  longBreakInterval: number;
  dailyGoal: number;
  autoStartBreak: boolean;
  sound: boolean;
}

export interface Config {
  panelRatio: number;
  dateFormat: string;
  timeFormat: string;
  dateTimeFormat: string;
  focus: FocusConfig;
}

/** JSON shape stored on disk, matching the Go struct tags. */
interface ConfigJSON {
  panel_ratio?: number;
  date_format?: string;
  time_format?: string;
  datetime_format?: string;
  focus?: {
    work_duration_min?: number;
    short_break_duration_min?: number;
    long_break_duration_min?: number;
    long_break_interval?: number;
    daily_goal?: number;
    auto_start_break?: boolean;
    sound?: boolean;
  };
}

export function defaultConfig(): Config {
  return {
    panelRatio: DEFAULT_PANEL_RATIO,
    dateFormat: DEFAULT_DATE_FORMAT,
    timeFormat: DEFAULT_TIME_FORMAT,
    dateTimeFormat: `${DEFAULT_DATE_FORMAT} ${DEFAULT_TIME_FORMAT}`,
    focus: {
      workDuration: 25,
      shortBreakDuration: 5,
      longBreakDuration: 15,
      longBreakInterval: 4,
      dailyGoal: 8,
      autoStartBreak: false,
      sound: true,
    },
  };
}

/** Zero-valued config, equivalent to Go's `config.Config{}`. */
export function zeroConfig(): Config {
  return {
    panelRatio: 0,
    dateFormat: "",
    timeFormat: "",
    dateTimeFormat: "",
    focus: {
      workDuration: 0,
      shortBreakDuration: 0,
      longBreakDuration: 0,
      longBreakInterval: 0,
      dailyGoal: 0,
      autoStartBreak: false,
      sound: false,
    },
  };
}

/**
 * Clamps values, applies defaults for zero values and reports the fields that
 * were reset because they held an invalid layout. Mutates `cfg`.
 */
export function validateWithWarnings(cfg: Config): string[] {
  const warnings: string[] = [];

  if (cfg.panelRatio === 0) cfg.panelRatio = DEFAULT_PANEL_RATIO;
  if (cfg.panelRatio < MIN_PANEL_RATIO) cfg.panelRatio = MIN_PANEL_RATIO;
  if (cfg.panelRatio > MAX_PANEL_RATIO) cfg.panelRatio = MAX_PANEL_RATIO;

  cfg.dateFormat = (cfg.dateFormat ?? "").trim();
  if (cfg.dateFormat === "") cfg.dateFormat = DEFAULT_DATE_FORMAT;
  if (!isValidTimeLayout(cfg.dateFormat)) {
    warnings.push(
      `date_format "${cfg.dateFormat}" is invalid, using default "${DEFAULT_DATE_FORMAT}"`,
    );
    cfg.dateFormat = DEFAULT_DATE_FORMAT;
  }

  cfg.timeFormat = (cfg.timeFormat ?? "").trim();
  if (cfg.timeFormat === "") cfg.timeFormat = DEFAULT_TIME_FORMAT;
  if (!isValidTimeLayout(cfg.timeFormat)) {
    warnings.push(
      `time_format "${cfg.timeFormat}" is invalid, using default "${DEFAULT_TIME_FORMAT}"`,
    );
    cfg.timeFormat = DEFAULT_TIME_FORMAT;
  }

  cfg.dateTimeFormat = (cfg.dateTimeFormat ?? "").trim();
  if (cfg.dateTimeFormat === "") {
    cfg.dateTimeFormat = `${cfg.dateFormat} ${cfg.timeFormat}`;
  }
  if (!isValidTimeLayout(cfg.dateTimeFormat)) {
    cfg.dateTimeFormat = `${cfg.dateFormat} ${cfg.timeFormat}`;
  }

  const f = cfg.focus;
  if (f.workDuration === 0) f.workDuration = 25;
  if (f.shortBreakDuration === 0) f.shortBreakDuration = 5;
  if (f.longBreakDuration === 0) f.longBreakDuration = 15;
  if (f.longBreakInterval === 0) f.longBreakInterval = 4;
  if (f.dailyGoal === 0) f.dailyGoal = 8;

  if (f.workDuration < 1) f.workDuration = 1;
  if (f.workDuration > 120) f.workDuration = 120;
  if (f.shortBreakDuration < 1) f.shortBreakDuration = 1;
  if (f.longBreakDuration < 1) f.longBreakDuration = 1;
  if (f.longBreakInterval < 1) f.longBreakInterval = 1;
  if (f.longBreakInterval > 10) f.longBreakInterval = 10;

  return warnings;
}

const SENTINEL_ONE = GoTime.date(2009, 3, 17, 8, 23, 7, 0, "utc");
const SENTINEL_TWO = GoTime.date(2021, 11, 28, 20, 51, 43, 0, "utc");

/**
 * Validates that a Go time layout contains at least one real time token and is
 * not just static text (e.g. "DD/MM/YYYY").
 */
export function isValidTimeLayout(layout: string): boolean {
  const trimmed = layout.trim();
  if (trimmed === "") return false;
  const s1 = SENTINEL_ONE.format(trimmed);
  const s2 = SENTINEL_TWO.format(trimmed);
  return !(s1 === trimmed && s2 === trimmed);
}

/** Throwing variant used by the CLI, mirroring Go's ValidateTimeLayout. */
export function validateTimeLayout(layout: string): void {
  const trimmed = layout.trim();
  if (trimmed === "") throw new Error("layout cannot be empty");
  if (!isValidTimeLayout(trimmed)) {
    throw new Error("not a valid Go time layout");
  }
}

export function formatDate(cfg: Config, t: GoTime): string {
  return t.format(cfg.dateFormat);
}

export function formatTime(cfg: Config, t: GoTime): string {
  return t.format(cfg.timeFormat);
}

export function formatDateTime(cfg: Config, t: GoTime): string {
  return t.format(cfg.dateTimeFormat);
}

/**
 * Removes the year component ("2006") and its adjacent separator from a layout,
 * handling both year-first and year-last patterns.
 */
export function stripYear(layout: string): string {
  const idx = layout.indexOf("2006");
  if (idx < 0) return layout;

  const before = layout.slice(0, idx);
  const after = layout.slice(idx + 4);
  const seps = " ,.-/";

  if (after === "" || !seps.includes(after[0]!)) {
    const result = trimRightAny(before, seps);
    if (result === "") return trimLeftAny(after, seps);
    return result + trimLeftAny(after, seps);
  }
  return before + trimLeftAny(after, seps);
}

function trimRightAny(s: string, chars: string): string {
  let end = s.length;
  while (end > 0 && chars.includes(s[end - 1]!)) end--;
  return s.slice(0, end);
}

function trimLeftAny(s: string, chars: string): string {
  let start = 0;
  while (start < s.length && chars.includes(s[start]!)) start++;
  return s.slice(start);
}

/** Formats a date without the year when it falls in the same year as `now`. */
export function formatDateShort(cfg: Config, t: GoTime, now: GoTime): string {
  if (t.year() === now.year()) {
    const short = stripYear(cfg.dateFormat);
    if (short === cfg.dateFormat) return formatDate(cfg, t);
    return t.format(short);
  }
  return formatDate(cfg, t);
}

/** Human-friendly label for a journal note date. */
export function formatNoteTitle(
  cfg: Config,
  date: GoTime,
  now: GoTime,
): string {
  const yesterday = now.addDate(0, 0, -1);
  const weekAgo = now.addDate(0, 0, -6);

  if (sameDay(date, now)) return `Today, ${formatDateShort(cfg, date, now)}`;
  if (sameDay(date, yesterday)) {
    return `Yesterday, ${formatDateShort(cfg, date, now)}`;
  }
  if (date.after(weekAgo)) {
    return `${date.format("Mon")}, ${formatDateShort(cfg, date, now)}`;
  }
  if (date.year() === now.year()) return formatDateShort(cfg, date, now);
  return formatDate(cfg, date);
}

/** Date with weekday prefix, used in detail panel titles. */
export function formatDetailDate(cfg: Config, t: GoTime): string {
  return t.format(`Mon, ${cfg.dateFormat}`);
}

/** Absolute path to the config file (~/.todo-app/config.json by default). */
export function configPath(): string {
  const dir = process.env.RONDO_HOME ?? join(homedir(), ".todo-app");
  return join(dir, "config.json");
}

export function toJSON(cfg: Config): ConfigJSON {
  return {
    panel_ratio: cfg.panelRatio,
    date_format: cfg.dateFormat,
    time_format: cfg.timeFormat,
    datetime_format: cfg.dateTimeFormat,
    focus: {
      work_duration_min: cfg.focus.workDuration,
      short_break_duration_min: cfg.focus.shortBreakDuration,
      long_break_duration_min: cfg.focus.longBreakDuration,
      long_break_interval: cfg.focus.longBreakInterval,
      daily_goal: cfg.focus.dailyGoal,
      auto_start_break: cfg.focus.autoStartBreak,
      sound: cfg.focus.sound,
    },
  };
}

export function fromJSON(raw: ConfigJSON): Config {
  const cfg = zeroConfig();
  cfg.panelRatio = raw.panel_ratio ?? 0;
  cfg.dateFormat = raw.date_format ?? "";
  cfg.timeFormat = raw.time_format ?? "";
  cfg.dateTimeFormat = raw.datetime_format ?? "";
  const f = raw.focus ?? {};
  cfg.focus = {
    workDuration: f.work_duration_min ?? 0,
    shortBreakDuration: f.short_break_duration_min ?? 0,
    longBreakDuration: f.long_break_duration_min ?? 0,
    longBreakInterval: f.long_break_interval ?? 0,
    dailyGoal: f.daily_goal ?? 0,
    autoStartBreak: f.auto_start_break ?? false,
    sound: f.sound ?? false,
  };
  return cfg;
}

export interface LoadResult {
  cfg: Config;
  warnings: string[];
}

/** Reads the config file, falling back to defaults when it does not exist. */
export function loadWithWarnings(path = configPath()): LoadResult {
  if (!existsSync(path)) return { cfg: defaultConfig(), warnings: [] };

  let raw: ConfigJSON;
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as ConfigJSON;
  } catch (err) {
    throw new Error(`parse config: ${(err as Error).message}`);
  }
  const cfg = fromJSON(raw);
  const warnings = validateWithWarnings(cfg);
  return { cfg, warnings };
}

export function load(path = configPath()): Config {
  return loadWithWarnings(path).cfg;
}

/** Writes the config as indented JSON, creating the parent directory. */
export function save(cfg: Config, path = configPath()): void {
  validateWithWarnings(cfg);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(toJSON(cfg), null, 2)}\n`, "utf8");
}

/** Location used when rendering task/journal dates coming from storage. */
export const StorageLoc: Loc = "utc";
