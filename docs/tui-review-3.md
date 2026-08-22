# TUI review #3 — speed, responsiveness and polish

Scope: `src/tui/` as of v0.3.1 (`67c05e5`, 2026-08-22). Goal of this pass: the
fewest keystrokes and seconds per action, a layout that survives real terminal
sizes, a modern look, and nothing a first-time user has to guess.

Method: seven independent lenses (action cost, layout, visual, discoverability,
interaction bugs, performance, persistence and daily workflow) produced 93 raw
findings, merged with 26 leads into 75. Every item below was then checked
against the current code by a skeptical second pass; layout and key-behavior
claims were reproduced through the real OpenTUI test renderer at 60×20, 70×24,
80×24, 90×24, 100×30, 120×40 and 200×50 with 12- and 40-task seeds. Items the
earlier reviews resolved (`tui-review.md`, `tui-review-2.md`) are not repeated
unless the fix turned out incomplete — those are marked **(incomplete fix)**.

Priorities: **P1** = broken or traps the user, **P2** = clear UX gap, **P3** =
polish. Each item also carries its effect on *speed* (time to perform an
action): high / medium / low. Key counts exclude typed text.

Headline numbers: 10 P1, 37 P2, 28 P3. Three P1s are layout failures at the
macOS default 80×24 that the 12-task test seeds never trigger.

---

## 1. Broken at common terminal sizes

### 1.1 (P1, speed high) Header and status bar disappear once the list is long
The root column has no child protected from shrinking: the task scrollbox
reports its full content height (3 rows per task) as the main row's flex
basis, and yoga shrinks Header and StatusBar to make room. With 12 tasks at
80×24 the toast hairline is already gone; with 40 tasks the header vanishes at
every size tested and at 80×24/100×30 the status bar (hints *and* toasts) goes
too. At 60×20, opening `/` or `#` with 12 tasks loses the tabs and clock.
Tabs, every hint and every feedback toast disappear exactly when the backlog
is realistic.
- `src/tui/app.tsx:1008-1014` root column, `:1043` main row — no `minHeight`
- `src/tui/components/Header.tsx:85`, `Panels.tsx:214` — no `flexShrink={0}`
- `src/tui/components/TaskList.tsx:354-360` scrollbox `flexGrow={1}`

**Fix (verified in isolation):** `flexShrink={0}` on Header, TagBar and
StatusBar; `minHeight={0}` on the main row and both panel columns. Add a
40-task 80×24 render test asserting `◆ RonDO`, `? help` and the hairline row.

### 1.2 (P1, speed medium) Task form loses labels, chips and Save/Cancel at 80×24
The form needs ~28 rows but asks for `min(screenHeight - 2, 28)` → 22 rows on
a 24-row terminal. Yoga zeroes the shrinkable children: every label except
Title, the today/tomorrow/+1w chips, the #tag chips and the Save/Cancel row
vanish; both segmented controls render unlabeled. At 60×20 the due/tags inputs
collapse to a border line. Reproduced at 80×24, 70×24, 60×20.
- `src/tui/components/TaskForm.tsx:338` `height={Math.min(screenHeight - 2, 28)}`
- `TaskForm.tsx:236-246` labels are bare rows; `:475-478` buttons row
- `src/tui/components/Overlay.tsx:44-45` clamps to `screenHeight - 2`, body has no overflow

**Fix:** a compact variant when `screenHeight < 30`: labels as the frame's
border `title` (Panel already does this), title frame 3 rows, description
`flexGrow={1} minHeight={3}`, `flexShrink={0}` on every fixed-height node so
yoga clips the description instead of deleting rows, buttons row omitted
(footer already says save/cancel). 16 rows + error + footer fits 20-row
terminals. Test at 80×24 asserting `Priority` and the chips are visible.

### 1.3 (P1, speed medium) Header garbles for the whole focus session below ~100 cols
Brand 7 + tabs 49 + `<task> · Focus 25:00` + meter/dots ~35 + clock 5 = 98 >
80. Nothing in the header has `flexShrink={0}`, so yoga shrinks every tab
label, count and the timer digits: at 80×24 the row reads
`RonDO ◐ 12 Done ▤ Al12 Journal 1… · 00 07`; at 90 the brand and clock are
gone and the title is glued to the last tab. Clean only from 100 cols.
**(incomplete fix)** — review 1 asked for the task title in the header; adding
it is what pushed 80 cols over budget.
- `src/tui/components/Header.tsx:86-93` row, `:119-142` timer block, `:143` clock
- `src/tui/app.tsx:943` `cap = width >= 110 ? 28 : 14`

**Fix:** `flexShrink={0}` on brand, tabs, divider and clock; timer block
`flexShrink={1} minWidth={0}` with the title `wrapMode="none" truncate`;
compute the spare width in app.tsx and drop title → dots → meter in that
order as it runs out. Worst case is a trimmed timer, never a clipped tab.

### 1.4 (P1, speed medium) Status bar hides `?`/`^k` below 84 cols and corrupts between 84 and ~99
`shown = width < 84 ? hints.slice(0, 4) : hints` keeps the *first* four hints,
and `^k palette` / `? help` are always last — at 80×24 a first-time user has
no visible path to help or the palette while 26 columns sit idle. Above 84 the
eight hints plus the sort segment need ~98 cols and KeyHint has no
`flexShrink={0}`: 84 → `spacestatus`, 90 → `? help⇅ Created`, 50 →
`t subtask⇅ Created`.
- `src/tui/components/Panels.tsx:211` threshold; `:239` sort text
- `src/tui/components/primitives.tsx:155` KeyHint box, no `flexShrink`
- `src/tui/app.tsx:977-986` hint arrays end with `^k`, `?`

**Fix:** a pure `fitHints(hints, available)` in `state.ts` (cost = key +
label + 3) measured against `width - 2` minus the sort segment when present;
`flexShrink={0}` on KeyHint; below ~60 cols keycaps only, keeping `^k` and
`?` literally. Stopgap: put `?` and `^k` first in every array.

### 1.5 (P2, speed high) Titles unreadable at 80×24
At 80 cols the list is `round(80 × 0.4) = 32` cols; after borders, rail,
glyph, scrollbar and the 6-col priority badge the title gets ~19 chars and is
elided in the middle: `Task num...ng titleURG!` — the badge's leading space is
eaten by the overflowing title at 80 and 100 cols. Priority is double-encoded
(colored rail + badge) while Medium gets neither. Scanning the list is the
most frequent action and it means reading fragments.
- `src/tui/components/TaskList.tsx:190-206` title `truncate`; `:214-221` badge
- `src/tui/app.tsx:947-950` `listWidth`, floor 24; `config.ts:6` ratio 0.4

**Fix:** trim the tail by hand (house pattern, see tags at `:152-157`) from a
`titleSpace` computed once per row, badge in `<box flexShrink={0}
paddingLeft={1}>`; replace the text badge by a 2-col glyph (`▲`/`‼`) colored
by priority so the title keeps ~24 chars at 80 cols; optionally raise the list
floor to 34.

