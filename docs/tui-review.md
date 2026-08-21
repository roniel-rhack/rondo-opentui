# TUI review — proposed improvements and found inconsistencies

Scope: `src/tui/` as of `4c097a3` (2026-08-21). Method: full read of `app.tsx`,
`state.ts`, `theme.ts`, `data.ts`, all components and hooks, plus the shipped
screenshots. Items are grouped and each carries evidence (`file:line`) and a
suggested fix. Priorities: **P1** = bug or misleading behavior, **P2** = clear
UX gap, **P3** = polish.

> **Resolution status (2026-08-21, same day):** everything below is resolved,
> with three conscious deviations:
>
> - **2.6 quick add** — not split into `a`/`A`: the form's title field already
>   submits on Enter, so capture is one keystroke away as-is. The typed due
>   shortcuts (`today`, `tomorrow`, `+3d`, `+1w`) were implemented.
> - **§3 toast hairline row** — kept: the reserved row is a deliberate
>   anti-layout-jump trade-off.
> - **1.3** — journal hide moved to `x` (not `H`, which keeps meaning
>   "show hidden notes").
>
> Fixing 1.3 uncovered a worse pre-existing bug the review missed: shifted
> letters arrive with a lowercase `key.name`, so the `h`/`l` panel-navigation
> cases swallowed `H` and `L` before the `key.sequence` switch ran — **Log
> time (`L`) and show-hidden (`H`) were unreachable from the keyboard**. Both
> now work and are covered by tests (this and every fix here: 350 tests pass,
> `tsc --noEmit --noUnusedLocals` clean). The stale assets in §4 were
> re-recorded with VHS.

---

## 1. Bugs and misleading behavior (P1)

### 1.1 Recurring tasks spawn a duplicate on every pass through Done
`RondoData.cycleStatus` creates the next occurrence every time a recurring
task transitions into Done (`src/tui/data.ts:98-111`). Status cycling is
Pending → InProgress → Done → Pending, on a single key (`space`), so cycling
past Done and back — an easy accidental triple-press — leaves a duplicate
occurrence behind, and re-completing spawns yet another.

**Fix:** spawn only when the task was never completed before (e.g. no open
sibling spawned from it), or confirm before spawning, or make `space` on a
Done task a no-op and require an explicit "reopen" action.

### 1.2 Focus toast lies when the next session is a break
`toggleFocus` always announces `Focus started (${cfg.focus.workDuration}m)`
(`src/tui/app.tsx:509-515`), but `pomodoro.toggle` starts whatever `kind` is
pending — after a work session finishes without auto-start, that is a short or
long break (`src/tui/hooks/usePomodoro.ts:112-118`). The toast then reports a
work session with the work duration while a break is running.

**Fix:** derive the message from `pomodoro.kind` and `durationFor` after the
toggle (or have `toggle` return what it started).

### 1.3 Journal `h` conflicts with panel navigation and the compact hint
In the journal tab `h` toggles the note hidden (`src/tui/app.tsx:663-669`)
while `left` still switches panels. In compact mode the detail panel subtitle
says `h back` (`src/tui/app.tsx:940`) for every tab — in the journal, pressing
`h` there hides the note instead of going back. A navigation key that mutates
data depending on the tab is a trap.

**Fix:** keep `h`/`l` navigation-only everywhere; move hide/restore to another
key (e.g. `x` or `H` for both directions), and make the compact subtitle
tab-aware.

### 1.4 Palette runs task actions on an invisible selection in the journal
When `tab === "journal"`, `shown` still resolves to the full task list, so
`selectedTask` is non-null (`src/tui/app.tsx:195-201`). The palette exposes
"Cycle status", "Edit selected task", "Delete selected task" unconditionally
(`src/tui/app.tsx:536-539`), so from the journal you can mutate a task you
cannot see.

**Fix:** filter palette actions by context (hide/disable task actions in the
journal tab), or make `selectedTask` null outside task tabs.

### 1.5 Search counter uses the wrong total
`SearchBar` receives `totalCount={tasks.length}` — all tasks, all statuses
(`src/tui/app.tsx:878-879`) — while filtering happens inside the current tab.
On the Active tab with 6 visible of 8 total, an empty query already reads
"6/8" as if the filter were dropping rows.

