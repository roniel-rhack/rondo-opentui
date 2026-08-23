import { describe, expect, mock, test } from "bun:test";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CapturedFrame, CapturedSpan } from "@opentui/core";
import {
  defaultConfig,
  formatDate,
  formatDateShort,
} from "../src/core/config/config.ts";
import { openMemory } from "../src/core/database/db.ts";
import { Minute } from "../src/core/duration.ts";
import { RecurFreq } from "../src/core/task/recur.ts";
import { newTask } from "../src/core/task/store.ts";
import { Priority, Status, type Task } from "../src/core/task/task.ts";
import { GoTime } from "../src/core/time.ts";
import { initTheme } from "../src/core/ui/colors.ts";
import { App } from "../src/tui/app.tsx";
import {
  CommandPalette,
  ConfirmDialog,
  PromptDialog,
  TagPickerDialog,
  TaskPickerDialog,
} from "../src/tui/components/Dialogs.tsx";
import { EntryList, NoteList } from "../src/tui/components/JournalPanel.tsx";
import {
  TaskDetail,
  type TaskDetailHandle,
} from "../src/tui/components/TaskDetail.tsx";
import { RondoData } from "../src/tui/data.ts";
import { TABS, type TabId, type Hint } from "../src/tui/state.ts";
import { mix, priorityColors, tuiTheme } from "../src/tui/theme.ts";
import { TaskList } from "../src/tui/components/TaskList.tsx";
import { StatusBar, TagBar } from "../src/tui/components/Panels.tsx";

initTheme(true);

// The app persists theme and panel ratio through saveConfig, so every test in
// this file must point RONDO_HOME away from the real ~/.todo-app.
process.env.RONDO_HOME = mkdtempSync(join(tmpdir(), "rondo-tui-render-"));

// OpenTUI's React root re-renders itself once the renderer is ready, outside of
// act(). The warning is library-internal noise, so keep it out of the report.
const consoleError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("not wrapped in act")) {
    return;
  }
  consoleError(...args);
};

function seed(cfg = defaultConfig()): RondoData {
  const data = new RondoData(openMemory(), cfg);

  const write = newTask({
    title: "Write the report",
    description: "Quarterly summary",
    priority: Priority.High,
    tags: ["work"],
    dueDate: GoTime.date(2026, 12, 24, 0, 0, 0, 0, "utc"),
  });
  data.tasks.create(write);
  data.tasks.addSubtask(write.id, "Collect numbers");
  data.tasks.addSubtask(write.id, "Draft intro");

  const milk = newTask({ title: "Buy oat milk", priority: Priority.Low });
  data.tasks.create(milk);
  data.setStatus(milk, Status.Done);

  // Due before the report so the due-sorted list, the default, opens on it
  // just as the created order does.
  const refactor = newTask({
    title: "Refactor the parser",
    priority: Priority.Urgent,
    tags: ["code"],
    dueDate: GoTime.date(2026, 12, 1, 0, 0, 0, 0, "utc"),
  });
  data.tasks.create(refactor);

  data.addJournalEntry("Shipped the opentui port");

  return data;
}

async function mount(
  width = 100,
  height = 30,
  cfg = defaultConfig(),
  fixture?: RondoData | ((data: RondoData) => void),
) {
  const data = fixture instanceof RondoData ? fixture : seed(cfg);
  if (typeof fixture === "function") fixture(data);
  // Wrapping the initial mount keeps React's act() warnings out of the output.
  let setup!: Awaited<ReturnType<typeof testRender>>;
  await act(async () => {
    setup = await testRender(<App data={data} />, {
      width,
      height,
      exitOnCtrlC: false,
    });
  });
  await setup.flush();

  /**
   * Dispatches input inside act() and waits for the resulting render. A bare
   * ESC byte is held back by the stdin parser until its escape-sequence
   * timeout elapses, so give it a moment before asserting.
   */
  const press = async (
    key: string,
    modifiers?: { ctrl?: boolean; shift?: boolean },
  ) => {
    await act(async () => {
      setup.mockInput.pressKey(key, modifiers);
      if (key === "ESCAPE") await new Promise((r) => setTimeout(r, 120));
    });
    await setup.flush();
  };

  const type = async (text: string) => {
    await act(async () => {
      await setup.mockInput.typeText(text);
    });
    await setup.flush();
  };

  /**
   * Walks to a tab with TAB, which cycles All → Active → Done → Journal. The
   * app opens on Active, so everything is measured from there.
   */
  const goToTab = async (id: TabId) => {
    const from = TABS.findIndex((t) => t.id === "active");
    const to = TABS.findIndex((t) => t.id === id);
    const steps = (to - from + TABS.length) % TABS.length;
    for (let i = 0; i < steps; i++) await press("TAB");
  };

  const click = async (x: number, y: number) => {
    await act(async () => {
      await setup.mockMouse.click(x, y);
    });
    await setup.flush();
  };

  return { data, press, type, click, goToTab, ...setup };
}

describe("TUI rendering", () => {
  test("shows header, tabs and task rows", async () => {
    const { captureCharFrame, renderer } = await mount();
    const frame = captureCharFrame();

    expect(frame).toContain("RonDO");
    expect(frame).toContain("All 3");
    expect(frame).toContain("Active 2");
    expect(frame).toContain("Done 1");
    expect(frame).toContain("Journal 1");
    expect(frame).toContain("Write the report");
    expect(frame).toContain("Refactor the parser");
    renderer.destroy();
  });

  test("detail panel shows the selected task", async () => {
    const { captureCharFrame, renderer } = await mount();
    const frame = captureCharFrame();

    // Newest task is selected first.
    expect(frame).toContain("Refactor the parser");
    expect(frame).toContain("#code");
    renderer.destroy();
  });

  test("moving down selects the next task and updates the detail panel", async () => {
    const { captureCharFrame, press, renderer } = await mount();

    await press("j");
    await press("j");
    const frame = captureCharFrame();

    expect(frame).toContain("Quarterly summary");
    expect(frame).toContain("SUBTASKS");
    expect(frame).toContain("0/2");
    renderer.destroy();
  });

  test("space cycles the status of the selected task", async () => {
    const { captureCharFrame, press, data, renderer } = await mount();

    await press(" ");

    const refactor = data
      .listTasks()
      .find((t) => t.title === "Refactor the parser")!;
    expect(refactor.status).toBe(Status.InProgress);
    expect(captureCharFrame()).toContain("In Progress");
    renderer.destroy();
  });

  test("tab switches to the journal view", async () => {
    const { captureCharFrame, goToTab, renderer } = await mount();

    await goToTab("journal");

    const frame = captureCharFrame();
    expect(frame).toContain("Journal");
    expect(frame).toContain("Shipped the opentui port");
    renderer.destroy();
  });

  test("? opens the help overlay above the app", async () => {
    const { captureCharFrame, press, renderer } = await mount();

    await press("?");

    const frame = captureCharFrame();
    expect(frame).toContain("Keyboard & mouse");
    // Global keys come first, so the palette is visible before any scrolling.
    expect(frame).toContain("Command palette");
    expect(frame).toContain("Move selection");
    renderer.destroy();
  });

  test("ctrl+k opens the command palette and filters actions", async () => {
    const { captureCharFrame, press, type, renderer } = await mount();

    await press("k", { ctrl: true });
    expect(captureCharFrame()).toContain("Command palette");

    await type("subt");
    expect(captureCharFrame()).toContain("Add subtask");
    renderer.destroy();
  });

  test("a opens the task form and creates a task", async () => {
    const { captureCharFrame, press, type, data, renderer } = await mount();

    await press("a");
    expect(captureCharFrame()).toContain("New task");

    await type("Ship the release");
    await press("s", { ctrl: true });

    expect(data.listTasks().some((t) => t.title === "Ship the release")).toBe(
      true,
    );
    expect(captureCharFrame()).toContain("Ship the release");
    renderer.destroy();
  });

  test("delete asks for confirmation and removes the task", async () => {
    const { captureCharFrame, press, data, renderer } = await mount();

    await press("d");
    expect(captureCharFrame()).toContain("Delete task");

    await press("y");

    expect(
      data.listTasks().some((t) => t.title === "Refactor the parser"),
    ).toBe(false);
    expect(captureCharFrame()).toContain("undo");
    renderer.destroy();
  });

  test("u restores the deleted task", async () => {
    const { press, data, renderer } = await mount();

    await press("d");
    await press("y");
    await press("u");

    expect(
      data.listTasks().some((t) => t.title === "Refactor the parser"),
    ).toBe(true);
    renderer.destroy();
  });

  test("/ filters the task list live", async () => {
    const { captureCharFrame, goToTab, press, type, renderer } = await mount();

    // The filter runs inside the current tab, and "milk" is a done task.
    await goToTab("all");

    await press("/");
    await type("milk");

    const frame = captureCharFrame();
    expect(frame).toContain("Buy oat milk");
    expect(frame).not.toContain("Refactor the parser");
    renderer.destroy();
  });

  test("o cycles the sort order", async () => {
    const { captureCharFrame, press, renderer } = await mount();

    // Due is the opening sort, so the wheel goes on to priority.
    expect(captureCharFrame()).toContain("⇅ Due date");
    await press("o");
    expect(captureCharFrame()).toContain("⇅ Priority");
    renderer.destroy();
  });

  test("S opens statistics", async () => {
    const { captureCharFrame, press, renderer } = await mount();

    await press("S");

    const frame = captureCharFrame();
    expect(frame).toContain("Statistics");
    expect(frame).toContain("OPEN BY PRIORITY");
    renderer.destroy();
  });

  test("narrow terminals collapse to a single column", async () => {
    const { captureCharFrame, press, renderer } = await mount(50, 20);

    const list = captureCharFrame();
    expect(list).toContain("● Active");
    expect(list).toContain("2 tasks · l details");
    expect(list.split("\n")[18]).toMatch(/^  l  details /);
    expect(list).toContain("Refactor the parser");
    // The detail panel is not on screen while the list is focused.
    expect(list).not.toContain("OPEN BY PRIORITY");
    expect(list).not.toContain("Created    ");

    // l swaps the single column to the detail view, h goes back.
    await press("l");
    const detail = captureCharFrame();
    expect(detail).toContain("Refactor the parser");
    expect(detail).toContain("Created");
    expect(detail).toContain("h back");

    await press("h");
    expect(captureCharFrame()).toContain("Refactor the parser");
    renderer.destroy();
  });
});

describe("TUI mouse", () => {
  test("clicking a tab switches views", async () => {
    const { captureCharFrame, click, renderer } = await mount();

    const frame = captureCharFrame();
    const headerRow = frame.split("\n")[0]!;
    const column = headerRow.indexOf("Journal");
    expect(column).toBeGreaterThan(0);

    await click(column + 1, 0);

    expect(captureCharFrame()).toContain("Shipped the opentui port");
    renderer.destroy();
  });

  test("clicking a row selects it", async () => {
    const { captureCharFrame, click, goToTab, renderer } = await mount();

    // The list opens on Active, which hides the done task used here.
    await goToTab("all");

    const lines = captureCharFrame().split("\n");
    const row = lines.findIndex((l) => l.includes("Buy oat milk"));
    expect(row).toBeGreaterThan(0);

    await click(10, row);

    expect(captureCharFrame()).toContain("Buy oat milk");
    renderer.destroy();
  });
});

describe("TUI flows", () => {
  test("t adds a subtask through the prompt dialog", async () => {
    const { captureCharFrame, press, type, data, renderer } = await mount();

    await press("t");
    expect(captureCharFrame()).toContain("New subtask");

    await type("Write the plan");
    await press("RETURN");

    const refactor = data
      .listTasks()
      .find((t) => t.title === "Refactor the parser")!;
    expect(refactor.subtasks.map((s) => s.title)).toEqual(["Write the plan"]);
    expect(captureCharFrame()).toContain("Write the plan");
    renderer.destroy();
  });

  test("e edits the selected task", async () => {
    const { captureCharFrame, press, type, data, renderer } = await mount();

    await press("e");
    expect(captureCharFrame()).toContain("Edit task");

    await type(" v2");
    await press("s", { ctrl: true });

    expect(
      data.listTasks().some((t) => t.title === "Refactor the parser v2"),
    ).toBe(true);
    renderer.destroy();
  });

  test("the task form rejects an invalid due date", async () => {
    const { captureCharFrame, press, type, renderer } = await mount();

    await press("a");
    await type("Broken date");
    await press("TAB");
    await press("TAB");
    await type("31/12/2026");
    await press("s", { ctrl: true });

    expect(captureCharFrame()).toContain("Due date must be YYYY-MM-DD");
    renderer.destroy();
  });

  test("a in the journal view adds an entry", async () => {
    const { captureCharFrame, goToTab, press, type, data, renderer } =
      await mount();

    await goToTab("journal");
    await press("a");
    expect(captureCharFrame()).toContain("Journal entry");

    await type("Second entry");
    // Journal entries are multiline, so ctrl+s saves instead of enter.
    await press("s", { ctrl: true });

    const entries = data.listNotes(false)[0]!.entries.map((e) => e.body);
    expect(entries).toContain("Second entry");
    expect(captureCharFrame()).toContain("Second entry");
    renderer.destroy();
  });

  test("# toggles the tag bar and filters by tag", async () => {
    const { captureCharFrame, press, click, renderer } = await mount();

    await press("#");
    const frame = captureCharFrame();
    expect(frame).toContain("#work");
    expect(frame).toContain("#code");

    const row = frame.split("\n").findIndex((l) => l.includes("tags "));
    const column = frame.split("\n")[row]!.indexOf("#work");
    await click(column + 1, row);

    const filtered = captureCharFrame();
    expect(filtered).toContain("Write the report");
    expect(filtered).not.toContain("Buy oat milk");
    renderer.destroy();
  });

  test("f starts the focus timer and shows it in the header", async () => {
    const { captureCharFrame, press, renderer } = await mount();

    await press("f");
    const header = captureCharFrame().split("\n")[0]!;

    expect(header).toContain("Focus");
    expect(header).toMatch(/\d\d:\d\d/);
    renderer.destroy();
  });

  test("T switches between light and dark without losing content", async () => {
    const { captureCharFrame, press, renderer } = await mount();

    await press("T");
    expect(captureCharFrame()).toContain("Refactor the parser");

    await press("T");
    expect(captureCharFrame()).toContain("Refactor the parser");
    renderer.destroy();
  });

  test("escape clears an active filter", async () => {
    const { captureCharFrame, press, type, renderer } = await mount();

    await press("/");
    await type("milk");
    expect(captureCharFrame()).not.toContain("Refactor the parser");

    await press("ESCAPE");
    expect(captureCharFrame()).toContain("Refactor the parser");
    renderer.destroy();
  });
});

