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
  addTask: () => void;
  editTask: () => void;
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
            hint: "e",
            run: ctx.editTask,
          },
          {
            id: "task.done",
            group: "Task",
            label: "Mark done / reopen",
            hint: "space",
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
            label: "Delete selected task",
            hint: "d",
            run: ctx.deleteTask,
          },
          {
            id: "task.priorityUp",
            group: "Task",
            label: "Priority up",
            hint: "+",
            run: () => ctx.stepPriority(1),
          },
          {
            id: "task.priorityDown",
            group: "Task",
            label: "Priority down",
            hint: "-",
            run: () => ctx.stepPriority(-1),
          },
          {
            id: "task.due",
            group: "Task",
            label: "Set due date",
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
            hint: "m",
            run: ctx.mark,
          },
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
      hint: "a",
      run: () => ctx.addJournalEntry("today"),
    },
    {
      id: "journal.addDay",
      group: "Journal",
      label: "Add entry to selected day",
      hint: "A",
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
    { id: "app.undo", group: "App", label: "Undo", hint: "u", run: ctx.undo },
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
