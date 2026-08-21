import {
  DateFormatPresets,
  DateTimeFormatPresets,
  TimeFormatPresets,
  defaultConfig,
  load,
  resolvePreset,
  save,
  toJSON,
  validateTimeLayout,
  type Config,
} from "../../core/config/config.ts";
import { Command, exactArgs, noArgs } from "../command.ts";
import { confirm } from "../confirm.ts";
import { isJSON, printer, type CLIContext } from "../context.ts";

export interface ConfigKey {
  description: string;
  get: (c: Config) => string;
  set: (c: Config, val: string) => void;
}

function parseMinutes(val: string, min: number, max: number): number {
  const v = Number(val);
  if (!Number.isInteger(v)) {
    throw new Error(`must be an integer, got "${val}"`);
  }
  if (v < min || v > max) {
    throw new Error(`must be between ${min} and ${max}, got ${v}`);
  }
  return v;
}

function parseBool(val: string): boolean {
  switch (val.toLowerCase()) {
    case "true":
    case "1":
    case "yes":
    case "on":
      return true;
    case "false":
    case "0":
    case "no":
    case "off":
      return false;
    default:
      throw new Error(`must be true or false, got "${val}"`);
  }
}

export const configKeys: Record<string, ConfigKey> = {
  theme: {
    description: "TUI theme: dark, light, or auto (follow the terminal)",
    get: (c) => (c.theme === "" ? "auto" : c.theme),
    set: (c, val) => {
      const v = val.toLowerCase();
      if (v === "auto") c.theme = "";
      else if (v === "dark" || v === "light") c.theme = v;
      else throw new Error(`theme must be dark, light or auto, got "${val}"`);
    },
  },
  panel_ratio: {
    description: "Panel width ratio (0.2–0.8)",
    get: (c) => c.panelRatio.toFixed(2),
    set: (c, val) => {
      const v = Number(val);
      if (Number.isNaN(v)) {
        throw new Error("panel_ratio must be a number between 0.2 and 0.8");
      }
      if (v < 0.2 || v > 0.8) {
        throw new Error(`panel_ratio must be between 0.2 and 0.8, got ${v}`);
      }
      c.panelRatio = v;
    },
  },
  date_format: {
    description: "Date format (Go layout or preset: iso, european, us)",
    get: (c) => c.dateFormat,
    set: (c, val) => {
      const resolved = resolvePreset(val, DateFormatPresets);
      try {
        validateTimeLayout(resolved);
      } catch (err) {
        throw new Error(`date_format: ${(err as Error).message}`);
      }
      c.dateFormat = resolved;
    },
  },
  time_format: {
    description: "Time format (Go layout or preset: 24h, 12h)",
    get: (c) => c.timeFormat,
    set: (c, val) => {
      const resolved = resolvePreset(val, TimeFormatPresets);
      try {
        validateTimeLayout(resolved);
      } catch (err) {
        throw new Error(`time_format: ${(err as Error).message}`);
      }
      c.timeFormat = resolved;
    },
  },
  datetime_format: {
    description: "Date+time format (Go layout or preset: iso, european, us)",
    get: (c) => c.dateTimeFormat,
    set: (c, val) => {
      const resolved = resolvePreset(val, DateTimeFormatPresets);
      try {
        validateTimeLayout(resolved);
      } catch (err) {
        throw new Error(`datetime_format: ${(err as Error).message}`);
      }
      c.dateTimeFormat = resolved;
    },
  },
  "focus.work_duration_min": {
    description: "Work session duration in minutes (1–120)",
    get: (c) => String(c.focus.workDuration),
    set: (c, val) => {
      try {
        c.focus.workDuration = parseMinutes(val, 1, 120);
      } catch (err) {
        throw new Error(`focus.work_duration_min: ${(err as Error).message}`);
      }
    },
  },
  "focus.short_break_duration_min": {
    description: "Short break duration in minutes (1–60)",
    get: (c) => String(c.focus.shortBreakDuration),
    set: (c, val) => {
      try {
        c.focus.shortBreakDuration = parseMinutes(val, 1, 60);
      } catch (err) {
        throw new Error(
          `focus.short_break_duration_min: ${(err as Error).message}`,
        );
      }
    },
  },
  "focus.long_break_duration_min": {
    description: "Long break duration in minutes (1–120)",
    get: (c) => String(c.focus.longBreakDuration),
    set: (c, val) => {
      try {
        c.focus.longBreakDuration = parseMinutes(val, 1, 120);
      } catch (err) {
        throw new Error(
          `focus.long_break_duration_min: ${(err as Error).message}`,
        );
      }
    },
  },
  "focus.long_break_interval": {
    description: "Work sessions before a long break (1–10)",
    get: (c) => String(c.focus.longBreakInterval),
    set: (c, val) => {
      try {
        c.focus.longBreakInterval = parseMinutes(val, 1, 10);
      } catch (err) {
        throw new Error(`focus.long_break_interval: ${(err as Error).message}`);
      }
    },
  },
  "focus.daily_goal": {
    description: "Daily focus session goal",
    get: (c) => String(c.focus.dailyGoal),
    set: (c, val) => {
      try {
        c.focus.dailyGoal = parseMinutes(val, 1, 100);
      } catch (err) {
        throw new Error(`focus.daily_goal: ${(err as Error).message}`);
      }
    },
  },
  "focus.auto_start_break": {
    description: "Auto-start breaks after work sessions (true/false)",
    get: (c) => (c.focus.autoStartBreak ? "true" : "false"),
    set: (c, val) => {
      try {
        c.focus.autoStartBreak = parseBool(val);
      } catch (err) {
        throw new Error(`focus.auto_start_break: ${(err as Error).message}`);
      }
    },
  },
  "focus.sound": {
    description: "Play sound on session completion (true/false)",
    get: (c) => (c.focus.sound ? "true" : "false"),
    set: (c, val) => {
      try {
        c.focus.sound = parseBool(val);
      } catch (err) {
        throw new Error(`focus.sound: ${(err as Error).message}`);
      }
    },
  },
};

