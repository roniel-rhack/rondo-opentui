/** Embedded SKILL.md installed by `rondo-opentui skill install`. */
export const skillContent = String.raw`---
name: rondo-opentui
description: Use when managing tasks, journal entries, subtasks, time logs, focus sessions, or tracking work progress. Invoke for any request involving todos, task lists, daily notes, pomodoro, or productivity tracking.
---

# RonDO — Terminal Productivity CLI

Task management, journaling, time tracking, and focus sessions from the
command line. Everything the app can do is available here.

## Agent guidelines

- **Exit codes**: 0 success · 1 error · 3 not found. Errors are one
  actionable line on stderr.
- **Parsing**: add ` + "`--json`" + ` to any command — reads return data,
  mutations return the affected object (` + "`add --json`" + ` → the created
  task with its id).
- **No hangs**: destructive commands never prompt when stdin is not a TTY;
  they fail telling you to pass ` + "`--force`" + `. Always pass ` + "`--force`" + ` (or ` + "`-y`" + `)
  on delete/reset.
- **Ids**: ` + "`add --quiet`" + ` and ` + "`focus start --quiet`" + ` print only the new id.
- **Idempotent done**: ` + "`done`" + ` on an already-done task is a safe no-op
  (recurring tasks never spawn twice on retry).
- **Dates**: every due/date field accepts ` + "`YYYY-MM-DD`" + `, ` + "`today`" + `,
  ` + "`tomorrow`" + `, ` + "`yesterday`" + `, ` + "`+Nd`" + `, ` + "`+Nw`" + `.
- **Sandbox**: set ` + "`RONDO_HOME=/tmp/some-dir`" + ` to run against a throwaway
  database instead of the user's real one.

## Global flags

` + "`--json`" + ` · ` + "`--format table|json|plain`" + ` · ` + "`--quiet`/`-q`" + ` · ` + "`--no-color`" + ` ·
` + "`--version`" + `. Color auto-disables when stdout is not a TTY.

## Tasks

` + "```bash" + `
# Create (prints the task as JSON with --json; just the id with --quiet)
rondo-opentui add "title" [--priority low|medium|high|urgent] [--due <date>] \
  [--tags t1,t2] [--desc "..."] [--meta key=value]... [--blocks 2,3] \
  [--recur daily|weekly|monthly|yearly]

# List with rich filtering
rondo-opentui list [--status pending|active|done|all] [--priority high] \
  [--tag work]... [--meta key=value]... [--sort created|due|priority] \
  [--due-before <date>] [--due-after <date>] [--overdue] [--search text] \
  [--limit N] [--json]

# Read one task (subtasks, notes, time logs, dependencies included)
rondo-opentui show <id> --json

# Update (only the flags you pass change; --meta merges; --blocks replaces)
rondo-opentui edit <id> [--title "..."] [--desc "..."] [--priority ...] \
  [--due <date>] [--clear-due] [--tags ...] [--meta key=value]... \
  [--blocks 1,2] [--clear-blocks] [--recur none|daily|weekly|monthly|yearly]

# Complete (multiple ids; recurring tasks spawn their next occurrence once)
rondo-opentui done <id> [<id2> ...]

# Set or cycle status
rondo-opentui status <id> [pending|active|done]

# Delete (--cascade required if it blocks others; unblocks them)
rondo-opentui delete <id> --force [--cascade]
` + "```" + `

## Dependencies

` + "```bash" + `
rondo-opentui block <task-id> <blocker-id>     # task waits on blocker; cycles rejected
rondo-opentui unblock <task-id> <blocker-id>
` + "```" + `

` + "`show --json`" + ` exposes ` + "`blocked_by`" + `/` + "`blocks`" + ` plus resolved
` + "`*_detail`" + ` entries with each referenced task's title and status.

## Subtasks

` + "```bash" + `
rondo-opentui subtask add <task-id> "title"
rondo-opentui subtask list <task-id> --json
rondo-opentui subtask done <task-id> <subtask-id>      # toggles completion
rondo-opentui subtask edit <task-id> <subtask-id> "new title"
rondo-opentui subtask delete <task-id> <subtask-id> --force
` + "```" + `

## Task notes

` + "```bash" + `
rondo-opentui note add <task-id> "note body"
rondo-opentui note list <task-id> --json
rondo-opentui note edit <task-id> <note-id> "new body"
rondo-opentui note delete <task-id> <note-id> --force
` + "```" + `

## Time logging

` + "```bash" + `
rondo-opentui timelog add <task-id> <duration> [--note "what I did"]  # 1h30m, 45m, 2h
rondo-opentui timelog list <task-id> --json
rondo-opentui timelog summary [--days 7] --json
` + "```" + `

## Recurrence

` + "```bash" + `
rondo-opentui recur set <id> daily|weekly|monthly|yearly
rondo-opentui recur clear <id>
` + "```" + `

## Journal

` + "```bash" + `
rondo-opentui journal "entry text"                 # shorthand: add to today
rondo-opentui journal add "entry text" [--date <date>]
rondo-opentui journal list [--date <date>] [--hidden] --json
rondo-opentui journal show [today|yesterday|YYYY-MM-DD] --json
rondo-opentui journal edit <entry-id> "new text"
rondo-opentui journal delete <entry-id> --force
rondo-opentui journal hide <date>                  # toggles note visibility
` + "```" + `

## Focus / Pomodoro

` + "```bash" + `
# Record a finished session ("log" is an alias that says what it does)
rondo-opentui focus start [--task <id>] [--duration 25m]
rondo-opentui focus log --task <id>

rondo-opentui focus status --json      # today's count, goal, streak
rondo-opentui focus stats [--days 7] --json
` + "```" + `

## Stats & export

` + "```bash" + `
rondo-opentui stats --json
rondo-opentui export [--format md|json] [--output file.md] [--journal]
` + "```" + `

## Batch mode

One JSON object per stdin line; the result carries each command's output:

` + "```bash" + `
echo '{"cmd":"add","args":["Deploy fix","--priority","urgent","--json"]}
{"cmd":"list","args":["--status","active","--json"]}' | rondo-opentui batch
` + "```" + `

Returns a JSON array. Lines run with ` + "`--json`" + ` come back parsed under
` + "`data`" + `; other output arrives as a raw ` + "`output`" + ` string:
` + "`[{\"cmd\":\"add\",\"ok\":true,\"data\":{...}}, {\"cmd\":\"list\",\"ok\":true,\"data\":[...]}]`" + `.
Failures are ` + "`{\"cmd\":…,\"ok\":false,\"error\":\"…\"}`" + `; batch cannot nest.

## Config

` + "```bash" + `
rondo-opentui config list --json
rondo-opentui config get <key>
rondo-opentui config set <key> <value>   # keys include theme (dark|light|auto),
                                         # panel_ratio, date_format, focus.*
rondo-opentui config reset --force
` + "```" + `

## Skill & meta

` + "```bash" + `
rondo-opentui skill install [--provider claude|codex] [--project]
rondo-opentui skill status                # per provider/scope: missing, stale, up to date
rondo-opentui skill uninstall [--provider claude|codex] [--project]
rondo-opentui version
rondo-opentui completion bash|zsh|fish
` + "```" + `

After upgrading the binary, run ` + "`skill status`" + ` — a stale skill should be
reinstalled with ` + "`skill install`" + `.

## Tips

- Tag filters OR together (` + "`--tag a --tag b`" + ` matches either); meta filters
  AND together (` + "`--meta a=1 --meta b=2`" + ` matches both).
- ` + "`edit --blocks`" + ` replaces the whole list; use ` + "`block`/`unblock`" + ` for
  incremental changes.
- Deleting a task that blocks others requires ` + "`--cascade`" + `.
- ` + "`export`" + ` writes Markdown or JSON to stdout unless ` + "`--output`" + ` is given;
  ` + "`--journal`" + ` includes the journal.
`;