describe("TUI overlays", () => {
  test("escape closes the task form without saving", async () => {
    const { captureCharFrame, press, type, data, renderer } = await mount();

    await press("a");
    await type("Never saved");
    expect(captureCharFrame()).toContain("Never saved");

    await press("ESCAPE");

    expect(captureCharFrame()).not.toContain("New task");
    expect(data.listTasks().some((t) => t.title === "Never saved")).toBe(false);
    renderer.destroy();
  });

  test("escape closes the command palette", async () => {
    const { captureCharFrame, press, renderer } = await mount();

    await press("k", { ctrl: true });
    expect(captureCharFrame()).toContain("Command palette");

    await press("ESCAPE");
    expect(captureCharFrame()).not.toContain("Command palette");
    renderer.destroy();
  });

  test("a confirmation can be cancelled with n", async () => {
    const { captureCharFrame, press, data, renderer } = await mount();

    await press("d");
    await press("n");

    expect(captureCharFrame()).not.toContain("Delete task");
    expect(
      data.listTasks().some((t) => t.title === "Refactor the parser"),
    ).toBe(true);
    renderer.destroy();
  });

  test("running a palette action opens the matching dialog", async () => {
    const { captureCharFrame, press, type, renderer } = await mount();

    await press("k", { ctrl: true });
    await type("log time");
    await press("RETURN");

    expect(captureCharFrame()).toContain("Log time");
    renderer.destroy();
  });
});

describe("TUI settings", () => {
  test("P opens focus settings and enter saves them", async () => {
    // Settings are persisted, so point the config at a throwaway directory.
    const previousHome = process.env.RONDO_HOME;
    process.env.RONDO_HOME = mkdtempSync(join(tmpdir(), "rondo-settings-"));
    const { captureCharFrame, press, data, renderer } = await mount();

    await press("P");
    expect(captureCharFrame()).toContain("Settings");
    expect(captureCharFrame()).toContain("Work duration (min)");

    await press("l");
    await press("RETURN");

    expect(data.cfg.focus.workDuration).toBe(26);
    expect(captureCharFrame()).toContain("Settings saved");
    expect(
      JSON.parse(
        readFileSync(join(process.env.RONDO_HOME!, "config.json"), "utf8"),
      ).focus.work_duration_min,
    ).toBe(26);

    renderer.destroy();
    if (previousHome === undefined) delete process.env.RONDO_HOME;
    else process.env.RONDO_HOME = previousHome;
  });

  test("F2 sorts by due date and < resizes the panels", async () => {
    const { captureCharFrame, press, renderer } = await mount();

    await press("F2");
    expect(captureCharFrame()).toContain("⇅ Due date");

    // The list panel's top-right corner marks where the divider sits.
    const dividerAt = () => captureCharFrame().split("\n")[1]!.indexOf("╮");
    const before = dividerAt();
    expect(before).toBeGreaterThan(0);

    await press("<");
    expect(dividerAt()).toBeLessThan(before);
    renderer.destroy();
  });
});

describe("TUI scrolling", () => {
  test("the selected row is kept in view while moving down a long list", async () => {
    const data = seed();
    for (let i = 0; i < 40; i++) {
      const t = newTask({ title: `Filler task ${i}` });
      data.tasks.create(t);
    }

    let setup!: Awaited<ReturnType<typeof testRender>>;
    await act(async () => {
      setup = await testRender(<App data={data} />, { width: 90, height: 16 });
    });
    await setup.flush();

    for (let i = 0; i < 30; i++) {
      await act(async () => {
        setup.mockInput.pressKey("j");
      });
    }
    // Scrolling is animated, so let the last hop finish before asserting.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    await setup.flush();

    // The cursor marker must still be on screen after scrolling far down.
    const frame = setup.captureCharFrame();
    expect(frame).toContain("┃");
    // …and the row after it, so the cursor never sits on the bottom edge.
    // Short terminals pack one-line rows without a gap, so it is adjacent.
    const cursorRow = frame.split("\n").findIndex((l) => l.includes("┃"));
    expect(frame.split("\n").length).toBeGreaterThan(cursorRow + 1);
    expect(frame.split("\n")[cursorRow + 1]).toContain("Filler task");
    setup.renderer.destroy();
  });
});

describe("TUI inputs", () => {
  test("the description field is a real multiline textarea", async () => {
    const { captureCharFrame, press, type, data, renderer } = await mount();

    await press("a");
    await type("Multi line task");
    await press("TAB"); // move to the description textarea
    await type("first line");
    await press("RETURN"); // stays inside the textarea instead of submitting
    await type("second line");
    expect(captureCharFrame()).toContain("New task");

    await press("s", { ctrl: true });

    const created = data.listTasks().find((t) => t.title === "Multi line task")!;
    expect(created.description).toBe("first line\nsecond line");
    renderer.destroy();
  });

  test("clicking a date shortcut fills the due field", async () => {
    const { captureCharFrame, press, type, click, data, renderer } = await mount();

    await press("a");
    await type("Pick a date");

    // "+1w" only appears in the shortcut row, so it is a safe anchor.
    const lines = captureCharFrame().split("\n");
    const row = lines.findIndex((l) => l.includes("+1w"));
    const column = lines[row]!.indexOf("tomorrow");
    expect(row).toBeGreaterThan(0);

    await click(column + 1, row);

    const tomorrow = GoTime.now().addDate(0, 0, 1).format("2006-01-02");
    expect(captureCharFrame()).toContain(tomorrow);

    await press("s", { ctrl: true });
    const created = data.listTasks().find((t) => t.title === "Pick a date")!;
    expect(created.dueDate?.format("2006-01-02")).toBe(tomorrow);
    renderer.destroy();
  });

  test("journal entries use a multiline prompt", async () => {
    const { captureCharFrame, goToTab, press, type, data, renderer } =
      await mount();

    await goToTab("journal");
    await press("a");
    expect(captureCharFrame()).toContain("ctrl+s save · enter new line");

    await type("line one");
    await press("RETURN");
    await type("line two");
    await press("s", { ctrl: true });

    const bodies = data.listNotes(false)[0]!.entries.map((e) => e.body);
    expect(bodies).toContain("line one\nline two");
    renderer.destroy();
  });

  test("subtask prompts stay single line", async () => {
    const { captureCharFrame, press, renderer } = await mount();

    await press("t");
    expect(captureCharFrame()).toContain("enter save · esc cancel");
    renderer.destroy();
  });
});

describe("TUI list density", () => {
  test("overdue rows use a compact marker instead of shouting OVERDUE", async () => {
    const data = seed();
    const late = newTask({
      title: "Late task",
      dueDate: GoTime.now().addDate(0, 0, -30),
    });
    data.tasks.create(late);

    let setup!: Awaited<ReturnType<typeof testRender>>;
    await act(async () => {
      setup = await testRender(<App data={data} />, { width: 90, height: 20 });
    });
    await setup.flush();

    // Only look at the list column; the detail panel keeps the full wording.
    const listColumn = setup
      .captureCharFrame()
      .split("\n")
      .map((line) => line.slice(0, line.indexOf("│ │") + 1))
      .join("\n");

    // The due sort files the task under an OVERDUE header; the row itself
    // carries only the relative label.
    const lines = listColumn.split("\n");
    const row = lines.findIndex((l) => l.includes("Late task"));
    expect(row).toBeGreaterThan(0);
    expect(`${lines[row]}\n${lines[row + 1]}`).not.toContain("OVERDUE");
    expect(lines[row + 1]).toContain("30d late");
    setup.renderer.destroy();
  });

  test("completed tasks show their completion date instead of metadata", async () => {
    const { captureCharFrame, data, goToTab, renderer } = await mount(90, 20);

    // The list opens on Active, which hides the done task used here.
    await goToTab("all");

    // Only the list column: the detail panel repeats the title.
    const lines = captureCharFrame()
      .split("\n")
      .map((line) => line.slice(0, line.indexOf("│ │") + 1));
    const doneRow = lines.findIndex((l) => l.includes("Buy oat milk"));
    expect(doneRow).toBeGreaterThan(0);
    const milk = data.listTasks().find((t) => t.title === "Buy oat milk")!;
    expect(lines[doneRow + 1]).toContain(`✓ ${formatDate(data.cfg, milk.updatedAt)}`);
    expect(lines[doneRow + 1]).not.toContain("#");
    expect(lines[doneRow + 1]).not.toContain("/");
    renderer.destroy();
  });

  test("tags are trimmed with a counter instead of wrapping", async () => {
    const data = seed();
    const many = newTask({
      title: "Tagged task",
      tags: ["alpha", "beta", "gamma", "delta"],
      dueDate: GoTime.now(),
    });
    data.tasks.create(many);

    let setup!: Awaited<ReturnType<typeof testRender>>;
    await act(async () => {
      setup = await testRender(<App data={data} />, { width: 120, height: 20 });
    });
    await setup.flush();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("#alpha #beta +2");
    // Only the first two tags are shown; the rest collapse into the counter.
    const taggedRow = frame
      .split("\n")
      .find((line) => line.includes("#alpha"))!;
    expect(taggedRow).not.toContain("#gamma");
    setup.renderer.destroy();
  });
});

describe("TUI review fixes", () => {
  test("h navigates back in the journal instead of hiding the note", async () => {
    const { captureCharFrame, goToTab, press, renderer } = await mount();

    await goToTab("journal");
    await press("l");
    await press("h");

    const frame = captureCharFrame();
    expect(frame).not.toContain("Note hidden");
    expect(frame).toContain("● Journal");
    renderer.destroy();
  });

  test("x hides the selected journal note", async () => {
    const { captureCharFrame, goToTab, press, renderer } = await mount();

    await goToTab("journal");
    await press("x");

    expect(captureCharFrame()).toContain("Note hidden");
    renderer.destroy();
  });

  test("the palette hides task actions while the journal is open", async () => {
    const { captureCharFrame, goToTab, press, type, renderer } = await mount();

    await goToTab("journal");
    await press("k", { ctrl: true });
    await type("cycle status");

    expect(captureCharFrame()).toContain("No matching command");
    renderer.destroy();
  });

  test("the search counter totals the current tab, not every task", async () => {
    const { captureCharFrame, press, renderer } = await mount();

    await press("/");
    expect(captureCharFrame()).toContain("2/2");
    renderer.destroy();
  });

  test("the list footer counts only the current tab", async () => {
    const { captureCharFrame, renderer } = await mount();
    expect(captureCharFrame()).toContain("2 tasks");
    renderer.destroy();
  });

  test("an applied filter stays visible after enter", async () => {
    const { captureCharFrame, press, type, renderer } = await mount();

    await press("/");
    await type("report");
    await press("RETURN");

    expect(captureCharFrame()).toContain("1/2");
    renderer.destroy();
  });

  test("the journal hides the sort indicator", async () => {
    const { captureCharFrame, goToTab, renderer } = await mount();

    await goToTab("journal");
    expect(captureCharFrame()).not.toContain("⇅");
    renderer.destroy();
  });

  test("/ searches the journal by entry text", async () => {
    const { captureCharFrame, goToTab, press, type, renderer } = await mount();

    await goToTab("journal");
    await press("/");
    await type("zzzz");

    expect(captureCharFrame()).toContain("0/1");
    renderer.destroy();
  });

  test("enter does not confirm a delete", async () => {
    const { captureCharFrame, press, renderer } = await mount();

    await press("d");
    expect(captureCharFrame()).toContain("Delete task");

    await press("RETURN");
    expect(captureCharFrame()).toContain("Delete task");

    await press("y");
    expect(captureCharFrame()).not.toContain("Delete task");
    renderer.destroy();
  });

  test("an empty prompt shows an error instead of doing nothing", async () => {
    const { captureCharFrame, press, renderer } = await mount();

    await press("t");
    await press("RETURN");

    expect(captureCharFrame()).toContain("Cannot be empty");
    renderer.destroy();
  });

  test("q asks before quitting while a focus session runs", async () => {
    const { captureCharFrame, press, renderer } = await mount();

    await press("f");
    await press("q");

    expect(captureCharFrame()).toContain("focus session is running");
    renderer.destroy();
  });

  test("the palette scrolls past the first ten actions", async () => {
    const { captureCharFrame, press, renderer } = await mount();

    await press("k", { ctrl: true });
    for (let i = 0; i < 30; i++) await press("n", { ctrl: true });

    expect(captureCharFrame()).toContain("Go to Journal");
    renderer.destroy();
  });

  test("a time log accepts a trailing note", async () => {
    const { captureCharFrame, press, type, renderer } = await mount();

    await press("L");
    await type("45m fixing build");
    await press("RETURN");

    const frame = captureCharFrame();
    expect(frame).toContain("Logged 45m");
    expect(frame).toContain("fixing build");
    renderer.destroy();
  });

  test("the due field accepts typed shortcuts like tomorrow", async () => {
    const { captureCharFrame, press, type, data, renderer } = await mount();

    await press("a");
    await type("Ship it");
    await press("TAB");
    await press("TAB");
    await type("tomorrow");
    await press("s", { ctrl: true });

    expect(captureCharFrame()).not.toContain("Due date must be");
    const created = data.listTasks().find((t) => t.title === "Ship it")!;
    expect(created.dueDate).not.toBeNull();
    renderer.destroy();
  });

  test("statistics name the states like the tabs do", async () => {
    const { captureCharFrame, press, renderer } = await mount();

    await press("S");
    const frame = captureCharFrame();
    expect(frame).toContain("in progress");
    expect(frame).toContain("todo");
    renderer.destroy();
  });

  test("a blocker can be added from the palette", async () => {
    const { captureCharFrame, press, type, renderer } = await mount();

    await press("k", { ctrl: true });
    await type("block on");
    await press("RETURN");
    expect(captureCharFrame()).toContain("Block on");

    await press("RETURN");
    expect(captureCharFrame()).toContain("BLOCKED");
    renderer.destroy();
  });

  test("the subtask panel gets its own key hints", async () => {
    const { captureCharFrame, press, renderer } = await mount();

    await press("RETURN");
    expect(captureCharFrame()).toContain("toggle");
    renderer.destroy();
  });

  test("the header names the task under focus", async () => {
    const { captureCharFrame, press, renderer } = await mount(120);

    await press("f");
    expect(captureCharFrame().split("\n")[0]).toContain("Refactor the parser");
    renderer.destroy();
  });

  test("escape leaves the detail panel before clearing the filter", async () => {
    const { captureCharFrame, press, type, renderer } = await mount();

    await press("/");
    await type("re");
    await press("RETURN");
    await press("RETURN"); // into the detail panel

    await press("ESCAPE");
    expect(captureCharFrame()).toContain("2/2"); // filter bar still applied

    await press("ESCAPE");
    expect(captureCharFrame()).not.toContain("2/2");
    expect(captureCharFrame()).toContain("2 tasks");
    renderer.destroy();
  });

  test("q keeps the help overlay open", async () => {
    const { captureCharFrame, press, renderer } = await mount();

    await press("?");
    await press("q");
    expect(captureCharFrame()).toContain("Keyboard & mouse");
    renderer.destroy();
  });

  test("H reveals hidden notes after x hides one", async () => {
    const { captureCharFrame, goToTab, press, renderer } = await mount();

    await goToTab("journal");
    await press("x");
    expect(captureCharFrame()).toContain("Note hidden");

    await press("H");
    const frame = captureCharFrame();
    expect(frame).toContain("Showing hidden notes");
    expect(frame).toContain("·hidden");
    renderer.destroy();
  });

  test("T persists the chosen theme", async () => {
    const { press, renderer } = await mount();

    await press("T");
    const cfg = JSON.parse(
      readFileSync(join(process.env.RONDO_HOME!, "config.json"), "utf8"),
    );
    expect(cfg.theme).toBe("light");
    renderer.destroy();
  });

  test("resizing the panels persists the ratio once the keys settle", async () => {
    const { press, data, renderer } = await mount();

    await press("<");
    // Like a drag, the key writes once, after a pause, not per press.
    expect(data.cfg.panelRatio).toBeCloseTo(0.4);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 500));
    });
    expect(data.cfg.panelRatio).toBeCloseTo(0.35);
    const saved = JSON.parse(
      readFileSync(join(process.env.RONDO_HOME!, "config.json"), "utf8"),
    );
    expect(saved.panel_ratio).toBeCloseTo(0.35);
    renderer.destroy();
  });
});

