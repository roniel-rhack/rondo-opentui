import { describe, expect, test } from "bun:test";
import { useTerminalDimensions } from "@opentui/react";
import { testRender } from "@opentui/react/test-utils";
import { act, type ReactNode } from "react";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, type Config } from "../src/core/config/config.ts";
import { Priority } from "../src/core/task/task.ts";
import { RecurFreq } from "../src/core/task/recur.ts";
import { TaskForm, emptyTaskForm, type TaskFormValues } from "../src/tui/components/TaskForm.tsx";
import { SettingsOverlay } from "../src/tui/components/Settings.tsx";
import { tuiTheme } from "../src/tui/theme.ts";

process.env.RONDO_HOME = mkdtempSync(join(tmpdir(), "rondo-review4-forms-"));
const theme = tuiTheme(true);
const consoleError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("not wrapped in act")) return;
  consoleError(...args);
};

async function mount(node: ReactNode, width = 80, height = 16) {
  let setup!: Awaited<ReturnType<typeof testRender>>;
  await act(async () => {
    setup = await testRender(node, { width, height, exitOnCtrlC: false });
  });
  await setup.flush();
  return {
    ...setup,
    async press(key: string, modifiers?: { ctrl?: boolean; shift?: boolean }) {
      await act(async () => {
        setup.mockInput.pressKey(key, modifiers);
      });
      await setup.flush();
    },
    async type(value: string) {
      await act(async () => {
        await setup.mockInput.typeText(value);
      });
      await setup.flush();
    },
    async clickText(text: string, within?: string) {
      const lines = setup.captureCharFrame().split("\n");
      const y = lines.findIndex((line) => line.includes(text) && (!within || line.includes(within)));
      expect(y).toBeGreaterThanOrEqual(0);
      const x = lines[y]!.indexOf(text);
      await act(async () => {
        await setup.mockMouse.click(x, y);
      });
      await setup.flush();
    },
  };
}

function Form({
  initial = { ...emptyTaskForm, title: "Review the report" },
  creating = false,
  onSubmit = () => {},
}: {
  initial?: TaskFormValues;
  creating?: boolean;
  onSubmit?: (values: TaskFormValues, keepOpen?: boolean) => void;
}) {
  const { width, height } = useTerminalDimensions();
  return <TaskForm theme={theme} title={creating ? "New task" : "Edit task"}
    initial={initial} creating={creating} screenWidth={width} screenHeight={height}
    onSubmit={onSubmit} onCancel={() => {}} />;
}

