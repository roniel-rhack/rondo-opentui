import { writeFileSync } from "node:fs";
import { formatDate } from "../../core/config/config.ts";
import { writeJSON, writeNotes, writeTasks } from "../../core/export/export.ts";
import { SessionKind, type Session } from "../../core/focus/focus.ts";
import type { Note } from "../../core/journal/journal.ts";
import { RecurFreq, parseRecurFreq, recurFreqString } from "../../core/task/recur.ts";
import { Status, statusString } from "../../core/task/task.ts";
import { formatDuration, parseDuration } from "../../core/task/timelog.ts";
import { DateOnly, GoTime, RFC3339 } from "../../core/time.ts";
import { Command, exactArgs, noArgs } from "../command.ts";
import {
  getTaskOrNotFound,
  isJSON,
  parseId,
  printer,
  requireFocusStore,
  requireJournalStore,
  requireTaskStore,
  type CLIContext,
} from "../context.ts";

export function exportCmd(ctx: CLIContext): Command {
  return new Command({
    use: "export [flags]",
    short: "Export tasks and optionally journal to a file or stdout",
    args: noArgs,
    flags: {
      format: { type: "string", default: "md", usage: "Export format: md, json" },
      output: { type: "string", usage: "Output file path (default: stdout)" },
      journal: { type: "bool", usage: "Include journal entries" },
    },
    run: (_args, flags) => {
      const format = flags.string("format");
      if (!["md", "markdown", "json"].includes(format)) {
        throw new Error(`invalid format "${format}": must be md or json`);
      }

      const tasks = requireTaskStore(ctx).list();
      const includeJournal = flags.bool("journal");
      let notes: Note[] | null = null;
      if (includeJournal) notes = requireJournalStore(ctx).listNotes(false);

      let content: string;
      if (format === "json") {
        content = writeJSON(tasks, includeJournal ? notes : null);
      } else {
        content = writeTasks(tasks);
        if (includeJournal) content += `\n${writeNotes(notes)}`;
      }

      const output = flags.string("output");
      if (output !== "") {
        writeFileSync(output, content, "utf8");
        ctx.stderr.write(`Exported to ${output}\n`);
        return;
      }
      ctx.stdout.write(content);
    },
  });
}

export function recurCmd(ctx: CLIContext): Command {
  const cmd = new Command({ use: "recur", short: "Manage task recurrence" });
  cmd.add(
    new Command({
      use: "set <task-id> <daily|weekly|monthly|yearly>",
      short: "Set recurrence for a task",
      args: exactArgs(2),
      run: (args) => {
        const taskId = parseId(args[0]!);
        const t = getTaskOrNotFound(ctx, taskId);
        const freq = parseRecurFreq(args[1]!.toLowerCase());
        if (freq === RecurFreq.None) {
          throw new Error(
            `invalid frequency "${args[1]}": must be daily, weekly, monthly, or yearly`,
          );
        }
        const interval = t.recurInterval > 0 ? t.recurInterval : 1;
        requireTaskStore(ctx).updateRecurrence(taskId, freq, interval);
        printer(ctx).success(
          `Set task #${taskId} to recur ${recurFreqString(freq)}`,
        );
      },
    }),
    new Command({
      use: "clear <task-id>",
      short: "Clear recurrence for a task",
      args: exactArgs(1),
      run: (args) => {
        const taskId = parseId(args[0]!);
        getTaskOrNotFound(ctx, taskId);
        requireTaskStore(ctx).updateRecurrence(taskId, RecurFreq.None, 0);
        printer(ctx).success(`Cleared recurrence for task #${taskId}`);
      },
    }),
  );
  return cmd;
}

