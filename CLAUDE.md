# RonDO (OpenTUI) — project guide

Terminal task manager + journal + pomodoro. TypeScript on Bun, CLI and TUI in
one binary. Port of [rondo](https://github.com/roniel-rhack/rondo) (Go +
Bubbletea), keeping its database, config and CLI contract.

## Commands

```bash
bun install
bun run start          # TUI
bun run start list     # any argument dispatches to the CLI instead
bun run dev            # TUI with --watch
bun test               # ~1 min; bun test tests/tui-state.test.ts for one file
bun run typecheck      # tsc --noEmit
bun run build          # dist/rondo-opentui (single binary, ad-hoc signed)
```

Always run `bun test` **and** `bun run typecheck` before claiming a change
works. `tsc --noEmit --noUnusedLocals` is also clean — keep it that way.

Never point the app at the real database while testing. Set `RONDO_HOME` to a
throwaway directory:

```bash
RONDO_HOME=$(mktemp -d) bun run start add "scratch"
```

## Layout

```
src/
  core/            Domain + persistence. No UI imports, ever.
    time.ts        GoTime: Go layouts ("Jan 02, 2006"), AddDate overflow, RFC3339
    duration.ts    Durations in nanoseconds, Go duration parsing
    task/          task.ts · recur.ts · timelog.ts · deps.ts · store.ts
    journal/       journal.ts · store.ts
    focus/         focus.ts · store.ts (pomodoro sessions, streaks)
    config/        ~/.todo-app/config.json, format presets, validation
                   tui-state.ts: the saved TUI session (tab, sort, view, tag,
                   selection, density)
    database/      db.ts (bun:sqlite) · backup.ts (VACUUM INTO + pruning)
    export/        Markdown and JSON exporters
    ui/            colors · ansi · markdown · overdue · stats (CLI-side rendering)
  cli/             Cobra-style command tree
    command.ts     Flags, arg validators, subcommand resolution
    printer.ts     Tables (bordered / tab-aligned), JSON, success lines
    commands/      tasks · journal · subtasks · timelog · note · misc · config · skill
                   skill-content.ts embeds the SKILL.md that `skill install` writes
  tui/             OpenTUI + React
    app.tsx        State, keyboard routing, layout, modals
    state.ts       Tabs (Active first, All last) and pure selectors:
                   filtering, sorting, fuzzy matching
    data.ts        Store facade the components talk to
    theme.ts       Design tokens (dark + light), mix(), meter()
    hooks/         usePomodoro · useClock · useToast · useTaskData · useUndo ·
                   useSessionState · useTween/useEntrance/useCountdown ·
                   useSmoothScrollIntoView
    palette.ts     Command-palette action table, pure and renderer-free
    components/    Header · TaskList · TaskDetail · JournalPanel · Panels ·
                   Dialogs · TaskForm · Settings · Overlay · primitives
tests/             bun:test — core, CLI, TUI selectors, live TUI rendering
docs/              Review passes (tui-review*.md, cli-review.md); each opens
                   with its resolution status and conscious deviations
.github/workflows/ ci.yml (typecheck + tests on push/PR) · release.yml
assets/            demo.tape + generated demo.gif / tasks.png / journal.png
scripts/           demo-seed.sh
```

## Compatibility rules

The Go build and this one share `~/.todo-app/todo.db` and `config.json`. That
constrains a few things:

- **Times are location-aware.** `GoTime` carries `"utc" | "local"`. Due dates
  and stored timestamps are UTC-anchored; `time.Now()` equivalents are local.
  Formatting always goes through `GoTime.format(layout)` with a Go layout.
- **Durations are nanoseconds**, because the `time_logs.duration` column is.
- **Schema and SQL stay identical** to the Go stores, including the
  `addColumnIfNotExists` migrations.
- **CLI output is a contract**: same commands, flags, exit codes (`3` for not
  found), JSON field names and table headers. Color auto-disables when stdout
  is not a TTY. TS-only additions are fine (`block`/`unblock`, `version`,
  `skill status`, `config set theme dark|light|auto`, relative due tokens,
  JSON on mutations); two conscious divergences: `done` is idempotent for
  recurring tasks, and journal misses exit `3` instead of `1`.
