# RonDO · OpenTUI + React

Terminal productivity app — tasks, journal and pomodoro — rebuilt on
[OpenTUI](https://github.com/anomalyco/opentui) + React + Bun, ported from the
original Go/Bubbletea implementation.

Same data, same CLI, new interface: real mouse support, layered overlays,
flexbox layout, a command palette and live filtering.

<p align="center">
  <img src="assets/demo.gif" width="820" alt="RonDO demo: filtering, the task form, the command palette and the journal">
</p>

<p align="center">
  <img src="assets/tasks.png" width="820" alt="Task list and detail panel">
</p>
<p align="center"><em>Metadata grid per row, subtask meters, notes and time logs in the detail panel</em></p>

<p align="center">
  <img src="assets/journal.png" width="820" alt="Journal view">
</p>
<p align="center"><em>One note per day, timestamped entries, smart date labels</em></p>


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

Everything is reachable with both keyboard and mouse; `?` opens the same
key map in-app.

**Global**

| Key | Action |
|-----|--------|
| `?` | This help |
| `ctrl+k` | Command palette (tasks and actions, fuzzy) |
| `1` `2` `3` `4` | Active / Done / All / Journal |
| `u` | Undo (status, edit, delete — everything is undoable) |
| `R` | Reload from disk (also polled automatically) |
| `T` | Light / dark theme |
| `P` | Focus (pomodoro) settings |
| `S` | Statistics |
| `f` | Start / stop focus |
| `z` | Density (auto / dense / comfortable) |
| `<` `>`, drag | Resize panels |
| `q`, `ctrl+c` | Quit (asks while focus runs) |

**Navigation**

| Key | Action |
|-----|--------|
| `j` `k` `↑` `↓` | Move selection |
| `g` `G`, `Home` `End` | First / last |
| `PgUp` `PgDn`, `ctrl+u` `ctrl+d` | Page up / down |
| `h` `l` `←` `→` | Switch panel |
| `enter` | Open detail / edit the row under the cursor |
| `esc` | Back out one step: marks, detail, query + tag, view |

**Tasks**

| Key | Action |
|-----|--------|
| `a` / `e` | Add / edit (quick-add tokens work in the title, see below) |
| `space` | Mark done / reopen |
| `s` | Start / stop |
| `d` | Delete — undo with `u` (confirms only if it blocks another task) |
| `+` `-` | Priority up / down |
| `@` | Due date (`t` `m` `w` `n` chips, or a typed date) |
| `#` | Tag picker |
| `t` `n` `L` | Add subtask / note / time log |
| `b` `B` | Block on… / remove blocker… |
| `m` | Mark for a bulk action, then `space`/`+`/`-`/`@`/`d` apply to all |
| `o`, `F1` `F2` `F3` | Cycle sort / by created / due / priority |
| `v` | Cycle view: all → today → overdue → week → blocked |
| `/` | Filter: free text, `#tag`, `!high`, `due:today`, `is:blocked` |

**Detail panel**

| Key | Action |
|-----|--------|
| `space` | Toggle subtask |
| `enter`, `e` | Edit the subtask, note or log under the cursor |
| `d` | Delete row |
| `t` `n` `L` | Add subtask / note / log |
| `h`, `esc` | Back to list |

**Journal**

| Key | Action |
|-----|--------|
| `a` | Add entry to today |
| `A` | Add entry to the selected day |
| `e` / `d` | Edit / delete the selected entry |
| `x` / `H` | Hide a note / show hidden notes |
| `/` | Search entries |

Quick-add tokens work in the title field of `a`/`e` — `#tag` (repeatable),
`@today` / `@tomorrow` / `@+3d` / `@2026-09-01`, `!low` / `!med` / `!high` /
`!urgent`, `~d` / `~w` / `~m` / `~y` for recurrence — stripped from the
stored title and previewed live as you type.

Inside dialogs: `tab` / `shift+tab` move between fields, `←` / `→` pick a
segmented option, `ctrl+s` saves (multiline fields keep `enter` for new
lines), `esc` cancels.

Mouse: click tabs, rows, tags and status glyphs, drag the divider to resize
the panels, scroll with the wheel.

### Session and live data

The TUI remembers the tab, sort order, tag filter, view and selected row
across restarts in `~/.todo-app/tui-state.json` — a TS-only file kept
separate from `config.json` so the Go build never sees or drops it. It also
polls the database for changes made from another terminal — the CLI, the
agent skill, or a second `rondo-opentui` — and reloads with a toast when
something else committed; `R` reloads on demand.

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
| — | Command palette (`ctrl+k`) over every action, tasks included |
| — | Responsive single-column layout on narrow terminals |
| — | Runtime light/dark switch |
| One-shot status cycling, deletes need a confirm | Every edit and delete is one key, undoable with `u` |
| Sort only | Views (today / overdue / week / blocked), tag picker, marks for bulk edits |
| Nothing survives a restart | Tab, sort, tag, view and selection restored from `tui-state.json` |
| Reads the database once | Polls for changes made by the CLI or another session and reloads |

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

## Demo

The recording is generated with [VHS](https://github.com/charmbracelet/vhs) from
a seeded throwaway profile, so it never touches your own database:

```bash
bun run build
PATH="$PWD/dist:$PATH" vhs assets/demo.tape
```

`scripts/demo-seed.sh` fills `$RONDO_HOME` with sample tasks, subtasks, notes,
time logs and journal entries, with due dates relative to today.

## Releases

Tagging `vX.Y.Z` builds standalone binaries for macOS (arm64/x64) and Linux
(arm64/x64) on native runners, publishes them with `checksums-sha256.txt`, and
asks [roniel-rhack/homebrew-tap](https://github.com/roniel-rhack/homebrew-tap)
to refresh `Formula/rondo-opentui.rb`.

```bash
git tag v0.1.0 && git push origin v0.1.0
```

The tap update needs a `HOMEBREW_TAP_TOKEN` repository secret with `repo`
scope on the tap. Without it the release still publishes and the formula can be
refreshed by hand:

```bash
gh workflow run update-rondo-opentui.yml -R roniel-rhack/homebrew-tap -f version=0.1.0
```

## Tests

```bash
bun test
```

Covers the ported Go suites (task store, dependencies, recurrence, time logs,
focus, config, backups, export, UI helpers, CLI unit + integration) plus new
ones for the time engine, the journal store, TUI selectors and the TUI itself —
rendered through OpenTUI's test renderer with simulated keyboard and mouse input.
