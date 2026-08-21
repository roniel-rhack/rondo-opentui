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

initTheme(true);

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

  const click = async (x: number, y: number) => {
    await act(async () => {
      await setup.mockMouse.click(x, y);
    });
    await setup.flush();
  };

  return { data, press, type, click, ...setup };
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
    const { captureCharFrame, press, renderer } = await mount();

    await press("TAB");
    await press("TAB");
    await press("TAB");

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
    const { captureCharFrame, press, type, renderer } = await mount();

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
    const { captureCharFrame, click, renderer } = await mount();

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
    const { captureCharFrame, press, type, data, renderer } = await mount();

    await press("TAB");
    await press("TAB");
    await press("TAB");
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
    expect(captureCharFrame()).toContain("Focus settings");
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
    await setup.flush();

    // The cursor marker must still be on screen after scrolling far down.
    expect(setup.captureCharFrame()).toContain("┃");
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
    const { captureCharFrame, press, type, data, renderer } = await mount();

    await press("TAB");
    await press("TAB");
    await press("TAB");
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
    const data = seed();
    let setup!: Awaited<ReturnType<typeof testRender>>;
    await act(async () => {
      setup = await testRender(<App data={data} />, { width: 90, height: 20 });
    });
    await setup.flush();

    const lines = setup.captureCharFrame().split("\n");
    const doneRow = lines.findIndex((l) => l.includes("Buy oat milk"));
    // The next line must be another task, not metadata for the done one.
    expect(lines[doneRow + 1]).not.toContain("#");
    setup.renderer.destroy();
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
