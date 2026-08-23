import { describe, expect, test } from "bun:test";
import { buildPaletteActions, type PaletteContext } from "../src/tui/palette.ts";
import { TABS } from "../src/tui/state.ts";

/** A context whose every callback records the id that ran it. */
function context(overrides: Partial<PaletteContext> = {}): {
  ctx: PaletteContext;
  ran: string[];
} {
  const ran: string[] = [];
  const note = (what: string) => () => {
    ran.push(what);
  };
  const ctx: PaletteContext = {
    tab: "active",
    marked: 0,
    addTask: note("addTask"),
    editTask: note("editTask"),
    toggleDone: note("toggleDone"),
    toggleStart: note("toggleStart"),
    deleteTask: note("deleteTask"),
    stepPriority: (delta) => ran.push(`stepPriority:${delta}`),
    setDue: note("setDue"),
    addSubtask: note("addSubtask"),
    addNote: note("addNote"),
    logTime: note("logTime"),
    block: note("block"),
    unblock: note("unblock"),
    mark: note("mark"),
    clearMarks: note("clearMarks"),
    cycleSort: note("cycleSort"),
    sortBy: (sort) => ran.push(`sortBy:${sort}`),
    pickTag: note("pickTag"),
    cycleTag: (delta) => ran.push(`cycleTag:${delta}`),
    toggleTagBar: note("toggleTagBar"),
    cycleView: note("cycleView"),
    setView: (view) => ran.push(`setView:${view}`),
    addJournalEntry: (day) => ran.push(`journal:${day}`),
    toggleNoteHidden: note("toggleNoteHidden"),
    toggleHiddenNotes: note("toggleHiddenNotes"),
    search: note("search"),
    cycleDensity: note("cycleDensity"),
    resizePanels: (delta) => ran.push(`resize:${delta}`),
    toggleTheme: note("toggleTheme"),
    showStats: note("showStats"),
    showHelp: note("showHelp"),
    toggleFocus: note("toggleFocus"),
    undo: note("undo"),
    reload: note("reload"),
    openSettings: note("openSettings"),
    exportTo: (format, scope) => ran.push(`export:${format}:${scope}`),
    quit: note("quit"),
    goToTab: (tab) => ran.push(`goToTab:${tab}`),
    ...overrides,
  };
  return { ctx, ran };
}

const idsOf = (ctx: PaletteContext) => buildPaletteActions(ctx).map((a) => a.id);

describe("buildPaletteActions", () => {
  test("every id is unique and every row carries a group and a label", () => {
    const actions = buildPaletteActions(context().ctx);
    expect(new Set(actions.map((a) => a.id)).size).toBe(actions.length);
    for (const action of actions) {
      expect(action.group).not.toBe("");
      expect(action.label).not.toBe("");
    }
  });

  test("task actions disappear on the journal tab", () => {
    const tasks = idsOf(context().ctx);
    const journal = idsOf(context({ tab: "journal" }).ctx);
    expect(tasks).toContain("task.add");
    expect(journal).not.toContain("task.add");
    expect(journal).not.toContain("view.cycle");
    // The journal-only rows are the other way round.
    expect(tasks).not.toContain("journal.hide");
    expect(journal).toContain("journal.hide");
  });

  test("clearing marks is offered only while something is marked", () => {
    expect(idsOf(context().ctx)).not.toContain("task.unmark");
    expect(idsOf(context({ marked: 2 }).ctx)).toContain("task.unmark");
  });

  test("the tag rows name the keys that do the same thing", () => {
    const actions = buildPaletteActions(context().ctx);
    const hint = (id: string) => actions.find((a) => a.id === id)?.hint;
    // [ and ] cycle the tag filter; they never toggled the bar.
    expect(hint("view.tag.next")).toBe("]");
    expect(hint("view.tag.prev")).toBe("[");
    expect(hint("view.tags")).toBeUndefined();
  });

  test("every tab gets a row keyed like its digit", () => {
    const actions = buildPaletteActions(context().ctx);
    for (const tab of TABS) {
      const row = actions.find((a) => a.id === `view.tab.${tab.id}`);
      expect(row?.hint).toBe(tab.key);
    }
  });

  test("running a row calls the callback it was handed", () => {
    const { ctx, ran } = context({ marked: 1 });
    const actions = buildPaletteActions(ctx);
    const run = (id: string) => actions.find((a) => a.id === id)!.run();
    run("task.priorityUp");
    run("task.priorityDown");
    run("view.tag.next");
    run("view.today");
    run("journal.add");
    run("app.export.tasks.json");
    run("view.tab.done");
    expect(ran).toEqual([
      "stepPriority:1",
      "stepPriority:-1",
      "cycleTag:1",
      "setView:today",
      "journal:today",
      "export:json:tasks",
      "goToTab:done",
    ]);
  });
});
