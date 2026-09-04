# TUI review 5 implementation plan

**Status:** Implemented and verified on `codex/tui-review-5`.

**Goal:** Apply the approved UX audit to make actions predictable, preserve work in progress, and reduce navigation overhead.

**Architecture:** Keep domain changes behind RondoData and keep session-only drafts in App. Components own their editing buffers and report draft changes. Reuse navigation history for revealing tasks outside the current filter and grouped undo for tag changes.

**Baseline:** `765a5fe`, version 0.6.0. The preceding audit reproduced the findings with 45 renderer captures. Baseline verification: 735 tests passing and typecheck passing.

## Constraints

- Preserve the database schema, CLI contract, two-line task metadata and existing themes.
- Read files and locate callers before changing functions.
- Test only in-memory databases and temporary RONDO_HOME profiles.
- Preserve unrelated working tree changes, including the untracked AGENTS.md.
- New mutations require undo; document every changed binding in help, hints, palette, README and demo.

## Work packages

- [x] Forms: free text in due-date prompts, arrow-selected presets and explicit Enter; session drafts, explicit discard, compact capture and effective metadata preview. Add real renderer regression tests for these behaviors.
- [x] Inspector: persistent task identity, overview on initial focus, explicit parent editing, collapsible description/administrative details and correct child actions. Verify reading and history restoration.
- [x] Tags: direct selectable tags with mixed states and new-tag entry; preserve untouched tags; add a tags-only undo action and batch integration.
- [x] App: session draft maps keyed by entity; a visible action for the last task created outside current filters; direct E parent editing, comma tag editing, D description toggle and V reveal-created navigation.
- [x] Layout: auto uses a readable list budget, manual split remains available; compact hints retain add/complete/search/back/help without requiring palette labels to occupy most of the row.
- [x] Integration: regression tests for hidden creation and return history, draft recovery/discard, compact list sizing and hints, and batch tag undo.
- [x] Documentation and demo: explain changed date presets and new bindings; regenerate and inspect demo assets.
- [x] Validation: run bun test, bun run typecheck, bunx tsc --noEmit --noUnusedLocals, bun run build, and git diff --check. Inspect representative dark/light frames and an open-form resize; obtain independent code review and resolve findings.

## Concrete interaction decisions

- Date prompts accept typed words without executing letter shortcuts. Arrow keys choose presets; Enter commits; clicking a preset still commits directly.
- Escape closes editors while retaining dirty drafts in memory for this app session. Discard is explicit; successful saves clear the saved draft.
- E edits the whole selected task from either task panel; e and Enter continue editing the selected inspector row.
- Comma opens the tag editor for visible marked tasks or the selected task. Changes apply as add/remove deltas, preserving untouched tags; one undo reverses a batch.
- V reveals the last task created outside the current results using existing navigation history. Backspace returns to the prior filter and selection.
- Auto layout requires at least 120 columns and a list budget of at least 60 columns. Manual split and its saved ratio remain usable from 75 columns.
- D folds/unfolds the inspector description. Administrative details have a mouse fold control; parent title and status stay outside the reading viewport.

## Review refinements

- Draft closure reads the current title, description, due-date and tag buffers synchronously, including a text-and-Escape stdin chunk.
- Inspector section state belongs to the app session, keyed by task ID, so navigation, an empty selection and compact-panel unmounts retain the reading context.
- Paging uses the actual inspector viewport below the fixed header, with one line of overlap.
- Discard shares the form header; its presence does not reduce the compact editor viewport.
- At 40 columns, quick capture retains metadata, More options and explicit close/discard controls without a nested input border.

- Tag editing reads query, selection and changes synchronously, so text, Enter and Ctrl+S in one stdin chunk create and save the intended tag.
- The hidden-creation banner is scoped to task panels and does not distract journal reading.

## Verification

- `bun test`: 784 passed, 0 failed, 8,733 assertions across 34 files.
- `bun run typecheck`, `bunx tsc --noEmit --noUnusedLocals`, `bun run build` and `git diff --check` passed.
- Inspected 110 real-renderer frames across dark/light themes, 40/60/80/100/120 columns, form resize, draft recovery, filtered creation, return navigation and tag editing.
- Independent review reproduced rapid-input draft/tag losses and lost inspector folds. Regression tests cover each corrected case.
- `PATH="$PWD/dist:$PATH" vhs assets/demo.tape` passed. Regenerated and inspected the demo GIF and task/journal screenshots, using a throwaway profile and 20 fps.

## Deliberate limits

- Drafts and inspector fold state last for the current app session; they are not written to the database or configuration.
- V refers to the most recent task created outside the current results. Existing navigation history preserves the return path.
- The responsive behavior changes Auto layout; explicit Split retains its saved ratio and 75-column minimum.
