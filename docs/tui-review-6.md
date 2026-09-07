# TUI review 6: fluid forms and direct field access

**Status:** Implemented and verified locally.

## Changes

- Task forms offer a field chooser: `ctrl+g`, then `1`–`6` for title,
  description, due date, tags, priority and recurrence. Escape dismisses the
  chooser; numbered tabs provide the same direct access with the mouse.
- The current field stays visible in the header. Field tabs yield their space
  in short terminals, appearing temporarily when the chooser opens.
- Leaving the title transfers recognized quick-add tokens into the controls.
  Later edits to those controls determine the saved metadata. Token conversion
  and subsequent control changes share a synchronous draft snapshot, including
  rapid field selection, repeated priority changes and saving in one input chunk.
- Short titles and single-field prompts use less vertical space. Long text
  retains a multiline viewport. Description hints correctly describe Enter as
  a newline, and save remains available through `ctrl+s`.
- Date presets wrap at narrow widths and highlight the previewed selection.
  Repeated arrow presses, including selection of the empty `none` value, work
  within one input chunk. Error messages and action buttons retain their own
  space; Discard shares the header instead of crowding the action row.
- A rejected task save retains the editor and its draft, including when the
  task was deleted elsewhere while the form was open.

## Decisions and limits

- Keep the existing Tab order, capture syntax, themes, undo operations and
  session-only drafts. Database schema, CLI behavior and configuration stay
  unchanged.
- `ctrl+g` was selected after a real terminal recording showed that Alt plus
  a digit inserted text instead of producing the simulated Meta key event.
  Field selection must work without changing terminal modifier settings.
- Field shortcuts belong to the open form. Palette actions retain `a`, `e`
  and `E`, which still open that form; there is no global field-selection action.
- A field chooser consumes unrelated typing until a field is selected or
  Escape is pressed. This prevents selection keys from entering the draft.
- Layout and interaction checks target terminals down to 40 columns and
  16 rows. Speed improvements reduce navigation steps; no latency benchmark
  or user study was performed.

## Verification

- Real-renderer regressions cover token conversion, subsequent metadata edits,
  clickable field tabs, chooser cancellation, resizing, rapid input, rejected
  saves and narrow prompts in both themes.
- README, contextual hints, help and the keyboard-driven demo describe the
  resulting interactions.
- `bun test`: 796 passed, 0 failed, 8,814 assertions across 35 files.
- `bun run typecheck`, `bunx tsc --noEmit --noUnusedLocals`, `bun run build`
  and `git diff --check` passed.
- Regenerated `assets/demo.gif`, `assets/tasks.png` and `assets/journal.png`
  with VHS using a throwaway profile. Inspected the recorded description and
  field-chooser flows, alongside real-renderer dark/light captures at 80×30
  and 40×16 and the tested 60×20 validation layout.
