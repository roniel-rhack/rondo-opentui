import { expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../src/core/config/config.ts";
import { defaultTuiState } from "../src/core/config/tui-state.ts";
import { openMemory } from "../src/core/database/db.ts";
import { newTask } from "../src/core/task/store.ts";
import { App } from "../src/tui/app.tsx";
import { RondoData } from "../src/tui/data.ts";

const reportError = console.error;
console.error = (...args: unknown[]) => {
  if (!String(args[0]).includes("not wrapped in act")) reportError(...args);
};

async function mount(width = 80, height = 24) {
  const home = mkdtempSync(join(tmpdir(), "rondo-review5-"));
  const previousHome = process.env.RONDO_HOME;
  process.env.RONDO_HOME = home;
  writeFileSync(join(home, "tui-state.json"), JSON.stringify({
    ...defaultTuiState(), selectedTaskId: 1, reducedMotion: true,
  }));
  const db = openMemory();
  const data = new RondoData(db, defaultConfig());
  data.tasks.create(newTask({ title: "Review authentication flow for production access", tags: ["work", "alpha"] }));
  data.tasks.create(newTask({ title: "Review authentication flow for customer accounts", tags: ["work", "beta"] }));
  data.tasks.addSubtask(1, "Validate credentials");
  let setup!: Awaited<ReturnType<typeof testRender>>;
  await act(async () => { setup = await testRender(<App data={data} />, { width, height, exitOnCtrlC: false }); });
  await setup.flush();
  return {
    ...setup, data,
    async press(key: string, modifiers?: { ctrl?: boolean }) {
      await act(async () => {
        setup.mockInput.pressKey(key, modifiers);
        if (key === "ESCAPE") await Bun.sleep(140);
      });
      await setup.flush();
    },
    async type(value: string) {
      await act(async () => { await setup.mockInput.typeText(value); });
      await setup.flush();
    },
    close() {
      setup.renderer.destroy();
      db.close();
      if (previousHome === undefined) delete process.env.RONDO_HOME;
      else process.env.RONDO_HOME = previousHome;
    },
  };
}

test("a filtered creation can be revealed and returns to the previous selection", async () => {
  const m = await mount();
  try {
    await m.press("/"); await m.type("production"); await m.press("RETURN");
    await m.press("a"); await m.type("Prepare invoice"); await m.press("RETURN");
    expect(m.captureCharFrame()).toContain("outside filter");
    await m.press("V");
    expect(m.captureCharFrame()).toContain("Prepare invoice");
    expect(m.captureCharFrame()).toContain("Details");
    await m.press("BACKSPACE");
    expect(m.captureCharFrame()).toContain("production");
    await m.press("e");
    expect(m.captureCharFrame()).toContain("Edit task #1");
  } finally { m.close(); }
});

test("task drafts survive Escape and explicit discard clears them", async () => {
  const m = await mount();
  try {
    await m.press("a"); await m.type("Keep this draft"); await m.press("ESCAPE");
    await m.press("a");
    expect(m.captureCharFrame()).toContain("Keep this draft");
    await m.press("r", { ctrl: true });
    await m.press("a");
    expect(m.captureCharFrame()).not.toContain("Keep this draft");
    await m.type("Saved once"); await m.press("RETURN"); await m.press("a");
    expect(m.captureCharFrame()).not.toContain("│Saved once");
    expect(m.data.listTasks().filter((task) => task.title === "Saved once")).toHaveLength(1);
  } finally { m.close(); }
});

test("journal entry drafts survive closing without writing the database", async () => {
  const m = await mount();
  try {
    await m.press("4"); await m.press("a"); await m.type("Journal draft"); await m.press("ESCAPE");
    expect(m.data.listNotes(false)).toHaveLength(0);
    await m.press("a"); expect(m.captureCharFrame()).toContain("Journal draft");
    await m.press("s", { ctrl: true });
    expect(m.data.listNotes(false)[0]?.entries[0]?.body).toBe("Journal draft");
  } finally { m.close(); }
});

test("E edits the parent task from the inspector while e still edits its child", async () => {
  const m = await mount();
  try {
    await m.press("RETURN"); await m.press("E");
    expect(m.captureCharFrame()).toContain("Edit task #1");
    await m.press("ESCAPE"); await m.press("e");
    expect(m.captureCharFrame()).toContain("Edit subtask");
  } finally { m.close(); }
});

test("subtask drafts remain attached to their own entity", async () => {
  const m = await mount();
  try {
    m.data.tasks.addSubtask(1, "Second independent step");
    await m.press("R"); await m.press("RETURN"); await m.press("e");
    await m.type(" revised"); await m.press("ESCAPE");
    await m.press("j"); await m.press("e");
    expect(m.captureCharFrame()).toContain("Second independent step");
    expect(m.captureCharFrame()).not.toContain("Validate credentials revised");
    await m.press("ESCAPE"); await m.press("k"); await m.press("e");
    expect(m.captureCharFrame()).toContain("Validate credentials revised");
  } finally { m.close(); }
});

test("auto layout keeps identifying title suffixes visible at 100 columns", async () => {
  const m = await mount(100, 28);
  try {
    expect(m.captureCharFrame()).toContain("customer accounts");
    expect(m.captureCharFrame()).not.toContain("Details");
  } finally { m.close(); }
});

test("40-column hints preserve complete, search and help", async () => {
  const m = await mount(40, 16);
  try {
    const footer = m.captureCharFrame().split("\n").slice(-3).join("\n");
    expect(footer).toContain("done");
    expect(footer).toContain("search");
    expect(footer).toContain("?");
  } finally { m.close(); }
});

test("comma opens bulk tag editing with one grouped undo", async () => {
  const m = await mount();
  try {
    await m.press("M"); await m.press(",");
    expect(m.captureCharFrame()).toContain("2 tasks");
    await m.type("release"); await m.press("RETURN"); await m.press("s", { ctrl: true });
    expect(m.data.listTasks().every((task) => task.tags.includes("release"))).toBe(true);
    expect(m.data.tasks.getById(1)?.tags).toContain("alpha");
    expect(m.data.tasks.getById(2)?.tags).toContain("beta");
    await m.press("u");
    expect(m.data.listTasks().every((task) => !task.tags.includes("release"))).toBe(true);
  } finally { m.close(); }
});


test("inspector folds survive a filtered jump, return history and the compact list", async () => {
  const m = await mount();
  try {
    const task = m.data.tasks.getById(1)!;
    task.description = Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1}`).join("\n\n");
    m.data.tasks.update(task);
    await m.press("R");
    await m.press("/"); await m.type("production"); await m.press("RETURN");
    await m.press("RETURN"); await m.press("D");
    expect(m.captureCharFrame()).toContain("Validate credentials");
    await m.press("a"); await m.type("Prepare invoice"); await m.press("RETURN");
    await m.press("V"); await m.press("BACKSPACE");
    expect(m.captureCharFrame()).toContain("Validate credentials");
    expect(m.captureCharFrame()).not.toContain("Paragraph 1");
    await m.press("h"); await m.press("RETURN");
    expect(m.captureCharFrame()).toContain("Validate credentials");
    expect(m.captureCharFrame()).not.toContain("Paragraph 1");
  } finally { m.close(); }
});


test("the hidden-task banner stays scoped to task panels", async () => {
  const m = await mount();
  try {
    await m.press("/"); await m.type("production"); await m.press("RETURN");
    await m.press("a"); await m.type("Prepare invoice"); await m.press("RETURN");
    expect(m.captureCharFrame()).toContain("outside filter");
    await m.press("4");
    expect(m.captureCharFrame().split("\n").slice(0, -3).join("\n")).not.toContain("outside filter");
    await m.press("1");
    expect(m.captureCharFrame()).toContain("outside filter");
  } finally { m.close(); }
});