### 1.6 (P2, speed medium) Row density never adapts: 3 rows per task everywhere
Title + meta + `gap: 1` regardless of height or width: 80×24 shows 6–7 of 12
tasks; 200×50 renders two-line rows with 60 % of each row blank and 10 empty
rows below 12 tasks. The meta line (~30 cols) fits beside the title on any
list ≥ 64 cols. `showMeta = width > 30` is the only rule; height is never
consulted.
- `src/tui/components/TaskList.tsx:372` `gap: 1`; `:286` `showMeta`; `:225` meta row

**Fix:** (a) `gap: height < 30 ? 0 : 1` (pass `height`) — 10 tasks visible at
80×24 instead of 7; (b) single-line rows when `metaWidth >= 56`: rail · glyph ·
title (flexGrow, tail-trimmed) · due (11) · progress (10) · first tag ·
priority glyph, all fixed cells `flexShrink={0}`. Session-only `z` toggle if a
manual override proves useful.

### 1.7 (P2, speed low) Segmented controls overflow below 76 cols
Overlay width is `min(76, screenWidth - 4)`; Priority (31 cols) and Repeats
(32) sit side by side in two `flexGrow` columns. At 70×24 padding collapses and
a stray `n` from `None` lands on the border row; at 60×20 labels are cut
mid-word: `Lo  MediuHig  Urgen │ Non Day Wee Mont Yea`.
- `src/tui/components/TaskForm.tsx:439-465` two columns; `:310-327` option boxes no `flexShrink`
- `src/tui/components/Overlay.tsx:42` width clamp

**Fix:** `flexShrink={0}` on option boxes + `overflow="hidden"` on the
container; when the overlay is narrower than 76 render each control as a
stepper `◂ Medium ▸` (12 cols, arrows clickable) — same ←/→ model the keyboard
already uses.

### 1.8 (P2, speed low) Auto-height overlays are never clamped
Overlay only centers/clamps when `height` is passed; otherwise `top =
screenHeight / 8` with no `maxHeight`. Stats (23 rows) runs off-screen at
60×20/70×24 and paints over the panel border and status bar at 80×24; the
palette at 60×20 does the same. Help is fine only because it passes a height
and scrolls.
- `src/tui/components/Overlay.tsx:44-49`; `Panels.tsx:439` Stats `width` only;
  `Dialogs.tsx:277,398` palette/picker `width` only

**Fix:** in Overlay, when `height` is omitted set `maxHeight={screenHeight -
top - 1}` + `overflow="hidden"`; give Stats `height={min(screenHeight - 2,
24)}` with a scrollbox body like Help; size the palette/picker window from
the available rows instead of a fixed 10.

### 1.9 (P2, speed low) Tag bar chips squeeze into garbage on narrow terminals
Height-1 row, up to 12 chips, no `flexShrink`/`wrapMode="none"`: with 8 tags
at 80 cols counts drop and names cut mid-word; at 20 rows the bar steals the
header row (see 1.1). Raised from the P3 the finder gave it.
- `src/tui/components/Panels.tsx:95-118` TagBar; `:56-87` TagChip

**Fix:** `flexShrink={0}` + `wrapMode="none"` on chips; pass `width` and fit
with a pure `fitTags(tags, available)` that ends in a clickable `+N` chip.

### 1.10 (P2, speed low) Panel ratio can produce a 15-col detail or a 24-col list
Clamp is 0.2–0.8 relative; at 80 cols ratio 0.8 leaves a 15-col detail where
chips render `Pen/din/g` and every field wraps under its label; 0.2 gives a
24-col list with no meta line. The ratio is persisted, so the bad state
survives restarts and needs up to 12 `<` presses to undo.
- `src/tui/app.tsx:555` clamp; `:1118` drag clamp; `:948-950` list floor only

**Fix:** `minRatio = 34 / width`, `maxRatio = (width - 40) / width` (fall
back to compact below that), used by both `<`/`>` and drag, plus the same
clamp on `listWidth` for a ratio persisted from a wider terminal.

### 1.11 (P2, speed medium) Compact mode never says a detail panel exists
Below 72 cols the detail is unmounted while panel 0 is focused; the panel-0
hints have no navigation key and `? help` is dropped at that width (1.4). A
narrow-terminal user sees a flat list with no sign that description, subtasks,
notes and time are one key away.
- `src/tui/app.tsx:947` compact; `:1044`, `:1123` one panel mounted; `:977-986` hints

**Fix:** append ` · l details` to `listSubtitle` when compact (mirrors `h
back`); optionally prepend `["l","details"]` to the compact hints.

### 1.12 (P2, speed medium) Four empty detail sections push real content below the fold
DESCRIPTION / SUBTASKS / NOTES / TIME each cost a header, a `press e/t/n/L`
hint and a blank row even when empty — 12 of the ~20 rows available at 80×24.
With three subtasks the TIME section is already cut off; anything with notes
or logged time starts under the fold.
- `src/tui/components/TaskDetail.tsx:273-353` four Sections; `primitives.tsx:131` `paddingTop`

**Fix:** render a Section only when it has content; one affordance row of
KeyHints under the fields (`e describe  t step  n note  L time`) omitting
keys whose section is present. Saves up to 9 rows at 80×24.

---

## 2. Bugs and traps

### 2.1 (P1, speed high) Journal `a` appends to the selected past day; today's note cannot be created
`addJournalEntry` targets `selectedNote`; notes list `ORDER BY date DESC` and
`noteIndex` starts at 0, so on any morning without a note yet `a` writes into
yesterday. The help says "Add entry to today" and the CLI defaults to today.
There is also no way to write to a past day that has no note (CLI has
`journal add --date`).
- `src/tui/app.tsx:429-446`; `src/core/journal/store.ts:73`; `Panels.tsx:296`

