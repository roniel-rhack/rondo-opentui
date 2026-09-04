# TUI review 4 implementation plan

**Goal:** implement the approved refinements in `docs/tui-review-4.md`.
**Architecture:** retain React/OpenTUI components and pure selectors, with all
mutations passing through `RondoData`. Keep the shared database and CLI contract.
**Stack:** TypeScript, Bun, React, OpenTUI, in-memory SQLite for tests.

## Work packages

- [x] Forms and Settings: make the TaskForm body scrollable and follow the focused
  control; focus validation errors; provide Ctrl+N save-and-add-another; keep
  metadata intentionally, clear title/description; make Settings values directly
  clickable and numeric values editable. Add isolated renderer regressions.
- [x] Reading and journal search: let page keys scroll content independently of
  selected rows; expose an EntryList scroll handle; select and highlight matching
  entries with contextual previews and next/previous result navigation. Add
  numbered long-content and offscreen-result renderer regressions.
- [x] Undo: add reversible creation/edit/subtask/entry/dependency mutations while
  preserving recurring-task and grouped-action behavior. Ensure the stack reflects
  actual mutation order. Add store and renderer regression coverage.
- [x] Action context: label palette actions for their real target; add M to mark
  all visible tasks and Shift+J/K to extend a range; add return navigation after
  global jumps. Keep selected IDs and filters stable.
- [x] Adaptive presentation: default to a full-width list below 100 columns with
  a persisted layout override, respect panel minimum widths including divider,
  prioritize active timer and frequent hints, improve muted text contrast and
  terminal-cell truncation. Retain two-line rows. Reduce inspector metadata
  prominence and offer reduced motion through session preferences.
- [x] Integration: synchronize help, palette hints, README and demo; record
  resolutions in the review; run the complete test suite, typecheck, unused-local
  check, build, real renderer size matrix and focused performance measurements.

## Execution rules

Read each file and find callers before editing functions. Work in the current
checkout on `codex/tui-ux-refinements`; preserve pre-existing untracked AGENTS.md.
Keep ownership of shared app sections explicit. Add regression tests before
behavior fixes and confirm the failure, then the passing result. Review the
integrated diff before completion.

## Release follow-up

Publish the verified changes on `main` and tag `v0.6.0`. Preserve the pre-existing
untracked AGENTS.md and the development branch.
