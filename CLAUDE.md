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
bun test               # 382 tests
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
    database/      db.ts (bun:sqlite) · backup.ts (VACUUM INTO + pruning)
    export/        Markdown and JSON exporters
    ui/            colors · ansi · markdown · overdue · stats (CLI-side rendering)
  cli/             Cobra-style command tree
    command.ts     Flags, arg validators, subcommand resolution
    printer.ts     Tables (bordered / tab-aligned), JSON, success lines
    commands/      tasks · journal · subtasks · timelog · note · misc · config · skill
  tui/             OpenTUI + React
    app.tsx        State, keyboard routing, layout, modals
    state.ts       Tabs (Active first, All last) and pure selectors:
                   filtering, sorting, fuzzy matching
    data.ts        Store facade the components talk to
    theme.ts       Design tokens (dark + light), mix(), meter()
    hooks/         usePomodoro · useTween/useEntrance/useCountdown ·
                   useSmoothScrollIntoView
    components/    Header · TaskList · TaskDetail · JournalPanel · Panels ·
                   Dialogs · TaskForm · Settings · Overlay · primitives
tests/             bun:test — core, CLI, TUI selectors, live TUI rendering
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
  `skill status`, `config theme`, relative due tokens, JSON on mutations);
  two conscious divergences: `done` is idempotent for recurring tasks, and
  journal misses exit `3` instead of `1`.
- **`config.json` may carry a TS-only `theme` key** ("dark" / "light"). The Go
  build ignores it on read and drops it when it rewrites the file — losing it
  is fine, inventing more keys like it needs the same care.

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
- **`opacity` applies to the whole subtree.** A dialog nested inside a
  translucent backdrop inherits it and turns unreadable — keep them siblings.
- **Nothing repaints unless it is dirty.** After a palette switch, call
  `renderer.setBackgroundColor()` + `requestRender()` or the old colors linger.
- **Scrollboxes do not follow the cursor.** Give rows an `id` and scroll to it
  when the selection changes — `useSmoothScrollIntoView` does that with an
  animated offset.
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
  `KeyCodes`); `"DOWN"` is typed as literal text.
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

## Releases

Tag `vX.Y.Z` on `main`:

```bash
git tag v0.2.0 && git push origin v0.2.0
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
