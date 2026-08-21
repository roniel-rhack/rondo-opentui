import { GoTime } from "../time.ts";
import { bold, fg } from "./ansi.ts";
import { theme } from "./colors.ts";

/** Sparkline block characters, lowest to highest. */
const SPARK_BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/**
 * Renders a horizontal sparkline using Unicode block characters. Data is
 * resampled to fit the given width.
 */
export function renderSparkline(
  data: readonly number[] | null,
  width: number,
): string {
  if (!data || data.length === 0 || width <= 0) return "";

  const display = resample(data, width);
  const maxVal = display.reduce((m, v) => (v > m ? v : m), 0);

  const chars = display.map((v) => {
    const idx = maxVal > 0 ? Math.trunc((v * (SPARK_BLOCKS.length - 1)) / maxVal) : 0;
    return SPARK_BLOCKS[idx]!;
  });

  return fg(theme.cyan, chars.join(""));
}

/** Nearest-neighbour resampling to exactly n points. */
export function resample(data: readonly number[], n: number): number[] {
  if (n <= 0) return [];
  if (data.length <= n) return [...data];
  const result: number[] = [];
  for (let i = 0; i < n; i++) {
    let srcIdx = Math.trunc((i * data.length) / n);
    if (srcIdx >= data.length) srcIdx = data.length - 1;
    result.push(data[srcIdx]!);
  }
  return result;
}

/** Stacked bar with legend showing the priority distribution. */
export function renderPriorityBreakdown(
  low: number,
  med: number,
  high: number,
  urgent: number,
): string {
  const total = low + med + high + urgent;
  if (total === 0) return fg(theme.gray, "No tasks");

  const barWidth = 40;
  const segments = [
    { count: low, color: theme.green, label: "Low" },
    { count: med, color: theme.yellow, label: "Med" },
    { count: high, color: theme.red, label: "High" },
    { count: urgent, color: theme.magenta, label: "Urgent" },
  ];

  let bar = "";
  for (const seg of segments) {
    if (seg.count === 0) continue;
    let w = Math.trunc((seg.count * barWidth) / total);
    if (w === 0) w = 1;
    bar += fg(seg.color, "█".repeat(w));
  }

  const legend = segments
    .filter((s) => s.count > 0)
    .map(
      (s) => fg(s.color, "█") + fg(theme.gray, ` ${s.label}:${s.count}`),
    );

  return `${bar}\n${legend.join("  ")}`;
}

/** Tags with counts, sorted by frequency descending then name ascending. */
export function renderTagCloud(
  tags: Record<string, number> | null | undefined,
): string {
  const entries = Object.entries(tags ?? {});
  if (entries.length === 0) return fg(theme.gray, "No tags");

  entries.sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0])));

  return entries
    .map(([name, count]) => fg(theme.cyan, name) + fg(theme.gray, `(${count})`))
    .join("  ");
}

export interface StreakSummary {
  current: number;
  longest: number;
  data: number[];
}

/** Computes current/longest streak plus daily activity for the last N days. */
export function computeStreak(
  completionsByDay: Record<string, number>,
  days: number,
  now = GoTime.now(),
): StreakSummary {
  const dayCount = days > 0 ? days : 30;
  const today = now.truncateDay();

  const data: number[] = [];
  for (let i = 0; i < dayCount; i++) {
    const day = today.addDate(0, 0, -(dayCount - 1 - i));
    data.push(completionsByDay[day.format("2006-01-02")] ?? 0);
  }

  let current = 0;
  for (let i = dayCount - 1; i >= 0; i--) {
    if (data[i]! > 0) {
      current++;
      continue;
    }
    // Today may be empty while yesterday still keeps the streak alive.
    if (i === dayCount - 1 && i > 0 && data[i - 1]! > 0) continue;
    break;
  }

  let longest = 0;
  let streak = 0;
  for (const v of data) {
    if (v > 0) {
      streak++;
      if (streak > longest) longest = streak;
    } else {
      streak = 0;
    }
  }

  return { current, longest, data };
}

/** Streak summary with a sparkline of activity over the past N days. */
export function renderJournalStreak(
  completionsByDay: Record<string, number>,
  days: number,
  now = GoTime.now(),
): string {
  const dayCount = days > 0 ? days : 30;
  const { current, longest, data } = computeStreak(
    completionsByDay,
    dayCount,
    now,
  );
  const sparkline = renderSparkline(data, dayCount);

  return (
    `${fg(theme.gray, "Current streak:")} ${bold(fg(theme.white, `${current} days`))}  ` +
    `${fg(theme.gray, "Longest:")} ${bold(fg(theme.white, `${longest} days`))}\n` +
    sparkline
  );
}
