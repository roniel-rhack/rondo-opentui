import { expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { defaultConfig } from "../src/core/config/config.ts";
import { newTask } from "../src/core/task/store.ts";
import { GoTime } from "../src/core/time.ts";
import { Header } from "../src/tui/components/Header.tsx";
import { TaskList } from "../src/tui/components/TaskList.tsx";
import { excerptOf, fitChips, fitTags } from "../src/tui/state.ts";
import { journalExcerpt } from "../src/tui/journal-search.ts";
import { tuiTheme } from "../src/tui/theme.ts";

test("text budgets count terminal cells and preserve graphemes", () => {
  expect(excerptOf("界界界界", 5)).toBe("界界…");
  expect(excerptOf("👨‍👩‍👧‍👦👨‍👩‍👧‍👦end", 5)).toBe("👨‍👩‍👧‍👦👨‍👩‍👧‍👦…");
  expect(excerptOf("e\u0301e\u0301end", 3)).toBe("e\u0301e\u0301…");
  expect(fitChips(["界界", "more"], 6)).toBe(0);
  expect(fitTags([{ tag: "界界", count: 1 }], 22)).toEqual({ shown: [], hidden: 1 });
});

for (const dark of [true, false]) {
  for (const width of [40, 60]) {
    test(`${width}-column ${dark ? "dark" : "light"} header keeps the active timer and journal tab`, async () => {
      const theme = tuiTheme(dark);
      const selected: string[] = [];
      let setup!: Awaited<ReturnType<typeof testRender>>;
      await act(async () => {
        setup = await testRender(
          <Header
            theme={theme}
            activeTab="journal"
            counts={{ active: 123, done: 100, all: 223, journal: 12 }}
            onSelectTab={(tab) => selected.push(tab)}
            focus={{
              endAt: Date.now() + 25 * 60_000,
              durationMs: 25 * 60_000,
              label: "Focus",
              color: theme.warning,
              cycleDots: "●○○○",
              nextLabel: "Focus 25m",
            }}
            compact
            width={width}
          />,
          { width, height: 2, exitOnCtrlC: false },
        );
      });
      await setup.flush();
      try {
        const frame = setup.captureCharFrame().split("\n")[0]!;
        expect(frame).toMatch(/(?:25:00|24:59)/);
        const journalAt = frame.indexOf(width === 40 ? "4 J" : "Journal");
        expect(journalAt).toBeGreaterThan(0);
        await act(async () => setup.mockMouse.click(journalAt + 2, 0));
        await setup.flush();
        expect(selected).toEqual(["journal"]);
      } finally {
        await act(async () => setup.renderer.destroy());
      }
    });
  }
}

test("wide task titles retain a visible ellipsis in a 40-column list", async () => {
  const task = newTask({ title: "界".repeat(40), tags: ["日本語".repeat(8)] });
  let setup!: Awaited<ReturnType<typeof testRender>>;
  await act(async () => {
    setup = await testRender(
      <TaskList
        theme={tuiTheme(true)}
        cfg={defaultConfig()}
        tasks={[task]}
        selected={0}
        focused
        width={40}
        gap={0}
        sort="due"
        now={GoTime.now()}
        blocked={new Set()}
        onSelect={() => {}}
        onActivate={() => {}}
        onToggleStatus={() => {}}
        emptyIcon="○"
        emptyTitle="Empty"
      />,
      { width: 40, height: 6, exitOnCtrlC: false },
    );
  });
  await setup.flush();
  try {
    const frame = setup.captureCharFrame();
    const titleRow = frame.split("\n").find((line) => line.includes("界"))!;
    expect(titleRow).toContain("…");
    expect(frame.split("\n").filter((line) => line.includes("界"))).toHaveLength(1);
    expect(frame.split("\n").find((line) => line.includes("日本語"))).toContain("…");
  } finally {
    await act(async () => setup.renderer.destroy());
  }
});


test("contextual journal previews start on a complete grapheme", () => {
  const family = "👨‍👩‍👧‍👦";
  const preview = journalExcerpt(`${family.repeat(3)}quartz`, "quartz", 20);
  expect(preview).toBe(`…${family.repeat(2)}quartz`);
  expect(Bun.stringWidth(preview)).toBeLessThanOrEqual(20);
});
