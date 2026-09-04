import { expect, test } from "bun:test";
import { type Renderable, ScrollBoxRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../src/core/config/config.ts";
import { defaultTuiState, type TuiState } from "../src/core/config/tui-state.ts";
import { openMemory } from "../src/core/database/db.ts";
import { newTask } from "../src/core/task/store.ts";
import { Status } from "../src/core/task/task.ts";
import { GoTime } from "../src/core/time.ts";
import { App } from "../src/tui/app.tsx";
import { RondoData } from "../src/tui/data.ts";

const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("not wrapped in act")) return;
  originalConsoleError(...args);
};

async function mount(
  seed: (data: RondoData) => void,
  state: Partial<TuiState> = {},
  width = 80,
) {
  const previousHome = process.env.RONDO_HOME;
  const home = mkdtempSync(join(tmpdir(), "rondo-history-"));
  process.env.RONDO_HOME = home;
  const db = openMemory();
  const data = new RondoData(db, defaultConfig());
  seed(data);
  writeFileSync(join(home, "tui-state.json"), JSON.stringify({
    ...defaultTuiState(), reducedMotion: true, ...state,
  }));
  let setup!: Awaited<ReturnType<typeof testRender>>;
  await act(async () => {
    setup = await testRender(<App data={data} />, { width, height: 24, exitOnCtrlC: false });
  });
  const settle = async () => {
    await setup.flush();
    await act(async () => { await Bun.sleep(80); });
    await setup.flush();
  };
  await settle();
  const press = async (key: string, modifiers?: { ctrl?: boolean }) => {
    await act(async () => {
      setup.mockInput.pressKey(key, modifiers);
      if (key === "ESCAPE") await Bun.sleep(120);
    });
    await settle();
  };
  const type = async (value: string) => {
    await act(async () => { await setup.mockInput.typeText(value); });
    await settle();
  };
  const jump = async (title: string) => {
    await press("k", { ctrl: true });
    await type(title);
    await press("RETURN");
  };
  const close = async () => {
    await act(async () => { setup.renderer.destroy(); });
    db.close();
    if (previousHome === undefined) delete process.env.RONDO_HOME;
    else process.env.RONDO_HOME = previousHome;
  };
  return { ...setup, data, press, type, jump, settle, close };
}

function taskViewport(node: Renderable, taskId: number): ScrollBoxRenderable | null {
  if (node instanceof ScrollBoxRenderable && node.findDescendantById(`task-row-${taskId}`)) return node;
  for (const child of node.getChildren()) {
    const found = taskViewport(child, taskId);
    if (found) return found;
  }
  return null;
}

function scrollViewports(node: Renderable): ScrollBoxRenderable[] {
  return [
    ...(node instanceof ScrollBoxRenderable ? [node] : []),
    ...node.getChildren().flatMap(scrollViewports),
  ];
}

for (const kind of ["task", "journal"] as const) {
  for (const width of [80, 120]) {
    test(`return preserves the reading position of a long ${kind} at ${width} columns`, async () => {
      const content = Array.from({ length: 50 }, (_, i) => `READ${String(i + 1).padStart(2, "0")} quartz content`).join("\n");
      const m = await mount((data) => {
        data.tasks.create(newTask({ title: "Reading task", description: content }));
        data.tasks.create(newTask({ title: "External jump" }));
        if (kind === "journal") data.addJournalEntry(content, "2026-09-04");
      }, { selectedTaskId: 1, tab: kind === "journal" ? "journal" : "active" }, width);
      try {
        if (kind === "journal") {
          await m.press("/"); await m.type("quartz"); await m.press("RETURN");
        } else await m.press("l");
        await m.press("\u001b[6~"); await m.press("\u001b[6~");
        const before = scrollViewports(m.renderer.root).at(-1)!;
        expect(before.scrollTop).toBeGreaterThan(20);
        const scrollTop = before.scrollTop;
        const visibleLines = m.captureCharFrame().match(/READ\d\d/g);
        expect(visibleLines?.length).toBeGreaterThan(5);
        await m.jump("External jump");
        expect(m.captureCharFrame()).toContain("External jump");
        expect(m.captureCharFrame()).not.toMatch(/READ\d\d/);
        await m.press("BACKSPACE");
        const after = scrollViewports(m.renderer.root).at(-1)!;
        expect(after.scrollTop).toBe(scrollTop);
        expect(m.captureCharFrame().match(/READ\d\d/g)).toEqual(visibleLines);
        await m.press("\u001b[5~");
        expect(after.scrollTop).toBeLessThan(scrollTop);
      } finally { await m.close(); }
    });
  }
}

