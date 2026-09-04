# TUI review #4 — action speed and adaptive layout

**Status:** implemented and verified on `codex/tui-ux-refinements`.
**Baseline:** `03730eb`, v0.5.0, reviewed September 4, 2026.

## Resolution

- PageUp/PageDown and Ctrl+U/D scroll the detail or journal viewport without
  changing the entity targeted by edit/delete. Oversized entries remain readable.
- New-task capture starts with the title and token preview. Tab or More options
  expands the editor; its body scrolls to focused controls and validation errors.
  Ctrl+N saves and clears title/description while visibly retaining metadata.
- The palette labels whole-task, selected-row and bulk actions separately; its
  hints reflect the active panel. The next undo action is named in the palette.
- Creation, editing, subtask/note/log/journal changes, dependencies and visibility
  changes now join the undo stack in mutation order. Child IDs survive restoration;
  grouped and recurring operations keep their existing undo behavior.
- Auto layout uses a full-width list below 100 columns. Enter opens its inspector;
  `\` cycles auto/single/split, with split requiring at least 75 columns.
  Layout and reduced-motion preferences live in `tui-state.json`.
- Journal search returns entry IDs and contextual previews, reveals the matching
  entry on acceptance, and navigates results with `{` / `}`.
- `M` marks all visible results; Shift+J/K extends a range. Changing results prunes
  hidden marks, and bulk operations are restricted to the visible set.
- Backspace returns from palette task jumps with the previous filters, tab,
  selection and scroll position in the task list, task detail or journal entry.
  Escape also returns from the inspector. Task jumps work from an unfiltered
  journal as well as a journal search.
- Add, complete and search lead task hints. Dialogs show their own shortcuts;
  feedback uses the second footer row so primary hints remain visible. Sort yields
  space below 100 columns.
- Settings supports direct toggle/arrow clicks and typed numeric values.
- The header budgets for an active timer before the wall clock. Narrow tabs retain
  their number shortcuts. Titles, tags and previews fit terminal cells without
  splitting graphemes. Informative muted text meets a 4.5:1 contrast target on the
  tested dark/light backgrounds; decorative borders remain subdued.
- The inspector places ID and timestamps after actionable content. Reduced motion
  skips scrolling/entrance/flash animation while retaining timer feedback.

The original evidence below describes the baseline, not the current implementation.
The 100-column default remains a configurable design choice rather than a finding
from a human usability study. No database schema or CLI contract was changed.

### Implementation validation

- `bun test`: 735 passing tests, zero failures, 8,475 assertions across 30 files.
- `bun run typecheck` and `bunx tsc --noEmit --noUnusedLocals`: passed.
- `bun run build` and `git diff --check`: passed.
- `PATH="$PWD/dist:$PATH" vhs assets/demo.tape`: passed; demo GIF and task/journal
  screenshots regenerated and inspected. `ffprobe` confirms a readable 79.28-second
  GIF. Tape validation and shell syntax checks pass. The demo seed refuses a
  nonempty profile; its refusal was checked to leave the existing database intact.

The real renderer was exercised in both themes at 40×16, 60×20, 80×16, 80×24,
100×28, 120×32 and 160×40, covering 196 frames across 14 states per configuration.
Follow-up probes exercised open-form resizing, the last palette action and narrow
Settings labels/controls. Regression tests cover 50-line content, late journal
matches, metadata reuse, validation focus, contextual bulk actions, undo order,
Unicode fitting and restoring exact task-list scroll positions.
Separate regressions verify the exact reading position in task descriptions and
journal entries at 80 and 120 columns, and shrinking the app from 160×40 to 40×16
retains panel borders, priority glyphs and the scrollbar.

Local interaction measurements at 100×28, using reduced motion, in-memory SQLite
and temporary profiles:

| Tasks | Initial mount | Navigation median / p95 | Type an 11-character filter median / p95 | Open palette median / p95 |
| --- | --- | --- | --- | --- |
| 100 | 54.2 ms | 35.1 / 57.1 ms | 50.0 / 51.4 ms | 34.8 / 36.3 ms |
| 1,000 | 337.7 ms | 34.1 / 51.6 ms | 143.1 / 154.4 ms | 36.1 / 42.8 ms |

Navigation used 12 samples; filter and palette used six each. Measurements include
React `act()` and the test renderer's `flush()`, and filtering types the complete
query. They are local diagnostics, not certified key-to-pixel latency, a before/
after speed comparison, or a human completion-time study. These measurements do
not justify adding input debounce or changing the rendering architecture here.

The highest-value work is making reading, recovery and bulk actions predictable,
then giving task titles and frequent actions more space. Keep the existing dark
and light themes, two-line task rows, inline quick-add, direct due-date shortcuts,
contextual help, and keyboard-first navigation.

## Method and limits

- Read current source and all three earlier review resolution summaries.
- Captured 41 frames with the real OpenTUI test renderer at 40×16, 60×20,
  72×24, 80×16, 80×24, 100×30, 120×40 and 160×40. Fixtures contained 40 tasks
  and 12 journal entries, with long titles, dates, priorities and tags.
- Used focused runtime probes for hidden form controls, Settings clicks,
  palette deletion, undo ordering and 50-line content navigation.
- All probes used in-memory SQLite and temporary `RONDO_HOME` directories.
  The real database was not accessed. No application code changed.
- Findings distinguish reproduced behavior from source-backed design proposals.
  This is not a human usability study, cross-terminal certification, or a latency
  benchmark. No claim is made that the renderer itself is slow.
- Applied relevant principles from the
  [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md):
  visible focus, accessible content, clear action scope and useful validation.
  Browser-only rules were not applied to OpenTUI.

P1 means inaccessible functionality or an action/recovery mismatch. P2 means
avoidable interaction cost or confusing presentation. P3 means visual refinement.
Line references below refer to the baseline above.

## P1 — address first

### 1. Long content cannot be fully read with the keyboard

**Reproduced, 80×24.** One journal entry with 50 numbered lines shows lines 1–18;
`j`, `k`, PageDown, PageUp and Home do not reveal the rest. A task with a 50-line
description and one subtask initially shows description lines 1–8; focusing the
detail jumps to lines 37–50 and the subtask. The middle remains inaccessible with
those keys. A long task note has the same class of problem.

`pageBy()` scrolls the task viewport only when there are no detail rows. Otherwise
it changes the selected entity index. A single large entity leaves that index
clamped. Separate page scrolling from entity selection; keep `j/k` for rows and
make PageUp/PageDown scroll readable content even inside an oversized row.

**Acceptance:** every line of a 50-line journal entry, task note and description
is reachable without a mouse, including when subtasks also exist.
**Sources:** `src/tui/app.tsx:1463`, `:1499`;
`src/tui/hooks/useSmoothScroll.ts:78`; `src/tui/components/TaskDetail.tsx:290`.

### 2. Short forms allow editing invisible fields

**Reproduced, 80×16.** New task hides Priority and Repeats. After entering a title,
four Tabs still focus the invisible Priority field. Right changes Low to Medium,
and Ctrl+S saves that unseen value. The footer remains visible, so this looks like
a complete form rather than an incomplete viewport.

Give the form a scrollable body with focus-following and a fixed action footer.
An optional compact editor may hide advanced fields only when they are also
removed from the active focus order and have an explicit expansion action.

**Acceptance:** resize an open form down to 80×16; every focused control and its
validation message remain visible. Preserve typed values across resizing.
**Sources:** `src/tui/components/TaskForm.tsx:198`, `:208`, `:341`, `:460`;
`src/tui/components/Overlay.tsx:118`.

### 3. Palette labels do not describe the action's scope

**Reproduced.** Mark two of three tasks, open the palette and execute
“Delete selected task”: both marked tasks are deleted. The label describes one
task while the callback performs a bulk operation. Undo exists; the problem is
the mismatch in scope, not the absence of an extra confirmation dialog.

Also, palette task commands advertise `e` and `d`, while those keys operate on
subtasks, notes or time logs when the detail panel has focus.

Make palette context include the focused entity and marked count. Show explicit
labels such as “Delete 2 marked tasks” and “Edit selected subtask”; distinguish
whole-task commands from detail-row commands.

**Acceptance:** the label, shortcut and executed target agree in list, detail and
bulk contexts. **Sources:** `src/tui/palette.ts:107`;
`src/tui/app.tsx:1325`, `:1382`, `:1658`.

### 4. Undo skips some newer edits

**Reproduced.** Increase priority, edit the title, then press `u`: the title stays
edited and the older priority change is undone. Creation and multiple editing
paths do not push undo entries.

Cover task/entry/subtask edits and other currently missing mutations; expose the
next undo action by name. Users should be able to correct an accidental edit
without reconstructing the previous value.

**Acceptance:** undo follows actual mutation order, including mixed edit, bulk
and recurring-task operations. **Sources:** `src/tui/app.tsx:494`, `:837`;
`src/tui/data.ts:27`; `src/tui/hooks/useUndo.ts:38`.

## P2 — reduce action and discovery cost

| Area | Current evidence | Refinement | Source |
| --- | --- | --- | --- |
| Adaptive panels | At 80×24, a 34-column list truncates similar titles to “Review authentication f…”, hiding their distinguishing suffixes. Two panels begin at 72 columns even though declared minima plus divider require 75. | Derive the breakpoint from actual panel budgets. Trial full-width list + Enter-to-detail below roughly 100 columns, with a persistent user override; prefer a wider list when both panels fit. The proposed 100-column threshold needs usability validation. | `src/tui/app.tsx:440`; `src/tui/state.ts:883` |
| Journal search | Reproduced: searching for text in entry 11 finds its day but opens entry 1. At 60×20 the matching entry is outside the viewport. The preview also uses the first entry. | Return matching entry IDs, show a contextual excerpt, scroll to the first match, highlight it and provide next/previous match navigation. | `src/tui/state.ts:228`; `src/tui/components/JournalPanel.tsx:119`; `src/tui/app.tsx:2078` |
| Bulk selection | Source-backed: `m` marks one task without advancing; no select-visible or range action. | Add select-all-visible and range selection, with an explicit count and grouped undo. Keep selection scope limited to the current results unless explicitly widened. | `src/tui/app.tsx:1192`; `src/tui/state.ts:1211` |
| Frequent action hints | Reproduced at 60×20: footer shows details, add, palette, help and sort, but omits complete and search. Modals retain background hints that their keyboard handler ignores. Toasts replace the hints after mutations. | Prioritize add, complete, search and back by context. Let sort yield space first; show modal-specific actions while editing. Keep primary actions discoverable while showing feedback. | `src/tui/state.ts:1100`; `src/tui/components/Panels.tsx:326`; `src/tui/app.tsx:1513` |
| Settings controls | Reproduced: clicking “off” in Auto-start breaks selects the row but does not toggle it; Space then toggles it. Stepper arrows are also text within a selectable row. | Make toggles and arrows operate directly. Allow typing a numeric duration instead of repeated increment/decrement presses. | `src/tui/components/Settings.tsx:182`, `:194`, `:206` |
| Return after a global jump | Source-backed: jumping to a task outside the current results changes to All and clears filters. Escape does not restore the previous search context. | Add navigation history or a return action preserving tab, filters, selection and scroll position. | `src/tui/app.tsx:1340`, `:1600` |
| Repeated capture | Source-backed: quick-add already accepts a title and inline metadata, but every saved task closes the form. Subtask entry already supports staying open. | Add an optional “save and add another” action, with deliberate metadata reuse. Preserve the existing Enter-to-save behavior. | `src/tui/app.tsx:494`, `:639`; `src/tui/components/Dialogs.tsx:166` |
| Validation recovery | Source-backed: validation marks the invalid field but does not move focus there. | Focus and reveal the first invalid field; retain the error until that field is corrected. | `src/tui/components/TaskForm.tsx:258` |
| Header information priority | Isolated renderer probe: with counts 123/100/223/12, 40 columns truncate Journal, 48 lose the clock, and 60 hide a running pomodoro while retaining the clock. | Reserve space for the active timer before the wall clock and idle text; abbreviate or scroll tabs when necessary. | `src/tui/components/Header.tsx:195`, `:206` |
| Terminal-width text | Isolated renderer probe: a 40-column list with 40 CJK characters loses its truncation ellipsis. The manual fit function measures UTF-16 length rather than display cells. | Measure terminal cells and truncate on grapheme boundaries for titles, tags and previews. Include wide characters and emoji in verification. | `src/tui/components/TaskList.tsx:134`; `src/tui/state.ts:953` |

### Concrete action-cost targets

These are keyboard-model estimates, not measured completion times. Typed content
is excluded; the implemented shortcuts are `M` and Ctrl+N.

| Workflow | Current | Proposed |
| --- | --- | --- |
| Re-date 20 already-visible results to today | 20 marks + 19 moves + `@` + `t` = 41 presses | Select visible + `@` + `t` = 3 presses |
| Capture 10 tasks | `(a, title, Enter)` × 10 = 20 control presses | Open once, save-and-continue nine times, save-and-close once = 11 control gestures |
| Find a late entry within a day | Search, accept, open detail, navigate to entry | Search and accept directly reveal the matching entry |
| Correct the latest title edit | Reopen, reconstruct old title, save | `u` |

## P3 — visual direction

Keep the recognizable palette and two-line task rows; the previous decision to
retain metadata on a second line remains useful. Refine information hierarchy:

- **Titles first:** allocate list width to distinguish tasks. Keep due state and
  priority scannable; summarize lower-value metadata before cutting the title.
- **A quieter inspector:** place status, due date, blockers and the next actionable
  subtask before ID and creation/update timestamps. Keep the latter available in
  secondary metadata instead of consuming the prime reading area.
- **A lighter editor:** trial title-first capture with the existing token preview
  and an explicit route to advanced fields. Reduce nested borders and blank
  description space while preserving visible focus and familiar shortcuts.
- **Contrast by surface:** the muted token is approximately 3.65:1 on the dark
  raised surface and 3.68:1 on the light selection background. Raise contrast for
  instructions and informative values on those backgrounds; retain subdued
  borders and decorative separators.
- **Motion as an option:** scrolling already snaps during repeats and large
  jumps. Preserve that optimization; offer reduced motion if users prefer an
  immediate response. No runtime evidence here establishes animation as a
  performance bottleneck.

Sources: `src/tui/components/TaskDetail.tsx:415`,
`src/tui/components/TaskForm.tsx:208`, `src/tui/theme.ts:54`, `:98`,
`src/tui/hooks/useSmoothScroll.ts:89`.

## Recommended order and verification

1. Restore keyboard access and predictable operation scope: findings 1–4.
2. Improve adaptive panels, entry-level search, bulk selection and primary hints.
3. Address Settings, return navigation, repeated capture and validation focus.
4. Apply visual hierarchy, contrast and width-aware text refinements.

For implementation, test resizing with an open form, filtered/marked lists,
running pomodoro, long journal entries and long descriptions with subtasks.
Preserve the two-line row convention. Check 60×20 and 80×24 first, then 80×16 and
40-column split panes, and larger dual-panel sizes. Test light and dark surfaces.

Measure input-to-visible-result latency with realistic 100/1,000-task fixtures
before deciding whether further rendering or search optimization is necessary.
Run `bun test` and `bun run typecheck` before claiming any future fixes work.

### Verification of this review

The frame capture completed with 41 frames. Separate interaction probes passed
10 assertions for palette deletion and undo ordering; the short-form/Settings
probe passed four assertions. Long-content probes captured unchanged viewports
across navigation keys. These checks reproduce the current defects; they do not
mean those defects are fixed or that the full project test suite was run.

A suspected general mouse regression from `Overlay`'s `overflow="hidden"` was
discarded: clicking the task-form Today chip successfully populated the date at
80×24. Do not reopen that old finding solely from the attribute's presence.