- **`config.json` may carry a TS-only `theme` key** ("dark" / "light";
  "auto" is stored as the key's absence). The Go build ignores it on read and
  drops it when it rewrites the file — losing it is fine, inventing more keys
  like it needs the same care.
- **The session state lives in its own file.** `~/.todo-app/tui-state.json`
  holds the tab, sort, view, tag, selection and density the TUI restores. It
  is deliberately not in `config.json`, which the Go build rewrites without
  the keys it does not know; the Go build ignores the extra file entirely.

## Testing

- Core and CLI: plain `bun:test` against in-memory SQLite (`openMemory()`).
- CLI tests inject `BufferWriter` for stdout/stderr through `CLIContext`, so
  nothing writes to the terminal; `newTestCLI()` in `tests/cli.test.ts` is the
  shared helper.
- TUI: real rendering through `@opentui/react/test-utils` — `testRender()`,
  `captureCharFrame()`, `mockInput`, `mockMouse`. Assert on the frame text.
- Wrap every input dispatch in `act()` and `await flush()` afterwards.

## OpenTUI gotchas

Hard-won, all of them cost time once:

- **ANSI escapes are not interpreted.** `<text>` renders them literally. Never
  feed it `core/ui/*` output (that renderer is for the CLI). Use styled
  `<span>`s — see `MarkdownText` in `components/primitives.tsx`.
- **A focused `<input>` swallows Escape**… and more precisely, a lone ESC byte
  sits in the stdin parser until its escape-sequence timeout. In tests, sleep
  ~120 ms after pressing `ESCAPE` before asserting.
- **`<textarea>` owns its buffer.** `ContentChangeEvent` is empty; read the
  text from the renderable ref (`ref.current.plainText`).
- **`truncate` elides in the middle** (`0/5...ase #infra`). When the tail
  matters, trim the string yourself.
- **`truncate` only works with `wrapMode="none"`.** The default wrap mode
  wins otherwise: long text wraps into extra lines and breaks the row layout
  instead of truncating.
- **Overflowing no-wrap text shrinks its flex siblings.** A `wrapMode="none"`
  title wider than the row squeezes the glyph box's padding away (`○Title`).
  Put `flexShrink={0}` on every fixed-width cell in the row.
- **A scrollbox's content height leaks into its ancestors' flex basis.** A
  long task list reports its full content height upward through yoga, so
  without protection the header and status bar shrink away as the list
  grows. Give every fixed-height row `flexShrink={0}` and the main row
  `minHeight={0}`.
- **`overflow="hidden"` also clips the mouse hit grid.** OpenTUI clips with a
  scissor rect that blocks pointer events along with paint, so children
  inside stop receiving clicks. Clip with fixed heights instead of
  `overflow="hidden"` wherever the content still needs to be clickable.
- **`‼` (U+203C) measures two columns.** It breaks a fixed-width one-column
  glyph cell; prefer a single-width glyph (`◆`, `▲`) for anything laid out
  next to fixed-width neighbors.
- **`contentOptions` gap is the only gap that works on a `<scrollbox>`.**
  `gap` on the outer `<scrollbox>`/`<box>` props is not wired through; pass
  it inside `contentOptions={{ gap }}` instead.
- **`opacity` applies to the whole subtree.** A dialog nested inside a
  translucent backdrop inherits it and turns unreadable — keep them siblings.
- **Nothing repaints unless it is dirty.** After a palette switch, call
  `renderer.setBackgroundColor()` + `requestRender()` or the old colors linger.
- **Scrollboxes do not follow the cursor.** Give rows an `id` and scroll to it
  when the selection changes — `useSmoothScrollIntoView` does that with an
  animated offset, resolving nested ids via `findDescendantById` (falling
  back to walking `getChildren`) so a row nested under section headers is
  still found.
- **A fresh scrollbox cannot scroll on its first layout pass.** The very
  first `scrollTo`/`scrollChildIntoView` after mount is a no-op because yoga
  has not measured content height yet; retry after the next layout pass
  instead of assuming the first call took effect.
- **A focused `<scrollbox>` answers `j`/`k`/arrows itself**, so a list that
  also scrolls from its own cursor scrolls twice per keypress. Pass
  `focused={false}` when the app routes those keys.
- **`scrollChildIntoView` only shows up in `scrollTop` after the next layout
  pass**, so it cannot be used to probe for a target. Absolute child positions
  lag the same way: measure offsets against the first row instead.
- **`scrollbarOptions={{ visible }}` forces the bar on**; omit it for auto.
- **Shifted letters keep a lowercase `key.name`** (`L` arrives as name `"l"`
  with `shift` set; only `key.sequence` is `"L"`). A switch on `key.name`
  swallows them before any `key.sequence` switch runs — guard with
  `key.shift`, or `L`/`H` shortcuts silently die.
- In `mockInput.pressKey`, arrows are named `ARROW_DOWN`/`ARROW_UP` (from
  `KeyCodes`); `"DOWN"` is typed as literal text. A shifted letter needs
  `{ name: "l", shift: true, sequence: "L" }`, and a few keys have no
  `KeyCodes` name at all — tests type the raw escape sequence instead
  (`PageDown` is the string `"\u001b[6~"`, `PageUp` is `"\u001b[5~"`).
- **`useKeyboard` handlers run before a focused `<textarea>` processes the
  same keypress.** A submit-on-enter reads the buffer pre-newline, then the
  textarea inserts it and fires `onContentChange` — collapse newlines there,
  and only clear validation errors when the text actually changed.
- `<markdown>` renders nothing without a tree-sitter client — not worth it.
- The React root re-renders itself outside `act()`; that warning is
  library-internal noise and is filtered in `tests/tui-render.test.tsx`.

## TUI conventions

- Components never read SQLite directly — everything goes through `RondoData`.
- Components never hard-code a color — everything comes from `theme.ts`.
- Selectors stay pure and live in `state.ts`, so they are testable without a
  renderer.
- Modals own their keyboard handling; `app.tsx` returns early while one is
  open. The `searching` state does the same for the filter bar.
- Rows keep hover state locally so hovering never re-renders the whole list.
- Selection is kept by id (`selectedTaskId`, and the journal's selected day),
  not by row index — it is looked up again whenever the shown list changes,
  so a sort, filter or create never leaves the cursor on the wrong task.
- Every mutation pushes an `UndoAction`; `u` pops the stack in `useUndo.ts`.
  A new mutation kind needs its own `UndoAction` case, not a silent gap.
- Status-bar hints come from `hintSpecs` and must match `HELP_SECTIONS`, both
  in `state.ts` — `hintKeysMissingFromHelp()` fails a test when a hint has no
  help row.
- `tui-state.json` is written debounced (400 ms) through the `RondoData`-free
  helpers in `core/config/tui-state.ts`, flushed on quit; it never touches
  `config.json`.

## When a key binding or CLI flag changes

The key map is documented in five places; update all of them or a test or a
user will catch the gap: `hintSpecs` + `HELP_SECTIONS` in `state.ts`, the
`hint` strings in `palette.ts`, the README key tables, and the demo:

```bash
bun run build && PATH="$PWD/dist:$PATH" vhs assets/demo.tape
```

A CLI change must also land in `skill-content.ts` — `skill status` reports an
installed copy as stale by comparing it byte-for-byte against that embed —
and in the README CLI examples.

## Releases

Tag `vX.Y.Z` on `main`:

```bash
git tag vX.Y.Z && git push origin vX.Y.Z
```

`release.yml` builds on native runners (macOS arm64/x64, Linux arm64/x64), runs
the tests, ad-hoc signs the macOS binaries, publishes tarballs plus
`checksums-sha256.txt`, then dispatches to `roniel-rhack/homebrew-tap`, which
regenerates `Formula/rondo-opentui.rb`.

Two constraints worth remembering: `macos-13` runners are retired (use
`macos-15-intel`), and `codesign` needs `-f` because Bun already signs the x64
output.

## Conventions

- Conventional Commits, imperative subject, body explains *why*.
- No AI attribution anywhere — commits, code, docs.
- Comments explain intent or a non-obvious constraint, never restate the code.
- Prefer fixing the root cause over widening a test's tolerance.