describe("TUI long titles", () => {
  const LONG =
    "Titulo enormemente largo numero uno para la prueba de edicion con " +
    "textarea y mas texto de relleno al final para que el input solo " +
    "muestre la cola";

  async function createLongTask(m: Awaited<ReturnType<typeof mount>>) {
    await m.press("a");
    await m.type(LONG);
    await m.press("s", { ctrl: true });
  }

  test("a long title stays on one row in the list", async () => {
    const m = await mount();
    await createLongTask(m);

    // Only the list panel: the detail panel repeats the title on the right.
    const lines = captureLines(m).map((l) => l.slice(0, 40));
    const row = lines.findIndex((l) => l.includes("Titulo enorme"));
    expect(row).toBeGreaterThan(0);
    expect(lines[row]).toMatch(/○ Titulo/);
    expect(lines[row + 1]).not.toContain("para la prueba");
    m.renderer.destroy();
  });

  test("editing shows the whole long title, not just its tail", async () => {
    const m = await mount();
    await createLongTask(m);

    await m.press("e");
    const lines = m.captureCharFrame().split("\n");
    const start = lines.findIndex((l) => l.includes("Title"));
    const end = lines.findIndex((l) => l.includes("Description"));
    expect(start).toBeGreaterThan(0);
    const titleBox = lines.slice(start, end).join("\n");
    // Both ends of the title must be inside the field at once.
    expect(titleBox).toContain("numero uno");
    expect(titleBox).toContain("muestre la cola");
    m.renderer.destroy();
  });

  test("enter on the title still submits the form", async () => {
    const m = await mount();

    await m.press("a");
    await m.type("Quick entry task");
    await m.press("RETURN");

    expect(m.data.listTasks().some((t) => t.title === "Quick entry task")).toBe(
      true,
    );
    m.renderer.destroy();
  });

  function captureLines(m: { captureCharFrame: () => string }): string[] {
    return m.captureCharFrame().split("\n");
  }
});

describe("TUI review 2 fixes", () => {
  test("editing a long subtask shows the middle of its title", async () => {
    const m = await mount();
    const LONG_SUB =
      "Paso inicial de la subtarea AAA con fragmento central unico BBB y " +
      "despues un final suficientemente largo para desplazar el texto";

    await m.press("t");
    await m.type(LONG_SUB);
    await m.press("RETURN");

    await m.press("RETURN"); // into the subtask panel
    await m.press("e");

    const frame = m.captureCharFrame();
    expect(frame).toContain("Edit subtask");
    // Start and middle visible at once; word wrap may split any two words.
    expect(frame).toContain("Paso inicial");
    expect(frame).toContain("fragmento central");
    m.renderer.destroy();
  });

  test("the task form offers existing tags as chips", async () => {
    const { captureCharFrame, press, renderer } = await mount();

    await press("a");
    expect(captureCharFrame()).toContain("#work");
    renderer.destroy();
  });

  test("settings render booleans as toggles and expose the theme", async () => {
    const { captureCharFrame, press, renderer } = await mount();

    await press("P");
    const frame = captureCharFrame();
    expect(frame).toContain("▣ on");
    expect(frame).toContain("▢ off");
    expect(frame).toContain("Theme");
    renderer.destroy();
  });

  test("the repeats control capitalizes like the priority one", async () => {
    const { captureCharFrame, press, renderer } = await mount();

    await press("a");
    expect(captureCharFrame()).toContain("Week");
    renderer.destroy();
  });
});

describe("TUI review 3 — header and focus", () => {
  const TAB_LABELS = TABS.map((t) => t.label);

  /** A header row is intact when nothing in it was squeezed or clipped. */
  function expectIntact(header: string) {
    expect(header).toContain("RonDO");
    for (const label of TAB_LABELS) expect(header).toContain(label);
    expect(header).toMatch(/\d\d:\d\d\s*$/);
  }

  /** A 60 ms work session; breaks keep their real length so they outlive a test. */
  function fastFocus() {
    const cfg = defaultConfig();
    cfg.focus.workDuration = 0.001;
    cfg.focus.sound = false;
    return cfg;
  }

  test("80 columns: the header keeps brand, tabs and timer during a session", async () => {
    const { captureCharFrame, press, renderer } = await mount(80, 24);

    expectIntact(captureCharFrame().split("\n")[0]!);

    await press("f");
    const header = captureCharFrame().split("\n")[0]!;
    expectIntact(header);
    expect(header).toMatch(/Focus \d\d:\d\d/);
    expect(header.length).toBeLessThanOrEqual(80);
    renderer.destroy();
  });

  test("digit keycaps sit before each tab label", async () => {
    const { captureCharFrame, renderer } = await mount();
    const header = captureCharFrame().split("\n")[0]!;

    TABS.forEach((tab, index) => {
      expect(header).toContain(`${index + 1} ${tab.label}`);
    });
    renderer.destroy();
  });

  test("compact header keeps text labels and drops the icons", async () => {
    const { captureCharFrame, renderer } = await mount(60, 20);
    const header = captureCharFrame().split("\n")[0]!;

    expect(header).toContain("Active 2");
    expect(header).toContain("Done 1");
    expect(header).toContain("All 3");
    expect(header).toContain("Journal 1");
    expect(header).not.toContain("◐");
    expect(header).not.toContain("▤");
    expect(header).not.toContain("1 Active");
    renderer.destroy();
  });

  test("idle header shows what f would start", async () => {
    const { captureCharFrame, press, renderer } = await mount();

    expect(captureCharFrame().split("\n")[0]).toContain("next: Focus 25m");

    await press("f");
    const running = captureCharFrame().split("\n")[0]!;
    expect(running).not.toContain("next:");
    expect(running).toMatch(/Focus (25:00|24:59)/);
    renderer.destroy();
  });

  test("a finished focus session is logged to its task", async () => {
    const { captureCharFrame, press, data, renderer, flush } = await mount(
      100,
      30,
      fastFocus(),
    );

    await press("f");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });
    await flush();

    const frame = captureCharFrame();
    expect(frame).toContain("Focus complete");
    expect(frame).toContain("logged to #3");
    const logs = data.tasks.getById(3)!.timeLogs;
    expect(logs).toHaveLength(1);
    expect(logs[0]!.note).toBe("focus session");
    expect(logs[0]!.duration).toBe(0.001 * Minute);
    // The detail panel picked the log up without a manual reload.
    expect(frame).toContain("focus session");
    renderer.destroy();
  });

  test("stopping a queued break re-arms focus, not another break", async () => {
    const { captureCharFrame, press, renderer, flush } = await mount(
      100,
      30,
      fastFocus(),
    );

    await press("f");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });
    await flush();
    expect(captureCharFrame().split("\n")[0]).toContain("next: Break 5m");

    await press("f");
    expect(captureCharFrame().split("\n")[0]).toMatch(/Break 0(5:00|4:59)/);

    await press("f");
    expect(captureCharFrame().split("\n")[0]).toContain("next: Focus 0m");
    renderer.destroy();
  });
});