describe("TUI review 4 forms", () => {
  test("resizing retains values and reveals every focused control at 80×16", async () => {
    let saved: TaskFormValues | undefined;
    const m = await mount(<Form onSubmit={(values) => { saved = values; }} />, 100, 30);
    try {
      await m.type(" revised");
      await act(async () => { m.resize(80, 16); });
      await m.flush();
      for (let i = 0; i < 4; i++) await m.press("TAB");
      expect(m.captureCharFrame()).toContain("Priority");
      expect(m.captureCharFrame()).toContain("Low");
      await m.press("ARROW_RIGHT");
      expect(m.captureCharFrame()).toContain("Medium");
      await m.press("TAB");
      expect(m.captureCharFrame()).toContain("Repeats");
      await m.press("TAB");
      expect(m.captureCharFrame()).toContain("Review the report revised");
      expect(m.captureCharFrame()).toContain("esc cancel");
      await m.press("s", { ctrl: true });
      expect(saved?.title).toBe("Review the report revised");
      expect(saved?.priority).toBe(Priority.Medium);
    } finally { m.renderer.destroy(); }
  });

  test("validation reveals and focuses the first invalid field", async () => {
    let saved: TaskFormValues | undefined;
    const m = await mount(<Form initial={{ ...emptyTaskForm, title: "", due: "bad" }}
      onSubmit={(values) => { saved = values; }} />);
    try {
      for (let i = 0; i < 5; i++) await m.press("TAB");
      await m.press("s", { ctrl: true });
      expect(m.captureCharFrame()).toContain("Title is required");
      await m.type("Valid title");
      await m.press("s", { ctrl: true });
      expect(m.captureCharFrame()).toContain("Due date must be");
      await m.press("a", { ctrl: true });
      await m.press("k", { ctrl: true });
      await m.type("tomorrow");
      await m.press("s", { ctrl: true });
      expect(saved?.title).toBe("Valid title");
      expect(saved?.due).toBe("tomorrow");
    } finally { m.renderer.destroy(); }
  });

  test("resizing an expanded form to 40×16 preserves every focused label and value", async () => {
    let saved: TaskFormValues | undefined;
    const m = await mount(<Form creating initial={emptyTaskForm}
      onSubmit={(values) => { saved = values; }} />, 160, 40);
    try {
      await m.type("Matrix resize values");
      await m.press("TAB");
      await m.type("Description persists");
      await m.press("TAB");
      await m.type("tomorrow");
      await m.press("TAB");
      await m.type("wide, values");
      await m.press("TAB");
      await m.press("ARROW_RIGHT");
      await m.press("TAB");
      await m.press("ARROW_RIGHT");
      for (const width of [80, 40]) {
        await act(async () => { m.resize(width, 16); });
        await m.flush();
        expect(m.captureCharFrame()).toContain("Repeats");
        expect(m.captureCharFrame()).toContain("Day");
      }
      for (const [label, value] of [
        ["Priority", "Medium"],
        ["Tags", "wide, values"],
        ["Due date", "tomorrow"],
        ["Description", "Description persists"],
        ["Title", "Matrix resize values"],
      ] as const) {
        await m.press("TAB", { shift: true });
        expect(m.captureCharFrame()).toContain(label);
        expect(m.captureCharFrame()).toContain(value);
      }
      await m.press("s", { ctrl: true });
      expect(saved).toEqual({
        title: "Matrix resize values",
        description: "Description persists",
        due: "tomorrow",
        tags: "wide, values",
        priority: Priority.Medium,
        recur: RecurFreq.Daily,
      });
    } finally { m.renderer.destroy(); }
  });

  test("creation starts with title capture and explicitly expands advanced fields", async () => {
    const m = await mount(<Form creating initial={emptyTaskForm} />, 100, 30);
    try {
      expect(m.captureCharFrame()).toContain("More options");
      expect(m.captureCharFrame()).not.toContain("Description");
      await m.clickText("More options");
      expect(m.captureCharFrame()).toContain("Description");
      await m.type("A useful description");
      expect(m.captureCharFrame()).toContain("A useful description");
    } finally { m.renderer.destroy(); }
  });

  test("a due-date error remains visible until that field is corrected", async () => {
    const m = await mount(<Form initial={{ ...emptyTaskForm, title: "Keep checking", due: "bad" }} />);
    try {
      await m.press("s", { ctrl: true });
      await m.type("x");
      expect(m.captureCharFrame()).toContain("Due date must be");
      await m.press("TAB", { shift: true });
      await m.press("TAB", { shift: true });
      await m.type(" revised");
      expect(m.captureCharFrame()).toContain("Due date must be");
      await m.press("TAB");
      await m.press("TAB");
      await m.press("a", { ctrl: true });
      await m.press("k", { ctrl: true });
      await m.type("today");
      expect(m.captureCharFrame()).not.toContain("Due date must be");
    } finally { m.renderer.destroy(); }
  });

  test("mouse scrolling can reach advanced controls without moving keyboard focus", async () => {
    const m = await mount(<Form />);
    try {
      await act(async () => {
        for (let i = 0; i < 5; i++) await m.mockMouse.scroll(40, 7, "down");
      });
      await m.flush();
      expect(m.captureCharFrame()).toContain("Priority");
      expect(m.captureCharFrame()).toContain("Repeats");
      await m.type(" revised");
      expect(m.captureCharFrame()).toContain("Review the report revised");
    } finally { m.renderer.destroy(); }
  });

  test("Ctrl+N resets capture text, retains metadata, and Enter saves normally", async () => {
    const saves: { values: TaskFormValues; keepOpen: boolean }[] = [];
    const m = await mount(<Form creating initial={{ ...emptyTaskForm, description: "Only first" }}
      onSubmit={(values, keepOpen) => { saves.push({ values, keepOpen: Boolean(keepOpen) }); }} />);
    try {
      await m.type("First #work !3 ~w");
      await m.press("n", { ctrl: true });
      expect(saves).toHaveLength(1);
      expect(saves[0]?.keepOpen).toBe(true);
      expect(saves[0]?.values.description).toBe("Only first");
      expect(m.captureCharFrame()).not.toContain("First");
      expect(m.captureCharFrame()).toContain("Keeping High");
      expect(m.captureCharFrame()).toContain("#work");
      await m.type("Second");
      await m.press("RETURN");
      expect(saves).toHaveLength(2);
      expect(saves[1]?.keepOpen).toBe(false);
      expect(saves[1]?.values.title).toBe("Second");
      expect(saves[1]?.values.description).toBe("");
      expect(saves[1]?.values.tags).toBe("work");
      expect(saves[1]?.values.priority).toBe(Priority.High);
    } finally { m.renderer.destroy(); }
  });

  test("Settings toggles and arrows change values with a single click", async () => {
    let saved: Config | undefined;
    const m = await mount(<SettingsOverlay theme={theme} cfg={defaultConfig()}
      screenWidth={100} screenHeight={30} onSave={(cfg) => { saved = cfg; }} onCancel={() => {}} />, 100, 30);
    try {
      await m.clickText("off", "Auto-start breaks");
      expect(m.captureCharFrame().split("\n").find((line) => line.includes("Auto-start breaks"))).toContain("on");
      await m.clickText("→", "Work duration");
      await m.press("RETURN");
      expect(saved?.focus.autoStartBreak).toBe(true);
      expect(saved?.focus.workDuration).toBe(26);
    } finally { m.renderer.destroy(); }
  });

  test("Settings accepts a typed duration and rejects out-of-range values", async () => {
    const saves: Config[] = [];
    const m = await mount(<SettingsOverlay theme={theme} cfg={defaultConfig()}
      screenWidth={80} screenHeight={16} onSave={(cfg) => { saves.push(cfg); }} onCancel={() => {}} />);
    try {
      await m.clickText("25", "Work duration");
      await m.type("999");
      await m.press("s", { ctrl: true });
      expect(saves).toHaveLength(0);
      expect(m.captureCharFrame()).toContain("1–120");
      await m.press("a", { ctrl: true });
      await m.press("k", { ctrl: true });
      await m.type("45");
      await m.press("s", { ctrl: true });
      expect(saves[0]?.focus.workDuration).toBe(45);
    } finally { m.renderer.destroy(); }
  });

  test("Settings types a duration from the keyboard and reveals the last field", async () => {
    let saved: Config | undefined;
    const m = await mount(<SettingsOverlay theme={theme} cfg={defaultConfig()}
      screenWidth={80} screenHeight={16} onSave={(cfg) => { saved = cfg; }} onCancel={() => {}} />);
    try {
      await m.type("45");
      for (let i = 0; i < 7; i++) await m.press("TAB");
      expect(m.captureCharFrame()).toContain("Theme");
      await m.press("ARROW_RIGHT");
      expect(m.captureCharFrame()).toContain("dark");
      await m.press("RETURN");
      expect(saved?.focus.workDuration).toBe(45);
      expect(saved?.theme).toBe("dark");
    } finally { m.renderer.destroy(); }
  });

  test("40×16 Settings keeps complete labels readable and every value clickable", async () => {
    let saved: Config | undefined;
    const m = await mount(<SettingsOverlay theme={theme} cfg={defaultConfig()}
      screenWidth={40} screenHeight={16} onSave={(cfg) => { saved = cfg; }} onCancel={() => {}} />, 40, 16);
    const control = (label: string, value: string) => {
      const lines = m.captureCharFrame().split("\n");
      const labelRow = lines.findIndex((line) => line.includes(label));
      expect(labelRow).toBeGreaterThan(0);
      expect(lines[labelRow]).not.toContain("←");
      const valueRow = labelRow + 1;
      expect(lines[valueRow]).toContain(value);
      return { x: lines[valueRow]!.indexOf(value), y: valueRow };
    };
    const clickControl = async (label: string, value: string) => {
      const { x, y } = control(label, value);
      await act(async () => { await m.mockMouse.click(x, y); });
      await m.flush();
    };
    try {
      control("Work duration (min)", "25");
      await clickControl("Work duration (min)", "→");
      await clickControl("Work duration (min)", "26");
      await m.type("45");
      for (const [label, value] of [
        ["Short break (min)", "5"],
        ["Long break (min)", "15"],
        ["Sessions per long break", "4"],
        ["Daily goal", "8"],
      ] as const) {
        await m.press("TAB");
        control(label, value);
      }
      await m.press("TAB");
      await clickControl("Auto-start breaks", "off");
      control("Auto-start breaks", "on");
      await m.press("TAB");
      control("Sound on completion", "on");
      await m.press("TAB");
      await clickControl("Theme", "→");
      control("Theme", "dark");
      await m.clickText("Save");
      expect(saved?.focus.workDuration).toBe(45);
      expect(saved?.focus.autoStartBreak).toBe(true);
      expect(saved?.theme).toBe("dark");
    } finally { m.renderer.destroy(); }
  });
});
