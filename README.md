# RonDO · OpenTUI + React

Terminal productivity app — tasks, journal and pomodoro — rebuilt on
[OpenTUI](https://github.com/anomalyco/opentui) + React + Bun, ported from the
original Go/Bubbletea implementation.

Same data, same CLI, new interface: real mouse support, layered overlays,
flexbox layout, a command palette and live filtering.

```
 ◆ RonDO   ▤ All 14  ◐ Active 12  ✓ Done 2  ✎ Journal 1                                   12:16
╭─ ● Tasks ────────────────────────────────────╮ ╭─ Details ───────────────────────────────────╮
│┃ ○ Plan Q3 roadmap                           │ │ ○ Plan Q3 roadmap                           │
│┃     Aug 23             #planning            │ │                                             │
││ ○ Ship v2 release                     HIGH  │ │  Pending   Medium                           │
││   • Aug 21   ●●●● 3/3  #release             │ │                                             │
│  ✓ Update dependencies                       │ │ Due        Aug 23, 2026  SOON               │
││ ○ Migrate database to PostgreSQL      HIGH  │ │ Tags       #planning                        │
││   ! Mar 16   ○○○○ 0/5  #database #infrast…  │ │                                             │
││ ◐ Fix login timeout bug               URG!  │ │ SUBTASKS                                    │
││   ! Feb 23   ●●○○ 2/4  #bug #auth +1        │ │ ████░░░░░░░░░░░░  1/4                       │
╰─ 14 tasks ───────────────────────────────────╯ ╰─ #14 · updated Aug 21, 2026 12:16 PM ───────╯
  a add  e edit  space status  t subtask  / filter  f focus  ^k palette  ? help     ⇅ Created
```

## Install

```bash
brew install roniel-rhack/tap/rondo-opentui
```

Or grab a binary from the [releases page](https://github.com/roniel-rhack/rondo-opentui/releases)
(macOS arm64/x64, Linux arm64/x64) — it is a single self-contained file:

```bash
tar xzf rondo-opentui-darwin-arm64.tar.gz
./rondo-opentui
```

The binary is called `rondo-opentui` so it can live next to the Go build. Alias
it if you prefer the short name:

```bash
alias rondo=rondo-opentui
```

## Develop

Requires [Bun](https://bun.sh) ≥ 1.4.

```bash
bun install

bun run start          # launch the TUI
bun run dev            # TUI with hot reload
bun run start list     # any argument dispatches to the CLI instead
bun run test           # 301 tests
bun run typecheck      # tsc --noEmit
bun run build          # single binary at dist/rondo-opentui
```

Data lives in `~/.todo-app/todo.db` (shared with the Go build). Set
`RONDO_HOME` to use a different directory — useful for throwaway profiles:

```bash
RONDO_HOME=/tmp/rondo-demo bun run start
```

## TUI

Everything is reachable with both keyboard and mouse.

| Key | Action |
|-----|--------|
| `j` / `k`, `↑` / `↓` | Move selection |
| `h` / `l`, `1` / `2` | Switch panel |
| `tab` / `shift+tab` | Switch view (All / Active / Done / Journal) |
| `a` / `e` / `d` | Add / edit / delete |
| `space`, `s` | Cycle task status (or toggle a subtask) |
| `t` / `n` / `L` | Add subtask / note / time log |
| `/` | Live filter (fuzzy) |
| `#` | Tag filter bar |
| `o` | Cycle sort order |
| `f` | Start / stop the pomodoro timer |
| `u` | Undo the last delete |
| `S` / `?` | Statistics / help |
| `T` | Toggle light / dark |
| `ctrl+k` | Command palette |
| `P` | Focus (pomodoro) settings |
| `<` / `>`, drag | Resize the panels |
| `F1` / `F2` / `F3` | Sort by created / due / priority |
| `q`, `ctrl+c` | Quit |

Inside dialogs: `tab` / `shift+tab` move between fields, `←` / `→` pick a
segmented option, `ctrl+s` saves (multiline fields keep `enter` for new lines),
`esc` cancels.

Mouse: click tabs and rows, click a status glyph or subtask to toggle it, drag
the divider to resize the panels, scroll with the wheel.

### Design

- **One palette, semantic tokens.** Every component reads colors from
  `src/tui/theme.ts` (surfaces, borders, accent, semantic states), so light and
  dark stay consistent and a re-theme is a single file.
- **Density with hierarchy.** A priority rail runs down both lines of a row so
  it reads as one block and doubles as the selection cursor. The second line is
  a fixed grid — due date, four-dot progress, tags — so the eye scans columns
  instead of ragged text. Completed tasks collapse to a single muted line.
- **Calm color.** Overdue rows carry a compact `!` marker in a softened red;
  the loud `OVERDUE` badge is reserved for the detail panel. Tags are capped at
  two plus a `+n` counter, so no row ever wraps.
- **Motion where it means something.** Meters ease towards their new value,
  overlays fade their backdrop in, and toasts carry a hairline timer that drains
  as they expire — the status bar keeps a reserved row so nothing jumps.
- **Real inputs.** Titles use a single-line input, descriptions and journal
  entries a true multiline textarea, priority and recurrence a clickable
  segmented control, due dates a text field plus `today / tomorrow / +1w / none`
  shortcuts.
- **Feedback everywhere.** Hover states on rows, tabs, chips, palette entries
  and buttons; focused panels get an accent border and a `●` marker; the filter
  bar shows `matches/total` and turns red when nothing matches.

### What changed versus the Go TUI

| Go (Bubbletea) | This port |
|---|---|
| Manual width/height arithmetic | Yoga flexbox layout |
| Panel borders drawn character by character | `<box border>` with title/subtitle |
| Dialogs replaced the whole screen | Real overlays with a fading backdrop |
| Single-line inputs everywhere | Textarea for prose, segmented controls, date shortcuts |
| No mouse | Click, hover, drag-to-resize, wheel scroll |
| Filtering through the list widget | Live fuzzy filter with match count |
| Static rendering | Eased meters, fading overlays, draining toast timer |
| — | Command palette (`ctrl+k`) over every action |
| — | Responsive single-column layout on narrow terminals |
| — | Runtime light/dark switch |

## CLI

The CLI is a faithful port — same commands, flags, exit codes and JSON shapes.

```bash
rondo-opentui add "Write the report" --priority high --due 2026-03-15 --tags work
rondo-opentui list --status active --sort priority --json
rondo-opentui show 1
rondo-opentui edit 1 --title "New title" --clear-due
rondo-opentui done 1 2
rondo-opentui delete 3 --force --cascade
rondo-opentui status 1 active

rondo-opentui subtask add 1 "Collect numbers"
rondo-opentui note add 1 "Talked to design"
rondo-opentui timelog add 1 1h30m --note "deep work"
rondo-opentui recur set 1 weekly

rondo-opentui journal "Shipped the port"
rondo-opentui journal list --json
rondo-opentui journal show yesterday

rondo-opentui focus start --duration 25m
rondo-opentui stats --json
rondo-opentui export --format md --journal --output report.md
rondo-opentui config set date_format european
echo '{"cmd":"add","args":["From batch"]}' | rondo-opentui batch
rondo-opentui completion zsh
rondo-opentui skill install
```

Global flags: `--json`, `--format table|json`, `--quiet`/`-q`, `--no-color`.
Color is disabled automatically when stdout is not a terminal.

## Layout

```
src/
  core/           # Domain + persistence, no UI dependencies
    time.ts       # Go-compatible time layouts, AddDate, RFC3339
    duration.ts   # Nanosecond durations, Go duration parsing
    task/         # Model, recurrence, time logs, dependencies, SQLite store
    journal/      # Notes and entries
    focus/        # Pomodoro sessions, streaks
    config/       # ~/.todo-app/config.json, format presets
    database/     # Connection + daily VACUUM INTO backups
    export/       # Markdown and JSON exporters
    ui/           # Palette, markdown renderer, sparklines, due dates
  cli/            # Cobra-style command tree, printer, commands
  tui/            # OpenTUI + React interface
    app.tsx       # State, keyboard routing, layout
    state.ts      # Pure selectors: filtering, sorting, fuzzy matching
    data.ts       # Store facade used by the UI
    components/   # Header, lists, detail, overlays, forms, dialogs
tests/            # bun:test — core, CLI and live TUI rendering
```

## Releases

Tagging `vX.Y.Z` builds standalone binaries for macOS (arm64/x64) and Linux
(arm64/x64) on native runners, publishes them with checksums, and asks the
Homebrew tap to refresh its formula.

```bash
git tag v0.1.0 && git push origin v0.1.0
```

## Tests

```bash
bun test
```

Covers the ported Go suites (task store, dependencies, recurrence, time logs,
focus, config, backups, export, UI helpers, CLI unit + integration) plus new
ones for the time engine, the journal store, TUI selectors and the TUI itself —
rendered through OpenTUI's test renderer with simulated keyboard and mouse input.