export function statsCmd(ctx: CLIContext): Command {
  return new Command({
    use: "stats",
    short: "Show a summary of tasks and focus sessions",
    args: noArgs,
    run: () => {
      const tasks = requireTaskStore(ctx).list();

      let pending = 0;
      let active = 0;
      let done = 0;
      for (const t of tasks) {
        if (t.status === Status.Pending) pending++;
        else if (t.status === Status.InProgress) active++;
        else if (t.status === Status.Done) done++;
      }

      const priCounts: Record<string, number> = {
        Low: 0,
        Medium: 0,
        High: 0,
        Urgent: 0,
      };
      for (const t of tasks) {
        if (t.status !== Status.Done) {
          const key = ["Low", "Medium", "High", "Urgent"][t.priority]!;
          priCounts[key] = (priCounts[key] ?? 0) + 1;
        }
      }

      const focus = requireFocusStore(ctx);
      const todayWork = focus.todayWorkCount();
      const streak = focus.streak();
      const totalMin = focus.totalMinutesFocused(30);
      const goal = ctx.cfg.focus.dailyGoal;

      const p = printer(ctx);
      if (isJSON(ctx)) {
        p.json({
          tasks: {
            total: tasks.length,
            pending,
            active,
            done,
            by_priority: {
              low: priCounts.Low,
              medium: priCounts.Medium,
              high: priCounts.High,
              urgent: priCounts.Urgent,
            },
          },
          focus: {
            today: todayWork,
            goal,
            streak_days: streak,
            total_min_30days: totalMin,
          },
        });
        return;
      }

      p.line(p.bold("TASKS"));
      p.table(
        ["STATUS", "COUNT"],
        [
          ["Pending", String(pending)],
          ["Active", String(active)],
          ["Done", String(done)],
          ["Total", String(pending + active + done)],
        ],
      );

      p.line();
      p.line(p.bold("OPEN TASKS BY PRIORITY"));
      p.table(
        ["PRIORITY", "COUNT"],
        [
          ["Urgent", String(priCounts.Urgent)],
          ["High", String(priCounts.High)],
          ["Medium", String(priCounts.Medium)],
          ["Low", String(priCounts.Low)],
        ],
      );

      p.line();
      p.line(p.bold("FOCUS (last 30 days)"));
      const totalHours = Math.trunc(totalMin / 60);
      const totalMinsRem = totalMin % 60;
      const totalFmt =
        totalHours === 0 ? `${totalMinsRem}m` : `${totalHours}h ${totalMinsRem}m`;
      p.table(
        ["METRIC", "VALUE"],
        [
          ["Today", `${todayWork} / ${goal} (goal)`],
          ["Streak", `${streak} days`],
          ["Total focused", totalFmt],
          ["As of", formatDate(ctx.cfg, GoTime.now())],
        ],
      );
    },
  });
}

export function focusCmd(ctx: CLIContext): Command {
  const cmd = new Command({
    use: "focus",
    short: "Manage focus (Pomodoro) sessions",
  });

  cmd.add(
    new Command({
      use: "start",
      short: "Record a completed focus session",
      aliases: ["log"],
      args: noArgs,
      flags: {
        "task-id": {
          type: "int",
          usage: "Associate session with a task ID",
        },
        task: {
          type: "int",
          usage: "Alias for --task-id",
        },
        duration: {
          type: "string",
          usage: "Session duration (e.g. 25m, 1h); default from config",
        },
      },
      run: (_args, flags) => {
        const durationStr = flags.changed("duration")
          ? flags.string("duration")
          : `${ctx.cfg.focus.workDuration}m`;

        let dur: number;
        try {
          dur = parseDuration(durationStr);
        } catch (err) {
          throw new Error(`invalid duration: ${(err as Error).message}`);
        }

        const session: Session = {
          id: 0,
          taskId: flags.changed("task-id")
            ? flags.int("task-id")
            : flags.int("task"),
          duration: dur,
          startedAt: GoTime.utcNow(),
          completedAt: null,
          kind: SessionKind.Work,
          cyclePos: 1,
        };

        const store = requireFocusStore(ctx);
        store.create(session);
        store.complete(session.id);

        if (ctx.quiet) {
          ctx.stdout.write(`${session.id}\n`);
        } else {
          printer(ctx).success(
            `Recorded focus session #${session.id} (${formatDuration(dur)})`,
          );
        }
      },
    }),
    new Command({
      use: "status",
      short: "Show today's focus status",
      args: noArgs,
      run: () => {
        const store = requireFocusStore(ctx);
        const today = store.todayWorkCount();
        const streak = store.streak();
        const goal = ctx.cfg.focus.dailyGoal;
        const p = printer(ctx);

        if (isJSON(ctx)) {
          p.json({
            today,
            goal,
            streak_days: streak,
            date: GoTime.now().format(DateOnly),
          });
          return;
        }
        p.table(
          ["METRIC", "VALUE"],
          [
            ["Today", `${today} / ${goal} (goal)`],
            ["Streak", `${streak} days`],
            ["Date", formatDate(ctx.cfg, GoTime.now())],
          ],
        );
      },
    }),
    new Command({
      use: "stats",
      short: "Show focus session statistics",
      args: noArgs,
      flags: {
        days: { type: "int", default: 7, usage: "Number of days to show" },
      },
      run: (_args, flags) => {
        const store = requireFocusStore(ctx);
        const days = flags.int("days");
        const byDay = store.completionsByDay(days);
        const p = printer(ctx);

        if (isJSON(ctx)) {
          p.json(byDay);
          return;
        }

        const rows = Object.keys(byDay)
          .sort((a, b) => (a > b ? -1 : 1))
          .map((day) => [day, String(byDay[day])]);
        if (rows.length === 0) {
          p.line(p.dim(`(no focus sessions in the last ${days} days)`));
          return;
        }
        p.table(["DATE", "SESSIONS"], rows);
      },
    }),
  );

  return cmd;
}

