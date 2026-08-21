import { formatDate } from "../../core/config/config.ts";
import {
  formatDuration,
  parseDuration,
  totalDuration,
} from "../../core/task/timelog.ts";
import { GoTime } from "../../core/time.ts";
import { Command, exactArgs, noArgs } from "../command.ts";
import {
  getTaskOrNotFound,
  isJSON,
  parseId,
  printer,
  requireTaskStore,
  type CLIContext,
} from "../context.ts";

export function timelogCmd(ctx: CLIContext): Command {
  const cmd = new Command({ use: "timelog", short: "Manage time logs" });
  cmd.add(timelogAddCmd(ctx), timelogListCmd(ctx), timelogSummaryCmd(ctx));
  return cmd;
}

function timelogAddCmd(ctx: CLIContext): Command {
  return new Command({
    use: "add <task-id> <duration>",
    short: "Log time spent on a task (e.g. 1h30m, 45m, 2h)",
    args: exactArgs(2),
    flags: {
      note: { type: "string", usage: "Optional note for this time entry" },
    },
    run: (args, flags) => {
      const taskId = parseId(args[0]!);
      getTaskOrNotFound(ctx, taskId);

      let dur: number;
      try {
        dur = parseDuration(args[1]!);
      } catch (err) {
        throw new Error(`invalid duration: ${(err as Error).message}`);
      }

      requireTaskStore(ctx).addTimeLog(taskId, dur, flags.string("note"));
      printer(ctx).success(
        `Logged ${formatDuration(dur)} to task #${taskId}`,
      );
    },
  });
}

function timelogListCmd(ctx: CLIContext): Command {
  return new Command({
    use: "list <task-id>",
    short: "List time logs for a task",
    args: exactArgs(1),
    run: (args) => {
      const taskId = parseId(args[0]!);
      getTaskOrNotFound(ctx, taskId);

      const logs = requireTaskStore(ctx).listTimeLogs(taskId);
      const p = printer(ctx);

      if (isJSON(ctx)) {
        p.json(
          logs.map((l) => ({
            id: l.id,
            date: l.loggedAt.format("2006-01-02"),
            duration: formatDuration(l.duration),
            ...(l.note !== "" ? { note: l.note } : {}),
          })),
        );
        return;
      }

      p.table(
        ["DATE", "DURATION", "NOTE"],
        logs.map((l) => [
          formatDate(ctx.cfg, l.loggedAt),
          formatDuration(l.duration),
          l.note,
        ]),
      );
      p.success(`Total: ${formatDuration(totalDuration(logs))}`);
    },
  });
}

function timelogSummaryCmd(ctx: CLIContext): Command {
  return new Command({
    use: "summary",
    short: "Summarize time logged across all tasks",
    args: noArgs,
    flags: {
      days: { type: "int", default: 7, usage: "Number of past days to include" },
    },
    run: (_args, flags) => {
      const days = flags.int("days");
      const cutoff = GoTime.now().addDate(0, 0, -days);
      const tasks = requireTaskStore(ctx).list();

      const summaries: { taskId: number; taskTitle: string; total: number }[] =
        [];
      let grandTotal = 0;

      for (const t of tasks) {
        let taskTotal = 0;
        for (const l of t.timeLogs) {
          if (l.loggedAt.after(cutoff)) taskTotal += l.duration;
        }
        if (taskTotal > 0) {
          summaries.push({ taskId: t.id, taskTitle: t.title, total: taskTotal });
          grandTotal += taskTotal;
        }
      }

      const p = printer(ctx);
      if (isJSON(ctx)) {
        p.json(
          summaries.map((s) => ({
            task_id: s.taskId,
            task_title: s.taskTitle,
            duration: formatDuration(s.total),
          })),
        );
        return;
      }

      p.table(
        ["ID", "TASK", "TOTAL"],
        summaries.map((s) => [
          String(s.taskId),
          s.taskTitle,
          formatDuration(s.total),
        ]),
      );
      p.success(
        `Grand total (${days} days): ${formatDuration(grandTotal)}`,
      );
    },
  });
}
