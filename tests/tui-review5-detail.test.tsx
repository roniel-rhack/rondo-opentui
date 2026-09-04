import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, useState } from "react";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../src/core/config/config.ts";
import { newTask } from "../src/core/task/store.ts";
import { Status, type Task } from "../src/core/task/task.ts";
import {
  TaskDetail,
  type TaskDetailHandle,
  type TaskDetailSectionState,
} from "../src/tui/components/TaskDetail.tsx";
import { tuiTheme } from "../src/tui/theme.ts";

process.env.RONDO_HOME = mkdtempSync(join(tmpdir(), "rondo-review5-detail-"));

async function mount(
  dark: boolean,
  width: number,
  height: number,
  options: {
    panelWidth?: number;
    title?: string;
    editable?: boolean;
    tags?: string[];
    sectionStateRef?: { current: TaskDetailSectionState };
  } = {},
) {
  const task = newTask({
    title: options.title ?? "Parent identity",
    tags: options.tags ?? [],
    description: Array.from({ length: 35 }, (_, index) => `Paragraph ${index + 1}`).join("\n\n"),
  });
  task.id = 901;
  task.subtasks = [
    { id: 1, title: "First step", completed: false, position: 0 },
    { id: 2, title: "Second step", completed: false, position: 1 },
  ];
  const handle: { current: TaskDetailHandle | null } = { current: null };
  let move!: (cursor: number) => void;
  let replaceTask!: (task: Task | null) => void;
  let showInspector!: (visible: boolean) => void;
  let edits = 0;
  function Fixture() {
    const [cursor, setCursor] = useState(0);
    const [shown, setShown] = useState<Task | null>(task);
    const [visible, setVisible] = useState(true);
    move = setCursor;
    replaceTask = setShown;
    showInspector = setVisible;
    return (
      <box width={options.panelWidth ?? width} height={height}>
        {visible ? <TaskDetail
          theme={tuiTheme(dark)} cfg={defaultConfig()} task={shown}
          focused cursor={cursor} onSelectRow={setCursor}
          onToggleSubtask={() => {}} blocked={false} blockedByTitles={new Map()}
          onEditTask={options.editable === false ? undefined : () => { edits += 1; }} ref={handle}
          sectionStateRef={options.sectionStateRef}
        /> : null}
      </box>
    );
  }
  let setup!: Awaited<ReturnType<typeof testRender>>;
  await act(async () => {
    setup = await testRender(<Fixture />, { width, height, exitOnCtrlC: false });
  });
  const settle = async () => {
    await setup.flush();
    await act(async () => { await Bun.sleep(180); });
    await setup.flush();
  };
  await settle();
  return { ...setup, handle, move, replaceTask, showInspector, settle, task, edits: () => edits };
}