describe("TUI review 3 — task form and settings", () => {
  const DUE_PREVIEW = "Mon, Jan 02";

  /** Rows of the frame from the overlay title down to its footer line. */
  function overlayRows(frame: string): string[] {
    const lines = frame.split("\n");
    const top = lines.findIndex((l) => l.includes("New task"));
    const bottom = lines.findIndex((l, i) => i > top && l.includes("esc cancel"));
    expect(top).toBeGreaterThan(0);
    expect(bottom).toBeGreaterThan(top);
    return lines.slice(top, bottom + 1);
  }

  test("80×24: the compact form keeps every field, chip and the footer", async () => {
    const { captureCharFrame, press, renderer } = await mount(80, 24);

    await press("a");
    const frame = captureCharFrame();
    const rows = overlayRows(frame);
    const text = rows.join("\n");
    for (const label of ["Title", "Description", "Due date", "Tags", "Priority", "Repeats"]) {
      expect(text).toContain(label);
    }
    for (const chip of ["today", "tomorrow", "+1w", "#work"]) {
      expect(text).toContain(chip);
    }
    for (const option of ["Low", "Medium", "High", "Urgent", "None", "Week"]) {
      expect(text).toContain(option);
    }
    // The footer already says how to save, so the buttons row is gone.
    expect(text).not.toContain("Save");
    expect(text).toContain("enter (title) / ctrl+s save · tab field · esc cancel");
    // The overlay ends above the status bar: nothing runs off-screen.
    const bottom = frame.split("\n").findIndex((l) => l.includes("esc cancel"));
    expect(bottom).toBeLessThan(23);
    // Priority and Repeats share a row, each in its own frame.
    const priorityRow = rows.findIndex((l) => l.includes("Priority"));
    expect(rows[priorityRow]).toContain("Repeats");
    renderer.destroy();
  });

  test("60×20: the compact form still fits with an error shown", async () => {
    const { captureCharFrame, press, type, renderer } = await mount(60, 20);

    await press("a");
    await type("Tiny");
    await press("TAB");
    await press("TAB");
    await type("31/12/2026");
    await press("s", { ctrl: true });

    const frame = captureCharFrame();
    const text = overlayRows(frame).join("\n");
    expect(text).toContain("Due date must be");
    for (const label of ["Title", "Description", "Due date", "Tags", "Priority", "Repeats"]) {
      expect(text).toContain(label);
    }
    expect(text).toContain("tomorrow");
    expect(text).toContain("◂ Low ▸");
    expect(text).toContain("◂ None ▸");
    renderer.destroy();
  });

  test("below 80 columns the segmented controls become clickable steppers", async () => {
    const { captureCharFrame, press, type, click, data, renderer } = await mount(70, 24);

    await press("a");
    await type("Stepped");
    const lines = captureCharFrame().split("\n");
    const row = lines.findIndex((l) => l.includes("◂ Low ▸"));
    expect(row).toBeGreaterThan(0);
    const left = lines[row]!.indexOf("◂ Low");
    const right = lines[row]!.indexOf("▸", left);

    await click(right, row);
    expect(captureCharFrame()).toContain("◂ Medium ▸");

    await click(left, row);
    expect(captureCharFrame()).toContain("◂ Low ▸");

    await click(right, row);
    await press("s", { ctrl: true });
    const created = data.listTasks().find((t) => t.title === "Stepped")!;
    expect(created.priority).toBe(Priority.Medium);
    renderer.destroy();
  });

  test("wide terminals keep the segmented controls on one row", async () => {
    const { captureCharFrame, press, renderer } = await mount(100, 30);

    await press("a");
    const lines = captureCharFrame().split("\n");
    const row = lines.find((l) => l.includes("Urgent"));
    expect(row).toBeDefined();
    for (const option of ["Low", "Medium", "High", "Urgent", "None", "Day", "Week", "Month", "Year"]) {
      expect(row).toContain(option);
    }
    expect(captureCharFrame()).not.toContain("◂");
    renderer.destroy();
  });

  test("a click on the scrim closes a pristine form but keeps a typed one", async () => {
    const { captureCharFrame, press, type, click, data, renderer } = await mount(100, 30);

    await press("a");
    expect(captureCharFrame()).toContain("New task");
    await click(1, 5);
    expect(captureCharFrame()).not.toContain("New task");

    await press("a");
    await type("Half typed");
    await click(1, 5);
    expect(captureCharFrame()).toContain("New task");
    expect(captureCharFrame()).toContain("Half typed");

    // The close button and escape still discard.
    const lines = captureCharFrame().split("\n");
    const titleRow = lines.findIndex((l) => l.includes("New task"));
    await click(lines[titleRow]!.indexOf("✕"), titleRow);
    expect(captureCharFrame()).not.toContain("New task");

    await press("a");
    await type("Half typed again");
    await press("ESCAPE");
    expect(captureCharFrame()).not.toContain("New task");
    expect(data.listTasks().some((t) => t.title.startsWith("Half typed"))).toBe(false);
    renderer.destroy();
  });

  test("a click on the scrim closes pristine settings but keeps changed ones", async () => {
    const previousHome = process.env.RONDO_HOME;
    process.env.RONDO_HOME = mkdtempSync(join(tmpdir(), "rondo-settings-"));
    const { captureCharFrame, press, click, data, renderer } = await mount(100, 30);

    await press("P");
    expect(captureCharFrame()).toContain("Work duration (min)");
    await click(1, 5);
    expect(captureCharFrame()).not.toContain("Work duration (min)");

    await press("P");
    await press("l");
    await click(1, 5);
    expect(captureCharFrame()).toContain("Work duration (min)");

    await press("ESCAPE");
    expect(captureCharFrame()).not.toContain("Work duration (min)");
    expect(data.cfg.focus.workDuration).toBe(25);

    renderer.destroy();
    if (previousHome === undefined) delete process.env.RONDO_HOME;
    else process.env.RONDO_HOME = previousHome;
  });

  test("ctrl+s saves the settings like enter does", async () => {
    const previousHome = process.env.RONDO_HOME;
    process.env.RONDO_HOME = mkdtempSync(join(tmpdir(), "rondo-settings-"));
    const { captureCharFrame, press, data, renderer } = await mount(100, 30);

    await press("P");
    expect(captureCharFrame()).toContain(
      "↑↓ field · ←→ / space change · enter / ctrl+s save · esc cancel",
    );
    await press("l");
    await press("s", { ctrl: true });

    expect(data.cfg.focus.workDuration).toBe(26);
    expect(captureCharFrame()).toContain("Settings saved");

    renderer.destroy();
    if (previousHome === undefined) delete process.env.RONDO_HOME;
    else process.env.RONDO_HOME = previousHome;
  });

  test("the task form names its save keys once, in the footer", async () => {
    const { captureCharFrame, press, renderer } = await mount(100, 30);

    await press("a");
    const frame = captureCharFrame();
    expect(frame).toContain("enter (title) / ctrl+s save · tab field · esc cancel");
    expect(frame).not.toContain("tab move");
    expect(frame.split("ctrl+s save")).toHaveLength(2);
    renderer.destroy();
  });

  test("the due field previews the parsed date while typing", async () => {
    const { captureCharFrame, press, type, renderer } = await mount(100, 30);

    await press("a");
    await type("Preview me");
    await press("TAB");
    await press("TAB");
    await type("tomorrow");
    const tomorrow = GoTime.now().addDate(0, 0, 1).format(DUE_PREVIEW);
    expect(captureCharFrame()).toContain(`→ ${tomorrow}`);

    for (let i = 0; i < "tomorrow".length; i++) await press("BACKSPACE");
    await type("31/12");
    expect(captureCharFrame()).toContain("→ invalid");
    expect(captureCharFrame()).not.toContain("Due date must be");
    renderer.destroy();
  });

  test("the compact form previews the due date in the frame title", async () => {
    const { captureCharFrame, press, type, renderer } = await mount(80, 24);

    await press("a");
    await press("TAB");
    await press("TAB");
    await type("+1w");
    const week = GoTime.now().addDate(0, 0, 7).format(DUE_PREVIEW);
    expect(captureCharFrame()).toContain(`Due date → ${week}`);
    renderer.destroy();
  });

  test("quick-add tokens in the title preview and then fill the fields", async () => {
    const { captureCharFrame, press, type, data, renderer } = await mount(100, 30);

    await press("a");
    expect(captureCharFrame()).toContain("What needs doing?  #tag @tomorrow !3 ~w");
    await type("Ship it #infra @tomorrow !3 ~w");
    const tomorrow = GoTime.now().addDate(0, 0, 1);
    expect(captureCharFrame()).toContain(
      `→ #infra · ${tomorrow.format(DUE_PREVIEW)} · High · weekly`,
    );

    await press("RETURN");
    const created = data.listTasks().find((t) => t.title === "Ship it")!;
    expect(created).toBeDefined();
    expect(created.tags).toEqual(["infra"]);
    expect(created.priority).toBe(Priority.High);
    expect(created.recurFreq).toBe(RecurFreq.Weekly);
    expect(created.dueDate?.format("2006-01-02")).toBe(tomorrow.format("2006-01-02"));
    expect(captureCharFrame()).not.toContain("#infra @tomorrow");
    renderer.destroy();
  });

  test("quick-add tags merge with the tag field and existing tags when editing", async () => {
    const { captureCharFrame, press, type, data, renderer } = await mount(100, 30);

    // Second row is "Write the report", which already carries #work.
    await press("j");
    await press("e");
    expect(captureCharFrame()).toContain("Edit task");
    expect(captureCharFrame()).toContain("Write the report");
    await type(" #infra #work");
    await press("s", { ctrl: true });

    const task = data.listTasks().find((t) => t.title === "Write the report")!;
    expect(task.tags).toEqual(["work", "infra"]);
    expect(task.priority).toBe(Priority.High);
    renderer.destroy();
  });

  test("a title made only of tokens is still rejected as empty", async () => {
    const { captureCharFrame, press, type, data, renderer } = await mount(100, 30);

    await press("a");
    await type("#infra !2");
    await press("RETURN");
    expect(captureCharFrame()).toContain("Title is required");
    expect(data.listTasks().some((t) => t.tags.includes("infra"))).toBe(false);
    renderer.destroy();
  });
});

