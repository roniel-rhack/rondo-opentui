import { formatDateTime } from "../../core/config/config.ts";
import type { Task } from "../../core/task/task.ts";
import { RFC3339 } from "../../core/time.ts";
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

function noteBelongsToTask(t: Task, noteId: number): boolean {
  return t.notes.some((n) => n.id === noteId);
}

export function noteCmd(ctx: CLIContext): Command {
  const cmd = new Command({ use: "note", short: "Manage task notes" });
  cmd.add(
    noteAddCmd(ctx),
    noteListCmd(ctx),
    noteEditCmd(ctx),
    noteDeleteCmd(ctx),
  );
  return cmd;
}

function noteAddCmd(ctx: CLIContext): Command {
  return new Command({
    use: 'add <task-id> "note text"',
    short: "Add a note to a task",
    args: exactArgs(2),
    run: (args) => {
      const taskId = parseId(args[0]!);
      getTaskOrNotFound(ctx, taskId);
      const body = args[1]!.trim();
      if (body === "") throw new Error("note body cannot be empty");

      requireTaskStore(ctx).addNote(taskId, body);
      printer(ctx).success(`Added note to task #${taskId}`);
    },
  });
}

function noteListCmd(ctx: CLIContext): Command {
  return new Command({
    use: "list <task-id>",
    short: "List notes for a task",
    args: exactArgs(1),
    run: (args) => {
      const taskId = parseId(args[0]!);
      getTaskOrNotFound(ctx, taskId);
      const notes = requireTaskStore(ctx).listNotes(taskId);
      const p = printer(ctx);

      if (isJSON(ctx)) {
        p.json(
          notes.map((n) => ({
            id: n.id,
            body: n.body,
            created_at: n.createdAt.format(RFC3339),
          })),
        );
        return;
      }

      p.table(
        ["ID", "DATE", "NOTE"],
        notes.map((n) => [
          String(n.id),
          formatDateTime(ctx.cfg, n.createdAt),
          n.body,
        ]),
      );
    },
  });
}

function noteEditCmd(ctx: CLIContext): Command {
  return new Command({
    use: 'edit <task-id> <note-id> "new text"',
    short: "Edit a note",
    args: exactArgs(3),
    run: (args) => {
      const taskId = parseId(args[0]!);
      const noteId = parseId(args[1]!, "note");
      const t = getTaskOrNotFound(ctx, taskId);
      if (!noteBelongsToTask(t, noteId)) {
        throw new NotFoundError("note", noteId);
      }
      requireTaskStore(ctx).updateNote(noteId, args[2]!);
      printer(ctx).success(`Updated note #${noteId}`);
    },
  });
}

function noteDeleteCmd(ctx: CLIContext): Command {
  return new Command({
    use: "delete <task-id> <note-id>",
    short: "Delete a note",
    args: exactArgs(2),
    flags: {
      force: { type: "bool", shorthand: "y", usage: "Skip confirmation prompt" },
    },
    run: (args, flags) => {
      const taskId = parseId(args[0]!);
      const noteId = parseId(args[1]!, "note");
      const t = getTaskOrNotFound(ctx, taskId);
      const note = t.notes.find((n) => n.id === noteId);
      if (!note) throw new NotFoundError("note", noteId);

      const display =
        note.body.length > 50 ? `${note.body.slice(0, 50)}...` : note.body;
      if (
        !confirm(ctx, `Delete note #${noteId} "${display}"?`, flags.bool("force"))
      ) {
        ctx.stderr.write("Cancelled.\n");
        return;
      }

      requireTaskStore(ctx).deleteNote(noteId);
      printer(ctx).success(`Deleted note #${noteId}`);
    },
  });
}
