import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Command, noArgs } from "../command.ts";
import { isJSON, printer, type CLIContext } from "../context.ts";
import { skillContent } from "./skill-content.ts";

type Provider = "claude" | "codex";

function parseProvider(raw: string): Provider {
  const s = raw.toLowerCase();
  if (s === "" || s === "claude") return "claude";
  if (s === "codex") return "codex";
  throw new Error(`invalid provider "${raw}": must be claude or codex`);
}

/** POSIX convention: $HOME wins over the resolved home directory. Bun's
 * homedir() ignores a runtime override, which tests rely on. */
function homeDir(): string {
  return process.env.HOME && process.env.HOME !== ""
    ? process.env.HOME
    : homedir();
}

/** Claude Code reads ~/.claude/skills; Codex reads the agent-agnostic
 * .agents/skills tree (repo, home, /etc/codex) — not ~/.codex, which only
 * holds its config. Layout is the same either way: <base>/skills/<name>/. */
function skillDir(provider: Provider, project: boolean): string {
  const base = provider === "codex" ? ".agents" : ".claude";
  if (project) return join(base, "skills", "rondo-opentui");
  return join(homeDir(), base, "skills", "rondo-opentui");
}

const providerFlag = {
  type: "string" as const,
  default: "claude",
  usage: "Agent provider: claude (Claude Code) or codex (OpenAI Codex)",
};

export function skillCmd(ctx: CLIContext): Command {
  const cmd = new Command({
    use: "skill",
    short: "Manage Claude Code skill integration",
  });

  cmd.add(
    new Command({
      use: "install",
      short: "Install the rondo skill for an AI agent",
      long: `Install the rondo skill so an AI coding agent can manage tasks, journal
entries, subtasks, time logs, and focus sessions through this CLI.

By default installs globally for Claude Code (~/.claude/skills/rondo-opentui/).
Use --provider codex for OpenAI Codex (~/.agents/skills/, the open Agent
Skills location Codex reads) and --project to install into the current
project instead of the home directory.`,
      args: noArgs,
      flags: {
        project: {
          type: "bool",
          usage:
            "Install to the current project (./<base>/skills/) instead of the home directory",
        },
        provider: providerFlag,
      },
      run: (_args, flags) => {
        const provider = parseProvider(flags.string("provider"));
        const dir = skillDir(provider, flags.bool("project"));
        mkdirSync(dir, { recursive: true });
        const path = join(dir, "SKILL.md");
        writeFileSync(path, skillContent, "utf8");
        printer(ctx).success(`Skill installed at ${path}`);
      },
    }),
    new Command({
      use: "uninstall",
      short: "Remove the rondo skill",
      args: noArgs,
      flags: {
        project: {
          type: "bool",
          usage:
            "Remove from the current project (./<base>/skills/) instead of the home directory",
        },
        provider: providerFlag,
      },
      run: (_args, flags) => {
        const provider = parseProvider(flags.string("provider"));
        const dir = skillDir(provider, flags.bool("project"));
        const p = printer(ctx);
        if (!existsSync(dir)) {
          p.success("Skill not installed, nothing to remove");
          return;
        }
        rmSync(dir, { recursive: true, force: true });
        p.success(`Skill removed from ${dir}`);
      },
    }),
    new Command({
      use: "status",
      short: "Show where the skill is installed and whether it is current",
      args: noArgs,
      run: () => {
        const rows: {
          provider: Provider;
          scope: "global" | "project";
          path: string;
          installed: boolean;
          current: boolean;
        }[] = [];

        for (const provider of ["claude", "codex"] as const) {
          for (const project of [false, true]) {
            const path = join(skillDir(provider, project), "SKILL.md");
            const installed = existsSync(path);
            const current =
              installed && readFileSync(path, "utf8") === skillContent;
            rows.push({
              provider,
              scope: project ? "project" : "global",
              path,
              installed,
              current,
            });
          }
        }

        const p = printer(ctx);
        if (isJSON(ctx)) {
          p.json(rows);
          return;
        }
        for (const row of rows) {
          const state = !row.installed
            ? "not installed"
            : row.current
              ? "up to date"
              : "stale — run 'skill install' again";
          p.line(
            `${row.provider.padEnd(7)} ${row.scope.padEnd(8)} ${state.padEnd(36)} ${row.path}`,
          );
        }
      },
    }),
  );

  return cmd;
}
