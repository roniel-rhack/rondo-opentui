import { Minute, type Duration } from "../duration.ts";
import type { GoTime } from "../time.ts";

/** Standard focus session length (Pomodoro). */
export const DefaultDuration: Duration = 25 * Minute;

export enum SessionKind {
  Work = 0,
  ShortBreak = 1,
  LongBreak = 2,
}

export function sessionKindString(k: SessionKind): string {
  switch (k) {
    case SessionKind.Work:
      return "Work";
    case SessionKind.ShortBreak:
      return "Short Break";
    case SessionKind.LongBreak:
      return "Long Break";
    default:
      return "Unknown";
  }
}

export function sessionKindLabel(k: SessionKind): string {
  switch (k) {
    case SessionKind.Work:
      return "Focus";
    case SessionKind.ShortBreak:
      return "Break";
    case SessionKind.LongBreak:
      return "Long Break";
    default:
      return "Unknown";
  }
}

export function sessionKindIcon(k: SessionKind): string {
  switch (k) {
    case SessionKind.Work:
      return "🍅";
    case SessionKind.ShortBreak:
      return "☕";
    case SessionKind.LongBreak:
      return "🌿";
    default:
      return "•";
  }
}

export interface Session {
  id: number;
  /** 0 when the session is not linked to a task. */
  taskId: number;
  duration: Duration;
  startedAt: GoTime;
  completedAt: GoTime | null;
  kind: SessionKind;
  /** 1-4 for work sessions, 0 for breaks. */
  cyclePos: number;
}

export function isCompleted(s: Pick<Session, "completedAt">): boolean {
  return s.completedAt !== null;
}

/** Time elapsed since startedAt, capped at duration. */
export function elapsed(
  s: Pick<Session, "startedAt" | "duration">,
  now: GoTime,
): Duration {
  const e = now.sub(s.startedAt);
  if (e < 0) return 0;
  if (e > s.duration) return s.duration;
  return e;
}

/** Duration minus elapsed, never below zero. */
export function remaining(
  s: Pick<Session, "startedAt" | "duration">,
  now: GoTime,
): Duration {
  const r = s.duration - elapsed(s, now);
  return r < 0 ? 0 : r;
}

/** Formats a duration as "MM:SS". */
export function formatTimer(d: Duration): string {
  const clamped = d < 0 ? 0 : d;
  const total = Math.trunc(clamped / 1_000_000_000);
  const minutes = Math.trunc(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