describe("inspector overview", () => {
  for (const dark of [true, false]) {
    for (const [width, height] of [[40, 16], [80, 24]]) {
      test(`${dark ? "dark" : "light"} ${width}x${height} keeps identity while following the cursor`, async () => {
        const setup = await mount(dark, width!, height!);
        try {
          expect(setup.handle.current!.getScrollTop()).toBe(0);
          expect(setup.captureCharFrame()).toContain("Parent identity");
          expect(setup.captureCharFrame()).toContain("Paragraph 1");
          expect(setup.captureCharFrame()).not.toContain("First step");
          await act(async () => { setup.move(1); });
          await setup.settle();
          expect(setup.handle.current!.getScrollTop()).toBeGreaterThan(0);
          expect(setup.captureCharFrame()).toContain("Parent identity");
          expect(setup.captureCharFrame()).toContain("Pending");
          expect(setup.captureCharFrame()).toContain("┃ ▢ Second step");
          await act(async () => { setup.handle.current!.scrollTo(0); });
          await setup.settle();
          expect(setup.handle.current!.getScrollTop()).toBe(0);
        } finally { setup.renderer.destroy(); }
      });
    }
  }

  test("description collapses by handle and mouse, and parent edit is explicit", async () => {
    const setup = await mount(true, 40, 16);
    try {
      await act(async () => { setup.handle.current!.toggleDescription(); });
      await setup.settle();
      let frame = setup.captureCharFrame();
      expect(frame).not.toContain("Paragraph 1");
      expect(frame).toContain("First step");
      expect(frame).not.toContain("describe");
      const descriptionRow = frame.split("\n").findIndex((line) => line.includes("DESCRIPTION"));
      await act(async () => { await setup.mockMouse.click(4, descriptionRow); });
      await setup.settle();
      expect(setup.captureCharFrame()).toContain("Paragraph 1");
      frame = setup.captureCharFrame();
      const editRow = frame.split("\n").findIndex((line) => line.includes("edit task"));
      const editColumn = frame.split("\n")[editRow]!.indexOf("edit task");
      await act(async () => { await setup.mockMouse.click(editColumn, editRow); });
      await setup.flush();
      expect(setup.edits()).toBe(1);
    } finally { setup.renderer.destroy(); }
  });

  test("titles honor the panel width and preserve grapheme clusters", async () => {
    const title = `Parent e\u0301 👨‍👩‍👧‍👦 ${"界".repeat(40)}`;
    const setup = await mount(false, 80, 24, {
      panelWidth: 24,
      title,
      tags: ["a-tag-that-is-longer-than-the-panel"],
    });
    try {
      await act(async () => {
        setup.replaceTask({ ...setup.task, status: Status.InProgress });
      });
      await setup.settle();
      const lines = setup.captureCharFrame().split("\n");
      const titleLine = lines.find((line) => line.includes("Parent"))!;
      expect(titleLine).toContain("e\u0301 👨‍👩‍👧‍👦");
      expect(titleLine).toContain("…");
      expect(Bun.stringWidth(titleLine.trimEnd())).toBeLessThanOrEqual(24);
      expect(lines.filter((line) => line.includes("界"))).toHaveLength(1);
      expect(setup.captureCharFrame()).toContain("In Progress");
      expect(setup.captureCharFrame()).toContain("DESCRIPTION");
    } finally { setup.renderer.destroy(); }
  });

  test("details collapse with the mouse, and changing tasks restores the overview", async () => {
    const setup = await mount(true, 80, 24, { editable: false });
    try {
      expect(setup.captureCharFrame()).not.toContain("edit task");
      await act(async () => { setup.handle.current!.toggleDescription(); });
      await setup.settle();
      const detailsRow = setup.captureCharFrame().split("\n").findIndex((line) => line.includes("DETAILS"));
      expect(setup.captureCharFrame()).toContain("#901");
      await act(async () => { await setup.mockMouse.click(4, detailsRow); });
      await setup.settle();
      expect(setup.captureCharFrame()).not.toContain("#901");
      await act(async () => {
        setup.replaceTask({ ...setup.task, id: 902, title: "Another parent" });
      });
      await setup.settle();
      expect(setup.handle.current!.getScrollTop()).toBe(0);
      expect(setup.captureCharFrame()).toContain("Another parent");
      expect(setup.captureCharFrame()).toContain("Paragraph 1");
      await act(async () => { setup.handle.current!.scrollBy(12); });
      await setup.settle();
      expect(setup.handle.current!.getScrollTop()).toBe(12);
      expect(setup.captureCharFrame()).toContain("Another parent");
    } finally { setup.renderer.destroy(); }
  });

  test("explicit row navigation reveals an unchanged cursor and uses the latest cursor", async () => {
    const setup = await mount(true, 40, 16);
    try {
      await act(async () => { setup.handle.current!.revealSelection(); });
      await setup.settle();
      expect(setup.captureCharFrame()).toContain("┃ ▢ First step");
      await act(async () => {
        setup.handle.current!.scrollTo(0);
        setup.move(1);
        setup.handle.current!.revealSelection();
      });
      await setup.settle();
      expect(setup.captureCharFrame()).toContain("┃ ▢ Second step");
    } finally { setup.renderer.destroy(); }
  });

  test("returning to a task restores its folds independently of other tasks", async () => {
    const setup = await mount(true, 80, 24);
    try {
      await act(async () => { setup.handle.current!.toggleDescription(); });
      await setup.settle();
      const detailsRow = setup.captureCharFrame().split("\n").findIndex((line) => line.includes("DETAILS"));
      await act(async () => { await setup.mockMouse.click(4, detailsRow); });
      await setup.settle();
      expect(setup.captureCharFrame()).toContain("First step");
      expect(setup.captureCharFrame()).not.toContain("#901");
      const other = { ...setup.task, id: 902, title: "Other parent" };
      await act(async () => { setup.replaceTask(other); });
      await setup.settle();
      expect(setup.captureCharFrame()).toContain("Paragraph 1");
      await act(async () => { setup.handle.current!.toggleDescription(); });
      await setup.settle();
      expect(setup.captureCharFrame()).toContain("#902");
      await act(async () => { setup.replaceTask(null); });
      await setup.settle();
      await act(async () => { setup.replaceTask({ ...setup.task }); });
      await setup.settle();
      expect(setup.captureCharFrame()).toContain("First step");
      expect(setup.captureCharFrame()).not.toContain("Paragraph 1");
      expect(setup.captureCharFrame()).not.toContain("#901");
      await act(async () => { setup.handle.current!.toggleDescription(); });
      await setup.settle();
      expect(setup.captureCharFrame()).toContain("Paragraph 1");
      await act(async () => { setup.replaceTask({ ...other }); });
      await setup.settle();
      expect(setup.captureCharFrame()).not.toContain("Paragraph 1");
      expect(setup.captureCharFrame()).toContain("#902");
    } finally { setup.renderer.destroy(); }
  });

  test("viewport-based paging reads every paragraph below the fixed header", async () => {
    const setup = await mount(true, 40, 16);
    try {
      const viewportHeight = setup.handle.current!.getViewportHeight();
      expect(viewportHeight).toBeGreaterThanOrEqual(11);
      expect(viewportHeight).toBeLessThan(16);
      const seen = new Set<number>();
      for (let page = 0; page < 12; page += 1) {
        const frame = setup.captureCharFrame();
        expect(frame).toContain("Parent identity");
        expect(frame).toContain("E  edit task");
        for (const match of frame.matchAll(/Paragraph (\d+)/g)) {
          seen.add(Number(match[1]));
        }
        await act(async () => {
          setup.handle.current!.scrollBy(viewportHeight - 1);
        });
        await setup.flush();
      }
      expect([...seen].sort((a, b) => a - b)).toEqual(
        Array.from({ length: 35 }, (_, index) => index + 1),
      );
    } finally { setup.renderer.destroy(); }
  });

  test("session section state survives unmounting and remounting the inspector", async () => {
    const sectionStateRef = { current: new Map() as TaskDetailSectionState };
    const setup = await mount(true, 40, 16, { sectionStateRef });
    try {
      await act(async () => { setup.handle.current!.toggleDescription(); });
      await setup.settle();
      const detailsRow = setup.captureCharFrame().split("\n").findIndex((line) => line.includes("DETAILS"));
      await act(async () => { await setup.mockMouse.click(4, detailsRow); });
      await setup.settle();
      await act(async () => { setup.showInspector(false); });
      await setup.settle();
      expect(setup.handle.current).toBeNull();
      await act(async () => { setup.showInspector(true); });
      await setup.settle();
      expect(setup.captureCharFrame()).toContain("First step");
      expect(setup.captureCharFrame()).not.toContain("Paragraph 1");
      expect(setup.captureCharFrame()).toContain("▸ DETAILS");
      await act(async () => { setup.handle.current!.toggleDescription(); });
      await setup.settle();
      expect(setup.captureCharFrame()).toContain("Paragraph 1");
    } finally { setup.renderer.destroy(); }
  });
});