export const orderedConfigKeys = [
  "theme",
  "panel_ratio",
  "date_format",
  "time_format",
  "datetime_format",
  "focus.work_duration_min",
  "focus.short_break_duration_min",
  "focus.long_break_duration_min",
  "focus.long_break_interval",
  "focus.daily_goal",
  "focus.auto_start_break",
  "focus.sound",
];

export function configCmd(ctx: CLIContext): Command {
  const path = () => ctx.configPath;

  const cmd = new Command({
    use: "config",
    short: "View and modify configuration",
  });

  cmd.add(
    new Command({
      use: "list",
      short: "List all configuration keys and values",
      args: noArgs,
      run: () => {
        const cfg = path() ? load(path()!) : load();
        const p = printer(ctx);
        if (isJSON(ctx)) {
          p.json(toJSON(cfg));
          return;
        }
        p.table(
          ["KEY", "VALUE", "DESCRIPTION"],
          orderedConfigKeys.map((key) => {
            const kd = configKeys[key]!;
            return [key, kd.get(cfg), kd.description];
          }),
        );
      },
    }),
    new Command({
      use: "get <key>",
      short: "Get a configuration value",
      args: exactArgs(1),
      run: (args) => {
        const kd = configKeys[args[0]!];
        if (!kd) {
          throw new Error(
            `unknown config key "${args[0]}"; run 'rondo config list' to see valid keys`,
          );
        }
        const cfg = path() ? load(path()!) : load();
        ctx.stdout.write(`${kd.get(cfg)}\n`);
      },
    }),
    new Command({
      use: "set <key> <value>",
      short: "Set a configuration value",
      args: exactArgs(2),
      run: (args) => {
        const [key, val] = args as [string, string];
        const kd = configKeys[key];
        if (!kd) {
          throw new Error(
            `unknown config key "${key}"; run 'rondo config list' to see valid keys`,
          );
        }
        const cfg = path() ? load(path()!) : load();
        kd.set(cfg, val);
        if (path()) save(cfg, path()!);
        else save(cfg);

        const stored = kd.get(cfg);
        const p = printer(ctx);
        if (stored !== val) {
          p.success(`Set ${key} = ${val} (resolved: ${stored})`);
        } else {
          p.success(`Set ${key} = ${val}`);
        }
      },
    }),
    new Command({
      use: "reset",
      short: "Reset configuration to defaults",
      args: noArgs,
      flags: {
        force: {
          type: "bool",
          shorthand: "y",
          usage: "Skip confirmation prompt",
        },
      },
      run: (_args, flags) => {
        if (
          !confirm(ctx, "Reset all configuration to defaults?", flags.bool("force"))
        ) {
          ctx.stderr.write("Cancelled.\n");
          return;
        }
        if (path()) save(defaultConfig(), path()!);
        else save(defaultConfig());
        printer(ctx).success("Configuration reset to defaults");
      },
    }),
  );

  return cmd;
}