test("a global task jump from an unfiltered journal opens the task", async () => {
  const m = await mount((data) => {
    data.tasks.create(newTask({ title: "External jump" }));
    data.addJournalEntry("Journal context to return to", "2026-09-04");
  }, { tab: "journal" });
  try {
    expect(m.captureCharFrame()).toContain("Journal context to return to");
    await m.jump("External jump");
    expect(m.captureCharFrame()).toContain("External jump");
    expect(m.captureCharFrame()).not.toContain("Journal context to return to");
    await m.press("BACKSPACE");
    expect(m.captureCharFrame()).toContain("Journal context to return to");
  } finally { await m.close(); }
});

for (const width of [80, 120]) {
  test(`return restores exact list scroll and selection at ${width} columns`, async () => {
    const m = await mount((data) => {
      for (let i = 1; i <= 60; i++) {
        data.tasks.create(newTask({
          title: `Task ${String(i).padStart(3, "0")}`,
          tags: ["review"],
          dueDate: GoTime.date(2030, 1, i, 0, 0, 0, 0, "utc"),
        }));
      }
      data.tasks.create(newTask({ title: "External jump", tags: ["outside"] }));
    }, { tag: "review", selectedTaskId: 31 }, width);
    try {
      await m.press("e");
      expect(m.captureCharFrame()).toContain("Edit task #31");
      await m.press("ESCAPE");
      const before = taskViewport(m.renderer.root, 31)!;
      expect(before).not.toBeNull();
      expect(before.scrollTop).toBeGreaterThan(4);
      await act(async () => { before.scrollTo(before.scrollTop + 2); });
      await m.settle();
      const scrollTop = before.scrollTop;
      expect(m.captureCharFrame()).toContain("Task 031");
      await m.jump("External jump");
      expect(m.captureCharFrame()).toContain("External jump");
      await m.press("BACKSPACE");
      const after = taskViewport(m.renderer.root, 31)!;
      expect(after).not.toBeNull();
      expect(after.scrollTop).toBe(scrollTop);
      expect(m.captureCharFrame()).toContain("Task 031");
      expect(m.captureCharFrame()).not.toContain("External jump");
      await m.press("e");
      expect(m.captureCharFrame()).toContain("Edit task #31");
    } finally { await m.close(); }
  });
}

test("return restores a later journal match and its edit target", async () => {
  const m = await mount((data) => {
    data.tasks.create(newTask({ title: "External jump" }));
    data.addJournalEntry("quartz first entry", "2026-09-04");
    data.addJournalEntry("quartz second entry", "2026-09-04");
    data.addJournalEntry("quartz third entry", "2026-09-04");
  }, { tab: "journal" });
  try {
    await m.press("/"); await m.type("quartz"); await m.press("RETURN");
    await m.press("}");
    await m.press("e");
    expect(m.captureCharFrame()).toContain("quartz second entry");
    await m.type(" before jump");
    await m.press("s", { ctrl: true });
    expect(m.data.listNotes(false)[0]!.entries[1]!.body).toBe("quartz second entry before jump");
    await m.jump("External jump");
    expect(m.captureCharFrame()).toContain("External jump");
    await m.press("BACKSPACE");
    await m.press("e");
    expect(m.captureCharFrame()).toContain("quartz second entry before jump");
    await m.type(" after return");
    await m.press("s", { ctrl: true });
    expect(m.data.listNotes(false)[0]!.entries.map((entry) => entry.body)).toEqual([
      "quartz first entry", "quartz second entry before jump after return", "quartz third entry",
    ]);
  } finally { await m.close(); }
});

test("a range after filtering cannot restore marks outside current results", async () => {
  const m = await mount((data) => {
    for (const [i, title] of ["Visible Alpha", "Visible Beta", "Hidden Gamma", "Hidden Delta"].entries()) {
      data.tasks.create(newTask({ title, dueDate: GoTime.date(2030, 1, i + 1, 0, 0, 0, 0, "utc") }));
    }
  }, { selectedTaskId: 1 });
  try {
    await m.press("e");
    expect(m.captureCharFrame()).toContain("Edit task #1");
    await m.press("ESCAPE");
    await m.press("M"); await m.press("J");
    await m.press("/"); await m.type("Visible"); await m.press("RETURN");
    await m.press("J");
    await m.press("k", { ctrl: true }); await m.type("Delete");
    expect(m.captureCharFrame()).toContain("Delete 2 marked tasks");
    await m.press("ESCAPE");
    await m.press(" ");
    expect(m.data.listTasks().filter((task) => task.status === Status.Done).map((task) => task.id).sort()).toEqual([1, 2]);
    expect(m.data.refreshTask(3)!.status).toBe(Status.Pending);
    expect(m.data.refreshTask(4)!.status).toBe(Status.Pending);
  } finally { await m.close(); }
});
