import { expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../src/core/config/config.ts";
import { defaultTuiState, loadTuiState } from "../src/core/config/tui-state.ts";
import { openMemory } from "../src/core/database/db.ts";
import { newTask } from "../src/core/task/store.ts";
import { Status } from "../src/core/task/task.ts";
import { App } from "../src/tui/app.tsx";
import { RondoData } from "../src/tui/data.ts";

const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("not wrapped in act")) return;
  originalConsoleError(...args);
};

async function mount(width = 80, height = 24) {
  const home = mkdtempSync(join(tmpdir(), "rondo-workflows-"));
  process.env.RONDO_HOME = home;
  const data = new RondoData(openMemory(), defaultConfig());
  for (const title of ["Alpha client authentication", "Beta client authentication", "Gamma release checklist"]) {
    data.tasks.create(newTask({ title }));
  }
  writeFileSync(join(home, "tui-state.json"), JSON.stringify({ ...defaultTuiState(), selectedTaskId: 1 }));
  let setup!: Awaited<ReturnType<typeof testRender>>;
  await act(async () => {
    setup = await testRender(<App data={data} />, { width, height, exitOnCtrlC: false });
  });
  await setup.flush();
  const press = async (key: string, modifiers?: { ctrl?: boolean; shift?: boolean }) => {
    await act(async () => {
      setup.mockInput.pressKey(key, modifiers);
      if (key === "ESCAPE") await new Promise((r) => setTimeout(r, 120));
    });
    await setup.flush();
  };
  const type = async (text: string) => {
    await act(async () => { await setup.mockInput.typeText(text); });
    await setup.flush();
  };
  return { ...setup, data, home, press, type };
}

test("compact layout gives titles full width and opens the inspector on demand", async () => {
  const m = await mount();
  try {
    expect(m.captureCharFrame()).not.toContain("Details");
    expect(m.captureCharFrame()).toContain("Alpha client authentication");
    await m.press("RETURN");
    expect(m.captureCharFrame()).toContain("Details");
    await m.press("ESCAPE");
    expect(m.captureCharFrame()).not.toContain("Details");
  } finally { m.renderer.destroy(); }
});

test("shrinking a split layout keeps the compact panel inside the terminal", async () => {
  const m = await mount(160, 40);
  try {
    await act(async () => { m.resize(40, 16); });
    await m.flush();
    const lines = m.captureCharFrame().split("\n");
    expect(lines[1]?.trimEnd().endsWith("╮")).toBe(true);
    expect(lines[13]?.trimEnd().endsWith("╯")).toBe(true);
    await m.press("RETURN");
    expect(m.captureCharFrame().split("\n")[1]?.trimEnd().endsWith("╮")).toBe(true);
  } finally { m.renderer.destroy(); }
});

test("select visible marks only search results and completes them as one undo", async () => {
  const m = await mount();
  try {
    await m.press("/"); await m.type("authentication"); await m.press("RETURN");
    await m.press("M"); await m.press(" ");
    expect(m.data.listTasks().filter((t) => t.status === Status.Done)).toHaveLength(2);
    expect(m.data.listTasks().find((t) => t.title.startsWith("Gamma"))?.status).toBe(Status.Pending);
    await m.press("u");
    expect(m.data.listTasks().every((t) => t.status === Status.Pending)).toBe(true);
  } finally { m.renderer.destroy(); }
});

test("shift navigation selects an inclusive range", async () => {
  const m = await mount();
  try {
    await m.press("g"); await m.press("J"); await m.press(" ");
    expect(m.data.listTasks().filter((t) => t.status === Status.Done)).toHaveLength(2);
  } finally { m.renderer.destroy(); }
});

test("filtering after marking all limits the mutation to visible results", async () => {
  const m = await mount();
  try {
    await m.press("M");
    await m.press("/"); await m.type("Alpha"); await m.press("RETURN");
    await m.press(" ");
    expect(m.data.listTasks().filter((t) => t.status === Status.Done).map((t) => t.title))
      .toEqual(["Alpha client authentication"]);
  } finally { m.renderer.destroy(); }
});

test("palette names all marked tasks before deleting them", async () => {
  const m = await mount();
  try {
    await m.press("g");
    await m.press("m"); await m.press("j"); await m.press("m");
    await m.press("k", { ctrl: true }); await m.type("Delete");
    expect(m.captureCharFrame()).toContain("Delete 2 marked tasks");
  } finally { m.renderer.destroy(); }
});

test("return from global task jump restores the filtered context", async () => {
  const m = await mount();
  try {
    await m.press("/"); await m.type("Alpha"); await m.press("RETURN");
    await m.press("k", { ctrl: true }); await m.type("Gamma release"); await m.press("RETURN");
    await m.press("BACKSPACE");
    expect(m.captureCharFrame()).toContain("Alpha");
    expect(m.captureCharFrame()).not.toContain("Gamma release");
  } finally { m.renderer.destroy(); }
});

test("short status bar keeps complete and search discoverable", async () => {
  const m = await mount(60, 20);
  try {
    const footer = m.captureCharFrame().split("\n").slice(-3).join("\n");
    expect(footer).toContain("done");
    expect(footer).toContain("search");
  } finally { m.renderer.destroy(); }
});

test("return from a jump inside the same result set restores the selected task", async () => {
  const m = await mount();
  try {
    await m.press("e");
    expect(m.captureCharFrame()).toContain("Edit task #1");
    await m.press("ESCAPE");
    await m.press("k", { ctrl: true }); await m.type("Gamma release"); await m.press("RETURN");
    await m.press("BACKSPACE");
    expect(m.captureCharFrame()).not.toContain("Details");
    await m.press("e");
    expect(m.captureCharFrame()).toContain("Alpha client authentication");
    expect(m.captureCharFrame()).not.toContain("Gamma release checklist");
  } finally { m.renderer.destroy(); }
});

test("session file round-trips layout and reduced motion without changing config", () => {
  const home = mkdtempSync(join(tmpdir(), "rondo-layout-state-"));
  const path = join(home, "tui-state.json");
  writeFileSync(path, JSON.stringify({ ...defaultTuiState(), layout: "split", reducedMotion: true }));
  expect(loadTuiState(path)).toMatchObject({ layout: "split", reducedMotion: true });
});
