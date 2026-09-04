import {
  TABS,
  VIEWS,
  VIEW_LABELS,
  type SortKey,
  type TabId,
  type View,
} from "./state.ts";

/** One row of the command palette. `hint` is the key that does the same
 * thing, printed on the right; actions without one are palette-only. */
export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  group: string;
  run: () => void;
}

/**
 * Everything the table needs: what the app is showing, and the callbacks the
 * rows run. Keeping it a plain object is what makes the table testable
 * without a renderer.
 */
export interface PaletteContext {
  tab: TabId;
  /** Tasks marked for a bulk action; only then is "Clear marks" offered. */
  marked: number;
  panel?: 0 | 1;
  row?: "subtask" | "note" | "timelog" | "entry" | null;
  editRow?: () => void;
  deleteRow?: () => void;
  toggleRow?: () => void;
  markVisible?: () => void;
  goBack?: () => void;
  cycleLayout?: () => void;
  toggleMotion?: () => void;
  undoLabel?: string | null;
  previousMatch?: () => void;
  nextMatch?: () => void;
  addTask: () => void;
  editTask: () => void;
  editTags?: () => void;
  revealCreated?: () => void;
  toggleDescription?: () => void;
  toggleDone: () => void;
  toggleStart: () => void;
  deleteTask: () => void;
  stepPriority: (delta: 1 | -1) => void;
  setDue: () => void;
  addSubtask: () => void;
  addNote: () => void;
  logTime: () => void;
  block: () => void;
  unblock: () => void;
  mark: () => void;
  clearMarks: () => void;
  cycleSort: () => void;
  sortBy: (sort: SortKey) => void;
  pickTag: () => void;
  cycleTag: (delta: 1 | -1) => void;
  toggleTagBar: () => void;
  cycleView: () => void;
  setView: (view: View) => void;
  addJournalEntry: (day: "today" | "selected") => void;
  toggleNoteHidden: () => void;
  toggleHiddenNotes: () => void;
  search: () => void;
  cycleDensity: () => void;
  resizePanels: (delta: number) => void;
  toggleTheme: () => void;
  showStats: () => void;
  showHelp: () => void;
  toggleFocus: () => void;
  undo: () => void;
  reload: () => void;
  openSettings: () => void;
  exportTo: (format: "md" | "json", scope: "all" | "tasks") => void;
  quit: () => void;
  goToTab: (tab: TabId) => void;
}

