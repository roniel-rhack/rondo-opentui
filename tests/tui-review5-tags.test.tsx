import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../src/core/config/config.ts";
import { openMemory } from "../src/core/database/db.ts";
import { newTask } from "../src/core/task/store.ts";
import { Status } from "../src/core/task/task.ts";
import { RondoData, type UndoAction } from "../src/tui/data.ts";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { TagEditor } from "../src/tui/components/TagEditor.tsx";
import { tuiTheme } from "../src/tui/theme.ts";
import type { Task } from "../src/core/task/task.ts";

process.env.RONDO_HOME = mkdtempSync(join(tmpdir(), "rondo-review5-tags-"));
const consoleError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("not wrapped in act")) return;
  consoleError(...args);
};

describe("direct tag editing data", () => {
  test("bulk changes preserve untouched unique tags and undo restores only tags", () => {
    const db = openMemory();
    const data = new RondoData(db, defaultConfig());
    try {
      const first = newTask({ title: "First", tags: ["common", "personal"] });
      const second = newTask({ title: "Second", tags: ["common", "work"] });
      data.tasks.create(first);
      data.tasks.create(second);
      const actions: UndoAction[] = [];
      for (const task of [first, second]) {
        const action = data.editTags(task.id, { add: [" shared ", "shared", ""], remove: [" common "] });
        expect(action?.kind).toBe("tags");
        actions.push(action!);
      }
      expect(data.refreshTask(first.id)!.tags).toEqual(["personal", "shared"]);
      expect(data.refreshTask(second.id)!.tags).toEqual(["work", "shared"]);
      const later = data.refreshTask(first.id)!;
      later.title = "Later title";
      later.status = Status.InProgress;
      data.tasks.update(later);
      data.undo({ kind: "bulk", label: "Tags", actions });
      expect(data.refreshTask(first.id)!.tags).toEqual(["common", "personal"]);
      expect(data.refreshTask(second.id)!.tags).toEqual(["common", "work"]);
      expect(data.refreshTask(first.id)!.title).toBe("Later title");
      expect(data.refreshTask(first.id)!.status).toBe(Status.InProgress);
    } finally { db.close(); }
  });

  test("reads fresh tags and avoids empty undo entries for unchanged or missing tasks", () => {
    const db = openMemory();
    const data = new RondoData(db, defaultConfig());
    try {
      const task = newTask({ title: "Task", tags: ["existing"] });
      data.tasks.create(task);
      const fresh = data.refreshTask(task.id)!;
      fresh.tags.push("external");
      data.tasks.update(fresh);
      data.editTags(task.id, { add: ["new"], remove: [] });
      expect(data.refreshTask(task.id)!.tags).toEqual(["existing", "external", "new"]);
      expect(data.editTags(task.id, { add: [" new ", ""], remove: ["absent"] })).toBeNull();
      expect(data.editTags(task.id, { add: [], remove: [] })).toBeNull();
      expect(data.editTags(999, { add: ["new"], remove: [] })).toBeNull();
    } finally { db.close(); }
  });
});

async function mountEditor(tasks: Task[], knownTags: string[] = []) {
  const saved: { add: string[]; remove: string[] }[] = [];
  let closed = 0;
  let setup!: Awaited<ReturnType<typeof testRender>>;
  await act(async () => {
    setup = await testRender(
      <TagEditor theme={tuiTheme(true)} tasks={tasks} knownTags={knownTags}
        screenWidth={40} screenHeight={16} onSubmit={(changes) => saved.push(changes)}
        onClose={() => closed++} />,
      { width: 40, height: 16, exitOnCtrlC: false },
    );
  });
  await setup.flush();
  return {
    ...setup,
    saved,
    closed: () => closed,
    async press(key: string, modifiers?: { ctrl?: boolean }) {
      await act(async () => {
        setup.mockInput.pressKey(key, modifiers);
        if (key === "ESCAPE") await Bun.sleep(120);
      });
      await setup.flush();
    },
    async type(value: string) {
      await act(async () => { await setup.mockInput.typeText(value); });
      await setup.flush();
    },
    async clickText(value: string) {
      const lines = setup.captureCharFrame().split("\n");
      const y = lines.findIndex((line) => line.includes(value));
      expect(y).toBeGreaterThanOrEqual(0);
      await act(async () => { await setup.mockMouse.click(lines[y]!.indexOf(value), y); });
      await setup.flush();
    },
  };
}

