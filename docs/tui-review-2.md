# TUI review #2 — field types and color choices

Scope: `src/tui/` as of v0.2.1 (2026-08-21). This pass audits every input
against what it edits, and every color token against where it is actually
used — with measured WCAG contrast ratios, not eyeballing. Targets: ≥ 4.5:1
for informative text, ≥ 3:1 for large/secondary text; decorative elements
are exempt. Priorities: **P1** = hurts usability, **P2** = clear improvement,
**P3** = polish.

> **Resolution status (2026-08-21, same day):** everything below is resolved
> — field types (1.4 subtask textarea, 1.6 bool toggles, 1.7 theme row, 1.2
> tag chips), colors (2.1 accentDim uses, 2.2 textMuted values, 2.3 Low as
> textDim, 2.4 borderFocus misuse) and polish (1.1/1.5 error borders, 1.3
> buffer cleanup, 3.1 casing, 3.3 shared `ChipButton`). One deviation: 3.2
> (error message position) stays where it was in each dialog — the offending
> field's border now turns `danger`, which points at the problem without
> reflowing the form's two-column rows. One extra find: the single-line
> textareas needed newline auto-collapse inside `onContentChange`, because
> `useKeyboard` handlers run *before* the textarea processes the same
> keypress — a submit-on-enter would otherwise leave a stray newline (and
> wipe the freshly set validation error). 359 tests pass, strict tsc clean.

---

## 1. Field types, one by one

### Task form (`TaskForm.tsx`)

| Field | Widget today | Verdict |
|---|---|---|
| Title | wrapping textarea, enter submits | ✓ right type (fixed in v0.2.1) |
| Description | 6-line textarea, markdown | ✓ |
| Due date | input + clickable presets + typed tokens | ✓ type, issues below |
| Tags | comma-separated input | type OK, discoverability gap (1.2) |
| Priority | segmented control | ✓ type, color issue (2.3) |
| Repeats | segmented control | ✓ type, label inconsistency (3.1) |

**1.1 (P2) Due field never shows where the error is.** Validation paints the
message at the bottom (`TaskForm.tsx:401-407`) but the offending field keeps
its normal border. Paint the invalid field's frame border `danger` (and the
title's when it is the empty one), so the eye lands on the problem.

**1.2 (P2) Tags are typed blind.** Nothing shows which tags already exist, so
`#front` / `#frontend` style splits are one typo away. `collectTags` already
exists (`state.ts`) and the date field shows the pattern: render the top ~6
existing tags as clickable chips under the input that append on press.

**1.3 (P3) A failed submit leaves the enter-newline in the title buffer.**
Enter inserts a newline before the form's handler reads and collapses it;
when validation fails the stray line stays visible until the next submit.
Collapse the buffer in place (`titleRef.current` edit) when validation fails.

### Prompt dialogs (`Dialogs.tsx`)

| Prompt | Widget today | Verdict |
|---|---|---|
| New / edit subtask | one-line input | **wrong for edit** — see 1.4 |
| Task note | textarea | ✓ |
| Journal entry (new/edit) | textarea | ✓ |
| Log time | one-line input (`45m note…`) | ✓ |

**1.4 (P1) Editing a long subtask scrolls under the cursor** — the exact bug
just fixed for the task title, alive in `PromptDialog`'s single-line mode
(`Dialogs.tsx:166-181`). Same recipe applies: a wrapping textarea capped at
~3 lines, cursor at the end, enter submits, newlines collapse on read. Keep
the true one-liner (log time) as-is if simpler, but subtask titles are the
long-text case.

**1.5 (P3) Prompt error doesn't reach the field.** "Cannot be empty" renders
below while the input frame stays `accent`; switch the frame border to
`danger` while the error is up (same rule as 1.1).

### Settings (`Settings.tsx`)

**1.6 (P2) Booleans are dressed as number steppers.** `Auto-start breaks`
and `Sound` render as `← off →`, the same chrome as `← 25 →` — arrows imply
a range, and "on/off" carries no state color. Render bools as a toggle
glyph instead (`▣ on` in `success` / `▢ off` in `textMuted`, matching the
subtask checkboxes), keep space/←→ to flip. Numbers keep the stepper — right
type for 1–120 ranges.

**1.7 (P3) Theme could live here too.** `T` toggles and persists now; a
`Theme  dark / light` row in Settings would make the preference visible
without hunting the help.

