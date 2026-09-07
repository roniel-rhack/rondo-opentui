import { describe, expect, test } from "bun:test";
import { useTerminalDimensions } from "@opentui/react";
import { testRender } from "@opentui/react/test-utils";
import { act, type ComponentProps, type ReactNode } from "react";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PromptDialog } from "../src/tui/components/Dialogs.tsx";
import { TaskForm, emptyTaskForm, type TaskFormValues } from "../src/tui/components/TaskForm.tsx";
import { Priority } from "../src/core/task/task.ts";
import { RecurFreq } from "../src/core/task/recur.ts";
import { DateOnly, GoTime } from "../src/core/time.ts";
import { tuiTheme } from "../src/tui/theme.ts";

process.env.RONDO_HOME = mkdtempSync(join(tmpdir(), "rondo-review6-forms-"));
const theme = tuiTheme(true);
const consoleError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("not wrapped in act")) return;
  consoleError(...args);
};

async function mount(node: ReactNode, width = 80, height = 30) {
  let setup!: Awaited<ReturnType<typeof testRender>>;
  await act(async () => { setup = await testRender(node, { width, height, exitOnCtrlC: false }); });
  await setup.flush();
  return {
    ...setup,
    async press(key: string, modifiers?: { ctrl?: boolean; meta?: boolean; shift?: boolean }) {
      await act(async () => { setup.mockInput.pressKey(key, modifiers); });
      await setup.flush();
    },
    async type(text: string) {
      await act(async () => { await setup.mockInput.typeText(text); });
      await setup.flush();
    },
    async click(text: string) {
      const lines = setup.captureCharFrame().split("\n");
      const y = lines.findIndex((line) => line.includes(text));
      expect(y).toBeGreaterThanOrEqual(0);
      await act(async () => { await setup.mockMouse.click(lines[y]!.indexOf(text), y); });
      await setup.flush();
    },
  };
}

function Form(props: Partial<ComponentProps<typeof TaskForm>>) {
  const { width, height } = useTerminalDimensions();
  return <TaskForm theme={theme} title="New task" creating initial={emptyTaskForm}
    screenWidth={width} screenHeight={height} onSubmit={() => {}} onCancel={() => {}} {...props} />;
}

const chips = [
  { key: "t", label: "today", value: "today" },
  { key: "m", label: "tomorrow", value: "tomorrow" },
  { key: "w", label: "+1w", value: "+1w" },
  { key: "n", label: "none", value: "" },
];

function Prompt(props: Partial<ComponentProps<typeof PromptDialog>>) {
  const { width, height } = useTerminalDimensions();
  return <PromptDialog theme={theme} title="Due date" label="Date for #1" chips={chips}
    screenWidth={width} screenHeight={height} onSubmit={() => {}} onCancel={() => {}} {...props} />;
}