describe("TUI review 3 — dialogs", () => {
  const theme = tuiTheme(true);

  /** Mounts a single component, for dialogs whose wiring lands in the app
   * later than the component itself. */
  async function mountNode(node: ReactNode, width = 80, height = 24) {
    let setup!: Awaited<ReturnType<typeof testRender>>;
    await act(async () => {
      setup = await testRender(node, { width, height });
    });
    await setup.flush();

    const press = async (key: string, modifiers?: { ctrl?: boolean }) => {
      await act(async () => {
        setup.mockInput.pressKey(key, modifiers);
        if (key === "ESCAPE") await new Promise((r) => setTimeout(r, 120));
      });
      await setup.flush();
    };
    const type = async (text: string) => {
      await act(async () => {
        await setup.mockInput.typeText(text);
      });
      await setup.flush();
    };
    const click = async (x: number, y: number) => {
      await act(async () => {
        await setup.mockMouse.click(x, y);
      });
      await setup.flush();
    };
    return { press, type, click, ...setup };
  }

  /** Line index and column of the first occurrence of `needle`. */
  function locate(frame: string, needle: string): { x: number; y: number } {
    const lines = frame.split("\n");
    const y = lines.findIndex((l) => l.includes(needle));
    expect(y).toBeGreaterThanOrEqual(0);
    return { x: lines[y]!.indexOf(needle), y };
  }

  function manyTasks(n: number): Task[] {
    const data = new RondoData(openMemory(), defaultConfig());
    for (let i = 1; i <= n; i++) {
      data.tasks.create(newTask({ title: `Task number ${i}` }));
    }
    return data.listTasks();
  }

  test("60×20: the palette stops above the status bar", async () => {
    const { captureCharFrame, press, renderer } = await mount(60, 20);

    await press("k", { ctrl: true });
    const lines = captureCharFrame().split("\n");

    expect(lines.join("\n")).toContain("↑↓ move · enter run · esc close");
    const bottom = lines.findIndex((l) => l.includes("╰"));
    expect(bottom).toBeLessThanOrEqual(17);
    expect(lines[18]).not.toMatch(/[│╰╯]/);
    expect(lines[18]).toContain("add");
    renderer.destroy();
  });

  test("60×20: the task picker sizes its window to the screen", async () => {
    const onPick = mock((_id: number) => {});
    const { captureCharFrame, press, renderer } = await mountNode(
      <TaskPickerDialog
        theme={theme}
        title="Block on"
        tasks={manyTasks(40)}
        screenWidth={60}
        screenHeight={20}
        onPick={onPick}
        onClose={() => {}}
      />,
      60,
      20,
    );

    let lines = captureCharFrame().split("\n");
    expect(lines.join("\n")).toContain("↑↓ move · enter pick · esc close");
    // 20 rows: the overlay starts on row 2 and leaves the two status bar rows,
    // so 12 body rows remain and the field with its padding takes 5 of them.
    expect(lines.filter((l) => l.includes("Task number")).length).toBe(7);
    expect(lines[18]).not.toMatch(/[│╰╯]/);

    for (let i = 0; i < 39; i++) await press("n", { ctrl: true });
    lines = captureCharFrame().split("\n");
    expect(lines.join("\n")).toContain("Task number 40");
    expect(lines.join("\n")).toContain("↑↓ move · enter pick · esc close");

    await press("RETURN");
    expect(onPick).toHaveBeenCalledWith(40);
    renderer.destroy();
  });

  test("a prompt shows the error its callback returns", async () => {
    const { captureCharFrame, press, type, renderer } = await mountNode(
      <PromptDialog
        theme={theme}
        title="Log time"
        label="Duration"
        screenWidth={80}
        screenHeight={24}
        onSubmit={(value) =>
          value === "45m" ? undefined : "Invalid duration — try 45m or 1h30m"
        }
        onCancel={() => {}}
      />,
    );

    await type("later");
    await press("RETURN");
    expect(captureCharFrame()).toContain("⚠ Invalid duration — try 45m");

    await type("!");
    expect(captureCharFrame()).not.toContain("Invalid duration");
    renderer.destroy();
  });

  test("a stay-open prompt counts what it added and clears the field", async () => {
    const submitted: string[] = [];
    const onCancel = mock(() => {});
    const { captureCharFrame, press, type, renderer } = await mountNode(
      <PromptDialog
        theme={theme}
        title="New subtask"
        label="Subtask for #3"
        stayOpen
        screenWidth={80}
        screenHeight={24}
        onSubmit={(value) => {
          submitted.push(value);
        }}
        onCancel={onCancel}
      />,
    );

    expect(captureCharFrame()).toContain("enter add · esc done");

    await type("Collect numbers");
    await press("RETURN");
    let frame = captureCharFrame();
    expect(frame).toContain("1 added · esc done");
    expect(frame).not.toContain("Collect numbers");

    await type("Draft intro");
    await press("RETURN");
    frame = captureCharFrame();
    expect(frame).toContain("2 added · esc done");
    expect(submitted).toEqual(["Collect numbers", "Draft intro"]);

    await press("RETURN");
    expect(captureCharFrame()).toContain("Cannot be empty");

    await press("ESCAPE");
    expect(onCancel).toHaveBeenCalledTimes(1);
    renderer.destroy();
  });

  test("prompt chips answer a key while the field is empty, and clicks", async () => {
    const submitted: string[] = [];
    const { captureCharFrame, press, type, click, renderer } = await mountNode(
      <PromptDialog
        theme={theme}
        title="Due date"
        label="Due for #1"
        stayOpen
        chips={[
          { key: "t", label: "today", value: "today" },
          { key: "n", label: "none", value: "" },
        ]}
        screenWidth={80}
        screenHeight={24}
        onSubmit={(value) => {
          submitted.push(value);
        }}
        onCancel={() => {}}
      />,
    );

    let frame = captureCharFrame();
    expect(frame).toContain("t today");
    expect(frame).toContain("n none");

    await press("t");
    expect(submitted).toEqual(["today"]);
    expect(captureCharFrame()).toContain("1 added");

    await type("+3d");
    await press("t");
    expect(submitted).toEqual(["today"]);
    await press("RETURN");
    expect(submitted).toEqual(["today", "+3dt"]);

    frame = captureCharFrame();
    const chip = locate(frame, "n none");
    await click(chip.x + 1, chip.y);
    expect(submitted).toEqual(["today", "+3dt", ""]);
    renderer.destroy();
  });

  test("a stray click on the scrim keeps a half-typed prompt", async () => {
    const { captureCharFrame, press, type, click, renderer } = await mount();

    await press("t");
    await type("Half typed");
    await click(1, 1);
    let frame = captureCharFrame();
    expect(frame).toContain("New subtask");
    expect(frame).toContain("Half typed");

    const cross = locate(frame, "✕");
    await click(cross.x, cross.y);
    expect(captureCharFrame()).not.toContain("New subtask");

    await press("t");
    await click(1, 1);
    expect(captureCharFrame()).not.toContain("New subtask");
    renderer.destroy();
  });

  test("the tag picker lists every tag plus all, and fuzzy-filters", async () => {
    const onPick = mock((_tag: string | null) => {});
    const { captureCharFrame, press, type, renderer } = await mountNode(
      <TagPickerDialog
        theme={theme}
        tags={[
          { tag: "infra", count: 3 },
          { tag: "work", count: 2 },
        ]}
        screenWidth={80}
        screenHeight={24}
        onPick={onPick}
        onClose={() => {}}
      />,
    );

    let frame = captureCharFrame();
    expect(frame).toContain("Filter by tag");
    expect(frame).toMatch(/┃ all\s+clear filter/);
    expect(frame).toMatch(/#infra\s+3/);
    expect(frame).toMatch(/#work\s+2/);

    await press("RETURN");
    expect(onPick).toHaveBeenLastCalledWith(null);

    await type("wo");
    frame = captureCharFrame();
    expect(frame).toContain("#work");
    expect(frame).not.toContain("#infra");
    expect(frame).not.toContain("all");
    await press("RETURN");
    expect(onPick).toHaveBeenLastCalledWith("work");

    await press("BACKSPACE");
    await press("BACKSPACE");
    await press("n", { ctrl: true });
    await press("n", { ctrl: true });
    await press("RETURN");
    expect(onPick).toHaveBeenLastCalledWith("work");
    renderer.destroy();
  });

  test("the palette lists matching tasks after the actions", async () => {
    const onPickTask = mock((_id: number) => {});
    const onClose = mock(() => {});
    const ran = mock(() => {});
    const tasks = seed().listTasks();
    const { captureCharFrame, press, type, renderer } = await mountNode(
      <CommandPalette
        theme={theme}
        actions={[
          { id: "task.add", group: "Task", label: "New task", hint: "a", run: ran },
          { id: "view.sort", group: "View", label: "Cycle sort order", run: ran },
        ]}
        tasks={tasks}
        screenWidth={80}
        screenHeight={24}
        onPickTask={onPickTask}
        onClose={onClose}
      />,
    );

    expect(captureCharFrame()).not.toContain("Refactor the parser");

    await type("re");
    const lines = captureCharFrame().split("\n");
    const action = lines.findIndex((l) => l.includes("Cycle sort order"));
    const task = lines.findIndex((l) => l.includes("Refactor the parser"));
    expect(action).toBeGreaterThanOrEqual(0);
    expect(task).toBeGreaterThan(action);
    expect(lines[task]).toMatch(/│ Task\s+#3\s+Refactor the parser/);

    await press("n", { ctrl: true });
    await press("RETURN");
    expect(onPickTask).toHaveBeenCalledWith(3);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(ran).not.toHaveBeenCalled();
    renderer.destroy();
  });

  test("#id alone finds a task in the palette", async () => {
    const onPickTask = mock((_id: number) => {});
    const { captureCharFrame, press, type, renderer } = await mountNode(
      <CommandPalette
        theme={theme}
        actions={[]}
        tasks={seed().listTasks()}
        screenWidth={80}
        screenHeight={24}
        onPickTask={onPickTask}
        onClose={() => {}}
      />,
    );

    await type("#2");
    expect(captureCharFrame()).toContain("Buy oat milk");
    await press("RETURN");
    expect(onPickTask).toHaveBeenCalledWith(2);
    renderer.destroy();
  });

  test("the palette groups actions under headers until a query interleaves them", async () => {
    const { captureCharFrame, press, type, renderer } = await mount();

    await press("k", { ctrl: true });
    let frame = captureCharFrame();
    expect(frame).toMatch(/│  TASK\s+│/);
    expect(frame).toMatch(/│  VIEW\s+│/);
    expect(frame).toMatch(/│    ┃ New task\s+a/);
    expect(frame).not.toContain("Task     New task");

    for (let i = 0; i < 40; i++) await press("n", { ctrl: true });
    frame = captureCharFrame();
    expect(frame).toMatch(/│  APP\s+│/);
    expect(frame).toContain("Quit");

    await type("sort");
    frame = captureCharFrame();
    expect(frame).toMatch(/[│┃] View\s+Cycle sort order/);
    expect(frame).not.toMatch(/│  VIEW\s+│/);
    renderer.destroy();
  });

  test("a confirmation quotes the entry it is about to delete", async () => {
    const { captureCharFrame, renderer } = await mountNode(
      <ConfirmDialog
        theme={theme}
        title="Delete entry"
        message="Delete this journal entry?"
        excerpt="Shipped the opentui port"
        screenWidth={80}
        screenHeight={24}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    const frame = captureCharFrame();
    expect(frame).toContain("Delete this journal entry?");
    expect(frame).toContain("“Shipped the opentui port”");
    renderer.destroy();
  });
});

describe("TUI review 3 — detail and journal", () => {
  /** A config pinned to dark so span colors can be compared with the theme. */
  function darkConfig() {
    const cfg = defaultConfig();
    cfg.theme = "dark";
    return cfg;
  }
  const theme = tuiTheme(true);

  function hexOf(color: CapturedSpan["fg"]): string {
    const [r, g, b] = color.toInts();
    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  }

  /** First span whose text contains `needle`, searching top to bottom. */
  function spanWith(frame: CapturedFrame, needle: string): CapturedSpan {
    for (const line of frame.lines) {
      const span = line.spans.find((s) => s.text.includes(needle));
      if (span) return span;
    }
    throw new Error(`no span contains ${JSON.stringify(needle)}`);
  }

  function rowOf(frame: string, needle: string): number {
    const row = frame.split("\n").findIndex((l) => l.includes(needle));
    expect(row).toBeGreaterThan(0);
    return row;
  }

  /** Renders a component on its own, outside the app shell. */
  async function mountComponent(node: React.ReactNode, width = 60, height = 16) {
    let setup!: Awaited<ReturnType<typeof testRender>>;
    await act(async () => {
      setup = await testRender(node, { width, height });
    });
    await setup.flush();
    return setup;
  }

  const detailProps = {
    theme,
    cfg: defaultConfig(),
    focused: true,
    onSelectRow: () => {},
    onToggleSubtask: () => {},
    blockedByTitles: new Map<number, string>(),
  };

  const longDescription = Array.from(
    { length: 20 },
    (_, i) => `Line ${i + 1} of the spec`,
  ).join("\n");

  test("80×24: a bare task shows no empty sections, only affordances", async () => {
    const { captureCharFrame, press, renderer } = await mount(80, 24);

    // "Refactor the parser" has no description, steps, notes or time.
    const bare = captureCharFrame();
    for (const header of ["DESCRIPTION", "SUBTASKS", "NOTES", "TIME"]) {
      expect(bare).not.toContain(header);
    }
    expect(bare).toContain("e  describe");
    expect(bare).toContain("t  step");
    expect(bare).toContain("n  note");
    expect(bare).toContain("L  time");

    await press("j");
    await press("j");
    const report = captureCharFrame();
    expect(report).toContain("DESCRIPTION");
    expect(report).toContain("SUBTASKS");
    expect(report).not.toContain("NOTES");
    expect(report).not.toContain("e  describe");
    expect(report).not.toContain("t  step");
    expect(report).toContain("n  note");
    expect(report).toContain("L  time");
    renderer.destroy();
  });

  test("a done task shows when it was due and finished, never OVERDUE", async () => {
    const cfg = darkConfig();
    const due = GoTime.now().utc().addDate(0, 0, -1).truncateDay();
    let paidId = 0;
    const { captureCharFrame, captureSpans, goToTab, data, renderer } =
      await mount(100, 30, cfg, (d) => {
        const paid = newTask({ title: "Pay the invoice", dueDate: due });
        d.tasks.create(paid);
        d.setStatus(paid, Status.Done);
        paidId = paid.id;
      });

    await goToTab("done");
    const frame = captureCharFrame();
    expect(frame).toContain("Pay the invoice");
    expect(frame).not.toContain("OVERDUE");
    expect(frame).toContain(`Was due    ${formatDate(cfg, due)}`);

    const paid = data.tasks.getById(paidId)!;
    const finished = formatDateShort(cfg, paid.updatedAt, GoTime.now());
    expect(frame).toContain(`Done · ${finished}`);

    const wasDue = spanWith(captureSpans(), formatDate(cfg, due));
    expect(hexOf(wasDue.fg)).toBe(theme.textDim);
    renderer.destroy();
  });

  test("outlined chips sit on a raised surface", async () => {
    const { captureSpans, renderer } = await mount(100, 30, darkConfig());

    const priority = spanWith(captureSpans(), "Urgent");
    expect(hexOf(priority.bg)).toBe(theme.surfaceAlt);
    expect(hexOf(priority.fg)).toBe(priorityColors(theme)[Priority.Urgent]!);
    const status = spanWith(captureSpans(), "Pending");
    expect(hexOf(status.bg)).toBe(theme.surfaceAlt);
    renderer.destroy();
  });

  test("clicking a subtask row selects it; only the checkbox toggles", async () => {
    const { captureCharFrame, press, click, renderer } = await mount();

    await press("j");
    await press("j");
    const row = rowOf(captureCharFrame(), "Draft intro");
    const line = captureCharFrame().split("\n")[row]!;
    const glyph = line.indexOf("▢", line.indexOf("Draft intro") - 4);

    await click(glyph + 6, row);
    const selected = captureCharFrame();
    expect(selected).toContain("0/2");
    expect(selected.split("\n")[row]).toContain("┃ ▢ Draft intro");

    await click(glyph, row);
    const toggled = captureCharFrame();
    expect(toggled).toContain("1/2");
    expect(toggled.split("\n")[row]).toContain("▣ Draft intro");
    renderer.destroy();
  });

  test("the subtask list says how to reach it until the panel has focus", async () => {
    const { captureCharFrame, press, renderer } = await mount();

    await press("j");
    await press("j");
    expect(captureCharFrame()).toContain("→ then space to check off");

    await press("RETURN");
    expect(captureCharFrame()).not.toContain("then space to check off");
    renderer.destroy();
  });

  test("j in the detail panel moves the cursor and brings it into view", async () => {
    const { captureCharFrame, press, renderer, flush } = await mount(
      80,
      24,
      defaultConfig(),
      (d) => {
        // Due before the seed so the due-sorted list opens on it.
        const spec = newTask({
          title: "Long spec",
          description: longDescription,
          dueDate: GoTime.date(2026, 11, 1, 0, 0, 0, 0, "utc"),
        });
        d.tasks.create(spec);
        for (const step of ["Step 1", "Step 2", "Step 3"]) {
          d.tasks.addSubtask(spec.id, step);
        }
      },
    );

    // From the list the panel shows the top of the task.
    expect(captureCharFrame()).toContain("○ Long spec");
    expect(captureCharFrame()).not.toContain("Step 2");

    await press("RETURN");
    await press("j");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    await flush();

    const lines = captureCharFrame().split("\n");
    const cursor = lines.findIndex((l) => l.includes("┃ ▢"));
    expect(cursor).toBeGreaterThan(0);
    expect(lines[cursor]).toContain("Step 2");
    renderer.destroy();
  });

  test("a task with nothing to select still scrolls from the keyboard", async () => {
    const data = seed();
    const spec = newTask({ title: "Long spec", description: longDescription });
    data.tasks.create(spec);
    const task = data.tasks.getById(spec.id)!;
    const handle: { current: TaskDetailHandle | null } = { current: null };

    const setup = await mountComponent(
      <TaskDetail {...detailProps} task={task} cursor={0} ref={handle} />,
      50,
      12,
    );
    expect(setup.captureCharFrame()).toContain("○ Long spec");
    expect(setup.captureCharFrame()).not.toContain("Line 12");

    await act(async () => {
      handle.current!.scrollBy(12);
    });
    await setup.flush();
    const frame = setup.captureCharFrame();
    expect(frame).not.toContain("○ Long spec");
    expect(frame).toContain("Line 12");
    setup.renderer.destroy();
  });

  test("the detail cursor walks notes and time logs after the subtasks", async () => {
    const data = seed();
    const spec = newTask({ title: "Ship it" });
    data.tasks.create(spec);
    data.tasks.addSubtask(spec.id, "Step 1");
    data.addTaskNote(spec.id, "Talked to finance");
    data.logTime(spec.id, 30 * Minute, "outline");
    const task = data.tasks.getById(spec.id)!;

    const onNote = await mountComponent(
      <TaskDetail {...detailProps} task={task} cursor={1} />,
      60,
      20,
    );
    let lines = onNote.captureCharFrame().split("\n");
    let rail = lines.findIndex((l) => l.includes("┃"));
    expect(lines[rail + 1]).toContain("Talked to finance");
    expect(lines.find((l) => l.includes("Step 1"))).toContain("│ ▢ Step 1");
    onNote.renderer.destroy();

    const selectRow: number[] = [];
    const onLog = await mountComponent(
      <TaskDetail
        {...detailProps}
        task={task}
        cursor={2}
        onSelectRow={(index) => selectRow.push(index)}
      />,
      60,
      26,
    );
    lines = onLog.captureCharFrame().split("\n");
    rail = lines.findIndex((l) => l.includes("┃"));
    expect(lines[rail]).toContain("30m");
    expect(lines[rail]).toContain("outline");

    const noteRow = lines.findIndex((l) => l.includes("Talked to finance"));
    await act(async () => {
      await onLog.mockMouse.click(6, noteRow);
    });
    await onLog.flush();
    expect(selectRow).toEqual([1]);
    onLog.renderer.destroy();
  });

  test("the entry selection stays visible, dimmed, from the day list", async () => {
    const { captureCharFrame, captureSpans, goToTab, press, renderer } =
      await mount(100, 30, darkConfig());

    await goToTab("journal");
    const row = rowOf(captureCharFrame(), "Shipped the opentui port");
    const lines = captureCharFrame().split("\n");
    // The rail marks the entry's first line, the timestamp above the body.
    expect(lines[row - 1]).toContain("┃");

    const dimmed = spanWith(captureSpans(), "Shipped the opentui port");
    expect(hexOf(dimmed.bg)).toBe(mix(theme.selectionBg, theme.bg, 0.45));

    await press("l");
    const focused = spanWith(captureSpans(), "Shipped the opentui port");
    expect(hexOf(focused.bg)).toBe(theme.selectionBg);
    renderer.destroy();
  });

  test("journal empty states use the shared placeholder", async () => {
    const days = await mountComponent(
      <NoteList
        theme={theme}
        cfg={defaultConfig()}
        notes={[]}
        selected={0}
        focused
        onSelect={() => {}}
      />,
    );
    expect(days.captureCharFrame()).toContain("✎");
    expect(days.captureCharFrame()).toContain("No journal notes yet");
    expect(days.captureCharFrame()).toContain("Press a to write about today");
    days.renderer.destroy();

    const entries = await mountComponent(
      <EntryList
        theme={theme}
        cfg={defaultConfig()}
        note={null}
        selected={0}
        focused={false}
        onSelect={() => {}}
      />,
    );
    expect(entries.captureCharFrame()).toContain("✎");
    expect(entries.captureCharFrame()).toContain("Nothing selected");
    entries.renderer.destroy();
  });

  test("the day row counts its entries in words", async () => {
    const one = await mount();
    await one.goToTab("journal");
    expect(one.captureCharFrame()).toContain("1 entry");
    expect(one.captureCharFrame()).not.toContain("1 entries");
    one.renderer.destroy();

    const two = await mount(100, 30, defaultConfig(), (d) => {
      d.addJournalEntry("Second entry");
    });
    await two.goToTab("journal");
    expect(two.captureCharFrame()).toContain("2 entries");
    two.renderer.destroy();
  });

  test("journal entries render markdown like descriptions do", async () => {
    const { captureCharFrame, goToTab, renderer } = await mount(
      100,
      30,
      defaultConfig(),
      (d) => {
        d.addJournalEntry("Read **Dune** tonight");
      },
    );

    await goToTab("journal");
    expect(captureCharFrame()).toContain("Read Dune tonight");
    expect(captureCharFrame()).not.toContain("**");
    renderer.destroy();
  });

  test("the subtask meter snaps when another task is selected", async () => {
    const { captureCharFrame, press, renderer } = await mount(
      100,
      30,
      defaultConfig(),
      (d) => {
        // Due dates before the seed so the due-sorted list opens on Ship it.
        const plan = newTask({
          title: "Plan it",
          dueDate: GoTime.date(2026, 11, 2, 0, 0, 0, 0, "utc"),
        });
        d.tasks.create(plan);
        d.tasks.addSubtask(plan.id, "Outline");
        d.tasks.addSubtask(plan.id, "Review");
        const ship = newTask({
          title: "Ship it",
          dueDate: GoTime.date(2026, 11, 1, 0, 0, 0, 0, "utc"),
        });
        d.tasks.create(ship);
        d.tasks.addSubtask(ship.id, "Build");
        d.tasks.addSubtask(ship.id, "Release");
        for (const st of d.tasks.getById(ship.id)!.subtasks) {
          d.toggleSubtask(st.id);
        }
      },
    );

    expect(captureCharFrame()).toContain("████████████████  2/2");

    await press("j");
    // No easing from the previous task's 2/2: the meter is empty at once.
    expect(captureCharFrame()).toContain("░░░░░░░░░░░░░░░░  0/2");
    renderer.destroy();
  });
});

describe("TUI review 3 — task list", () => {
  /** Only the list panel: the detail panel repeats titles and dates. */
  function listLines(frame: string): string[] {
    return frame.split("\n").map((line) => {
      const end = line.indexOf("│ │");
      return end < 0 ? line : line.slice(0, end + 1);
    });
  }

  function hex(color: { toInts(): [number, number, number, number] }): string {
    const [r, g, b] = color.toInts();
    return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  }

  /** Forty long-titled tasks across every priority, enough to overflow. */
  function backlog(data: RondoData, count = 40) {
    for (let i = 0; i < count; i++) {
      data.tasks.create(
        newTask({
          title: `Filler task ${i} with a title long enough to overflow`,
          priority: (i % 4) as Priority,
          tags: i % 3 === 0 ? ["infra", "backend"] : [],
        }),
      );
    }
  }

  async function mountWith(
    prepare: (data: RondoData) => void,
    width: number,
    height: number,
    cfg = defaultConfig(),
  ) {
    const data = seed(cfg);
    prepare(data);
    let setup!: Awaited<ReturnType<typeof testRender>>;
    await act(async () => {
      setup = await testRender(<App data={data} />, { width, height });
    });
    await setup.flush();
    const press = async (key: string) => {
      await act(async () => {
        setup.mockInput.pressKey(key);
      });
      await setup.flush();
    };
    // Scrolling is animated; let the last hop finish before asserting.
    const settle = async () => {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 300));
      });
      await setup.flush();
    };
    return { data, press, settle, ...setup };
  }

  test("80 columns: titles trim at the tail and the priority glyph keeps its gap", async () => {
    const m = await mountWith(backlog, 80, 24);
    // Newest first, from the top: the glyph sequence below is by creation.
    await m.press("F1");
    await m.press("g");
    await m.settle();

    const rows = listLines(m.captureCharFrame()).filter((l) =>
      l.includes("Filler task"),
    );
    expect(rows.length).toBeGreaterThan(5);
    for (const row of rows) {
      expect(row).not.toContain("...");
      expect(row).not.toMatch(/URG|HIGH|MED/);
      // A glyph never touches the title: "…◆" was the old overflow bug.
      if (/[◆▲△]/.test(row)) expect(row).toMatch(/\S…? [◆▲△] /);
    }
    // Every priority above Low is marked; Low is not.
    const frame = m.captureCharFrame();
    // The list keeps 34 columns at 80, two more than the old 0.4 ratio gave.
    expect(frame).toMatch(/Filler task 39 with a t… ◆/);
    expect(frame).toMatch(/Filler task 38 with a t… ▲/);
    expect(frame).toMatch(/Filler task 37 with a t… △/);
    expect(frame).toMatch(/Filler task 36 with a tit…  │/);
    m.renderer.destroy();
  });

  test("short terminals drop the blank line between rows", async () => {
    const m = await mountWith(backlog, 80, 24);

    const rows = listLines(m.captureCharFrame()).filter((l) =>
      l.includes("Filler task"),
    );
    // Two-line rows with a gap showed seven tasks at this size.
    expect(rows.length).toBeGreaterThanOrEqual(10);
    m.renderer.destroy();
  });

  test("tall terminals keep a blank line between rows", async () => {
    const m = await mountWith(() => {}, 120, 40);

    const lines = listLines(m.captureCharFrame());
    const row = lines.findIndex((l) => l.includes("Refactor the parser"));
    expect(row).toBeGreaterThan(0);
    expect(lines[row + 1]).toContain("#code");
    expect(lines[row + 2]).toMatch(/^│ +│$/);
    m.renderer.destroy();
  });

  test("wide, short terminals collapse rows to one line", async () => {
    const m = await mountWith(
      (data) => {
        const t = newTask({
          title: "One line task",
          priority: Priority.High,
          tags: ["ops", "later"],
          dueDate: GoTime.now().addDate(0, 0, 1),
        });
        data.tasks.create(t);
        data.tasks.addSubtask(t.id, "step");
      },
      160,
      24,
    );

    const lines = listLines(m.captureCharFrame());
    const row = lines.find((l) => l.includes("One line task"))!;
    expect(row).toMatch(/One line task +tomorrow +○○○○ 0\/1 +#ops +▲/);
    // Nothing of that row spilled onto the next line.
    expect(
      lines.filter((l) => l.includes("tomorrow") || l.includes("#ops")),
    ).toHaveLength(1);
    m.renderer.destroy();
  });

  test("a sort change keeps the selection on screen", async () => {
    const m = await mountWith(backlog, 80, 24);

    await m.press("G");
    await m.settle();
    expect(m.captureCharFrame()).toContain("┃");

    await m.press("F3");
    await m.settle();
    const frame = m.captureCharFrame();
    expect(frame).toContain("⇅ Priority");
    expect(frame).toContain("┃");
    m.renderer.destroy();
  });

  test("sorting by due groups rows under section headers with a flat cursor", async () => {
    const m = await mountWith(
      (data) => {
        const now = GoTime.now();
        data.tasks.create(
          newTask({ title: "Late one", dueDate: now.addDate(0, 0, -2) }),
        );
        data.tasks.create(newTask({ title: "Today one", dueDate: now }));
        data.tasks.create(
          newTask({ title: "Later one", dueDate: now.addDate(0, 0, 10) }),
        );
        data.tasks.create(newTask({ title: "Undated one" }));
      },
      100,
      30,
    );

    await m.press("F2");
    await m.settle();
    const lines = listLines(m.captureCharFrame());
    const text = lines.join("\n");
    expect(text).toContain("OVERDUE  1");
    expect(text).toContain("TODAY  1");
    // The seed adds two far-off due dates; the fixture one undated task.
    expect(text).toContain("LATER  3");
    expect(text).toContain("NO DATE  1");
    expect(text).toContain("2d late");
    expect(text).toContain("today");
    expect(text).toContain("in 10d");
    // Headers come before their rows and the cursor sits on a task.
    expect(lines.findIndex((l) => l.includes("OVERDUE"))).toBeLessThan(
      lines.findIndex((l) => l.includes("Late one")),
    );
    expect(lines.find((l) => l.includes("┃"))).toContain("Late one");

    await m.press("j");
    await m.settle();
    expect(
      listLines(m.captureCharFrame()).find((l) => l.includes("┃ ○")),
    ).toContain("Today one");
    m.renderer.destroy();
  });

  test("an empty due cell does not hold its column", async () => {
    const m = await mountWith(
      (data) => {
        data.tasks.create(newTask({ title: "Tagged only", tags: ["alpha"] }));
      },
      100,
      30,
    );
    // Undated rows close the due-sorted list.
    await m.press("G");
    await m.settle();

    const lines = listLines(m.captureCharFrame());
    const row = lines.findIndex((l) => l.includes("Tagged only"));
    expect(lines[row + 1]).toMatch(/^│┃ {3}#alpha/);
    m.renderer.destroy();
  });

  test("the selection keeps its fill when the list loses focus", async () => {
    const cfg = defaultConfig();
    cfg.theme = "dark";
    const m = await mountWith(() => {}, 100, 30, cfg);
    const theme = tuiTheme(true);

    const rowSpans = () => {
      // The detail title sits above the list row now that a section header
      // leads the list, so locate the row through the list column.
      const row = listLines(m.captureCharFrame()).findIndex((l) =>
        l.includes("Refactor the parser"),
      );
      return m.captureSpans().lines[row]!.spans;
    };

    const focusedSpans = rowSpans();
    const title = focusedSpans.find((s) => s.text.includes("Refactor"))!;
    expect(hex(title.bg)).toBe(theme.selectionBg);
    expect(hex(focusedSpans.find((s) => s.text.includes("┃"))!.fg)).toBe(
      theme.accent,
    );

    await m.press("l");
    const blurredSpans = rowSpans();
    const blurredTitle = blurredSpans.find((s) => s.text.includes("Refactor"))!;
    expect(hex(blurredTitle.bg)).toBe(theme.selectionBg);
    expect(hex(blurredSpans.find((s) => s.text.includes("┃"))!.fg)).toBe(
      theme.border,
    );
    m.renderer.destroy();
  });

  test("done rows hide their tags behind the completion date", async () => {
    const m = await mountWith(
      (data) => {
        const old = newTask({ title: "Archived chore", tags: ["old"] });
        data.tasks.create(old);
        data.setStatus(old, Status.Done);
      },
      100,
      30,
    );

    await m.press("TAB");
    const lines = listLines(m.captureCharFrame());
    const row = lines.findIndex((l) => l.includes("Archived chore"));
    expect(row).toBeGreaterThan(0);
    const chore = m.data.listTasks().find((t) => t.title === "Archived chore")!;
    expect(lines[row + 1]).toContain(
      `✓ ${formatDate(m.data.cfg, chore.updatedAt)}`,
    );
    expect(lines.join("\n")).not.toContain("#old");
    m.renderer.destroy();
  });

  test("blocked rows carry a marker before the title", async () => {
    const m = await mountWith(
      (data) => {
        const blocker = newTask({ title: "Blocker task" });
        const blocked = newTask({ title: "Waiting task" });
        data.tasks.create(blocker);
        data.tasks.create(blocked);
        data.addDependency(blocked.id, blocker.id);
      },
      100,
      30,
    );

    const lines = listLines(m.captureCharFrame());
    expect(lines.find((l) => l.includes("Waiting task"))).toContain(
      "⊘ Waiting task",
    );
    expect(lines.find((l) => l.includes("Blocker task"))).not.toContain("⊘");
    m.renderer.destroy();
  });

  test("marked rows show a rail of their own", async () => {
    const data = seed();
    const tasks = data.listTasks().filter((t) => t.status !== Status.Done);
    const marked = new Set([tasks[1]!.id]);

    let setup!: Awaited<ReturnType<typeof testRender>>;
    await act(async () => {
      setup = await testRender(
        <TaskList
          theme={tuiTheme(true)}
          cfg={data.cfg}
          tasks={tasks}
          selected={0}
          focused
          width={60}
          height={20}
          dense={false}
          sort="created"
          now={GoTime.now()}
          blocked={new Set()}
          marked={marked}
          onSelect={() => {}}
          onActivate={() => {}}
          onToggleStatus={() => {}}
          emptyIcon="✦"
          emptyTitle="No tasks"
        />,
        { width: 60, height: 20 },
      );
    });
    await setup.flush();

    const lines = setup.captureCharFrame().split("\n");
    expect(lines.find((l) => l.includes(tasks[0]!.title))).toMatch(/^┃/);
    expect(lines.find((l) => l.includes(tasks[1]!.title))).toMatch(/^▌/);
    setup.renderer.destroy();
  });
});

describe("TUI review 3 — panels", () => {
  const theme = tuiTheme(true);

  function seedMany(count: number, cfg = defaultConfig()): RondoData {
    const data = seed(cfg);
    for (let i = 0; i < count; i++) {
      data.tasks.create(newTask({ title: `Filler task ${i}` }));
    }
    return data;
  }

  function seedTags(): RondoData {
    const data = new RondoData(openMemory(), defaultConfig());
    const names = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"];
    for (const tag of names) {
      data.tasks.create(newTask({ title: `Tagged ${tag}`, tags: [tag] }));
    }
    return data;
  }

  async function mountComponent(node: ReactNode, width: number, height: number) {
    let setup!: Awaited<ReturnType<typeof testRender>>;
    await act(async () => {
      setup = await testRender(node, { width, height });
    });
    await setup.flush();
    return setup;
  }

  const ints = (hex: string) => RGBA.fromHex(hex).toInts();

  /** The chrome every task tab shows: brand, help hint and the toast hairline. */
  function expectChrome(frame: string, width: number, height: number) {
    const lines = frame.split("\n");
    expect(lines[0]).toContain("RonDO");
    expect(lines[height - 2]).toContain(" ?  help ");
    expect(lines[height - 1]).toBe("▁".repeat(width));
  }

  /** The hint row sits right above the toast hairline. */
  const statusRow = (frame: string, height: number) => frame.split("\n")[height - 2]!;

  test("1.1: 40 tasks keep the header, hints and hairline at 80×24 and 100×30", async () => {
    for (const [w, h] of [[80, 24], [100, 30]] as const) {
      const { captureCharFrame, renderer } = await mount(w, h, defaultConfig(), seedMany(40));
      expectChrome(captureCharFrame(), w, h);
      renderer.destroy();
    }
  });

  test("1.1: / and # at 60×20 keep tabs and clock with 12 tasks", async () => {
    const { captureCharFrame, press, renderer } = await mount(60, 20, defaultConfig(), seedMany(12));

    // 60 columns is the compact header: brand glyph, text tabs and the clock.
    await press("#");
    let header = captureCharFrame().split("\n")[0]!;
    expect(header).toContain("◆");
    expect(header).toContain("Active");
    expect(header).toContain("Journal");
    expect(header).toMatch(/\d\d:\d\d\s*$/);
    expect(captureCharFrame()).toContain("tags ");

    await press("/");
    header = captureCharFrame().split("\n")[0]!;
    expect(header).toContain("◆");
    expect(header).toContain("Active");
    expect(header).toContain("Journal");
    expect(header).toMatch(/\d\d:\d\d\s*$/);
    expect(captureCharFrame()).toContain("⌕");
    renderer.destroy();
  });

  test("1.4: the status bar never garbles and keeps ? and ^k", async () => {
    for (const w of [80, 84, 90, 50]) {
      const { captureCharFrame, renderer } = await mount(w, 24);
      const status = statusRow(captureCharFrame(), 24);
      expect(status).toContain(" ?  help ");
      expect(status).toContain(" ^k  ");
      expect(status).toContain(" ⇅ Due date");
      expect(status).not.toMatch(/[a-z]⇅/);
      expect(status).not.toContain("spacestatus");
      expect(status.length).toBeLessThanOrEqual(w);
      renderer.destroy();
    }
  });

  test("1.4: 80 columns still show the primary hints with labels", async () => {
    const { captureCharFrame, renderer } = await mount(80, 24);
    const status = statusRow(captureCharFrame(), 24);
    expect(status).toContain(" a  add ");
    expect(status).toContain(" space  status ");
    expect(status).toContain(" ^k  palette ");
    renderer.destroy();
  });

  test("1.9: eight tags fit at 60 and 80 columns with a +N chip", async () => {
    const data = seedTags();
    const tasks = data.tasks.list();
    const cases: [number, string[], number][] = [
      [80, ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"], 2],
      [60, ["alpha", "bravo", "charlie", "delta"], 4],
    ];
    for (const [w, shown, hidden] of cases) {
      let more = 0;
      const setup = await mountComponent(
        <TagBar
          theme={theme}
          tasks={tasks}
          activeTag={null}
          width={w}
          onSelect={() => {}}
          onMore={() => more++}
        />,
        w,
        3,
      );
      const row = setup.captureCharFrame().split("\n")[0]!;
      expect(row).toContain("tags ");
      expect(row).toContain(" all ");
      for (const tag of shown) expect(row).toContain(` #${tag} 1 `);
      expect(row).not.toContain("golf");
      expect(row).not.toContain("hotel");
      expect(row).toContain(` +${hidden} `);
      expect(row.length).toBeLessThanOrEqual(w);

      await act(async () => {
        await setup.mockMouse.click(row.indexOf(`+${hidden}`), 0);
      });
      await setup.flush();
      expect(more).toBe(1);
      setup.renderer.destroy();
    }
  });

  test("1.9: a trimmed active tag moves to the front instead of vanishing", async () => {
    const setup = await mountComponent(
      <TagBar
        theme={theme}
        tasks={seedTags().tasks.list()}
        activeTag="hotel"
        width={60}
        onSelect={() => {}}
      />,
      60,
      3,
    );
    const row = setup.captureCharFrame().split("\n")[0]!;
    expect(row).toContain(" all  #hotel 1  #alpha 1 ");
    expect(row).toContain(" +4 ");
    setup.renderer.destroy();
  });

  test("5.7: the tag bar sits on the surface color", async () => {
    const setup = await mountComponent(
      <TagBar
        theme={theme}
        tasks={seedTags().tasks.list()}
        activeTag={null}
        width={80}
        onSelect={() => {}}
      />,
      80,
      3,
    );
    const spans = setup.captureSpans().lines[0]!.spans;
    const prefix = spans.find((s) => s.text.includes("tags"));
    expect(prefix).toBeDefined();
    expect(prefix!.bg.toInts()).toEqual(ints(theme.surface));
    setup.renderer.destroy();
  });

  test("5.4: status-bar keycaps and the sort segment are clickable", async () => {
    const calls: string[] = [];
    const hints: Hint[] = [
      { key: "a", label: "add", run: () => calls.push("add") },
      { key: "?", label: "help", run: () => calls.push("help") },
    ];
    const setup = await mountComponent(
      <StatusBar
        theme={theme}
        hints={hints}
        message={null}
        messageKind="info"
        messageId={0}
        messageMs={3000}
        sort="created"
        width={80}
        onCycleSort={() => calls.push("sort")}
      />,
      80,
      3,
    );
    const row = setup.captureCharFrame().split("\n")[0]!;

    await act(async () => {
      await setup.mockMouse.click(row.indexOf(" a ") + 1, 0);
    });
    await setup.flush();
    expect(calls).toEqual(["add"]);

    await act(async () => {
      await setup.mockMouse.click(row.indexOf("⇅ Created") + 2, 0);
    });
    await setup.flush();
    expect(calls).toEqual(["add", "sort"]);
    setup.renderer.destroy();
  });

  test("5.4: a hovered keycap lights up", async () => {
    const setup = await mountComponent(
      <StatusBar
        theme={theme}
        hints={[{ key: "a", label: "add", run: () => {} }]}
        message={null}
        messageKind="info"
        messageId={0}
        messageMs={3000}
        width={40}
      />,
      40,
      3,
    );
    const keycap = () =>
      setup.captureSpans().lines[0]!.spans.find((s) => s.text.trim() === "a")!;
    expect(keycap().bg.toInts()).toEqual(ints(theme.surfaceAlt));

    const row = setup.captureCharFrame().split("\n")[0]!;
    await act(async () => {
      await setup.mockMouse.moveTo(row.indexOf(" a ") + 1, 0);
    });
    await setup.flush();
    expect(keycap().bg.toInts()).toEqual(
      ints(mix(theme.surfaceAlt, theme.accentSoft, 0.5)),
    );
    setup.renderer.destroy();
  });

  test("5.16: help lists the final key map with GLOBAL first and a scroll footer", async () => {
    const { captureCharFrame, press, renderer } = await mount(80, 24);
    await press("?");
    const frame = captureCharFrame();
    expect(frame.indexOf("GLOBAL")).toBeGreaterThan(-1);
    expect(frame.indexOf("GLOBAL")).toBeLessThan(frame.indexOf("NAVIGATION"));
    expect(frame).toContain("↑↓ / j k scroll · esc close");
    expect(frame).not.toContain("Cycle status");

    // The tail is below the fold at 24 rows; j scrolls down to it.
    expect(frame).not.toContain("Clear filter");
    for (let i = 0; i < 40; i++) await press("j");
    const scrolled = captureCharFrame();
    expect(scrolled).toContain("VIEWS & FILTERS");
    expect(scrolled).toContain("Clear filter");
    renderer.destroy();
  });

  test("5.16: wide terminals show the help in two columns", async () => {
    const { captureCharFrame, press, renderer } = await mount(120, 40);
    await press("?");
    const frame = captureCharFrame();
    const lines = frame.split("\n");
    const global = lines.find((l) => l.includes("GLOBAL"))!;
    expect(global).toContain("TASKS");
    for (const label of [
      "Mark done / reopen",
      "Start / stop",
      "Add entry to today",
      "Add entry to selected day",
      "Tag picker",
      "Cycle view",
      "Toggle subtask",
      "Block on",
      "Undo",
      "Reload",
      "Density",
    ]) {
      expect(frame).toContain(label);
    }
    renderer.destroy();
  });

  test("5.19: statistics break logged time down by today and the last week", async () => {
    const data = seed();
    const task = data.tasks.list()[0]!;
    data.logTime(task.id, 30 * Minute, "");
    const now = GoTime.utcNow();
    data.tasks.restoreTimeLog(task.id, 60 * Minute, "", now.addDate(0, 0, -3));
    data.tasks.restoreTimeLog(task.id, 120 * Minute, "", now.addDate(0, 0, -30));

    const { captureCharFrame, press, renderer } = await mount(100, 30, defaultConfig(), data);
    await press("S");
    expect(captureCharFrame()).toMatch(/logged\s+3h 30m · today 30m · 7d 1h 30m/);
    renderer.destroy();
  });

  test("1.8: statistics clamp to the screen and scroll", async () => {
    const { captureCharFrame, press, renderer } = await mount(60, 20);
    await press("S");
    const lines = captureCharFrame().split("\n");
    const footer = lines.findIndex((l) => l.includes("esc close"));
    expect(footer).toBeGreaterThan(0);
    expect(footer).toBeLessThan(19);
    expect(lines[footer + 1]).toContain("╰");
    expect(lines[2]).toContain("Statistics");
    renderer.destroy();
  });

  test("A3: statistics meters fill in after opening", async () => {
    const { captureCharFrame, press, renderer } = await mount(100, 30);
    await press("S");
    const doneRow = () =>
      captureCharFrame().split("\n").find((l) => l.includes("done "))!;
    const before = (doneRow().match(/█/g) ?? []).length;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    const after = (doneRow().match(/█/g) ?? []).length;
    expect(after).toBeGreaterThan(before);
    renderer.destroy();
  });
});

describe("TUI review 3 — keys and selection", () => {
  /** Only the list column: the detail panel repeats titles. */
  function listColumn(frame: string): string[] {
    return frame.split("\n").map((line) => {
      const end = line.indexOf("│ │");
      return end < 0 ? line : line.slice(0, end + 1);
    });
  }

  /** The list row under the cursor. */
  function cursorRow(frame: string): string {
    return listColumn(frame).find((l) => l.includes("┃")) ?? "";
  }

  /** Only the detail column: the list repeats the selected title. */
  function detailColumn(frame: string): string {
    return frame
      .split("\n")
      .map((line) => line.slice(line.indexOf("│ │") + 2))
      .join("\n");
  }

  const settle = async (flush: () => Promise<void>) => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    await flush();
  };

  const PAGE_DOWN = "\u001b[6~";
  const PAGE_UP = "\u001b[5~";

  function fillers(count: number) {
    return (d: RondoData) => {
      for (let i = 0; i < count; i++) {
        d.tasks.create(newTask({ title: `Filler task ${i}` }));
      }
    };
  }

  test("2.3: ctrl+c asks before quitting, even from inside an overlay", async () => {
    const { captureCharFrame, press, renderer } = await mount();

    await press("f");
    await press("?");
    expect(captureCharFrame()).toContain("Keyboard & mouse");

    await press("c", { ctrl: true });
    const frame = captureCharFrame();
    expect(frame).toContain("focus session is running");
    expect(frame).not.toContain("Keyboard & mouse");
    renderer.destroy();
  });

  test("2.7: a sort change keeps the selected task, not the row number", async () => {
    const { captureCharFrame, press, renderer, flush } = await mount(
      100,
      30,
      defaultConfig(),
      (d) => {
        d.tasks.create(
          newTask({ title: "Soon one", dueDate: GoTime.now().addDate(0, 0, 1) }),
        );
      },
    );

    await press("j");
    expect(cursorRow(captureCharFrame())).toContain("Refactor the parser");

    await press("F1");
    await settle(flush);
    expect(cursorRow(captureCharFrame())).toContain("Refactor the parser");
    renderer.destroy();
  });

  test("2.7: clearing a filter keeps the task found under it", async () => {
    const { captureCharFrame, press, type, renderer } = await mount();

    await press("/");
    await type("report");
    await press("RETURN");
    expect(cursorRow(captureCharFrame())).toContain("Write the report");

    await press("ESCAPE");
    expect(captureCharFrame()).toContain("2 tasks");
    expect(cursorRow(captureCharFrame())).toContain("Write the report");
    renderer.destroy();
  });

  test("2.7: a created task is selected, and so is a task brought back by undo", async () => {
    const { captureCharFrame, press, type, renderer } = await mount();

    await press("a");
    await type("Ship the release");
    await press("s", { ctrl: true });
    expect(cursorRow(captureCharFrame())).toContain("Ship the release");

    await press("g");
    expect(cursorRow(captureCharFrame())).toContain("Refactor the parser");
    await press("d");
    await press("y");
    expect(cursorRow(captureCharFrame())).not.toContain("Refactor the parser");

    await press("u");
    expect(cursorRow(captureCharFrame())).toContain("Refactor the parser");
    renderer.destroy();
  });

  test("2.7: a new journal entry selects its day", async () => {
    const { captureCharFrame, goToTab, press, type, renderer } = await mount(
      100,
      30,
      defaultConfig(),
      (d) => {
        d.addJournalEntry("Long ago", "2026-08-10");
      },
    );

    await goToTab("journal");
    await press("j");
    expect(cursorRow(captureCharFrame())).toContain("Aug 10");

    await press("a");
    expect(captureCharFrame()).toContain("Entry for today");
    await type("Fresh");
    await press("s", { ctrl: true });
    expect(cursorRow(captureCharFrame())).toContain("Today");
    renderer.destroy();
  });

  test("2.9: / focuses the list and the hints explain the search keys", async () => {
    const { captureCharFrame, press, renderer } = await mount(60, 20);

    await press("l");
    expect(captureCharFrame()).toContain("● Details");

    await press("/");
    const frame = captureCharFrame();
    expect(frame).toContain("● Active");
    expect(frame.split("\n")[18]).toMatch(/^  ↑↓  move  enter  keep /);

    await press("ARROW_DOWN");
    expect(cursorRow(captureCharFrame())).toContain("Write the report");
    renderer.destroy();
  });

  test("2.10: deleting the last step leaves the cursor on the one before it", async () => {
    const { captureCharFrame, press, renderer } = await mount();

    await press("j");
    await press("RETURN");
    await press("j");
    expect(captureCharFrame()).toContain("┃ ▢ Draft intro");

    await press("d");
    await press("y");
    expect(captureCharFrame()).toContain("┃ ▢ Collect numbers");

    await press("e");
    expect(captureCharFrame()).toContain("Edit subtask");
    expect(captureCharFrame()).toContain("Collect numbers");
    renderer.destroy();
  });

  test("2.12: typing a query lands the cursor on the best match", async () => {
    const { captureCharFrame, press, type, renderer } = await mount();

    await press("j");
    expect(cursorRow(captureCharFrame())).toContain("Write the report");

    await press("/");
    await type("re");
    expect(captureCharFrame()).toContain("2/2");
    expect(cursorRow(captureCharFrame())).toContain("Refactor the parser");
    renderer.destroy();
  });

  test("2.16: f in the journal starts a session without a task", async () => {
    const { captureCharFrame, goToTab, press, data, renderer } = await mount(120);

    await goToTab("journal");
    await press("f");
    const header = captureCharFrame().split("\n")[0]!;
    expect(header).toContain("Focus");
    expect(header).not.toContain("Refactor the parser");
    expect(data.focus.listByTask(3)).toHaveLength(0);
    renderer.destroy();
  });

  test("2.17: enter in the detail panel edits the step instead of toggling it", async () => {
    const { captureCharFrame, press, renderer } = await mount();

    await press("j");
    await press("RETURN");
    await press("RETURN");
    const frame = captureCharFrame();
    expect(frame).toContain("Edit subtask");
    expect(frame).toContain("Collect numbers");

    await press("ESCAPE");
    expect(captureCharFrame()).toContain("0/2");
    await press(" ");
    expect(captureCharFrame()).toContain("1/2");
    renderer.destroy();
  });

  test("3.5: digits jump to tabs and the palette shows them", async () => {
    const { captureCharFrame, press, type, renderer } = await mount();

    await press("4");
    expect(captureCharFrame()).toContain("● Journal");
    await press("2");
    expect(captureCharFrame()).toContain("● Done");
    expect(captureCharFrame()).toContain("Buy oat milk");
    await press("3");
    expect(captureCharFrame()).toContain("● All");
    await press("1");
    expect(captureCharFrame()).toContain("● Active");

    await press("k", { ctrl: true });
    await type("go to journal");
    expect(captureCharFrame()).toMatch(/Go to Journal\s+4/);
    renderer.destroy();
  });

  test("3.6: page keys move by a screen, home and end jump", async () => {
    const { captureCharFrame, press, renderer, flush } = await mount(
      80,
      24,
      defaultConfig(),
      fillers(40),
    );

    await press(PAGE_DOWN);
    await settle(flush);
    const row = cursorRow(captureCharFrame());
    expect(row).toContain("Filler task");
    expect(row).not.toContain("Filler task 39");

    await press(PAGE_UP);
    await settle(flush);
    expect(cursorRow(captureCharFrame())).toContain("Refactor the parser");

    await press("d", { ctrl: true });
    await settle(flush);
    expect(cursorRow(captureCharFrame())).toBe(row);
    await press("u", { ctrl: true });
    await settle(flush);
    expect(cursorRow(captureCharFrame())).toContain("Refactor the parser");

    await press("END");
    await settle(flush);
    expect(cursorRow(captureCharFrame())).toContain("Filler task 0");
    await press("HOME");
    await settle(flush);
    expect(cursorRow(captureCharFrame())).toContain("Refactor the parser");
    renderer.destroy();
  });

  test("3.6: in the detail panel a page walks the rows or scrolls the text", async () => {
    const longDescription = Array.from(
      { length: 20 },
      (_, i) => `Line ${i + 1} of the spec`,
    ).join("\n");
    const { captureCharFrame, press, renderer, flush } = await mount(
      80,
      24,
      defaultConfig(),
      (d) => {
        d.tasks.create(
          newTask({
            title: "Long spec",
            description: longDescription,
            dueDate: GoTime.date(2026, 11, 1, 0, 0, 0, 0, "utc"),
          }),
        );
      },
    );

    await press("l");
    expect(detailColumn(captureCharFrame())).toContain("○ Long spec");
    expect(detailColumn(captureCharFrame())).not.toContain("Line 14");
    await press(PAGE_DOWN);
    await settle(flush);
    expect(detailColumn(captureCharFrame())).not.toContain("○ Long spec");
    expect(detailColumn(captureCharFrame())).toContain("Line 14");

    await press("h");
    await press("G");
    await press("l");
    await press(PAGE_DOWN);
    await settle(flush);
    expect(captureCharFrame()).toContain("┃ ▢ Draft intro");
    renderer.destroy();
  });

  test("3.11: b and B open the block pickers, open tasks first", async () => {
    const { captureCharFrame, press, data, renderer } = await mount(
      100,
      30,
      defaultConfig(),
      (d) => {
        const chore = newTask({ title: "Archived chore" });
        d.tasks.create(chore);
        d.setStatus(chore, Status.Done);
      },
    );

    await press("b");
    let frame = captureCharFrame();
    expect(frame).toContain("Block on");
    const lines = frame.split("\n");
    expect(lines.findIndex((l) => l.includes("Write the report"))).toBeLessThan(
      lines.findIndex((l) => l.includes("Archived chore")),
    );

    await press("RETURN");
    frame = captureCharFrame();
    expect(frame).toContain("BLOCKED");
    expect(data.tasks.getById(3)!.blockedByIds).toEqual([1]);

    await press("B");
    expect(captureCharFrame()).toContain("Remove blocker");
    await press("RETURN");
    expect(captureCharFrame()).not.toContain("BLOCKED");
    expect(data.tasks.getById(3)!.blockedByIds).toEqual([]);
    renderer.destroy();
  });

  test("1.10: the panel ratio stops where either panel would become unusable", async () => {
    const { captureCharFrame, press, renderer } = await mount(80, 24);
    const dividerAt = () => captureCharFrame().split("\n")[1]!.indexOf("╮");

    for (let i = 0; i < 12; i++) await press(">");
    expect(dividerAt()).toBe(39);
    expect(captureCharFrame().split("\n")[5]).toContain("Pending");

    for (let i = 0; i < 12; i++) await press("<");
    expect(dividerAt()).toBe(33);
    renderer.destroy();
  });

  test("5.15: the divider is visible, lights up under the pointer, and the palette resizes", async () => {
    const cfg = defaultConfig();
    cfg.theme = "dark";
    const { captureSpans, captureCharFrame, press, type, renderer, mockMouse, flush } =
      await mount(100, 30, cfg);
    const theme = tuiTheme(true);
    const hex = (c: { toInts(): [number, number, number, number] }) => {
      const [r, g, b] = c.toInts();
      return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
    };
    const dividerColumn = () => captureCharFrame().split("\n")[1]!.indexOf("╮") + 1;
    const dividerBg = () => {
      const column = dividerColumn();
      let x = 0;
      for (const span of captureSpans().lines[5]!.spans) {
        if (column >= x && column < x + span.width) return hex(span.bg);
        x += span.width;
      }
      throw new Error("divider not found");
    };

    expect(dividerBg()).toBe(theme.border);
    await act(async () => {
      await mockMouse.moveTo(dividerColumn(), 5);
    });
    await flush();
    expect(dividerBg()).toBe(theme.borderFocus);

    await press("k", { ctrl: true });
    await type("widen");
    expect(captureCharFrame()).toMatch(/Widen task list\s+>/);
    await press("RETURN");
    expect(dividerColumn()).toBe(45);
    renderer.destroy();
  });

  test("3.12: a task created inside a tag filter inherits the tag", async () => {
    const { captureCharFrame, press, click, type, data, renderer } = await mount();

    await press("#");
    const frame = captureCharFrame();
    const row = frame.split("\n").findIndex((l) => l.includes("tags "));
    const column = frame.split("\n")[row]!.indexOf("#work");
    await click(column + 1, row);
    expect(captureCharFrame()).toContain("1 of 2");

    await press("a");
    await type("Write the appendix");
    await press("s", { ctrl: true });

    const created = data.listTasks().find((t) => t.title === "Write the appendix")!;
    expect(created.tags).toEqual(["work"]);
    expect(cursorRow(captureCharFrame())).toContain("Write the appendix");
    renderer.destroy();
  });

  test("2.1: journal a writes to today, A to the selected day", async () => {
    const { captureCharFrame, goToTab, press, type, data, renderer } = await mount(
      100,
      30,
      defaultConfig(),
      (d) => {
        d.addJournalEntry("Long ago", "2026-08-10");
      },
    );

    await goToTab("journal");
    expect(captureCharFrame().split("\n")[28]).toContain(" A  add to day ");
    await press("j");
    await press("a");
    expect(captureCharFrame()).toContain("Entry for today");
    await press("ESCAPE");

    await press("A");
    const frame = captureCharFrame();
    expect(frame).toContain("Entry for");
    expect(frame).toContain("Aug 10");
    expect(frame).not.toContain("Entry for today");
    await type("Back-filled");
    await press("s", { ctrl: true });

    const old = data
      .listNotes(false)
      .find((n) => n.date.format("2006-01-02") === "2026-08-10")!;
    expect(old.entries.map((e) => e.body)).toContain("Back-filled");
    renderer.destroy();
  });

  test("2.6: journal d and e need the entry panel, and the confirm quotes the entry", async () => {
    const { captureCharFrame, goToTab, press, renderer } = await mount();

    await goToTab("journal");
    const hints = captureCharFrame().split("\n")[28]!;
    expect(hints).not.toContain(" d  delete ");
    expect(hints).not.toContain(" e  edit ");

    await press("d");
    expect(captureCharFrame()).not.toContain("Delete entry");
    await press("e");
    expect(captureCharFrame()).not.toContain("Edit entry");

    await press("l");
    expect(captureCharFrame().split("\n")[28]).toContain(" d  delete ");
    await press("d");
    const frame = captureCharFrame();
    expect(frame).toContain("Delete entry");
    expect(frame).toContain("“Shipped the opentui port”");
    renderer.destroy();
  });

  test("5.3: an active tag filter keeps its bar until the tag is cleared", async () => {
    const { captureCharFrame, press, click, renderer } = await mount();

    await press("#");
    const frame = captureCharFrame();
    const row = frame.split("\n").findIndex((l) => l.includes("tags "));
    const column = frame.split("\n")[row]!.indexOf("#work");
    await click(column + 1, row);

    await press("#");
    expect(captureCharFrame()).toContain("tags ");
    expect(captureCharFrame()).toContain("1 of 2");

    await press("ESCAPE");
    expect(captureCharFrame()).not.toContain("tags ");
    expect(captureCharFrame()).toContain("2 tasks");
    renderer.destroy();
  });

  test("5.4: the status-bar keycaps run the actions they name", async () => {
    const { captureCharFrame, click, renderer } = await mount();

    const row = captureCharFrame().split("\n")[28]!;
    await click(row.indexOf(" a  add ") + 1, 28);
    expect(captureCharFrame()).toContain("New task");
    renderer.destroy();
  });

  test("1.6: z cycles the density for the session", async () => {
    const { captureCharFrame, press, renderer } = await mount(
      160,
      40,
      defaultConfig(),
      (d) => {
        const t = newTask({
          title: "One line task",
          priority: Priority.High,
          tags: ["ops", "later"],
          dueDate: GoTime.now().addDate(0, 0, 1),
        });
        d.tasks.create(t);
        d.tasks.addSubtask(t.id, "step");
      },
    );
    const oneLine = /One line task +tomorrow +○○○○ 0\/1 +#ops +▲/;

    expect(captureCharFrame()).not.toMatch(oneLine);
    await press("z");
    expect(captureCharFrame()).toContain("Density: dense");
    expect(captureCharFrame()).toMatch(oneLine);
    await press("z");
    expect(captureCharFrame()).toContain("Density: comfortable");
    expect(captureCharFrame()).not.toMatch(oneLine);
    await press("z");
    expect(captureCharFrame()).toContain("Density: auto");
    renderer.destroy();
  });

  test("5.8 / 5.18: panels are titled by tab and the Done tab counts today's finishes", async () => {
    const { captureCharFrame, press, renderer } = await mount();

    expect(captureCharFrame()).toContain("● Active");
    await press("2");
    const frame = captureCharFrame();
    expect(frame).toContain("● Done");
    expect(frame).toContain("1 task · 1 today");
    expect(frame).not.toContain("1 tasks");
    renderer.destroy();
  });
});
