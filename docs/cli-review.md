# CLI review — fitness for AI agents driving it through a skill

Scope: `src/cli/` as of 2026-08-21. Question asked: is the CLI optimized for
AI agents using it via a skill, and does the CLI itself offer a way to
install that skill? Method: full read of the command tree plus empirical
probes against a throwaway `RONDO_HOME`.

> **Resolution status (2026-08-21, same day):** everything below is resolved,
> plus the follow-up request "everything doable from the CLI, all of it in
> the skill":
>
> - **P1**: batch results now carry each command's stdout (`data` parsed for
>   JSON lines, `output` raw otherwise); `done` is idempotent (an
>   already-done task spawns nothing on retry — conscious divergence from
>   Go); due flags accept `today|tomorrow|yesterday|+Nd|+Nw` everywhere
>   (shared `parseDueDateInput` in core, also used by the TUI form);
>   `focus start --task` works alongside `--task-id`.
> - **P2**: mutations answer `--json` (`add`/`edit` → the task, `done` →
>   `[{id,status}]`, `status` → `{id,status}`, `delete` →
>   `{id,deleted,unblocked}`); `version` command and `--version`/`-V` flag;
>   `skill status` reports missing/stale/up-to-date per provider × scope;
>   `--format plain` genuinely renders the tab-aligned table.
> - **P3**: journal misses raise `NotFoundError` (exit 3);
>   `edit --clear-due --due` errors; `focus log` alias added.
> - **CLI parity**: new `block <id> <blocker-id>` / `unblock` commands with
>   cycle detection (the only TUI feature the CLI lacked), and
>   `config set theme dark|light|auto` exposes the TUI theme.
> - **SKILL.md rewritten** from reality: agent guidelines (exit codes,
>   `--force`, `--quiet` ids, idempotent done, date tokens, `RONDO_HOME`
>   sandboxing), the batch result shape, dependencies, meta commands, and
>   every flag verified against the code. 382 tests pass, strict tsc clean.

## Answer first: skill install exists

`rondo-opentui skill install` writes the embedded `SKILL.md` to
`~/.claude/skills/rondo-opentui/`, `--project` targets `./.claude/skills/`,
and `skill uninstall` removes it. **Resolved this session:** `--provider
claude|codex` chooses the agent — Codex installs land in `~/.codex/skills/`
(same Agent Skills layout), unknown providers are rejected, and uninstall
honors the flag. Covered by `tests/cli-skill.test.ts`.

## What already works well for agents

- Errors go to stderr as one actionable line; exit codes are `0` ok, `1`
  error, `3` not found (verified: `show 999` → 3).
- Destructive commands never hang headless: `confirm()` throws
  `stdin is not a TTY: use --force to skip confirmation` (verified, exit 1).
- `--json` on every read (`list`, `show`, `subtask list`, `note list`,
  `timelog list/summary`, `journal list/show`, `focus status/stats`,
  `stats`, `config list`), with snake_case keys matching the Go contract.
- `add --quiet` and `focus start --quiet` print only the new id — perfect
  for capture.
- Color auto-disables when stdout is not a TTY; `edit` only touches flags
  that changed; `list` filtering is rich (status/priority/tag/meta/search/
  due-windows/overdue/limit).
- Batch mode exists for bulk writes without paying process startup per call.

## P1 — breaks an agent

### 1. `batch` swallows every command's output (verified)

`runNested` replaces stdout with a no-op writer (`src/cli/index.ts:100-107`),
so `{"cmd":"list","args":["--json"]}` returns `{"cmd":"list","ok":true}` and
nothing else. Reads inside batch are useless, and a bulk `add` cannot learn
the created ids. **Fix:** capture the nested stdout into the result —
`{"cmd":…,"ok":…,"output":"…"}`, plus `"data": <parsed>` when the line ran
with JSON format. The skill's batch section must document the shape.

### 2. `done` is not idempotent for recurring tasks (verified)

`done <id>` spawns the next occurrence every time it runs
(`src/cli/commands/tasks.ts:177-191`), even when the task is already Done.
Two `done 2` calls on one recurring task left three copies. Agents retry;
retries must be safe. **Fix:** skip both the spawn and the update when the
task is already Done and say "already done" — same guard the TUI got in
v0.2.0. Conscious divergence from the Go build, worth it.

### 3. The installed skill teaches wrong flags (drift)

- `SKILL.md` says `focus start [--task <id>]`; the real flag is `--task-id`.
- Tips claim date fields accept `today`/`yesterday` — true only for journal
  dates; task `--due`, `--due-before`, `--due-after` accept `YYYY-MM-DD`
  only (`parseDueFlag`).

**Fix both ends:** accept `today|tomorrow|yesterday|+Nd|+Nw` in task due
flags (the TUI's `parseDueInput` already exists — share it), add `--task` as
an alias or rename, and regenerate the skill from reality. Drift here is
worse than a missing feature: the agent trusts the skill verbatim.

## P2 — clear improvements

4. **Mutations ignore `--json`.** `add --json` prints the human line;
   an agent must switch to `--quiet` (id only) and lose the rest. Emit a
   JSON object on mutating commands when JSON is requested (`add` → the
   created task, `done`/`status` → `{id, status}`, `delete` → `{id,
   deleted:true}`). At minimum, document the `--quiet` id contract in the
   skill.
5. **No `--version`/`version`** (verified: `unknown flag`). Agents and bug
   reports need it; embed the package version at build time.
6. **No `skill status`.** Add a subcommand that reports, per provider ×
   scope, whether SKILL.md exists and whether it differs from the embedded
   copy (stale after an upgrade → suggest re-install).
7. **Exit codes and `RONDO_HOME` are undocumented in the skill.** Add a
   short "Agent guidelines" section: exit codes, always `--force` on
   deletes, `--quiet` for ids, `RONDO_HOME` for sandboxed testing.
8. **`--format plain` is accidental.** The usage advertises it, but it
   renders as the bordered table on a TTY (only the no-TTY color fallback
   makes it look plain). Make `plain` explicitly select the tab-aligned
   table, or drop it from the usage.

## P3 — polish

9. `journal show <missing-date>` and similar journal misses exit `1`;
   task/subtask misses exit `3`. Align on `NotFoundError` for consistency.
10. `edit --clear-due --due X` silently prefers clear; error out instead.
11. `focus start` records an *already finished* session; alias `focus log`
    says what it does.
12. Shell completion only knows top-level commands — fine, but note it.

## Suggested order

**P1:** batch output capture · idempotent `done` · due-date tokens +
`--task` alias + skill regen.
**P2:** JSON mutations · `version` · `skill status` · skill "Agent
guidelines" · `--format plain`.
**P3:** 9–12.