describe("direct tag editor", () => {
  test("shows mixed and checked tags, then applies only explicitly toggled tags", async () => {
    const m = await mountEditor([
      newTask({ tags: ["common", "personal"] }), newTask({ tags: ["common", "work"] }),
    ]);
    try {
      expect(m.captureCharFrame()).toContain("[x] #common");
      expect(m.captureCharFrame()).toContain("[-] #personal");
      expect(m.captureCharFrame()).toContain("1/2");
      await m.clickText("#personal");
      expect(m.captureCharFrame()).toContain("[x] #personal");
      await m.clickText("#common");
      expect(m.captureCharFrame()).toContain("[ ] #common");
      await m.press("s", { ctrl: true });
      expect(m.saved).toEqual([{ add: ["personal"], remove: ["common"] }]);
    } finally { m.renderer.destroy(); }
  });

  test("creates a tag with spaces and saves through the mouse at 40 by 16", async () => {
    const m = await mountEditor([newTask()]);
    try {
      expect(m.captureCharFrame()).toContain("No tags yet");
      expect(m.captureCharFrame()).toContain("ctrl+s save");
      await m.type("team planning");
      expect(m.captureCharFrame()).toContain("Create #team planning");
      await m.press("RETURN");
      expect(m.captureCharFrame()).toContain("[x] #team planning");
      await m.clickText("Save");
      expect(m.saved).toEqual([{ add: ["team planning"], remove: [] }]);
    } finally { m.renderer.destroy(); }
  });

  test("keyboard selection scrolls all tags and space toggles only with list focus", async () => {
    const tags = Array.from({ length: 20 }, (_, i) => `tag-${String(i).padStart(2, "0")}`);
    const m = await mountEditor([newTask()], tags);
    try {
      await m.press("TAB");
      for (let i = 0; i < 19; i++) await m.press("ARROW_DOWN");
      expect(m.captureCharFrame()).toContain("#tag-19");
      expect(m.captureCharFrame()).toContain("ctrl+s save");
      await m.press(" ");
      await m.press("s", { ctrl: true });
      expect(m.saved).toEqual([{ add: ["tag-19"], remove: [] }]);
    } finally { m.renderer.destroy(); }
  });

  test("mixed tags can be removed from every task and escape discards the draft", async () => {
    const m = await mountEditor([newTask({ tags: ["mixed"] }), newTask()]);
    try {
      await m.press("TAB");
      await m.press("RETURN");
      expect(m.captureCharFrame()).toContain("[x] #mixed");
      await m.press(" ");
      expect(m.captureCharFrame()).toContain("[ ] #mixed");
      await m.press("ESCAPE");
      expect(m.closed()).toBe(1);
      expect(m.saved).toEqual([]);
    } finally { m.renderer.destroy(); }
  });

  test("mouse scrolling reaches tags outside the visible window", async () => {
    const tags = Array.from({ length: 20 }, (_, i) => `tag-${String(i).padStart(2, "0")}`);
    const m = await mountEditor([newTask()], tags);
    try {
      for (let i = 0; i < 20; i++) {
        await act(async () => { await m.mockMouse.scroll(12, 5, "down"); });
        await m.flush();
      }
      await m.clickText("#tag-19");
      await m.clickText("Save");
      expect(m.saved).toEqual([{ add: ["tag-19"], remove: [] }]);
    } finally { m.renderer.destroy(); }
  });

  test("filters long labels without losing counts or controls and toggling twice leaves no change", async () => {
    const longTag = "work-planning-for-the-complete-quarter";
    const m = await mountEditor([newTask({ tags: [longTag] })], ["personal", longTag]);
    try {
      await m.type("quarter");
      const frame = m.captureCharFrame();
      expect(frame).toContain("1/1");
      expect(frame).toContain("Save");
      expect(frame).toContain("ctrl+s save · esc cancel");
      expect(frame).not.toContain("#personal");
      await m.press("RETURN");
      expect(m.captureCharFrame()).toContain("0/1");
      await m.press("RETURN");
      await m.press("s", { ctrl: true });
      expect(m.saved).toEqual([{ add: [], remove: [] }]);
    } finally { m.renderer.destroy(); }
  });

  test("a created tag stays visible when many known tags precede it", async () => {
    const tags = Array.from({ length: 20 }, (_, i) => `tag-${String(i).padStart(2, "0")}`);
    const m = await mountEditor([newTask()], tags);
    try {
      await m.type("zz-new");
      await m.clickText("Create #zz-new");
      expect(m.captureCharFrame()).toContain("[x] #zz-new");
      await m.clickText("Save");
      expect(m.saved).toEqual([{ add: ["zz-new"], remove: [] }]);
    } finally { m.renderer.destroy(); }
  });

  test("creating and saving in one input chunk includes the new tag", async () => {
    const m = await mountEditor([newTask()]);
    try {
      await m.type("release");
      await m.press("\r\u0013");
      expect(m.saved).toEqual([{ add: ["release"], remove: [] }]);
    } finally { m.renderer.destroy(); }
  });

  test("toggling and saving in one input chunk removes an existing tag", async () => {
    const m = await mountEditor([newTask({ tags: ["release"] })]);
    try {
      await m.press("\r\u0013");
      expect(m.saved).toEqual([{ add: [], remove: ["release"] }]);
    } finally { m.renderer.destroy(); }
  });

  test("typing, creating and saving in one input chunk keeps the complete query", async () => {
    const m = await mountEditor([newTask()], ["other"]);
    try {
      await m.press("release\r\u0013");
      expect(m.saved).toEqual([{ add: ["release"], remove: [] }]);
    } finally { m.renderer.destroy(); }
  });
});