### The rest

Search bar (input), palette and task picker (input + list), confirm dialog
(buttons + y/n): all the right types. No changes.

---

## 2. Colors, measured

Method: WCAG relative-luminance contrast on every fg/bg pair actually
rendered. The semantic set is healthy in both themes (dark: success 9.6,
warning 10.0, danger 6.2, info 6.6, secondary 8.1 — light equivalents all
≥ 4.7). The failures cluster in two tokens:

**2.1 (P1) `accentDim` is used as text and fails everywhere it is.**
It was designed as a *rail* color (selected-row rail, fine — decorative) but
it also paints informative text:

| Use | Pair | Ratio |
|---|---|---|
| Date preset chips (form) | dark `#0e7f92` on overlay `#333336` | **2.68** |
| Date preset chips (form) | light `#3aa7bd` on `#ffffff` | **2.82** |
| Progress dots `●●○○ 2/4` (list) | dark on `#1e1e1e` | **3.55** |
| Progress dots (list) | light `#3aa7bd` on `#f7f8fc` | **2.66** |

Fix by changing the *uses*, not the token: progress dots → `textDim` in dark
(6.85) / `accent` in light (5.05); date presets → keycap treatment like the
status-bar hints (`accent` on `surfaceAlt`: 7.60 dark, 4.74 light), which
also makes them look clickable.

**2.2 (P1) Light `textMuted` is illegible.** `#8a93ab` on `#f7f8fc` = **2.89**
— and it carries real content: every empty-section hint ("press e to describe
this task"), placeholders, footers, labels. Dark's `#7a7a7a` (3.88) is
borderline-acceptable for deliberately muted text but sits under AA too.
Proposed token change (verified):

| Token | Today | Proposed | Ratio on bg |
|---|---|---|---|
| dark `textMuted` | `#7a7a7a` (3.88) | `#8a8a8a` | 4.83 |
| light `textMuted` | `#8a93ab` (2.89) | `#667089` | 4.66 |

**2.3 (P2) "Low" looks disabled when selected.** The priority segmented
control fills the active option with `priorityColors[p]`, and Low's color is
`textMuted` — a gray fill that reads as *inactive*, and in light mode white
text on `#8a93ab` is only 3.07. Use `textDim` as Low's color (`#a6a6a6` dark
/ `#4b5570` light): still gray-coded, but selection contrast becomes 7.6 /
7.4. This changes Low's list/detail tint too — acceptable, it stays the
muted step of the scale.

**2.4 (P3) `borderFocus` moonlights as an icon color.** `EmptyState` icons
and the markdown quote bar use `theme.borderFocus`
(`primitives.tsx:151,203`) — today identical to `accent`, but it is a border
token; if the focus ring ever changes, empty-state icons change with it.
Use `accent` directly.

**2.5 (OK, for the record)** — checked and fine: overdue softening
`mix(danger, textMuted, .35)` = 5.11; `textOn` on accent 10.3 dark / 5.4
light; recur active `textOn` on `secondary` 9.0; rails on `borderSubtle`
(1.18) are decorative by design; `secondary` triple duty (tags, recurrence,
active tag chip) is consistent enough to keep.

---

## 3. Consistency polish (P3)

- **3.1 Segmented label casing disagrees**: Priority says `Low Medium High
  Urgent`, Repeats says `none day week month year`. Pick one (suggest
  capitalizing Repeats: `None Daily Weekly Monthly Yearly` fits at width 76,
  or keep the short forms capitalized: `None Day Week Month Year`).
- **3.2 Error text placement varies**: TaskForm shows `⚠ message` above the
  buttons, PromptDialog between field and buttons. Same position (right
  under the offending field) in both would read as one system.
- **3.3 The date presets and future tag chips (1.2) should share one "chip
  row" primitive** with the keycap styling from 2.1, instead of two ad-hoc
  boxes.

---

## 4. Suggested order

**P1:** 1.4 (subtask edit textarea) · 2.1 (accentDim text uses) · 2.2
(textMuted values).
**P2:** 1.1/1.5 (error borders) · 1.2 (existing-tag chips) · 1.6 (bool
toggles) · 2.3 (Low selected).
**P3:** 1.3 · 1.7 · 2.4 · 3.1 · 3.2 · 3.3.

Everything here is a small, testable diff; none of it touches core or the
Go contract.
