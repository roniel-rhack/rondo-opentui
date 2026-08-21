import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Command, noArgs } from "../command.ts";
import { printer, type CLIContext } from "../context.ts";
import { skillContent } from "./skill-content.ts";

function skillDir(project: boolean): string {
  if (project) return join(".claude", "skills", "rondo-opentui");
  return join(homedir(), ".claude", "skills", "rondo-opentui");
}

export function skillCmd(ctx: CLIContext): Command {
  const cmd = new Command({
    use: "skill",
    short: "Manage Claude Code skill integration",
  });

  cmd.add(
    new Command({
      use: "install",
      short: "Install rondo skill for Claude Code",
      long: `Install the rondo skill so Claude Code can manage tasks, journal entries,
subtasks, time logs, and focus sessions.

By default installs to ~/.claude/skills/rondo-opentui/ (available in all projects).
Use --project to install to ./.claude/skills/rondo-opentui/ (current project only).`,
      args: noArgs,
      flags: {
        project: {
          type: "bool",
          usage:
            "Install to current project (.claude/skills/) instead of global (~/.claude/skills/)",
        },
      },
      run: (_args, flags) => {
        const dir = skillDir(flags.bool("project"));
        mkdirSync(dir, { recursive: true });
        const path = join(dir, "SKILL.md");
        writeFileSync(path, skillContent, "utf8");
        printer(ctx).success(`Skill installed at ${path}`);
      },
    }),
    new Command({
      use: "uninstall",
      short: "Remove rondo skill from Claude Code",
      args: noArgs,
      flags: {
        project: {
          type: "bool",
          usage:
            "Remove from current project (.claude/skills/) instead of global (~/.claude/skills/)",
        },
      },
      run: (_args, flags) => {
        const dir = skillDir(flags.bool("project"));
        const p = printer(ctx);
        if (!existsSync(dir)) {
          p.success("Skill not installed, nothing to remove");
          return;
        }
        rmSync(dir, { recursive: true, force: true });
        p.success(`Skill removed from ${dir}`);
      },
    }),
  );

  return cmd;
}
