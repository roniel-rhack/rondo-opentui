import { formatDate, formatNoteTitle, formatTime } from "../../core/config/config.ts";
import type { Entry, Note } from "../../core/journal/journal.ts";
import { DateOnly, GoTime, RFC3339, parseDateOnly } from "../../core/time.ts";
import {
  Command,
  arbitraryArgs,
  exactArgs,
  maximumNArgs,
  minimumNArgs,
  noArgs,
} from "../command.ts";
import { confirm } from "../confirm.ts";
import { NotFoundError } from "../errors.ts";
import {
  isJSON,
  parseId,
  printer,
  requireJournalStore,
  type CLIContext,
} from "../context.ts";
import type { Printer } from "../printer.ts";

/** Converts "today", "yesterday" or "YYYY-MM-DD" into a date string. */
export function parseJournalDate(s: string): string {
  switch (s.toLowerCase()) {
    case "today":
    case "":
      return GoTime.now().format(DateOnly);
    case "yesterday":
      return GoTime.now().addDate(0, 0, -1).format(DateOnly);
    default:
      try {
        return parseDateOnly(s, "utc").format(DateOnly);
      } catch {
        throw new Error(
          `invalid date "${s}": expected today, yesterday, or YYYY-MM-DD`,
        );
      }
  }
}

function findNoteByDate(notes: Note[], dateStr: string): Note | undefined {
  return notes.find((n) => n.date.format(DateOnly) === dateStr);
}

export function journalCmd(ctx: CLIContext): Command {
  const cmd = new Command({
    use: 'journal ["entry text"]',
    short: "Manage journal entries",
    long: `Manage journal entries.

When called with text arguments and no subcommand, adds an entry to today's
note (backward-compatible shorthand for 'journal add').`,
    args: arbitraryArgs,
    run: (args) => {
      if (args.length === 0) {
        throw new Error(
          "no text provided; use 'rondo journal <text>' or a subcommand (run 'rondo journal --help')",
        );
      }
      const store = requireJournalStore(ctx);
      const note = store.getOrCreateToday();
      store.addEntry(note.id, args.join(" "));
      printer(ctx).success(
        `Added journal entry to ${formatDate(ctx.cfg, note.date)}`,
      );
    },
  });

  cmd.add(
    journalAddCmd(ctx),
    journalListCmd(ctx),
    journalShowCmd(ctx),
    journalEditCmd(ctx),
    journalDeleteCmd(ctx),
    journalHideCmd(ctx),
  );
  return cmd;
}

function journalAddCmd(ctx: CLIContext): Command {
  return new Command({
    use: 'add "entry text"',
    short: "Add a journal entry",
    args: minimumNArgs(1),
    flags: {
      date: {
        type: "string",
        usage: "Note date (today, yesterday, or YYYY-MM-DD; default: today)",
      },
    },
    run: (args, flags) => {
      const body = args.join(" ");
      const store = requireJournalStore(ctx);
      const date = flags.string("date");
      const note =
        date === ""
          ? store.getOrCreateToday()
          : store.getOrCreate(parseJournalDate(date));

      store.addEntry(note.id, body);
      printer(ctx).success(
        `Added journal entry to ${formatDate(ctx.cfg, note.date)}`,
      );
    },
  });
}

function journalListCmd(ctx: CLIContext): Command {
  return new Command({
    use: "list",
    short: "List journal notes",
    args: noArgs,
    flags: {
      date: {
        type: "string",
        usage: "Filter to a specific date (today, yesterday, or YYYY-MM-DD)",
      },
      hidden: { type: "bool", usage: "Include hidden notes" },
    },
    run: (_args, flags) => {
      const store = requireJournalStore(ctx);
      let notes = store.listNotes(flags.bool("hidden"));

      const date = flags.string("date");
      if (date !== "") {
        const dateStr = parseJournalDate(date);
        notes = notes.filter((n) => n.date.format(DateOnly) === dateStr);
      }

      if (isJSON(ctx)) {
        printer(ctx).json(
          notes.map((n) => ({
            id: n.id,
            date: n.date.format(DateOnly),
            entry_count: n.entries.length,
            hidden: n.hidden,
          })),
        );
        return;
      }
      printNotesTable(ctx, printer(ctx), notes);
    },
  });
}

