import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../src/core/config/config.ts";
import { openMemory } from "../src/core/database/db.ts";
import { newTask } from "../src/core/task/store.ts";
import { Priority, Status } from "../src/core/task/task.ts";
import { GoTime } from "../src/core/time.ts";
import { initTheme } from "../src/core/ui/colors.ts";
import { App } from "../src/tui/app.tsx";
import { RondoData } from "../src/tui/data.ts";
import { TABS, type TabId } from "../src/tui/state.ts";

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

function seed(): RondoData {
  const data = new RondoData(openMemory(), defaultConfig());

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

  const refactor = newTask({
    title: "Refactor the parser",
    priority: Priority.Urgent,
    tags: ["code"],
  });
  data.tasks.create(refactor);

  data.addJournalEntry("Shipped the opentui port");

  return data;
}

async function mount(width = 100, height = 30) {
  const data = seed();
  // Wrapping the initial mount keeps React's act() warnings out of the output.
  let setup!: Awaited<ReturnType<typeof testRender>>;
  await act(async () => {
    setup = await testRender(<App data={data} />, { width, height });
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
    expect(frame).toContain("Move selection");
    expect(frame).toContain("Add subtask");
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

    expect(captureCharFrame()).toContain("⇅ Created");
    await press("o");
    expect(captureCharFrame()).toContain("⇅ Due date");
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
    expect(list).toContain("Tasks");
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
    const cursorRow = frame.split("\n").findIndex((l) => l.includes("┃"));
    expect(frame.split("\n").length).toBeGreaterThan(cursorRow + 2);
    expect(frame.split("\n")[cursorRow + 2]).toContain("Filler task");
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

    expect(listColumn).toContain("Late task");
    expect(listColumn).not.toContain("OVERDUE");
    expect(listColumn).toContain("!");
    setup.renderer.destroy();
  });

  test("completed tasks collapse to a single line", async () => {
    const { captureCharFrame, goToTab, renderer } = await mount(90, 20);

    // The list opens on Active, which hides the done task used here.
    await goToTab("all");

    const lines = captureCharFrame().split("\n");
    const doneRow = lines.findIndex((l) => l.includes("Buy oat milk"));
    expect(doneRow).toBeGreaterThan(0);
    // The row is followed by the gap, not by a metadata line of its own.
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
    await type("cycle");

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
    const { captureCharFrame, press, renderer } = await mount();

    await press("f");
    expect(captureCharFrame().split("\n")[0]).toContain("Refactor");
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

  test("resizing the panels persists the ratio", async () => {
    const { press, renderer } = await mount();

    await press("<");
    const cfg = JSON.parse(
      readFileSync(join(process.env.RONDO_HOME!, "config.json"), "utf8"),
    );
    expect(cfg.panel_ratio).toBeCloseTo(0.35);
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