interface BatchCommand {
  cmd: string;
  args?: string[];
}

interface BatchResult {
  cmd: string;
  ok: boolean;
  /** Raw stdout of the command, when it produced any non-JSON output. */
  output?: string;
  /** Parsed stdout, when the command ran with JSON format. */
  data?: unknown;
  error?: string;
}

export interface NestedRun {
  output: string;
  json: boolean;
}

export function batchCmd(
  ctx: CLIContext,
  runOne: (argv: string[]) => NestedRun,
): Command {
  return new Command({
    use: "batch",
    short: "Execute commands from stdin (one JSON object per line)",
    long: `Read newline-delimited JSON commands from stdin and execute each one.
Each line is a JSON object: {"cmd": "add", "args": ["task title", "--priority", "high"]}
Output is a JSON array of results.`,
    args: noArgs,
    run: () => {
      const results: BatchResult[] = [];

      for (const rawLine of ctx.stdin().split("\n")) {
        const line = rawLine.trim();
        if (line === "") continue;

        let bc: BatchCommand;
        try {
          bc = JSON.parse(line) as BatchCommand;
        } catch (err) {
          results.push({
            cmd: line,
            ok: false,
            error: `invalid JSON: ${(err as Error).message}`,
          });
          continue;
        }

        if (bc.cmd === "batch") {
          results.push({
            cmd: bc.cmd,
            ok: false,
            error: "batch cannot be nested",
          });
          continue;
        }

        try {
          const run = runOne([bc.cmd, ...(bc.args ?? [])]);
          const result: BatchResult = { cmd: bc.cmd, ok: true };
          const output = run.output.trim();
          if (run.json && output !== "") {
            try {
              result.data = JSON.parse(output);
            } catch {
              result.output = output;
            }
          } else if (output !== "") {
            result.output = output;
          }
          results.push(result);
        } catch (err) {
          results.push({
            cmd: bc.cmd,
            ok: false,
            error: (err as Error).message,
          });
        }
      }

      printer(ctx).json(results);
    },
  });
}

export function completionCmd(ctx: CLIContext): Command {
  return new Command({
    use: "completion <bash|zsh|fish>",
    short: "Generate a shell completion script",
    args: exactArgs(1),
    run: (args) => {
      const shell = args[0]!.toLowerCase();
      const commands = [
        "add",
        "done",
        "list",
        "show",
        "edit",
        "delete",
        "status",
        "subtask",
        "timelog",
        "recur",
        "note",
        "journal",
        "export",
        "stats",
        "focus",
        "config",
        "batch",
        "completion",
        "skill",
      ].join(" ");

      switch (shell) {
        case "bash":
          ctx.stdout.write(
            `_rondo_completions() {\n  COMPREPLY=($(compgen -W "${commands}" -- "\${COMP_WORDS[1]}"))\n}\ncomplete -F _rondo_completions rondo-opentui\n`,
          );
          break;
        case "zsh":
          ctx.stdout.write(
            `#compdef rondo-opentui\n_arguments '1:command:(${commands})'\n`,
          );
          break;
        case "fish":
          ctx.stdout.write(
            commands
              .split(" ")
              .map((c) => `complete -c rondo-opentui -n "__fish_use_subcommand" -a ${c}`)
              .join("\n") + "\n",
          );
          break;
        default:
          throw new Error(
            `unsupported shell "${args[0]}": must be bash, zsh, or fish`,
          );
      }
    },
  });
}

export function versionCmd(ctx: CLIContext, version: string): Command {
  return new Command({
    use: "version",
    short: "Print the rondo-opentui version",
    args: noArgs,
    run: () => {
      if (isJSON(ctx)) {
        printer(ctx).json({ version });
        return;
      }
      ctx.stdout.write(`rondo-opentui ${version}\n`);
    },
  });
}

/** Shown by `rondo show`/`list` JSON consumers; kept for API parity. */
export function statusLabel(s: Status): string {
  return statusString(s);
}

export function nowStamp(): string {
  return GoTime.utcNow().format(RFC3339);
}