**Fix:** pass the tab's pre-query count (`visibleTasks(tasks, tab, {no query},
sort).length`).

### 1.6 Stopping a focus session leaves an orphan row
Sessions are inserted at start (`src/tui/hooks/usePomodoro.ts:54-72`) and only
ever updated by `complete()` on natural expiry. `stop()` just clears local
state (`usePomodoro.ts:74-77`), so every manual stop, and quitting mid-session
(`q` has no guard, `src/tui/app.tsx:637-639`), accumulates
`completed_at IS NULL` rows forever.

**Fix:** delete (or mark aborted) the row on manual stop; confirm quit while a
session is running.

### 1.7 "Export everything to Markdown" drops the journal
The palette action is labelled "Export everything" but the md branch writes
only `writeTasks(tasks)` (`src/tui/app.tsx:482-485`); the JSON branch includes
notes. Also `` `${writeTasks(tasks)}` `` is a pointless template literal.

**Fix:** append the journal markdown to the export, or rename the action.

---

## 2. UX gaps (P2)

### 2.1 An applied filter becomes invisible
Pressing `enter` in the search bar keeps the query active but unmounts the bar
(`src/tui/app.tsx:614-626`, bar rendered only while `searching`,
`app.tsx:871`). The only trace is the subtle "N of M" footer. Users will
wonder where their tasks went.

**Fix:** while `filters.query !== ""` or a tag filter is active, keep a
one-line chip visible (e.g. `⌕ query · esc clear` in the panel title or above
the list).

### 2.2 Sort control pretends to work in the journal
The status bar always shows `⇅ <sort>` (`src/tui/components/Panels.tsx:236`)
and `o` cycles it with a toast from any tab (`src/tui/app.tsx:701-703`), but
notes are date-ordered regardless. In the journal the indicator and the action
are noise that teaches users a false model.

**Fix:** hide the sort segment and disable `o`/`F1-F3` in the journal tab.

### 2.3 No search in the journal
`/` is explicitly disabled in the journal (`src/tui/app.tsx:704-706`). Finding
an old entry means scrolling day by day. Journal search (across entry bodies,
jumping to the matching day) would close the loop with task search.

### 2.4 No dependency management from the TUI
`Blocked by` / `Blocks` render read-only (`src/tui/components/TaskDetail.tsx:250-269`)
and `core/task/deps.ts` plus the CLI support editing, but the TUI has no way
to add or remove a dependency. Also nothing warns when starting a task that is
BLOCKED — the chip is informational only.

**Fix:** palette actions ("Block on…", "Unblock…") backed by a task picker
dialog; optionally a confirm when moving a blocked task to InProgress.

### 2.5 Command palette caps at 10 rows with no scroll
`results = actions.slice(0, 10)` (`src/tui/components/Dialogs.tsx:208-216`)
and the tab-navigation actions are appended after ~20 task/view actions
(`src/tui/app.tsx:556-563`), so "Go to Journal" etc. are unreachable without
typing. Make the list a scrollbox or raise the cap and clamp to overlay
height.

### 2.6 Quick capture is heavier than it needs to be
`a` always opens the full 6-field modal. Most captures are a title. Consider:
`a` = single-line quick add (reusing `PromptDialog`), `A` or `enter` inside
the form for the full editor. The Due field also only accepts `YYYY-MM-DD`
typed (`src/tui/components/TaskForm.tsx:80-90`); the clickable presets
(today/tomorrow/+1w) should be accepted as typed tokens too, keyboard-first
app after all.

### 2.7 Time log cannot carry a note
`logTime` always passes `""` (`src/tui/app.tsx:384`), yet the detail panel
renders `tl.note` (`TaskDetail.tsx:346-348`) and the store supports it. Accept
`25m fixing the build` in the prompt and split duration/note.

### 2.8 Enter-to-delete in confirm dialogs
`return` confirms destructive dialogs (`src/tui/components/Dialogs.tsx:34-37`).
Combined with muscle-memory Enter presses this is risky. Suggest: `y` only for
destructive confirms (keep Enter for non-destructive ones), or focus Cancel by
default.

### 2.9 Empty prompt submit fails silently
`PromptDialog.submit` ignores empty input with no feedback
(`Dialogs.tsx:110-113`). Show the same inline error pattern the TaskForm uses.

### 2.10 Theme and panel ratio are session-only
- `T` toggles dark/light but nothing persists it; next launch re-detects
  (`src/tui/app.tsx:496-500`). Config has no theme field.
- `<`/`>`/drag resize works but `cfg.panelRatio` is never written back
  (`src/tui/app.tsx:151,756-760`), even though the CLI can persist it
  (`src/cli/commands/config-cmd.ts:54-63`).

**Fix:** save both through `saveConfig` (debounced for the drag). Check the Go
binary tolerates an extra JSON field before adding `theme`.

### 2.11 Error toasts expire as fast as info toasts
All toasts die at 3200 ms (`src/tui/app.tsx:176-180`). Errors ("Could not
save settings…") deserve longer, or to stick until keypress.

---

## 3. Consistency and polish (P3)

- **Stats vocabulary clashes with the tabs.** Tab "Active" means "not Done"
  (`src/tui/state.ts:87-88`), but the stats overlay's "active" row counts only
  InProgress and calls Pending "pending" (`Panels.tsx:413-415`). Rename the
  stats rows to "in progress" / "todo" or align both.
- **`q` closes the help overlay** (`Panels.tsx:322-326`) but quits the app
  everywhere else — harmless, still a double meaning; `esc`/`?` suffice.
- **Escape overload:** with a filter active, `esc` clears it even when you are
  in the detail panel and probably meant "back to the list"
  (`src/tui/app.tsx:681-684`). Consider panel-first, filter-second.
- **`/` is handled in both key switches** (`app.tsx:704` and `app.tsx:771`) —
  dead second case.
- **Dead exports:** `statusForTab` and `matchesQuery` in `src/tui/state.ts`
  have no callers anywhere (and `statusForTab`'s mapping of Active →
  InProgress contradicts the real tab filter — delete before someone uses it).
- **Timer drift:** the pomodoro decrements a counter on a 1 s `setInterval`
  (`usePomodoro.ts:79-110`); over 25 min with a busy event loop it drifts.
  Compute remaining from `startedAt` each tick instead. Side effects inside
  the `setRemainingMs` updater are also a React smell worth extracting.
- **`blockedBy` doc comment is wrong:** says "deletion is refused while
  non-empty" (`src/tui/data.ts:128`), but the app deletes and unblocks with a
  warning (`app.tsx:273-292`). Fix the comment.
- **Status-bar hints are static.** Panel 1 (subtasks) gets the same hints as
  panel 0, and `d`/`n`/`L`/`u` never appear. Context-sensitive hints are cheap
  and this bar is the app's discoverability surface.
- **Focus header shows no task.** During a session the header shows
  `Focus 24:51` but not which task it is attached to. One truncated title
  next to the timer grounds the session.
- **Toast timer row always reserves a line** (`Panels.tsx:241-250`). Fine
  trade-off, but on 24-row terminals two status lines are expensive; consider
  collapsing the hairline into the status bar background.

---

## 4. Stale assets (docs inconsistency)

`assets/demo.gif`, `assets/tasks.png` and `assets/journal.png` were last
generated in `1429368`, before the gray palette (`099befc`), the Active-first
tab order (`fbbad50`) and the list spacing fix. The README currently shows an
old near-black theme with "All" as the first tab — none of which matches the
shipped TUI. `assets/demo.tape` was updated (`:17`) but never re-rendered.

**Fix:** re-run VHS and commit the regenerated media.

---

## 5. Suggested order of attack

**Quick wins (small diffs, high value):** 1.2, 1.3, 1.5, 1.7, 2.1, 2.2, 2.9,
2.11, dead exports, comment fix, assets regen (§4).

**Medium:** 1.1 (needs a decision on recurrence semantics), 1.4, 1.6, 2.5,
2.7, 2.8, 2.10, context hints.

**Larger:** 2.3 (journal search), 2.4 (dependency picker), 2.6 (quick add +
natural date input), pomodoro rework (drift + task label + quit guard).
