import { describe, expect, test } from "bun:test";
import { stripAnsi } from "../src/core/ui/ansi.ts";
import { initTheme, isDark, theme } from "../src/core/ui/colors.ts";
import { renderMarkdown } from "../src/core/ui/markdown.ts";
import { DueLevel, dueBadge, dueColor, dueStatus } from "../src/core/ui/overdue.ts";
import {
  renderJournalStreak,
  renderPriorityBreakdown,
  renderSparkline,
  renderTagCloud,
} from "../src/core/ui/stats.ts";
import { GoTime } from "../src/core/time.ts";

describe("theme", () => {
  test("dark palette", () => {
    initTheme(true);
    expect(theme.cyan).toBe("#00BCD4");
    expect(theme.white).toBe("#FAFAFA");
    expect(theme.selectionBg).toBe("#1a1a2e");
    expect(theme.overlayDim).toBe("#111111");
  });

  test("light palette", () => {
    initTheme(false);
    expect(theme.cyan).toBe("#00838F");
    expect(theme.white).toBe("#1A1A2E");
    expect(theme.selectionBg).toBe("#F0F0F0");
    expect(theme.overlayDim).toBe("#F5F5F5");
    initTheme(true);
  });

  test("isDark tracks the theme", () => {
    initTheme(true);
    expect(isDark()).toBe(true);
    initTheme(false);
    expect(isDark()).toBe(false);
    initTheme(true);
  });
});

describe("due status", () => {
  test("overdue", () => {
    expect(dueStatus(GoTime.now().addDate(0, 0, -1))).toBe(DueLevel.Overdue);
    expect(dueStatus(GoTime.now().addDate(0, 0, -7))).toBe(DueLevel.Overdue);
  });

  test("today", () => {
    expect(dueStatus(GoTime.now())).toBe(DueLevel.Today);
  });

  test("soon", () => {
    expect(dueStatus(GoTime.now().addDate(0, 0, 1))).toBe(DueLevel.Soon);
    expect(dueStatus(GoTime.now().addDate(0, 0, 3))).toBe(DueLevel.Soon);
  });

  test("far", () => {
    expect(dueStatus(GoTime.now().addDate(0, 0, 7))).toBe(DueLevel.Far);
    expect(dueStatus(GoTime.now().addDate(0, 1, 0))).toBe(DueLevel.Far);
  });

  test("every level has a color", () => {
    for (const level of [
      DueLevel.None,
      DueLevel.Far,
      DueLevel.Soon,
      DueLevel.Today,
      DueLevel.Overdue,
    ]) {
      expect(dueColor(level)).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  test("badges", () => {
    expect(dueBadge(DueLevel.Overdue)).toBe("OVERDUE");
    expect(dueBadge(DueLevel.Today)).toBe("TODAY");
    expect(dueBadge(DueLevel.Soon)).toBe("SOON");
    expect(dueBadge(DueLevel.Far)).toBe("");
    expect(dueBadge(DueLevel.None)).toBe("");
  });
});

describe("markdown", () => {
  test("h1 strips the prefix", () => {
    const result = renderMarkdown("# Hello World", 80);
    expect(result).toContain("Hello World");
    expect(result).not.toContain("# ");
  });

  test("h2 strips the prefix", () => {
    const result = renderMarkdown("## Subheading", 80);
    expect(result).toContain("Subheading");
    expect(result).not.toContain("## ");
  });

  test("bold markers are removed", () => {
    const result = renderMarkdown("This is **bold** text", 80);
    expect(result).toContain("bold");
    expect(result).not.toContain("**");
  });

  test("italic text", () => {
    expect(renderMarkdown("This is *italic* text", 80)).toContain("italic");
  });

  test("bullet lists", () => {
    const result = renderMarkdown(
      "- First item\n- Second item\n* Third item",
      80,
    );
    expect(result).toContain("First item");
    expect(result).toContain("Second item");
    expect(result).toContain("Third item");
    expect(result).toContain("*");
  });

  test("blockquote", () => {
    expect(renderMarkdown("> This is a quote", 80)).toContain("This is a quote");
  });

  test("inline code removes backticks", () => {
    const result = renderMarkdown("Use `fmt.Println` here", 80);
    expect(result).toContain("fmt.Println");
    expect(result).not.toContain("`");
  });

  test("empty input", () => {
    expect(renderMarkdown("", 80)).toBe("");
  });

  test("plain text", () => {
    expect(renderMarkdown("Just plain text", 80)).toContain("Just plain text");
  });

  test("multiple lines", () => {
    const result = renderMarkdown("# Title\n\nSome text\n\n- Item 1\n- Item 2", 80);
    expect(result.split("\n").length).toBeGreaterThanOrEqual(4);
  });
});

describe("sparkline", () => {
  test("empty data", () => {
    expect(renderSparkline(null, 20)).toBe("");
    expect(renderSparkline([], 20)).toBe("");
  });

  test("single value", () => {
    expect(renderSparkline([5], 10)).not.toBe("");
  });

  test("one character per data point", () => {
    const result = stripAnsi(renderSparkline([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 10));
    expect([...result].length).toBe(10);
  });

  test("resamples large data", () => {
    const data = Array.from({ length: 100 }, (_, i) => i);
    expect(stripAnsi(renderSparkline(data, 20)).length).toBe(20);
  });

  test("zero width", () => {
    expect(renderSparkline([1, 2, 3], 0)).toBe("");
  });
});

describe("priority breakdown", () => {
  test("all zero", () => {
    expect(renderPriorityBreakdown(0, 0, 0, 0)).toContain("No tasks");
  });

  test("has a bar", () => {
    const result = renderPriorityBreakdown(5, 3, 2, 1);
    expect(result).not.toBe("");
    expect(result).toContain("█");
  });

  test("legend", () => {
    const result = renderPriorityBreakdown(5, 3, 2, 1);
    expect(result).toContain("Low");
    expect(result).toContain("Med");
    expect(result).toContain("High");
    expect(result).toContain("Urgent");
  });

  test("single priority", () => {
    const result = renderPriorityBreakdown(10, 0, 0, 0);
    expect(result).toContain("Low");
    expect(result).not.toContain("Med");
  });
});

describe("tag cloud", () => {
  test("empty", () => {
    expect(renderTagCloud(null)).toContain("No tags");
    expect(renderTagCloud({})).toContain("No tags");
  });

  test("ordering by frequency", () => {
    const result = stripAnsi(
      renderTagCloud({ work: 5, personal: 3, urgent: 8 }),
    );
    const urgentIdx = result.indexOf("urgent");
    const workIdx = result.indexOf("work");
    const personalIdx = result.indexOf("personal");

    expect(urgentIdx).toBeGreaterThanOrEqual(0);
    expect(urgentIdx).toBeLessThan(workIdx);
    expect(workIdx).toBeLessThan(personalIdx);
  });

  test("shows counts", () => {
    expect(renderTagCloud({ go: 4 })).toContain("(4)");
  });
});

describe("journal streak", () => {
  test("empty data", () => {
    expect(renderJournalStreak({}, 7)).toContain("0 days");
  });

  test("with data", () => {
    const completions: Record<string, number> = {};
    const today = GoTime.now().truncateDay();
    for (let i = 0; i < 5; i++) {
      completions[today.addDate(0, 0, -i).format("2006-01-02")] = i + 1;
    }

    const result = renderJournalStreak(completions, 30);
    expect(result).toContain("Current streak:");
    expect(result).toContain("Longest:");
  });

  test("defaults to 30 days", () => {
    expect(renderJournalStreak({}, 0)).not.toBe("");
  });
});