function journalShowCmd(ctx: CLIContext): Command {
  return new Command({
    use: "show [today|yesterday|YYYY-MM-DD]",
    short: "Show entries for a journal note",
    args: maximumNArgs(1),
    run: (args) => {
      const dateStr = parseJournalDate(args[0] ?? "today");
      const store = requireJournalStore(ctx);
      const note = findNoteByDate(store.listNotes(true), dateStr);
      if (!note) throw new NotFoundError("note", dateStr);

      const entries = store.listEntries(note.id);

      if (isJSON(ctx)) {
        printer(ctx).json({
          date: note.date.format(DateOnly),
          entries: entries.map((e) => ({
            id: e.id,
            note_id: e.noteId,
            body: e.body,
            created_at: e.createdAt.format(RFC3339),
          })),
        });
        return;
      }
      printEntriesTable(ctx, printer(ctx), note.date, entries);
    },
  });
}

function journalEditCmd(ctx: CLIContext): Command {
  return new Command({
    use: 'edit <entry-id> "new text"',
    short: "Edit a journal entry",
    args: exactArgs(2),
    run: (args) => {
      const id = parseId(args[0]!, "entry");
      if (id <= 0) {
        throw new Error(
          `invalid entry ID "${args[0]}": expected a positive integer`,
        );
      }
      requireJournalStore(ctx).updateEntry(id, args[1]!);
      printer(ctx).success(`Updated entry #${id}`);
    },
  });
}

function journalDeleteCmd(ctx: CLIContext): Command {
  return new Command({
    use: "delete <entry-id>",
    short: "Delete a journal entry",
    aliases: ["del", "rm"],
    args: exactArgs(1),
    flags: {
      force: { type: "bool", shorthand: "y", usage: "Skip confirmation prompt" },
    },
    run: (args, flags) => {
      const id = parseId(args[0]!, "entry");
      if (id <= 0) {
        throw new Error(
          `invalid entry ID "${args[0]}": expected a positive integer`,
        );
      }

      if (!confirm(ctx, `Delete entry #${id}?`, flags.bool("force"))) {
        ctx.stderr.write("Cancelled.\n");
        return;
      }

      requireJournalStore(ctx).deleteEntry(id);
      printer(ctx).success(`Deleted entry #${id}`);
    },
  });
}

function journalHideCmd(ctx: CLIContext): Command {
  return new Command({
    use: "hide <date>",
    short: "Toggle the hidden flag on a journal note",
    args: exactArgs(1),
    run: (args) => {
      const dateStr = parseJournalDate(args[0]!);
      const store = requireJournalStore(ctx);
      const note = findNoteByDate(store.listNotes(true), dateStr);
      if (!note) throw new NotFoundError("note", dateStr);

      store.toggleHidden(note.id);
      printer(ctx).success(`Toggled hidden flag for note ${dateStr}`);
    },
  });
}

function printNotesTable(ctx: CLIContext, p: Printer, notes: Note[]): void {
  const now = GoTime.now();
  const rows = notes.map((n) => [
    formatNoteTitle(ctx.cfg, n.date, now),
    String(n.entries.length),
    n.hidden ? "yes" : "no",
  ]);
  p.table(["DATE", "ENTRIES", "HIDDEN"], rows);
}

function printEntriesTable(
  ctx: CLIContext,
  p: Printer,
  date: GoTime,
  entries: Entry[],
): void {
  p.line(`${p.bold("Date:")} ${formatDate(ctx.cfg, date)}`);
  p.line();
  if (entries.length === 0) {
    p.line(p.dim("(no entries)"));
    return;
  }
  p.table(
    ["ID", "TIME", "BODY"],
    entries.map((e) => [
      String(e.id),
      formatTime(ctx.cfg, e.createdAt),
      e.body,
    ]),
  );
}
