import pkg from "../../package.json";
import { setColorEnabled } from "../core/ui/ansi.ts";
import { Command, execute, type Flags } from "./command.ts";
import { configCmd } from "./commands/config-cmd.ts";
import { journalCmd } from "./commands/journal.ts";
import {
  batchCmd,
  completionCmd,
  exportCmd,
  focusCmd,
  recurCmd,
  statsCmd,
  versionCmd,
  type NestedRun,
} from "./commands/misc.ts";
import { noteCmd } from "./commands/note.ts";
import { skillCmd } from "./commands/skill.ts";
import { subtaskCmd } from "./commands/subtasks.ts";
import {
  addCmd,
  blockCmd,
  deleteCmd,
  doneCmd,
  editCmd,
  listCmd,
  showCmd,
  statusCmd,
  unblockCmd,
} from "./commands/tasks.ts";
import { timelogCmd } from "./commands/timelog.ts";
import { newContext, type CLIContext } from "./context.ts";
import { BufferWriter } from "./writer.ts";

export { newContext } from "./context.ts";
export type { CLIContext } from "./context.ts";

/** Builds the root command tree, wired to the given context. */
export function buildRoot(ctx: CLIContext): Command {
  const root = new Command({
    use: "rondo-opentui",
    short: "RonDO — terminal productivity app",
    persistentFlags: {
      format: {
        type: "string",
        default: "table",
        usage: "Output format: table, json, plain",
      },
      quiet: {
        type: "bool",
        shorthand: "q",
        usage: "Suppress non-essential output",
      },
      "no-color": { type: "bool", usage: "Disable ANSI color output" },
      json: { type: "bool", usage: "Shorthand for --format json" },
    },
    persistentPreRun: (flags: Flags) => {
      if (flags.bool("json")) {
        if (flags.changed("format")) {
          throw new Error("--json and --format cannot be used together");
        }
        ctx.format = "json";
      } else if (flags.changed("format")) {
        ctx.format = flags.string("format");
      }
      if (flags.changed("quiet")) ctx.quiet = flags.bool("quiet");
      if (flags.changed("no-color")) {
        ctx.noColor = flags.bool("no-color");
      } else if (!ctx.stdout.isTTY) {
        // Auto-disable color when stdout is not a terminal.
        ctx.noColor = true;
      }
      setColorEnabled(!ctx.noColor);
    },
    run: () => {
      throw new Error(
        "no subcommand provided. Run 'rondo-opentui --help' for usage",
      );
    },
  });

  root.add(
    addCmd(ctx),
    doneCmd(ctx),
    listCmd(ctx),
    showCmd(ctx),
    editCmd(ctx),
    deleteCmd(ctx),
    statusCmd(ctx),
    blockCmd(ctx),
    unblockCmd(ctx),
    journalCmd(ctx),
    exportCmd(ctx),
    subtaskCmd(ctx),
    timelogCmd(ctx),
    recurCmd(ctx),
    configCmd(ctx),
    statsCmd(ctx),
    focusCmd(ctx),
    noteCmd(ctx),
    batchCmd(ctx, (argv) => runNested(ctx, argv)),
    completionCmd(ctx),
    skillCmd(ctx),
    versionCmd(ctx, pkg.version),
  );

  return root;
}

/** Runs a single command inside `batch`, capturing its stdout so the batch
 * result can carry each command's output back to the caller. */
function runNested(ctx: CLIContext, argv: string[]): NestedRun {
  const out = new BufferWriter();
  const nested: CLIContext = {
    ...ctx,
    stdout: out,
    stderr: { write: () => {}, isTTY: false },
    format: "table",
    quiet: false,
    noColor: true,
  };
  execute(buildRoot(nested), argv);
  return { output: out.toString(), json: nested.format.toLowerCase() === "json" };
}

/** CLI entry point. Throws on any command error. */
export function runCLI(argv: string[], ctx: CLIContext = newContext()): void {
  if (argv.length === 0) {
    throw new Error("no subcommand provided. Run 'rondo-opentui --help' for usage");
  }

  const root = buildRoot(ctx);

  if (argv.includes("--version") || argv.includes("-V")) {
    runCLI(["version"], ctx);
    return;
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    const helpArgs = argv.filter((a) => a !== "--help" && a !== "-h");
    let cmd: Command = root;
    for (const arg of helpArgs) {
      const sub = cmd.find(arg);
      if (!sub) break;
      cmd = sub;
    }
    ctx.stdout.write(cmd.helpText());
    return;
  }

  execute(root, argv);
}