/** Every action the palette can run, in the order it groups them. */
export function buildPaletteActions(ctx: PaletteContext): PaletteAction[] {
  const detail = ctx.panel === 1;
  const bulk = !detail && ctx.marked > 0;
  const target = bulk ? `${ctx.marked} marked tasks` : "selected task";
  // Task actions act on the current selection; the journal cannot see it,
  // so they disappear there instead of mutating something invisible.
  const taskActions: PaletteAction[] =
    ctx.tab === "journal"
      ? []
      : [
          {
            id: "task.add",
            group: "Task",
            label: "New task",
            hint: "a",
            run: ctx.addTask,
          },
          {
            id: "task.edit",
            group: "Task",
            label: "Edit selected task",
            hint: detail ? "E" : "e",
            run: ctx.editTask,
          },
          {
            id: "task.done",
            group: "Task",
            label: bulk ? `Mark done / reopen ${target}` : "Mark done / reopen",
            hint: detail ? undefined : "space",
            run: ctx.toggleDone,
          },
          {
            id: "task.start",
            group: "Task",
            label: "Start / stop",
            hint: "s",
            run: ctx.toggleStart,
          },
          {
            id: "task.delete",
            group: "Task",
            label: `Delete ${target}`,
            hint: detail ? undefined : "d",
            run: ctx.deleteTask,
          },
          {
            id: "task.priorityUp",
            group: "Task",
            label: bulk ? `Priority up for ${target}` : "Priority up",
            hint: "+",
            run: () => ctx.stepPriority(1),
          },
          {
            id: "task.priorityDown",
            group: "Task",
            label: bulk ? `Priority down for ${target}` : "Priority down",
            hint: "-",
            run: () => ctx.stepPriority(-1),
          },
          {
            id: "task.due",
            group: "Task",
            label: bulk ? `Set due date for ${target}` : "Set due date",
            hint: "@",
            run: ctx.setDue,
          },
          {
            id: "task.subtask",
            group: "Task",
            label: "Add subtask",
            hint: "t",
            run: ctx.addSubtask,
          },
          {
            id: "task.note",
            group: "Task",
            label: "Add note",
            hint: "n",
            run: ctx.addNote,
          },
          {
            id: "task.time",
            group: "Task",
            label: "Log time",
            hint: "L",
            run: ctx.logTime,
          },
          {
            id: "task.block",
            group: "Task",
            label: "Block on…",
            hint: "b",
            run: ctx.block,
          },
          {
            id: "task.unblock",
            group: "Task",
            label: "Remove blocker…",
            hint: "B",
            run: ctx.unblock,
          },
          {
            id: "task.mark",
            group: "Task",
            label: "Mark for bulk action",
            hint: detail ? undefined : "m",
            run: ctx.mark,
          },
          ...(ctx.markVisible ? [{
            id: "task.markVisible", group: "Task", label: "Select all visible tasks",
            hint: detail ? undefined : "M", run: ctx.markVisible,
          }] : []),
          ...(ctx.marked > 0
            ? [
                {
                  id: "task.unmark",
                  group: "Task",
                  label: "Clear marks",
                  hint: "esc",
                  run: ctx.clearMarks,
                },
              ]
            : []),
          {
            id: "view.sort",
            group: "View",
            label: "Cycle sort order",
            hint: "o",
            run: ctx.cycleSort,
          },
          {
            id: "view.sort.created",
            group: "View",
            label: "Sort by created",
            hint: "F1",
            run: () => ctx.sortBy("created"),
          },
          {
            id: "view.sort.due",
            group: "View",
            label: "Sort by due date",
            hint: "F2",
            run: () => ctx.sortBy("due"),
          },
          {
            id: "view.sort.priority",
            group: "View",
            label: "Sort by priority",
            hint: "F3",
            run: () => ctx.sortBy("priority"),
          },
          {
            id: "view.tag",
            group: "View",
            label: "Filter by tag…",
            hint: "#",
            run: ctx.pickTag,
          },
          {
            id: "view.tag.next",
            group: "View",
            label: "Next tag",
            hint: "]",
            run: () => ctx.cycleTag(1),
          },
          {
            id: "view.tag.prev",
            group: "View",
            label: "Previous tag",
            hint: "[",
            run: () => ctx.cycleTag(-1),
          },
          {
            id: "view.tags",
            group: "View",
            label: "Toggle tag bar",
            run: ctx.toggleTagBar,
          },
          {
            id: "view.cycle",
            group: "View",
            label: "Cycle view",
            hint: "v",
            run: ctx.cycleView,
          },
          ...VIEWS.map<PaletteAction>((view) => ({
            id: `view.${view}`,
            group: "View",
            label: `View: ${VIEW_LABELS[view].toLowerCase()}`,
            run: () => ctx.setView(view),
          })),
        ];

  const journalActions: PaletteAction[] =
    ctx.tab === "journal"
      ? [
          {
            id: "journal.hide",
            group: "Journal",
            label: "Hide / show note",
            hint: "x",
            run: ctx.toggleNoteHidden,
          },
          {
            id: "journal.hidden",
            group: "Journal",
            label: "Show hidden notes",
            hint: "H",
            run: ctx.toggleHiddenNotes,
          },
        ]
      : [];

  const actions: PaletteAction[] = [
    ...taskActions,
    {
      id: "journal.add",
      group: "Journal",
      label: "Add journal entry for today",
      hint: ctx.tab === "journal" ? "a" : undefined,
      run: () => ctx.addJournalEntry("today"),
    },
    {
      id: "journal.addDay",
      group: "Journal",
      label: "Add entry to selected day",
      hint: ctx.tab === "journal" ? "A" : undefined,
      run: () => ctx.addJournalEntry("selected"),
    },
    ...journalActions,
    {
      id: "view.search",
      group: "View",
      label: "Filter",
      hint: "/",
      run: ctx.search,
    },
    {
      id: "view.density",
      group: "View",
      label: "Cycle row density",
      hint: "z",
      run: ctx.cycleDensity,
    },
    {
      id: "view.widen",
      group: "View",
      label: "Widen task list",
      hint: ">",
      run: () => ctx.resizePanels(0.05),
    },
    {
      id: "view.narrow",
      group: "View",
      label: "Narrow task list",
      hint: "<",
      run: () => ctx.resizePanels(-0.05),
    },
    {
      id: "view.theme",
      group: "View",
      label: "Toggle light / dark",
      hint: "T",
      run: ctx.toggleTheme,
    },
    {
      id: "view.stats",
      group: "View",
      label: "Show statistics",
      hint: "S",
      run: ctx.showStats,
    },
    {
      id: "view.help",
      group: "View",
      label: "Show help",
      hint: "?",
      run: ctx.showHelp,
    },
    {
      id: "focus.toggle",
      group: "Focus",
      label: "Start / stop focus timer",
      hint: "f",
      run: ctx.toggleFocus,
    },
    { id: "app.undo", group: "App", label: ctx.undoLabel ? `Undo: ${ctx.undoLabel}` : "Undo", hint: "u", run: ctx.undo },
    {
      id: "app.reload",
      group: "App",
      label: "Reload from disk",
      hint: "R",
      run: ctx.reload,
    },
    {
      id: "app.settings",
      group: "App",
      label: "Settings",
      hint: "P",
      run: ctx.openSettings,
    },
    {
      id: "app.export.md",
      group: "App",
      label: "Export everything to Markdown",
      run: () => ctx.exportTo("md", "all"),
    },
    {
      id: "app.export.json",
      group: "App",
      label: "Export everything to JSON",
      run: () => ctx.exportTo("json", "all"),
    },
    {
      id: "app.export.tasks.md",
      group: "App",
      label: "Export tasks only to Markdown",
      run: () => ctx.exportTo("md", "tasks"),
    },
    {
      id: "app.export.tasks.json",
      group: "App",
      label: "Export tasks only to JSON",
      run: () => ctx.exportTo("json", "tasks"),
    },
    { id: "app.quit", group: "App", label: "Quit", hint: "q", run: ctx.quit },
  ];

  if (ctx.tab !== "journal" && ctx.editTags) actions.push({
    id: "task.tags", group: "Task", label: `Edit tags for ${target}`, hint: ",", run: ctx.editTags,
  });
  if (ctx.revealCreated) actions.push({
    id: "task.revealCreated", group: "Task", label: "View task created outside filter", hint: "V", run: ctx.revealCreated,
  });
  if (ctx.toggleDescription) actions.push({
    id: "detail.description", group: "Selected task", label: "Fold / unfold description", hint: "D", run: ctx.toggleDescription,
  });
  if (detail && ctx.row) {
    const row = ctx.row === "timelog" ? "time log" : ctx.row === "entry" ? "journal entry" : ctx.row;
    if (ctx.editRow) actions.push({ id: "detail.edit", group: "Selected row", label: `Edit selected ${row}`, hint: "e", run: ctx.editRow });
    if (ctx.deleteRow) actions.push({ id: "detail.delete", group: "Selected row", label: `Delete selected ${row}`, hint: "d", run: ctx.deleteRow });
    if (ctx.row === "subtask" && ctx.toggleRow) actions.push({ id: "detail.toggle", group: "Selected row", label: "Toggle selected subtask", hint: "space", run: ctx.toggleRow });
  }
  if (ctx.goBack) actions.push({ id: "view.back", group: "View", label: "Return to previous context", hint: "backspace", run: ctx.goBack });
  if (ctx.cycleLayout) actions.push({ id: "view.layout", group: "View", label: "Cycle layout: auto / single / split", hint: "\\", run: ctx.cycleLayout });
  if (ctx.toggleMotion) actions.push({ id: "view.motion", group: "View", label: "Toggle reduced motion", run: ctx.toggleMotion });
  if (ctx.tab === "journal" && ctx.previousMatch && ctx.nextMatch) {
    actions.push({ id: "journal.previousMatch", group: "Journal", label: "Previous search match", hint: "{", run: ctx.previousMatch });
    actions.push({ id: "journal.nextMatch", group: "Journal", label: "Next search match", hint: "}", run: ctx.nextMatch });
  }

  for (const t of TABS) {
    actions.push({
      id: `view.tab.${t.id}`,
      group: "View",
      label: `Go to ${t.label}`,
      hint: t.key,
      run: () => ctx.goToTab(t.id),
    });
  }
  return actions;
}

/** Group the palette shows first for actions run earlier this session. */
export const RECENT_GROUP = "Recent";
/** How many recently run actions the palette keeps at the top. */
export const RECENT_LIMIT = 5;

/** `ids` with `id` moved to the front and the list capped, so the palette's
 * Recent group reads newest first and never grows past a glance. */
export function rememberRecent(ids: readonly string[], id: string): string[] {
  return [id, ...ids.filter((x) => x !== id)].slice(0, RECENT_LIMIT);
}

/** `actions` with the ones in `recentIds` lifted into a leading Recent
 * group, in that order; the rest keep their groups. An id the current tab
 * no longer offers is skipped rather than shown as a dead row. */
export function withRecent(
  actions: readonly PaletteAction[],
  recentIds: readonly string[],
): PaletteAction[] {
  const byId = new Map(actions.map((a) => [a.id, a]));
  const recent: PaletteAction[] = [];
  for (const id of recentIds) {
    const action = byId.get(id);
    if (action) recent.push({ ...action, group: RECENT_GROUP });
  }
  const lifted = new Set(recent.map((a) => a.id));
  return [...recent, ...actions.filter((a) => !lifted.has(a.id))];
}