**Fix:** `a` = today (no date passed, label "Entry for today"); `A` = selected
day (keeps today's behavior); hints + help updated. Later: a prompt date
token for arbitrary days.

### 2.2 (P1, speed high) Detail and journal-entry scrollboxes stay focused — j/k scroll *and* move the cursor
`<scrollbox focused={focused}>` answers j/k itself (1/5 viewport per press)
while `move()` advances `subtaskIndex`/`entryIndex` on the same key. On a task
with a 12-line description, `l`, `j` jumps the panel 4 lines (title gone) while
the cursor moves to step 2 still below the fold. Neither SubtaskRow nor
EntryRow has an `id`, so the selection can never be scrolled into view. The
list side was fixed in `4c097a3`; the right panels were not.
- `src/tui/components/TaskDetail.tsx:152-153`; `JournalPanel.tsx:169-170`
- `src/tui/app.tsx:741-763` `move()`; `hooks/useSmoothScroll.ts:34-37` looks at direct children only

**Fix:** `focused={false}` on both; ids `subtask-<id>` / `entry-<id>`; make
`useSmoothScrollIntoView` resolve nested targets (`findDescendantById`, fall
back to `getChildren`); for tasks without subtasks let j/k (or ctrl+d/u)
scroll the description via `scrollBy`.

### 2.3 (P1, speed low) ctrl+c bypasses the quit guard and is dead inside modals **(incomplete fix)**
`index.tsx:68` sets `exitOnCtrlC: false`; the handler calls `onQuit()` directly,
so a running focus session is abandoned without the confirm `q` shows and
`pomodoro.stop()` never deletes the in-flight row (`completed_at IS NULL` —
the orphan review 1 §1.6 fixed for `q`). The branch also sits after the
modal/search early returns, so ctrl+c does nothing while any overlay is open.
- `src/tui/app.tsx:788-791` vs `:593-608` `requestQuit`; `:768`, `:770` early returns

**Fix:** move the ctrl+c branch above the early returns and call
`requestQuit()` (the confirm replaces whatever modal is open).

### 2.4 (P1, speed medium) Status changes are not undoable; one pass through Done on a recurring task is irreversible **(incomplete fix)**
`UndoAction` covers only deletes and the palette says "Undo last delete".
Review 1 §1.1 now moves the recurrence to the spawned occurrence and clears it
on the original, so two spaces, `s` twice or one click on the status glyph
leaves #1 Done with `recur=0` and #2 spawned — `u` says "Nothing to undo".
Recovery is ~10 keys (find and delete the spawn, reopen, re-edit Repeats). An
accidental Done on Active also makes the task vanish from the list.
- `src/tui/data.ts:26-29` kinds; `:99-117` spawn + strip; `app.tsx:293-301` no `pushUndo`
- `TaskList.tsx:175-181` glyph click; `app.tsx:703` label

**Fix:** `status` UndoAction `{taskId, prevStatus, prevRecur, prevInterval,
spawnedId?}` pushed from the cycle callback (have `cycleStatus` return the
spawned id); rename to "Undo"; toast `· u undo` when a spawn happened.

### 2.5 (P1, speed medium) Undo after deleting a task silently drops notes, time logs and dependencies
`delete` cascades `task_notes`, `time_logs`, `task_dependencies`; `restore`
re-inserts only the task, tags and subtasks, under a fresh id. Probe: task
with 1 note, 1 log, blocking #3 → delete → undo → restored as #4 with 0 notes,
0 logs, #3 unblocked. The dialog warns "will be unblocked" while the toast
promises `press u to undo`. This blocks 3.4 (delete without confirm).
- `src/core/task/store.ts:591` `restore`; `:423` delete; `data.ts:26-29` snapshot already carries everything

**Fix:** restore notes (`restoreNote` exists at `store.ts:515`), time logs and
both dependency directions (existence-checked) inside the existing
transaction, keeping the original id. Core test with note + log + blocker +
blocked.

### 2.6 (P1, speed low) Journal `d`/`e` from the day list act on an entry that is not highlighted
`d`/`e` resolve `selectedNote.entries[entryIndex]` regardless of the focused
panel; EntryList paints the selection only while `focused`, so from the day
list nothing is highlighted on the right and the confirm says only "Delete
this journal entry?". `y` deletes the first entry blind — the invisible-
selection class review 1 §1.4 fixed for the palette.
- `src/tui/app.tsx:448-480`; `JournalPanel.tsx:190` `selected={focused && …}`

**Fix:** gate `d`/`e` to panel 1 in the journal (drop them from panel-0
hints), dim-paint the remembered selection in EntryRow, quote the first ~48
chars of the entry in the confirm.

### 2.7 (P2, speed medium) Selection is an index: create, sort, filter-clear or tab switch move it to another task
`taskIndex` is a bare number. `o`/F1–F3, Esc clearing a filter, Tab, a query
re-rank or a create (default sort is created DESC, so every new task shifts
all rows) keep the row number and land on a different task; any `e`/`space`/
`t`/`f`/`d` pressed next acts on the wrong one. Probes: `j j` on #6, `o` → #3;
`/ alpha 5 ⏎`, Esc → #8; with #7 selected, `a` + title + ⏎ → cursor on #8 and
the new task unselected. Same for `noteIndex`.
- `src/tui/app.tsx:162`, `:230`, `:239-241` (clamp only), `:274-292` create never selects

**Fix:** keep a `selectedTaskId` ref; on `[shown]` change `findIndex` by id,
fall back to the clamped index; set the ref to the new id after create and
after undoing a delete. Pure `indexOfId` in `state.ts`; render tests for the
three probes above.

### 2.8 (P2, speed high) Pomodoro: a queued break cannot be skipped and a stopped break re-arms as a break **(incomplete fix)**
After a work session without auto-start, `kind` becomes a break and `toggle()`
starts whatever is queued; `stop()` never resets `kind`. Probe: `f` → "Break
05:00", `f` → stopped, `f` → "Break 05:00" again. The idle header shows
nothing about the queued kind. Review 1 §1.2 fixed only the toast text.
- `src/tui/hooks/usePomodoro.ts:80-86` `stop()`; `:106-111`; `:122-128` `toggle()`

**Fix:** `stop()` also `setKind(Work)`; show the queued kind when idle (`next:
Break 5m`, dimmed, where the timer sits) so `f` is predictable.

### 2.9 (P2, speed medium) `/` from the detail panel leaves arrows dead and hints lie while typing
`/` sets `searching` but never moves focus to panel 0; ↑/↓ go through `move()`
which honours `panel`, so from panel 1 they move the (invisible) subtask
cursor. The focus ring stays on Details and the bar keeps `space toggle …`
while every letter types into the search box. In compact mode the SearchBar
lives inside the unmounted Tasks panel, so the user types into an invisible
filter.
- `src/tui/app.tsx:861-863` `/`; `:770-782` searching branch; `:955-985` hints ignore `searching`

**Fix:** `setPanel(0)` in `case "/"` and in the palette Filter action; a
`searching` branch in the hints (`↑↓ move · enter keep · esc clear`). Render
test at 60 cols.

### 2.10 (P2, speed medium) Subtask and entry cursors are never clamped after a delete
`subtaskIndex` resets only when the selected task id changes. Delete the last
of two steps: index stays 1 with one step left — no row highlighted, a second
`d` opens nothing, `space`/`e` do nothing until `k`. Same for entries.
- `src/tui/app.tsx:247-249`; `:345-348`, `:355-357`, `:372-375` silent `if (!subtask) return`

**Fix:** clamp where the index is read (`clampIndex(subtaskIndex,
subtasks.length)`), or two effects mirroring `:239`.

### 2.11 (P2, speed medium) A sort change leaves the selection off-screen and `j` cannot bring it back
`useSmoothScrollIntoView` re-runs only when the anchor *id* changes; sorting
reorders rows but the selected task keeps its id, so the viewport stays where
it was. Probe: `G`, F3 → selection invisible; `j` (clamped, same id) does
nothing. Filter/tag changes that reorder without changing the selected id
share the hole.
- `src/tui/components/TaskList.tsx:341-352`; `hooks/useSmoothScroll.ts:83` deps `[ref, childId]`

**Fix:** add a `revision` dependency (the `tasks` array or a counter bumped on
sort/filter) to the hook.

### 2.12 (P2, speed medium) Typing a query keeps the old cursor row instead of landing on the best match
Results are ranked best-first but `taskIndex` is only clamped: cursor on row 4,
`/ number 1` → the highlighted row is the 4th-best match (#12) while #1 sits
unselected at row 0; Enter keeps the wrong task and every search costs an
extra `g`.
- `src/tui/app.tsx:1060` `onInput` only sets the query; `:1039` TagBar likewise

**Fix:** reset the cursor to 0 (or to `shown[0].id` with 2.7) whenever the
query or tag changes.

### 2.13 (P2, speed medium) A stray click on the scrim discards a half-typed form
TaskForm, Settings and PromptDialog pass `onBackdropClick={onCancel}`; the scrim
is full-screen, so the click that focuses the terminal window throws away
everything typed. Probe: `a`, "Important idea", click outside → form gone,
nothing saved.
- `src/tui/components/TaskForm.tsx:342`; `Settings.tsx:216`; `Dialogs.tsx:171`; `Overlay.tsx:55-65`

**Fix:** no backdrop cancel on data-entry overlays (keep ✕ and esc), or cancel
on backdrop only while the form is pristine.

### 2.14 (P2, speed low) Sort indicator, `o` and F1–F3 pretend to work while a query is active **(incomplete fix)**
`visibleTasks` returns early in score order when a query is set, yet the bar
shows `⇅ Created`, `o` toasts "Sorted by due date" and the rows do not move
(probe: identical order before/after). Review 1 §2.2 fixed this only for the
journal.
- `src/tui/state.ts:146-159`; `Panels.tsx:238-240`; `app.tsx:581-586`, `:857-872`, `:1171`

**Fix:** apply the sort key after the fuzzy filter with score as tie-break
(keeps sorting meaningful), or show `⇅ relevance` and make `o`/F-keys say
"Sorting resumes when the filter is cleared".

### 2.15 (P2, speed medium) Errors raised inside prompt callbacks surface as a toast under the scrim
Log time validates in `onSubmit`; on a bad duration it toasts an error and
leaves the PromptDialog open. The toast renders in the status bar under the
0.72-opacity backdrop, ~20 rows from the field, while the dialog shows no red
border and no ⚠ — the inline error path exists but only for empty text.
- `src/tui/app.tsx:416-424`; `Dialogs.tsx:121-128`, `:177`, `:193-199`; `Overlay.tsx:54-64`

**Fix:** `onSubmit: (value) => string | void`; a returned string becomes the
inline error (danger border). `notify` stays for the success path.

### 2.16 (P3, speed low) `f` in the journal starts a focus session on a task the user cannot see
`selectedTask` ignores the tab; probe from Journal: header shows `Task number
1… · Focus 25:00` and the session row is persisted against that task. Review
1 hid the palette's task actions in the journal for this reason; the hotkey
was left out.
- `src/tui/app.tsx:588-591`, `:230`

**Fix:** `pomodoro.toggle(tab === "journal" ? 0 : selectedTask?.id ?? 0)`, or
open the task picker from the journal.

### 2.17 (P3, speed low) Enter from the list, then Enter again, toggles the first subtask
Enter in panel 0 opens the detail; Enter in panel 1 toggles the subtask under
the cursor. Double-Enter is "open it" muscle memory and the hint bar advertises
`space toggle`, not Enter. Probe: RETURN, RETURN marks step 1 done.
- `src/tui/app.tsx:841-844`; `:967-975` hints

**Fix:** Enter in panel 1 = edit subtask (or no-op); space stays the toggle.

---

## 3. Fewer keystrokes

The table lists the actions whose cost changes; everything not listed is
already one key (`f`, `u`, `q`, `T`, `S`, `?`, `^k`) or one key plus text
(`a`, `e`, `t`, `n`, `L`, `/`).

| Action | Today | Proposed | Item |
|---|---|---|---|
| Mark done from Pending | `space space` (2, via InProgress) | `space` (1) | 3.1 |
| Create task with due + tag + priority + weekly | `a` … Tab×5, arrows (24 + text) | `a`, `title @tom #infra !3 ~w`, ⏎ (2 + text) | 3.2 |
| Raise priority one step | `e`, Tab×4, →, ⏎ (7) | `+` (1) | 3.3 |
| Set due to tomorrow | `e`, Tab, Tab, `tomorrow`, ⏎ (4 + text) | `@`, `m` (2) | 3.3 |
| Delete task / subtask / entry | `d`, `y` (2) | `d` (1, undo toast) | 3.4 |
| Go to Journal from Active | Tab×3 (3) | `4` (1) | 3.5 |
| Row 20 of 40 | `j`×20 (20) | PgDn×3, `j`×2 (≈5) | 3.6 |
| Filter by tag | `#` + mouse click | `#`, type, ⏎ or `/ #tag ⏎` (3 + text) | 3.7 |
| Overdue / today / blocked view | F2 then read dates | `v` (1) | 3.8 |
| Log the focus session you just finished | `L`, `25m`, ⏎ (5) | 0 (automatic) | 3.9 |
| Fix a typo in a note / wrong time log | quit, `rondo note edit …`, relaunch | `l`, `j`×n, `e` | 3.10 |
| Block on another task | `^k`, `bl`, ⏎, type, ⏎ (5 + text) | `b`, type, ⏎ (2 + text) | 3.11 |
| New task while in `#work` | tag typed again | `a`, title, ⏎ (tag inherited) | 3.12 |
| Open a specific task | `/`, text, ⏎, (`g`), Esc | `^k`, text, ⏎ | 3.13 |
| Three subtasks | 3 × (`t`, text, ⏎) | `t`, text ⏎ ×3, Esc | 3.14 |
| Reschedule five tasks | 5 × full form (≈60) | `m`,`j` ×5, `@`, `m` (≈12) | 3.15 |
| Return to yesterday's sort/tag/task | F2, `#`, `j`×n every launch | 0 (restored) | 4.1 |

### 3.1 (P2, speed high) Completing a task costs two keystrokes and `space` changes meaning per panel
`space`/`s` run the 3-state wheel Pending → InProgress → Done → Pending;
finishing — the most common action — is `space space`, two DB writes, two
toasts, and a third accidental press reopens it. On a subtask the same key is
a 2-state toggle. `s` is an exact duplicate of `space`.
- `src/tui/data.ts:91-122` `cycleStatus`; `app.tsx:845-849`, `:892-894`

**Fix:** `space` = done toggle everywhere (Pending/InProgress → Done, Done →
Pending; move the recurring spawn into a shared `data.completeTask` so
`setStatus` spawns too); `s` = start/stop (Pending ↔ InProgress). Glyph click
follows `space`. Palette labels, hints, help updated. Pairs with 2.4 so the
toggle is undoable.

### 3.2 (P2, speed high) Quick capture cannot take tags, priority, due or recurrence inline
The form is the only way to set any field but the title; Tab is the only way
across fields and Enter submits only from the title. `toDraft` only trims the
title; the due parser already accepts `today/tomorrow/+3d/+1w`. Review 1 §2.6
kept the single form — tokens are orthogonal to that.
- `src/tui/components/TaskForm.tsx:43-50`, `:210-215`, `:133-149`; `app.tsx:109-121`; `core/time.ts:485`

**Fix:** pure `parseQuickAdd(title)` in `state.ts` stripping whole-word tokens
`#tag` (many), `@today|@tomorrow|@tom|@+3d|@2026-09-01`, `!1..!4` /
`!low|!med|!high|!urgent`, `~d|~w|~m|~y`; applied in `submitTaskForm` for
create *and* edit (`e`, ` #infra`, ⏎ adds a tag). Run it live in
`handleTitleChange` so the due/tags/priority/recur widgets preview the parsed
values; placeholder `What needs doing?  #tag @tomorrow !3 ~w`.

### 3.3 (P2, speed high) No direct keys for the two most common triage edits
Re-prioritising or re-dating from the list always opens the modal and walks to
the field. `+`, `-`, `@` are unbound in both switches.
- `src/tui/app.tsx:264-272` only path; `:877-933` no priority/due keys; `TaskForm.tsx:183-193`

**Fix:** panel 0, task tabs: `+`/`-` step priority via a narrow
`data.setPriority` (toast `#12 → High`); `@` opens a one-line prompt "Due date"
pre-filled with the current value whose chips answer single letters (`t`
today, `m` tomorrow, `w` +1w, `n` none) and accepts typed tokens with inline
validation (2.15). Both undoable (2.4). Add to hints, help, palette.

### 3.4 (P2, speed high) Deletes demand a confirm although every delete is undoable
Task, subtask and entry deletes open a ConfirmDialog and need `y` while each
returns an UndoAction on a 20-deep stack and the toast already says `press u
to undo`. **Precondition:** 2.5 — until restore is complete, dropping the
confirm makes a slip lossy.
- `src/tui/app.tsx:307-326`, `:372-387`, `:466-480`; `:303` stack; `Dialogs.tsx:39`

**Fix:** after 2.5, `d` deletes immediately with an error-length toast
`Deleted "…" · u to undo`; keep the confirm only when the task blocks others
and for quit-while-focusing.

### 3.5 (P2, speed medium) Tabs cycle with Tab only; `1`/`2` duplicate `h`/`l`
`1`/`2` switch panels — already covered by h/l/←/→/Enter/Esc and the mouse.
Four tabs, no direct jump, no key hint in the header or on the palette's "Go
to …" actions; a new user pressing `2` for Done lands in the detail.
- `src/tui/app.tsx:797-803`, `:830-835`, `:709-716`; `Header.tsx:62`

**Fix:** `1`–`4` → `TABS[n-1]`; show the digit as a muted keycap in each
TabButton when not compact; hints on the "Go to …" actions; help row.

### 3.6 (P2, speed high) No page navigation
Only j/k/arrows/g/G; `pageup`, `pagedown`, `home`, `end`, ctrl+d/u are no-ops
(probe). Three rows per task, so a 40-task backlog is six screens of single
steps.
- `src/tui/app.tsx:804-818`; `:784-791` ctrl handling

**Fix:** `pageup`/`pagedown` and ctrl+u/ctrl+d → `move(±pageSize)` with
`pageSize` from `height` and the list's row height; `home`/`end` as g/G
aliases; help rows.

### 3.7 (P2, speed high) Filtering by tag is mouse-only; tags are never clickable where shown
`#` only toggles the bar, chips are `onMouseDown`, and `filters.tag` is set
from nowhere else; the query has no field tokens. The tag text on rows and in
the detail is inert.
- `src/tui/app.tsx:928-930`, `:1039`; `Panels.tsx:77,103-117`; `state.ts:141-158`

**Fix:** `#` opens a fuzzy tag picker (`collectTags` + `all`) and the bar
stays the mouse surface (palette toggles it); `parseFilterQuery` in `state.ts`
so `/ #infra ⏎` filters by tag exactly (and `!high`, `due:today`,
`is:blocked` later); detail Tags field through `Chip.onPress` → filter; `[`/`]`
cycle tags while the bar is visible.

### 3.8 (P2, speed high) No Today / Overdue / This week / Blocked views; blocked tasks are invisible in the list
Filters are `{query, tag}` and tabs only split by Done. Morning triage has no
answer beyond F2, which mixes overdue, today, soon and undated rows with no
counts. `TaskRow` never reads `blockedByIds`; the BLOCKED chip exists only in
the detail — probe: a blocked row renders identically to a free one. The CLI
has `--overdue --due-before --status --priority`.
- `src/tui/state.ts:37-40`, `:135-139`; `TaskList.tsx:100-256`; `TaskDetail.tsx:195-198`

**Fix:** a `view` field on Filters with a pure `matchesView` (`all · today ·
overdue · week · blocked`) cycled by `v`, count in `listSubtitle` (`3 overdue
of 12`); a `⊘` marker on blocked rows using `isBlocked` from `core/task/deps.ts`
(excludes Done blockers — make the detail chip agree). Session-only; not
persisted to config.json.

### 3.9 (P2, speed high) A finished focus session never reaches its task
On expiry only `data.focus.complete` runs; the task's time logs stay empty and
the detail still says "press L to log time" — after every session the user
types what the app already measured.
- `src/tui/hooks/usePomodoro.ts:95-97`; `app.tsx:207-213`; `data.ts:184`

**Fix:** pass the task id out of `onFinish`; on Work completion call
`data.logTime(taskId, workDuration, "focus session")`, reload, toast `Focus
complete · 25m logged to #12`. A normal `time_logs` row, fine for the Go
build; Settings boolean only if someone objects. Optionally move a Pending
task to InProgress when `f` starts on it (undoable).

### 3.10 (P2, speed medium) Notes and time logs are append-only in the TUI
Rendered read-only with no selection; `updateNote`/`deleteNote`/`restoreNote`
exist in the store and the CLI ships `note edit|delete`. No `deleteTimeLog` in
the store, no note kind in `UndoAction`.
- `src/tui/components/TaskDetail.tsx:316-353`; `core/task/store.ts:507-515`; `cli/commands/note.ts`

**Fix:** panel-1 cursor walks a unified `detailRows(task)` (subtasks, notes,
time logs) from `state.ts`; `e` on a note opens the multiline prompt, `d`
deletes with a `note` UndoAction; add `deleteTimeLog` to the store (no schema
change) with the same treatment.

### 3.11 (P3, speed medium) Block / unblock live only in the palette; the picker lists Done tasks
The two actions have no key hint because no key exists; candidates exclude
only self and current blockers.
- `src/tui/app.tsx:690-691`, `:627-629`

**Fix:** `b` → block picker, `B` → unblock picker (task tabs), hints and help;
open tasks first in the picker.

### 3.12 (P3, speed medium) Creating a task inside a tag filter forgets the tag
`openAddTask` always seeds `emptyTaskForm`, so the new task must be retagged
and otherwise vanishes from the filtered view on save.
- `src/tui/app.tsx:255-262`

**Fix:** seed `tags: filters.tag ?? ""` (and `due: "today"` in the Today view).

### 3.13 (P3, speed medium) Command palette cannot jump to a task
Results cover actions only; opening a task by title or `#id` is `/` + text + ⏎
+ Esc (plus 2.12).
- `src/tui/components/Dialogs.tsx:239-246`

**Fix:** include tasks in the palette results (prefix-free, like Go to File)
or a "Go to task…" action on `TaskPickerDialog` that selects by id (2.7).

### 3.14 (P3, speed low) Entering several subtasks reopens the prompt each time
`addSubtask` closes the modal on submit; N steps = N × (`t`, text, ⏎) with the
list flashing between each.
- `src/tui/app.tsx:336-341`; `Dialogs.tsx:121-128`

**Fix:** a `keepOpen` mode for PromptDialog (Enter saves + clears, subtitle
`3 added · esc done`), or one subtask per line from a multiline prompt.

### 3.15 (P3, speed low) No bulk actions
The CLI completes several tasks in one call; the TUI acts on one row.
- `src/cli/commands/tasks.ts:179`; `app.tsx:845`

**Fix (later):** `m` marks rows (rail `▌` in accent); `space`/`+`/`@`/`d` then
apply to all marked with one grouped UndoAction; Esc clears.

### 3.16 (P2, speed low) Export drops a file into the launch directory with no path choice or overwrite check
`exportAll` writes `rondo-export.md|json` to `RONDO_HOME ?? cwd` — in normal
use, wherever rondo was launched — and overwrites silently. The CLI has
`--output` and `--journal`.
- `src/tui/app.tsx:514-529`; `cli/commands/misc.ts:29-30`

**Fix:** PromptDialog pre-filled with a dated default under the data dir
(`~/.todo-app/exports/rondo-2026-08-22.md`), confirm on overwrite, "tasks
only" variants.

---

## 4. Persistence and live data

### 4.1 (P2, speed high) Nothing about the session survives a relaunch except theme and ratio
Tab, sort, tag bar, tag filter, hidden notes and the selected row reset every
launch; a due-first user pays F2 + `#` + `j`×n every morning. config.json is
shared with the Go binary, which drops unknown keys.
- `src/tui/app.tsx:158-171` defaults; `:544-579` the only persisted prefs

**Fix:** TS-only `RONDO_HOME/tui-state.json` (`src/core/config/tui-state.ts`,
read/written through `RondoData`): `{ tab, sort, tagBar, tag, view,
selectedTaskId, selectedNoteDate, density }`, validated with fallbacks, written
debounced (reuse the `dragSave` pattern at `:566-579`). Query and
`showHidden` stay session-only. Never touch config.json for this.

### 4.2 (P2, speed medium) The TUI never notices changes made by the CLI or the agent skill
Tasks and notes are read once at mount and after the TUI's own mutations. The
project ships an agent-facing CLI writing the same WAL database; anything
added from another terminal stays invisible, and a stale `Task` written back
by `e`/`space` overwrites the external edit (`store.update` writes every
column).
- `src/tui/app.tsx:156-157`, `:185-187`; `core/database/db.ts:26`; `core/task/store.ts:402-415`

**Fix:** poll `PRAGMA data_version` (changes only when another connection
commits) every ~2 s from `RondoData.changed()`; on change reload and toast
`Refreshed — changed outside`. `R` for a manual reload.

### 4.3 (P3, speed low) `<` / `>` write config.json synchronously on every keypress
`resizePanels` → `saveConfig` (validate, mkdir, write) per press while the drag
path already debounces 400 ms; each write races the Go binary.
- `src/tui/app.tsx:553-563` vs `:566-579`

**Fix:** route the keyboard path through the same debounce.

---

## 5. Look and feel

### 5.1 (P2, speed medium) Due dates are absolute with cryptic markers; no grouping by due or priority
`! Aug 19`, `• Aug 22`, `  Aug 24` — the user does date arithmetic against the
clock; nothing explains `!`/`•`; an empty due slot still pads 11 columns so
the progress cell floats mid-line. Sorting by due is a flat list with no
Overdue / Today / This week / Later / No date sections — the first thing
Things, Todoist and taskwarrior-tui do. The overdue "softening" blend is
louder than `danger` in the light theme (6.41:1 vs 5.92:1).
- `src/tui/components/TaskList.tsx:59-69`, `:148-151`, `:38`; `state.ts:161-175`; `TaskDetail.tsx:214-223`

**Fix:** pure `relativeDue(due, now)` (`today`, `tomorrow`, `Mon`, `in 12d`,
`3d late`, `Sep 11` beyond 14 days) and `groupTasks(tasks, sort, now)` in
`state.ts`; non-selectable section header rows in TaskList (muted bold
uppercase + count) with a flat cursor index; left-pack the meta line when due
is empty; detail shows `Aug 19, 2026 · 3 days overdue`. Overdue tone =
`dark ? mix(danger, textMuted, .35) : danger`.

### 5.2 (P2, speed low) A completed task is still painted OVERDUE in danger
The detail derives the due level from the date alone, so Done's detail shows
`Due  Aug 21, 2026  OVERDUE` in red two lines under a green Done chip.
- `src/tui/components/TaskDetail.tsx:131`, `:214-223`

**Fix:** `level = done ? None : dueStatus(...)`; render `Was due  Aug 21` in
`textDim`; show the completion date next to the status chip (`updatedAt`).

### 5.3 (P2, speed medium) An active tag filter becomes invisible once the bar is hidden **(incomplete fix)**
Review 1 §2.1 named both the query and the tag; the query bar now sticks,
the tag half was left out: click `#work`, press `#` → the only trace is `6 of
12` in the footer; the string `work` appears nowhere.
- `src/tui/app.tsx:1055` (query only), `:1034`, `:987-993`

**Fix:** render TagBar when `tagBar || filters.tag`, or name the tag in the
subtitle (`6 of 12 · #work`).

### 5.4 (P2, speed low) Status-bar keycaps and the sort indicator look clickable but are not
`KeyHint` accepts `onPress`; StatusBar never passes it; `⇅ Created` is bare
text. The help subtitle says "everything is clickable too".
- `src/tui/components/Panels.tsx:233-240`; `primitives.tsx:153-155`

**Fix:** hints become `{key, label, run}` built from the callbacks already in
scope; hover state on KeyHint; `⇅` wrapped in a box that cycles the sort.

### 5.5 (P3, speed low) Unfocused selection is indistinguishable from hover; light selection is faint
`mix(selectionBg, bg, .45)` = `#252e31` vs `hoverBg #2a2d2e` (1.00:1); light
selection 1.18:1 on bg; meta text `textMuted` on the selected row 3.37:1.
- `src/tui/components/TaskList.tsx:124-130`, `:233`; `theme.ts:77-78`, `:111-112`

**Fix:** keep `selectionBg` in both focus states and move the focus cue to
the rail (`┃` accent vs border) and bold title; nudge light `selectionBg` to
~`#d3dff2`; promote meta on selected rows to `textDim`.

### 5.6 (P3, speed low) Tab glyphs clash with row glyphs and go icon-only in compact mode
Active uses ◐ — the InProgress glyph on rows — while Active means "not Done"
and most rows show ○; ▤ is opaque. Below 72 cols the header is `◆ ◐ 7 ✓ 1 ▤ 8
│ ✎ 1` plus a 3-space hole after the brand.
- `src/tui/state.ts:23-26`; `TaskList.tsx:48`; `Header.tsx:62`, `:97`

**Fix:** drop the icons (the accent pill already marks the active tab) and
keep short text labels in compact mode (`Active 7  Done 1  All 8 │ Journal 1`
is 38 cols); with 3.5 the digit keycap adds the key.

### 5.7 (P3, speed low) Outlined chips and the tag bar have no surface
Non-filled Chips draw no background — a colored word, one column indented;
the tag bar band is 1.05:1 against bg.
- `src/tui/components/primitives.tsx:27-41`; `TaskDetail.tsx:181-211`; `Panels.tsx:100`

**Fix:** outlined chips on `surfaceAlt` with the tone as text (the keycap
treatment), row with `gap={1}`; tag bar on `theme.surface` like header and
status bar.

### 5.8 (P3, speed low) Copy and empty-state inconsistencies
`1 tasks`, `1 days`; the list panel is titled `Tasks` on every task tab;
journal empty states are bare sentences while the task list uses `EmptyState`;
the note row shows an unlabeled count (`Today, Aug 22   2`).
- `src/tui/app.tsx:987-993`, `:1048`; `JournalPanel.tsx:34-41`, `:152-166`, `:124-126`

**Fix:** pluralize; title the panel with the tab label (`● Active`); route
journal placeholders through `EmptyState` (✎); `2 entries`.

### 5.9 (P3, speed low) Palette prints the group on every row
An 8-col group word on each of ~30 rows — a table, not how VS Code/Raycast/
lazygit section commands.
- `src/tui/components/Dialogs.tsx:503`, `:239-246`

**Fix:** section headers when the query is empty; dim prefix only while
results interleave.

### 5.10 (P3, speed low) Meters do not animate on open
`useTween` starts at its target, so the Stats bars pop fully drawn while the
backdrop fades in.
- `src/tui/hooks/useTween.ts:15`; `primitives.tsx:111-114`; `Panels.tsx:394`

**Fix:** multiply by `useEntrance(260)` on mount so bars fill with the
overlay. Pair with 6.8 so selection changes stay instant.

### 5.11 (P3, speed low) Journal entries are plain text; task descriptions render markdown
- `src/tui/components/JournalPanel.tsx:225-227` vs `TaskDetail.tsx:275`

**Fix:** `MarkdownText` for entry bodies.

### 5.12 (P3, speed low) Clicking a subtask row toggles it; clicking a task row only selects
SubtaskRow does select + toggle on one click; TaskRow separates the glyph.
A click to pick a step before `e` flips it.
- `src/tui/components/TaskDetail.tsx:80-94`, `:307-310` vs `TaskList.tsx:166`, `:179-182`

**Fix:** mirror TaskRow — row selects, `▢/▣` glyph box toggles with
`stopPropagation`.

### 5.13 (P3, speed low) Save conventions differ across modals
Settings ignores ctrl+s; TaskForm says "ctrl+s save" twice and never that
Enter on the title submits; the ConfirmDialog `!danger` Enter path has no
caller.
- `src/tui/components/Settings.tsx:133-158`, `:214`; `TaskForm.tsx:336`, `:341`; `Dialogs.tsx:38`

**Fix:** ctrl+s in Settings; TaskForm footer `enter (title) / ctrl+s save ·
tab field · esc cancel`, drop the duplicate subtitle.

### 5.14 (P3, speed low) Due field gives no feedback until submit fails
Typed tokens are parsed only in `validate()`.
- `src/tui/components/TaskForm.tsx:90-105`, `:388`

**Fix:** live preview next to the label (`→ Fri, Aug 29`, danger tone when
unparseable); shares the parser with 3.2.

### 5.15 (P3, speed low) Panel divider is invisible
A 1-col box painted `theme.bg` with only `onMouseDrag`; `<`/`>` are not in the
palette.
- `src/tui/app.tsx:1114-1120`; `:684-705`

**Fix:** paint the column `border`, `borderFocus` on hover; palette entries
"Widen / Narrow task list" with `>` / `<` hints.

### 5.16 (P2, speed low) Help overlay omits Enter/Esc/subtask/dialog keys, mislabels journal `a`, hides GLOBAL below the fold
No rows for Enter, Esc order, ctrl+c, `y/n`, or the panel-1 meanings of
`e`/`d`/`space`; "a  Add entry to today" contradicts 2.1; at 80×24 GLOBAL
needs scrolling with no scroll hint while 46 columns sit idle at 120×40.
- `src/tui/components/Panels.tsx:266-319`, `:338-345`

**Fix:** add the rows and a SUBTASKS section; GLOBAL first; two columns when
`screenWidth >= 110`; footer `↑↓ / j k scroll · esc close`; generate the
table from the same source as the status hints so they cannot drift.

### 5.17 (P3, speed low) Defaults: sort by creation, new tasks Low
Newest capture on top, overdue rows wherever they were created; the due sort
has no priority tie-break. Priority Low matches the CLI/Go default — keep it.
- `src/tui/app.tsx:167`; `state.ts:161-172`; `TaskForm.tsx:22-29`

**Fix:** tie-break the due sort by priority then created; start on `due` (or
restore the last sort via 4.1).

### 5.18 (P3, speed low) The Done tab cannot show what was finished today
Done rows collapse to one line with no date and are ordered by creation, so
today's completions scatter among old ones. `updatedAt` is the completion time
in the common case.
- `src/tui/components/TaskList.tsx:144-146`; `state.ts:173`

**Fix:** on the Done tab order by `updatedAt` DESC, meta line `✓ Aug 22`,
subtitle `12 tasks · 3 today`.

### 5.19 (P3, speed low) Stats show only all-time logged time
The CLI's `timelog summary --days 7` has no TUI counterpart.
- `src/tui/components/Panels.tsx:426`, `:482-483`

**Fix:** `loggedSince(tasks, cutoff)` in `state.ts`; one line `logged <all> ·
today <t> · 7d <w>`.

---

## 6. Performance

Numbers are from a React Profiler probe on the test renderer; they scale
linearly with task count, which is the point — the app is fine at 12 tasks
and degrades on a real backlog.

### 6.1 (P2, speed high) Every cursor move re-renders all N rows, twice
`TaskRow` is not memoized; ScrollingList creates two closures per row per
render; `now = GoTime.now()` is a new object per render; App hands inline
closures to TaskList/TaskDetail and a fresh `hints` array to StatusBar. A `j`
press reconciles every row: 3.1 ms at 12 tasks, 8.7 ms at 400, 46 ms at 1000
— key-repeat (~30/s) outruns it. Each press also commits twice because
`useEffect(() => setSubtaskIndex(0), [selectedTask?.id])` fires a no-op
update after every selection change.
- `src/tui/components/TaskList.tsx:100`, `:284`, `:386-390`; `app.tsx:1094-1095`, `:1151-1154`, `:955`, `:247-249`

**Fix:** `React.memo(TaskRow)` with primitive props and stable `useCallback`
handlers taking `index`; `todayMs` primitive memoized on the 15 s clock
instead of `now`; `React.memo` on TaskList/TaskDetail/StatusBar/Header;
`hints` in `useMemo`; reset `subtaskIndex` inside `move`/`onSelect` instead of
the effect.

### 6.2 (P2, speed medium) Pomodoro tick and clock tick re-render the whole tree every second
`remainingMs` and `clock` are App state; with nothing memoized each tick
reconciles Header, TagBar, TaskList, TaskDetail, StatusBar — 17.5 ms per tick
at 200 tasks, ~90 ms at 1000, for 25 minutes.
- `src/tui/hooks/usePomodoro.ts:88-120`, `:130-144`; `app.tsx:202-213`; `Header.tsx:119`

**Fix:** keep `session/kind/cyclePos/endAt` in the hook, replace per-second
polling with one `setTimeout(endAt - now)` for completion, and render a
`<FocusTimer>` / `<Clock>` leaf inside Header that owns its own interval.

### 6.3 (P3, speed medium) Smooth scroll restarts on every key-repeat press and delays G/g
A new target mid-animation resumes from the last written offset; holding `j`
emits ~2.7 frames per press with the viewport lagging the selection; `G`
lands after the capped 200 ms (measured 211 ms).
- `src/tui/hooks/useSmoothScroll.ts:47`, `:63-66`, `:79`

**Fix:** snap when an animation is still in flight or the distance exceeds a
viewport; `MAX_MS` ≈ 120.

### 6.4 (P3, speed low) Toast hairline renders at ~17 fps for its whole lifetime
`useCountdown` ticks every 60 ms and sets state each time: 53 commits/frames
per info toast, 107 per error, after every mutating action — the largest
source of terminal writes over SSH/tmux, for a bar with only `width` distinct
states.
- `src/tui/hooks/useTween.ts:63-79`; `Panels.tsx:199`, `:245-253`

**Fix:** quantize to cell boundaries (set state only when `round(t × width)`
changes; tick at `max(100, duration / width)` ms).

### 6.5 (P3, speed low) `reloadTasks` replaces every Task object after any mutation
A subtask toggle rebuilds all N tasks with new identities — once rows are
memoized (6.1) this still re-renders all of them.
- `src/tui/app.tsx:185-187`, `:345-353`; `core/task/store.ts:184`, `:633` (`getById`)

**Fix:** `RondoData.refreshTask(id)` + `setTasks(prev => prev.map(...))` for
single-task mutations; full reload only for create/delete/undo/spawn.

### 6.6 (P3, speed low) Stats re-runs SQL and `collectTags` recomputes on every App render
While Stats is open the JSX calls `completionsByDay(30)`, `todayWorkCount()`
and `streak()` on every render (each tick); TagBar runs `collectTags` per
render and the form gets a new `knownTags` array per App render, so a tick
re-renders the open form while the user types.
- `src/tui/app.tsx:1264-1267`, `:1180`; `Panels.tsx:91`, `:428`

**Fix:** snapshot stats when the overlay opens; `useMemo(collectTags(tasks),
[tasks])` shared by TagBar and TaskForm; `React.memo(TagBar)`.

### 6.7 (P3, speed low) Palette actions rebuild every second while a session runs
`usePomodoro` returns a new object each render; `toggleFocus` depends on it;
`paletteActions` depends on `toggleFocus`.
- `src/tui/hooks/usePomodoro.ts:132`; `app.tsx:591`, `:734`

**Fix:** memoize the hook's return or depend on `pomodoro.toggle/running/kind`.
Subsumed by 6.2.

### 6.8 (P3, speed low) The subtask meter re-animates on every cursor move
One `AnimatedMeter` for whichever task is selected; moving between tasks
tweens 260 ms (up to 16 frames) although nothing progressed; under key-repeat
it draws stale values for the previous task.
- `src/tui/components/primitives.tsx:111-114`; `useTween.ts:19-34`; `TaskDetail.tsx:290`

**Fix:** `useTween(target, duration, resetKey = task.id)` — snap on key change,
animate only on a real change for the same task.

---

## 7. Proposed key map (conflict-checked against both switches)

| Key | Today | Proposed | Item |
|---|---|---|---|
| `space` | cycle 3 states | toggle done / reopen | 3.1 |
| `s` | duplicate of space | start / stop (Pending ↔ InProgress) | 3.1 |
| `1` `2` | panel 0 / 1 | `1`–`4` tabs | 3.5 |
| `+` `-` | — | priority up / down | 3.3 |
| `@` | — | due prompt (`t` `m` `w` `n` + tokens) | 3.3 |
| `#` | toggle tag bar | tag picker (bar via palette / `[` `]`) | 3.7 |
| `v` | — | cycle view all · today · overdue · week · blocked | 3.8 |
| `b` `B` | — | block on… / remove blocker… | 3.11 |
| `d` | confirm then delete | delete + undo toast (after 2.5) | 3.4 |
| `a` / `A` (journal) | selected day | today / selected day | 2.1 |
| Enter (panel 1) | toggle subtask | edit subtask | 2.17 |
| PgUp PgDn ^u ^d Home End | — | page / jump | 3.6 |
| `R` | — | reload from disk | 4.2 |
| `m` | — | mark for bulk action (later) | 3.15 |
| `z` | — | density toggle (optional) | 1.6 |
| ctrl+c | quit unguarded | `requestQuit` | 2.3 |

`h`/`l`/←/→/Enter/Esc keep switching panels; `x`/`H` stay journal-only; `T`,
`P`, `S`, `L`, `?`, `^k`, `<`, `>`, `o`, F1–F3, `u`, `f`, `q` unchanged.

---

## 8. Order of attack

**A — stop the bleeding (all small diffs, render tests at 80×24 with 40
tasks):** 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.6, 2.8, 2.9, 2.10, 2.13, 2.15,
2.16, 2.17, 5.3, 5.4.

**B — correctness that unlocks speed:** 2.5 (full restore) → 2.4 (status
undo) → 3.4 (delete without confirm); 2.7 (id-based selection) → 2.11, 2.12,
3.12, 3.13; 2.14.

**C — the keystroke wins:** 3.1, 3.5, 3.6, 3.3, 3.2, 3.7, 3.8, 3.9, 3.10,
3.11, 4.1, 4.2.

**D — look:** 1.5, 1.6, 1.12, 5.1, 5.2, 5.5–5.8, 5.16–5.18, then the rest of
§1 (1.7–1.11) and §5.

**E — performance (after C, since it changes what re-renders):** 6.1, 6.2,
6.3, then 6.4–6.8.

Nothing here touches the SQL schema, the CLI contract or config.json beyond
the optional TS-only state file (4.1), which follows the `theme` precedent
but lives in its own file so the Go binary can never drop it.
