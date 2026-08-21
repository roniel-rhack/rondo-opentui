import { parseGoDuration, type Duration } from "../duration.ts";
import type { TimeLog } from "./task.ts";

/**
 * Parses a human-friendly duration such as "1h30m", "45m" or "2h".
 * Throws on empty, unparseable or negative input.
 */
export function parseDuration(s: string): Duration {
  if (s === "") throw new Error("empty duration string");
  const d = parseGoDuration(s);
  if (d === null) throw new Error(`parse duration "${s}": invalid duration`);
  if (d < 0) throw new Error(`negative duration not allowed: ${s}`);
  return d;
}

/**
 * Formats a duration as "Xh Ym", omitting zero components.
 * A zero or negative duration returns "0m".
 */
export function formatDuration(d: Duration): string {
  if (d <= 0) return "0m";
  const totalMinutes = Math.trunc(d / 60_000_000_000);
  const hours = Math.trunc(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

export function totalDuration(logs: readonly TimeLog[] | null): Duration {
  if (!logs) return 0;
  return logs.reduce((sum, l) => sum + l.duration, 0);
}
