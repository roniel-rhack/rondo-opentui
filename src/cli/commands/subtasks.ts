import type { Task } from "../../core/task/task.ts";
import { theme } from "../../core/ui/colors.ts";
import { Command, exactArgs } from "../command.ts";
import { confirm } from "../confirm.ts";
import {
  getTaskOrNotFound,
  isJSON,
  parseId,
  printer,
  requireTaskStore,
  type CLIContext,
} from "../context.ts";
import { NotFoundError } from "../errors.ts";

function subtaskBelongsToTask(t: Task, subtaskId: number): boolean {
  return t.subtasks.some((s) => s.id === subtaskId);
}

export function subtaskCmd(ctx: CLIContext): Command {
  const cmd = new Command({ use: "subtask", short: "Manage subtasks" });
  cmd.add(
    subtaskAddCmd(ctx),
    subtaskListCmd(ctx),
    subtaskDoneCmd(ctx),
    subtaskEditCmd(ctx),
    subtaskDeleteCmd(ctx),
  );
  return cmd;
}

function subtaskAddCmd(ctx: CLIContext): Command {
  return new Command({
    use: 'add <task-id> "title"',
    short: "Add a subtask to a task",
    args: exactArgs(2),
    run: (args) => {
      const taskId = parseId(args[0]!);
      getTaskOrNotFound(ctx, taskId);
      requireTaskStore(ctx).addSubtask(taskId, args[1]!);
      printer(ctx).success(`Added subtask to task #${taskId}: ${args[1]}`);
    },
  });
}

function subtaskListCmd(ctx: CLIContext): Command {
  return new Command({
    use: "list <task-id>",
    short: "List subtasks for a task",
    args: exactArgs(1),
    run: (args) => {
      const t = getTaskOrNotFound(ctx, parseId(args[0]!));
      const p = printer(ctx);

      if (isJSON(ctx)) {
        p.json(
          t.subtasks.map((s) => ({
            id: s.id,
            done: s.completed,
            title: s.title,
            position: s.position,
          })),
        );
        return;
      }

      p.table(
        ["ID", "DONE", "TITLE"],
        t.subtasks.map((s) => [
          String(s.id),
          s.completed
            ? p.colored("✓", theme.green)
            : p.colored("○", theme.gray),
          s.title,
        ]),
      );
    },
  });
}

function subtaskDoneCmd(ctx: CLIContext): Command {
  return new Command({
    use: "done <task-id> <subtask-id>",
    short: "Toggle subtask completion",
    args: exactArgs(2),
    run: (args) => {
      const taskId = parseId(args[0]!);
      const subtaskId = parseId(args[1]!, "subtask");
      const t = getTaskOrNotFound(ctx, taskId);
      if (!subtaskBelongsToTask(t, subtaskId)) {
        throw new NotFoundError("subtask", subtaskId);
      }
      requireTaskStore(ctx).toggleSubtask(subtaskId);
      printer(ctx).success(`Toggled subtask #${subtaskId}`);
    },
  });
}

function subtaskEditCmd(ctx: CLIContext): Command {
  return new Command({
    use: 'edit <task-id> <subtask-id> "new title"',
    short: "Edit a subtask title",
    args: exactArgs(3),
    run: (args) => {
      const taskId = parseId(args[0]!);
      const subtaskId = parseId(args[1]!, "subtask");
      const t = getTaskOrNotFound(ctx, taskId);
      if (!subtaskBelongsToTask(t, subtaskId)) {
        throw new NotFoundError("subtask", subtaskId);
      }
      requireTaskStore(ctx).updateSubtask(subtaskId, args[2]!);
      printer(ctx).success(`Updated subtask #${subtaskId}: ${args[2]}`);
    },
  });
}

function subtaskDeleteCmd(ctx: CLIContext): Command {
  return new Command({
    use: "delete <task-id> <subtask-id>",
    short: "Delete a subtask",
    args: exactArgs(2),
    flags: {
      force: { type: "bool", shorthand: "y", usage: "Skip confirmation prompt" },
    },
    run: (args, flags) => {
      const taskId = parseId(args[0]!);
      const subtaskId = parseId(args[1]!, "subtask");
      const t = getTaskOrNotFound(ctx, taskId);
      const subtask = t.subtasks.find((s) => s.id === subtaskId);
      if (!subtask) throw new NotFoundError("subtask", subtaskId);

      if (
        !confirm(
          ctx,
          `Delete subtask #${subtaskId} "${subtask.title}"?`,
          flags.bool("force"),
        )
      ) {
        ctx.stderr.write("Cancelled.\n");
        return;
      }

      requireTaskStore(ctx).deleteSubtask(subtaskId);
      printer(ctx).success(`Deleted subtask #${subtaskId}`);
    },
  });
}
