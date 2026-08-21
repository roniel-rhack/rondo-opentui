import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newTestCLI } from "./cli.test.ts";

let home: string;
let previousHome: string | undefined;

beforeEach(() => {
  previousHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), "rondo-skill-"));
  process.env.HOME = home;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

describe("skill install providers", () => {
  test("installs for Claude Code by default", () => {
    const cli = newTestCLI();
    cli.run(["skill", "install"]);

    const path = join(home, ".claude", "skills", "rondo-opentui", "SKILL.md");
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toContain("rondo-opentui");
    expect(cli.output()).toContain(path);
  });

  test("installs for Codex into the .agents skills directory", () => {
    const cli = newTestCLI();
    cli.run(["skill", "install", "--provider", "codex"]);

    // Codex reads skills from .agents/skills (repo, ~, /etc/codex), not
    // from ~/.codex — see developers.openai.com/codex/skills.
    const path = join(home, ".agents", "skills", "rondo-opentui", "SKILL.md");
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toContain("rondo-opentui");
  });

  test("rejects an unknown provider", () => {
    const cli = newTestCLI();
    expect(() =>
      cli.run(["skill", "install", "--provider", "cursor"]),
    ).toThrow(/invalid provider/);
  });

  test("uninstall honors the provider", () => {
    const cli = newTestCLI();
    cli.run(["skill", "install", "--provider", "codex"]);
    cli.run(["skill", "uninstall", "--provider", "codex"]);

    expect(
      existsSync(join(home, ".agents", "skills", "rondo-opentui")),
    ).toBe(false);
  });
});

describe("skill status", () => {
  test("reports missing, current and stale installs", () => {
    const cli = newTestCLI();
    cli.run(["skill", "status"]);
    expect(cli.output()).toContain("not installed");

    cli.run(["skill", "install"]);
    const cli2 = newTestCLI();
    cli2.run(["skill", "status"]);
    expect(cli2.output()).toContain("up to date");

    const path = join(home, ".claude", "skills", "rondo-opentui", "SKILL.md");
    require("node:fs").writeFileSync(path, "old content", "utf8");
    const cli3 = newTestCLI();
    cli3.run(["skill", "status"]);
    expect(cli3.output()).toContain("stale");
  });
});
