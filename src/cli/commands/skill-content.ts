/** Embedded SKILL.md installed by `rondo-opentui skill install`. */
export const skillContent = String.raw`---
name: rondo-opentui
description: Use when managing tasks, journal entries, subtasks, time logs, focus sessions, or tracking work progress. Invoke for any request involving todos, task lists, daily notes, pomodoro, or productivity tracking.
---

# RonDO — Terminal Productivity CLI

Task management, journaling, time tracking, and focus sessions from the command line.
Always use ` + "`--json`" + ` when you need to parse output programmatically.

## Global Flags

All commands support: ` + "`--json`" + `, ` + "`--format table|json`" + `, ` + "`--quiet` / `-q`" + `, ` + "`--no-color`" + `

## Tasks

` + "```bash" + `
# Add a task
rondo-opentui add "title" [--priority low|medium|high|urgent] [--due YYYY-MM-DD] \
  [--tags t1,t2] [--desc "..."] [--meta key=value] [--blocks 2,3] [--recur daily|weekly|monthly|yearly]

# List tasks (supports rich filtering)
rondo-opentui list [--status pending|active|done|all] [--priority high] [--tag work] \
  [--meta key=value] [--sort created|due|priority] [--due-before YYYY-MM-DD] \
  [--due-after YYYY-MM-DD] [--overdue] [--search text] [--limit N] [--json]

# Show task details
rondo-opentui show <id> [--json]

# Edit task (only specified flags are updated)
rondo-opentui edit <id> [--title "..."] [--desc "..."] [--priority ...] [--due ...] \
  [--tags ...] [--meta key=value] [--blocks 1,2] [--clear-blocks] [--clear-due] [--recur ...]

# Mark done (supports multiple IDs; spawns next for recurring tasks)
rondo-opentui done <id> [<id2> ...]

# Delete task (--cascade if it blocks others, --force/-y to skip confirm)
rondo-opentui delete <id> [--force] [--cascade]

# Set or cycle status
rondo-opentui status <id> [pending|active|done]
` + "```" + `

## Subtasks

` + "```bash" + `
rondo-opentui subtask add <task-id> "title"
rondo-opentui subtask list <task-id> [--json]
rondo-opentui subtask done <task-id> <subtask-id>      # toggles completion
rondo-opentui subtask edit <task-id> <subtask-id> "new title"
rondo-opentui subtask delete <task-id> <subtask-id> [--force]
` + "```" + `

## Task Notes

` + "```bash" + `
rondo-opentui note add <task-id> "note body"
rondo-opentui note list <task-id> [--json]
rondo-opentui note edit <task-id> <note-id> "new body"
rondo-opentui note delete <task-id> <note-id> [--force]
` + "```" + `

## Time Logging

` + "```bash" + `
# Duration format: 1h30m, 45m, 2h
rondo-opentui timelog add <task-id> <duration> [--note "what I did"]
rondo-opentui timelog list <task-id> [--json]
rondo-opentui timelog summary [--days 7] [--json]
` + "```" + `

## Recurrence

` + "```bash" + `
rondo-opentui recur set <id> daily|weekly|monthly|yearly
rondo-opentui recur clear <id>
` + "```" + `

## Journal

` + "```bash" + `
# Quick add to today (shorthand)
rondo-opentui journal "entry text"

# Add with date control
rondo-opentui journal add "entry text" [--date today|yesterday|YYYY-MM-DD]

# List notes
rondo-opentui journal list [--date YYYY-MM-DD] [--hidden] [--json]

# Show entries for a date (default: today)
rondo-opentui journal show [today|yesterday|YYYY-MM-DD] [--json]

# Edit / delete entries
rondo-opentui journal edit <entry-id> "new text"
rondo-opentui journal delete <entry-id> [--force]

# Toggle note visibility
rondo-opentui journal hide <date>
` + "```" + `

## Focus / Pomodoro

` + "```bash" + `
# Record a completed focus session
rondo-opentui focus start [--task <id>] [--duration 25m]

# Today's progress
rondo-opentui focus status [--json]

# Historical stats
rondo-opentui focus stats [--days 7] [--json]
` + "```" + `

## Stats & Export

` + "```bash" + `
rondo-opentui stats [--json]
rondo-opentui export [--format md|json] [--output file.md] [--journal]
` + "```" + `

## Batch Mode

Send multiple commands via stdin as newline-delimited JSON:

` + "```bash" + `
echo '{"cmd":"add","args":["Deploy fix","--priority","urgent"]}
{"cmd":"list","args":["--status","active","--json"]}' | rondo-opentui batch
` + "```" + `

Returns JSON array: ` + "`[{\"cmd\":\"add\",\"ok\":true}, ...]`" + `

## Config

` + "```bash" + `
rondo-opentui config list [--json]
rondo-opentui config get <key>
rondo-opentui config set <key> <value>
rondo-opentui config reset [--force]
` + "```" + `

## Shell Completions

` + "```bash" + `
rondo-opentui completion bash|zsh|fish
` + "```" + `

## Tips

- Use ` + "`--json`" + ` to get structured output for parsing
- Use ` + "`--quiet`" + ` to suppress success messages
- Date fields accept: YYYY-MM-DD, "today", "yesterday"
- Metadata filters use AND logic: ` + "`--meta a=1 --meta b=2`" + ` matches both
- Tag filters use OR logic: ` + "`--tag a --tag b`" + ` matches either
- Delete guard: tasks blocking others need ` + "`--cascade`" + ` to delete
- Recurring tasks auto-spawn next occurrence on ` + "`done`" + `
`;