describe("TUI review 6 forms", () => {
  test("direct field jumps materialize tokens and explicit edits win at save", async () => {
    let saved: TaskFormValues | undefined;
    const m = await mount(<Form onSubmit={(values) => { saved = values; }} />);
    try {
      await m.type("Ship it #work @tomorrow !3 ~w");
      await m.press("\u00073");
      expect(m.captureCharFrame()).toContain(GoTime.now().addDate(0, 0, 1).format(DateOnly));
      expect(m.captureCharFrame()).not.toContain("@tomorrow");
      await m.press("a", { ctrl: true });
      await m.press("k", { ctrl: true });
      await m.type("today");
      await m.press("\u00075");
      await m.press("ARROW_LEFT");
      await m.press("\u00074");
      await m.press("a", { ctrl: true });
      await m.press("k", { ctrl: true });
      await m.type("release");
      await m.press("s", { ctrl: true });
      expect(saved).toEqual({ ...emptyTaskForm, title: "Ship it", tags: "release", due: "today",
        priority: Priority.Medium, recur: RecurFreq.Weekly });
    } finally { m.renderer.destroy(); }
  });

  test("clicking a field tab focuses its control without cycling other fields", async () => {
    let saved: TaskFormValues | undefined;
    const m = await mount(<Form onSubmit={(values) => { saved = values; }} />);
    try {
      await m.type("Prepare the meeting");
      await m.press("TAB");
      await m.click("4 Tags");
      await m.type("planning");
      await m.click("6 Repeat");
      await m.press("ARROW_RIGHT");
      await m.press("s", { ctrl: true });
      expect(saved?.tags).toBe("planning");
      expect(saved?.recur).toBe(RecurFreq.Daily);
      expect(saved?.description).toBe("");
    } finally { m.renderer.destroy(); }
  });

  test("the field chooser is visible at 40×16 and Escape returns to editing", async () => {
    const saves: TaskFormValues[] = [];
    const m = await mount(<Form onSubmit={(values) => { saves.push(values); }} />, 40, 16);
    try {
      await m.type("Keep writing");
      await m.press("g", { ctrl: true });
      for (const text of ["1 Title", "2 Desc", "3 Due", "4 Tags", "5 Prio", "6 Repeat", "esc back"]) {
        expect(m.captureCharFrame()).toContain(text);
      }
      await m.press("x");
      expect(m.captureCharFrame()).toContain("Choose field");
      await m.press("\u001b[27u");
      expect(m.captureCharFrame()).not.toContain("Choose field");
      await m.type(" now");
      await m.press("s", { ctrl: true });
      expect(saves[0]?.title).toBe("Keep writing now");
    } finally { m.renderer.destroy(); }
  });

  test("a clicked control preserves other tokens entered after expanding", async () => {
    let saved: TaskFormValues | undefined;
    const m = await mount(<Form creating={false} onSubmit={(values) => { saved = values; }} />);
    try {
      await m.type("Next release #work @tomorrow !3 ~w");
      await m.click("Medium");
      await m.press("s", { ctrl: true });
      expect(saved?.title).toBe("Next release");
      expect(saved?.tags).toBe("work");
      expect(saved?.due).toBe(GoTime.now().addDate(0, 0, 1).format(DateOnly));
      expect(saved?.priority).toBe(Priority.Medium);
      expect(saved?.recur).toBe(RecurFreq.Weekly);
    } finally { m.renderer.destroy(); }
  });

  test("a rejected continuous save keeps the text and draft for retry", async () => {
    const drafts: (TaskFormValues | null)[] = [];
    let attempts = 0;
    const m = await mount(<Form onDraftChange={(value) => { drafts.push(value); }} onSubmit={() => {
      attempts++;
      return "Could not save this task";
    }} />);
    try {
      await m.type("Keep this text #work");
      await m.press("n", { ctrl: true });
      expect(attempts).toBe(1);
      expect(m.captureCharFrame()).toContain("Could not save this task");
      expect(m.captureCharFrame()).toContain("Keep this text #work");
      expect(drafts.at(-1)?.title).toBe("Keep this text #work");
      await m.press("s", { ctrl: true });
      expect(attempts).toBe(2);
    } finally { m.renderer.destroy(); }
  });

  test("a field jump, repeated priority changes and save in one chunk use the latest values", async () => {
    const saves: TaskFormValues[] = [];
    const m = await mount(<Form onSubmit={(values) => { saves.push(values); }} />);
    try {
      await m.type("Fast capture #work !3");
      await m.press("\u00075\u001b[D\u001b[D\r");
      expect(saves).toHaveLength(1);
      expect(saves[0]?.title).toBe("Fast capture");
      expect(saves[0]?.tags).toBe("work");
      expect(saves[0]?.priority).toBe(Priority.Low);
    } finally { m.renderer.destroy(); }
  });

  test("each field jump survives resize and description Enter keeps a newline", async () => {
    let saved: TaskFormValues | undefined;
    const m = await mount(<Form initial={{ ...emptyTaskForm, title: "Keep context" }}
      onSubmit={(values) => { saved = values; }} />);
    try {
      await m.press("\u00072");
      expect(m.captureCharFrame()).toContain("enter newline");
      await m.type("First line");
      await m.press("RETURN");
      await m.type("Second line");
      await act(async () => { m.resize(40, 16); });
      await m.flush();
      for (const [key, label] of [["6", "Repeats"], ["5", "Priority"], ["4", "Tags"],
        ["3", "Due date"], ["2", "Description"], ["1", "Title"]]) {
        await m.press(`\u0007${key}`);
        expect(m.captureCharFrame()).toContain(label!);
        expect(m.captureCharFrame()).toContain("^s save · esc cancel");
      }
      await m.press("s", { ctrl: true });
      expect(saved?.description).toBe("First line\nSecond line");
    } finally { m.renderer.destroy(); }
  });

  test("rapid preset selection commits the last preview, including none", async () => {
    const saves: string[] = [];
    const m = await mount(<Prompt stayOpen onSubmit={(value) => { saves.push(value); }} />);
    try {
      await m.press("\u001b[B\u001b[B\r");
      expect(saves).toEqual(["tomorrow"]);
      await m.press("\u001b[A\r");
      expect(saves).toEqual(["tomorrow", ""]);
    } finally { m.renderer.destroy(); }
  });

  for (const dark of [true, false]) {
    test(`40×16 ${dark ? "dark" : "light"} date prompt keeps presets, error and actions visible`, async () => {
      const saves: string[] = [];
      const m = await mount(<Prompt theme={tuiTheme(dark)} onDraftChange={() => {}} onDiscard={() => {}}
        onSubmit={(value) => {
          if (value === "invalid") return "Use YYYY-MM-DD, today, tomorrow, +3d, +1w or none";
          saves.push(value);
        }} />, 40, 16);
      try {
        await m.type("invalid");
        await m.press("RETURN");
        const frame = m.captureCharFrame();
        for (const text of ["today", "tomorrow", "+1w", "none", "Save", "Close", "Discard", "esc close"]) {
          expect(frame).toContain(text);
        }
        expect(frame).toContain("+3d, +1w or none");
        expect(saves).toEqual([]);
        await m.click("none");
        expect(saves).toEqual([""]);
      } finally { m.renderer.destroy(); }
    });
  }

  test("resizing a multiline draft preserves its buffer and keeps Save clickable", async () => {
    let saved: string | undefined;
    const m = await mount(<Prompt title="Journal entry" multiline chips={undefined}
      draft={"First line\nSecond line"} onDraftChange={() => {}} onDiscard={() => {}}
      onSubmit={(value) => { saved = value; }} />);
    try {
      await m.type(" revised");
      await act(async () => { m.resize(40, 16); });
      await m.flush();
      expect(m.captureCharFrame()).toContain("Second line revised");
      expect(m.captureCharFrame()).toContain("^s save · esc close");
      await m.click("Save");
      expect(saved).toBe("First line\nSecond line revised");
    } finally { m.renderer.destroy(); }
  });
});
