import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../src/core/config/config.ts";
import { openMemory } from "../src/core/database/db.ts";
import { newTask } from "../src/core/task/store.ts";
import { initTheme } from "../src/core/ui/colors.ts";
import { App } from "../src/tui/app.tsx";
import { RondoData } from "../src/tui/data.ts";
import { searchJournal } from "../src/tui/journal-search.ts";

initTheme(true);

async function mount(data: RondoData, width = 80, height = 24) {
  process.env.RONDO_HOME = mkdtempSync(join(tmpdir(), "rondo-reading-"));
  let setup!: Awaited<ReturnType<typeof testRender>>;
  await act(async () => {
    setup = await testRender(<App data={data} />, {
      width,
      height,
      exitOnCtrlC: false,
    });
  });
  await setup.flush();
  const press = async (key: string) => {
    await act(async () => {
      setup.mockInput.pressKey(key);
      await new Promise((resolve) => setTimeout(resolve, 140));
    });
    await setup.flush();
  };
  const type = async (value: string) => {
    await act(async () => {
      await setup.mockInput.typeText(value);
    });
    await setup.flush();
  };
  const close = async () => {
    await act(async () => setup.renderer.destroy());
  };
  return { ...setup, press, type, close };
}

function fixture() {
  const cfg = defaultConfig();
  cfg.theme = "dark";
  return new RondoData(openMemory(), cfg);
}

describe("reading oversized content", () => {
  for (const kind of ["journal", "description", "task-note"] as const) {
    test(`page keys expose every line of a 50-line ${kind}`, async () => {
      const data = fixture();
      const lines = Array.from({ length: 50 }, (_, i) =>
        `LINE${String(i + 1).padStart(2, "0")} content to read`,
      );
      if (kind === "journal") data.addJournalEntry(lines.join("\n"));
      else {
        const task = newTask({
          title: "Long content task",
          description: kind === "description" ? lines.join("\n") : "",
        });
        data.tasks.create(task);
        data.tasks.addSubtask(task.id, "Action below description");
        if (kind === "task-note") data.tasks.addNote(task.id, lines.join("\n"));
      }
      const m = await mount(data);
      try {
        if (kind === "journal") await m.press("4");
        await m.press("l");
        const seen = new Set<string>();
        const collect = () => {
          for (const line of m.captureCharFrame().match(/LINE\d\d/g) ?? []) {
            seen.add(line);
          }
        };
        collect();
        for (let i = 0; i < 6; i++) {
          await m.press("\u001b[5~");
          collect();
        }
        for (let i = 0; i < 6; i++) {
          await m.press("\u001b[6~");
          collect();
        }
        expect([...seen].sort()).toEqual(lines.map((line) => line.slice(0, 6)));
      } finally {
        await m.close();
      }
    }, 10000);
  }
});

describe("journal search", () => {
  test("accepting search opens the matching entry outside the viewport", async () => {
    const data = fixture();
    for (let i = 1; i <= 12; i++) {
      data.addJournalEntry(i === 11 ? `${"Opening words. ".repeat(12)}quartz result eleven` : `Entry ${i} ordinary words`);
    }
    const m = await mount(data, 60, 20);
    try {
      await m.press("4");
      await m.press("/");
      await m.type("quartz");
      expect(m.captureCharFrame()).toContain("quartz result eleven");
      await m.press("RETURN");
      expect(m.captureCharFrame()).toContain("quartz result eleven");
      await m.press("e");
      expect(m.captureCharFrame()).toContain("quartz result eleven");
    } finally {
      await m.close();
    }
  });
});

test("journal matches cycle in both directions within and between days", async () => {
  const data = fixture();
  for (const [date, suffix] of [["2026-09-03", "older"], ["2026-09-04", "newer"]]) {
    data.addJournalEntry(`quartz ${suffix} first`, date);
    data.addJournalEntry(`quartz ${suffix} second`, date);
  }
  const m = await mount(data, 60, 20);
  const selectedBody = () => {
    const lines = m.captureCharFrame().split("\n");
    const header = lines.findIndex((line) => line.includes("┃") && line.includes("Match"));
    expect(header).toBeGreaterThan(0);
    return lines[header + 1] ?? "";
  };
  try {
    await m.press("4");
    await m.press("/");
    await m.type("quartz");
    await m.press("RETURN");
    expect(selectedBody()).toContain("quartz newer first");
    for (const suffix of ["newer second", "older first", "older second", "newer first"]) {
      await m.press("}");
      expect(selectedBody()).toContain(`quartz ${suffix}`);
    }
    for (const suffix of ["older second", "older first", "newer second", "newer first"]) {
      await m.press("{");
      expect(selectedBody()).toContain(`quartz ${suffix}`);
    }
  } finally {
    await m.close();
  }
});

test("journal date matches remain available without inventing entry matches", async () => {
  const data = fixture();
  data.addJournalEntry("Earlier journal body", "2026-09-03");
  data.addJournalEntry("Later journal body", "2026-09-04");
  const result = searchJournal(data.journal.listNotes(false), "Sep 03");
  expect(result).toHaveLength(1);
  expect(result[0]!.entryIds).toEqual([]);
  const m = await mount(data, 60, 20);
  try {
    await m.press("4");
    await m.press("/");
    await m.type("Sep 03");
    await m.press("RETURN");
    expect(m.captureCharFrame()).toContain("Earlier journal body");
    await m.press("l");
    expect(m.captureCharFrame()).toContain("Earlier journal body");
    expect(m.captureCharFrame()).not.toContain("Match 1/");
  } finally {
    await m.close();
  }
});

test("journal queries match individual entries rather than joining unrelated bodies", () => {
  const data = fixture();
  data.addJournalEntry("qua", "2026-09-03");
  data.addJournalEntry("rtz", "2026-09-03");
  expect(searchJournal(data.journal.listNotes(false), "quartz")).toEqual([]);
});

test("paging journal content preserves the entry targeted by delete", async () => {
  const data = fixture();
  data.addJournalEntry(Array.from({ length: 50 }, (_, i) => `Long entry line ${i + 1}`).join("\n"));
  data.addJournalEntry("Keep the second entry");
  const m = await mount(data, 60, 20);
  try {
    await m.press("4");
    await m.press("l");
    for (let i = 0; i < 5; i++) await m.press("\u001b[6~");
    expect(m.captureCharFrame()).toContain("Keep the second entry");
    await m.press("d");
    expect(data.journal.listNotes(false)[0]!.entries.map((entry) => entry.body)).toEqual([
      "Keep the second entry",
    ]);
  } finally {
    await m.close();
  }
});
