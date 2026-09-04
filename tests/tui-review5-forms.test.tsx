import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act, useState, type ReactNode } from "react";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PromptDialog } from "../src/tui/components/Dialogs.tsx";
import { TaskForm, emptyTaskForm, type TaskFormValues } from "../src/tui/components/TaskForm.tsx";
import { Priority } from "../src/core/task/task.ts";
import { tuiTheme } from "../src/tui/theme.ts";

process.env.RONDO_HOME = mkdtempSync(join(tmpdir(), "rondo-review5-forms-"));
const theme = tuiTheme(true);
const dimensions = { screenWidth: 80, screenHeight: 30 };
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
    async press(key: string, modifiers?: { ctrl?: boolean }) {
      await act(async () => {
        setup.mockInput.pressKey(key, modifiers);
        if (key === "ESCAPE") await Bun.sleep(130);
      });
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

function FormSession({ initial = emptyTaskForm }: { initial?: TaskFormValues }) {
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState<TaskFormValues | null>(null);
  return open ? <TaskForm theme={theme} title="New task" creating initial={initial}
    draft={draft ?? undefined} onDraftChange={setDraft} {...dimensions}
    onCancel={() => setOpen(false)} onDiscard={() => { setDraft(null); setOpen(false); }}
    onSubmit={(_, keepOpen) => { setDraft(null); if (!keepOpen) setOpen(false); }} />
    : <box onMouseDown={() => setOpen(true)}><text>Reopen</text></box>;
}

function PromptSession({ stayOpen = false }: { stayOpen?: boolean }) {
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState<string | null>(null);
  return open ? <PromptDialog theme={theme} title="Note" label="Text" initial="Original"
    draft={draft ?? undefined} onDraftChange={setDraft} stayOpen={stayOpen} {...dimensions}
    onCancel={() => setOpen(false)} onDiscard={() => { setDraft(null); setOpen(false); }}
    onSubmit={() => { setDraft(null); if (!stayOpen) setOpen(false); }} />
    : <box onMouseDown={() => setOpen(true)}><text>Reopen</text></box>;
}

describe("TUI review 5 forms", () => {
  const chips = [{ key: "t", label: "today", value: "today" },
    { key: "m", label: "tomorrow", value: "tomorrow" }];

  test("due presets never consume ordinary typing", async () => {
    const saves: string[] = [];
    const m = await mount(<PromptDialog theme={theme} title="Due" label="Date" chips={chips}
      {...dimensions} onSubmit={(value) => { saves.push(value); }} onCancel={() => {}} />);
    try {
      await m.type("tomorrow");
      expect(saves).toEqual([]);
      expect(m.captureCharFrame()).toContain("tomorrow");
      await m.press("RETURN");
      expect(saves).toEqual(["tomorrow"]);
    } finally { m.renderer.destroy(); }
  });

  test("arrows preview presets and Enter accepts the selected value", async () => {
    const saves: string[] = [];
    const m = await mount(<PromptDialog theme={theme} title="Due" label="Date" chips={chips}
      {...dimensions} onSubmit={(value) => { saves.push(value); }} onCancel={() => {}} />);
    try {
      await m.press("ARROW_DOWN");
      await m.press("ARROW_DOWN");
      expect(saves).toEqual([]);
      expect(m.captureCharFrame()).toContain("↑↓ presets");
      await m.press("RETURN");
      expect(saves).toEqual(["tomorrow"]);
      await m.press("ARROW_UP");
      await m.press("RETURN");
      expect(saves).toEqual(["tomorrow", "today"]);
    } finally { m.renderer.destroy(); }
  });

  test("the none preset accepts an empty value by keyboard and mouse", async () => {
    const saves: string[] = [];
    const m = await mount(<PromptDialog theme={theme} title="Due" label="Date"
      chips={[...chips, { key: "n", label: "none", value: "" }]} stayOpen
      {...dimensions} onSubmit={(value) => { saves.push(value); }} onCancel={() => {}} />);
    try {
      await m.press("ARROW_UP");
      await m.press("RETURN");
      expect(saves).toEqual([""]);
      await m.click("none");
      expect(saves).toEqual(["", ""]);
      await m.press("RETURN");
      expect(saves).toHaveLength(2);
      expect(m.captureCharFrame()).toContain("Cannot be empty");
    } finally { m.renderer.destroy(); }
  });

  test("task drafts restore after closing and explicit discard removes them", async () => {
    const m = await mount(<FormSession />);
    try {
      await m.type("Unfinished capture");
      await m.press("ESCAPE");
      await m.click("Reopen");
      expect(m.captureCharFrame()).toContain("Unfinished capture");
      expect(m.captureCharFrame()).toContain("Discard");
      await m.press("r", { ctrl: true });
      await m.click("Reopen");
      expect(m.captureCharFrame()).not.toContain("Unfinished capture");
    } finally { m.renderer.destroy(); }
  });

  for (const [name, session, expected] of [
    ["task", <FormSession />, "Last text"],
    ["prompt", <PromptSession />, "OriginalLast text"],
  ] as const) {
    test(`${name} preserves the last input when Escape arrives in the same chunk`, async () => {
      const m = await mount(session);
      try {
        await act(async () => { m.mockInput.pressKey("Last text\u001b[27u"); });
        await m.flush();
        await m.click("Reopen");
        expect(m.captureCharFrame()).toContain(expected);
        await act(async () => { m.mockInput.pressKey("more\u0012"); });
        await m.flush();
        await m.click("Reopen");
        expect(m.captureCharFrame()).not.toContain("Last text");
        expect(m.captureCharFrame()).not.toContain("more");
      } finally { m.renderer.destroy(); }
    });
  }

  test("invalid raw task metadata survives closing and reopening", async () => {
    const m = await mount(<FormSession />);
    try {
      await m.type("Draft");
      await m.press("TAB");
      await m.press("TAB");
      await m.type("not-a-date");
      await m.press("s", { ctrl: true });
      expect(m.captureCharFrame()).toContain("Due date must be");
      await m.press("ESCAPE");
      await m.click("Reopen");
      await m.press("TAB");
      await m.press("TAB");
      expect(m.captureCharFrame()).toContain("not-a-date");
    } finally { m.renderer.destroy(); }
  });

  for (const [field, tabs, text] of [["due", 2, "invalid-date"], ["tags", 3, "last-tag"]] as const) {
    test(`${field} preserves input and Escape received in the same chunk`, async () => {
      const m = await mount(<FormSession />);
      try {
        for (let i = 0; i < tabs; i++) await m.press("TAB");
        await act(async () => { m.mockInput.pressKey(`${text}\u001b[27u`); });
        await m.flush();
        await m.click("Reopen");
        for (let i = 0; i < tabs; i++) await m.press("TAB");
        expect(m.captureCharFrame()).toContain(text);
      } finally { m.renderer.destroy(); }
    });
  }

  test("Discard shares the header without hiding advanced controls after validation at 60×20", async () => {
    let discarded = false;
    const m = await mount(<TaskForm theme={theme} title="Edit task" initial={emptyTaskForm}
      draft={{ ...emptyTaskForm, title: "Valid title", due: "bad" }}
      onDraftChange={() => {}} onDiscard={() => { discarded = true; }}
      screenWidth={60} screenHeight={20} onSubmit={() => {}} onCancel={() => {}} />, 60, 20);
    try {
      await m.press("s", { ctrl: true });
      expect(m.captureCharFrame()).toContain("Due date must be");
      expect(m.captureCharFrame()).toContain("Priority");
      expect(m.captureCharFrame()).toContain("Repeats");
      const header = m.captureCharFrame().split("\n").find((line) => line.includes("Edit task"));
      expect(header).toContain("Discard");
      await m.click("Discard");
      expect(discarded).toBe(true);
    } finally { m.renderer.destroy(); }
  });

  for (const width of [80, 60]) {
    test(`capture footer keeps save, next, discard and close hints readable at ${width} columns`, async () => {
      const m = await mount(<TaskForm theme={theme} title="New task" creating initial={emptyTaskForm}
        onDraftChange={() => {}} onDiscard={() => {}} screenWidth={width} screenHeight={20}
        onSubmit={() => {}} onCancel={() => {}} />, width, 20);
      try {
        const footer = m.captureCharFrame().split("\n").find((line) => line.includes("enter save"));
        expect(footer).toContain("^n next");
        expect(footer).toContain("^r discard");
        expect(footer).toContain("esc close");
        expect(footer).not.toContain("...");
      } finally { m.renderer.destroy(); }
    });
  }

  test("successful task saves do not restore the submitted draft", async () => {
    const m = await mount(<FormSession />);
    try {
      await m.type("Saved capture");
      await m.press("RETURN");
      await m.click("Reopen");
      expect(m.captureCharFrame()).not.toContain("Saved capture");
      await m.type("First #work !3");
      await m.press("n", { ctrl: true });
      expect(m.captureCharFrame()).not.toContain("First");
      expect(m.captureCharFrame()).toContain("#work");
      await m.press("ESCAPE");
      await m.click("Reopen");
      expect(m.captureCharFrame()).not.toContain("#work");
    } finally { m.renderer.destroy(); }
  });

  test("prompt drafts restore, discard, and clear after a successful save", async () => {
    const m = await mount(<PromptSession />);
    try {
      await m.type(" revised");
      await m.press("ESCAPE");
      await m.click("Reopen");
      expect(m.captureCharFrame()).toContain("Original revised");
      await m.click("Discard");
      await m.click("Reopen");
      expect(m.captureCharFrame()).not.toContain("revised");
      await m.type(" saved");
      await m.press("RETURN");
      await m.click("Reopen");
      expect(m.captureCharFrame()).not.toContain("saved");
    } finally { m.renderer.destroy(); }
  });

  test("stay-open prompts retain only text typed after the last save", async () => {
    const m = await mount(<PromptSession stayOpen />);
    try {
      await m.press("RETURN");
      expect(m.captureCharFrame()).not.toContain("Original");
      await m.type("Next entry");
      await m.press("ESCAPE");
      await m.click("Reopen");
      expect(m.captureCharFrame()).toContain("Next entry");
    } finally { m.renderer.destroy(); }
  });

  test("compact capture exposes inherited and overridden metadata at 40×16", async () => {
    const m = await mount(<TaskForm theme={theme} title="New task" creating
      initial={{ ...emptyTaskForm, priority: Priority.High, due: "tomorrow", tags: "work" }}
      screenWidth={40} screenHeight={16} onCancel={() => {}} onSubmit={() => {}} />, 40, 16);
    try {
      expect(m.captureCharFrame()).toContain("High");
      expect(m.captureCharFrame()).toContain("tomorrow");
      expect(m.captureCharFrame()).toContain("#work");
      expect(m.captureCharFrame()).toContain("More options");
      expect(m.captureCharFrame().match(/╭/g)).toHaveLength(1);
      const occupied = m.captureCharFrame().split("\n").filter((line) => line.trim());
      expect(occupied.length).toBeLessThanOrEqual(10);
      await m.type("Capture !4 @none");
      expect(m.captureCharFrame()).toContain("Urgent");
      expect(m.captureCharFrame()).toContain("no due");
      expect(m.captureCharFrame()).not.toContain("tomorrow");
    } finally { m.renderer.destroy(); }
  });
});
