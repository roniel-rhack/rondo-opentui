import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Config } from "../../core/config/config.ts";
import { Minute } from "../../core/duration.ts";
import {
  SessionKind,
  sessionKindLabel,
  type Session,
} from "../../core/focus/focus.ts";
import { formatDuration } from "../../core/task/timelog.ts";
import { GoTime } from "../../core/time.ts";
import type { RondoData } from "../data.ts";

export interface PomodoroState {
  running: boolean;
  kind: SessionKind;
  cyclePos: number;
  /** Wall-clock end of the running session (ms since epoch), null when idle. */
  endAt: number | null;
  /** Length of the running session, or of the one `f` would start. */
  durationMs: number;
  label: string;
  /** What `f` starts next, e.g. "Focus 25m" or "Break 5m". */
  nextLabel: string;
  /** Task the running session is attached to, or null when idle. */
  taskId: number | null;
  start: (taskId: number) => void;
  stop: () => void;
  toggle: (taskId: number) => void;
}

function durationFor(cfg: Config, kind: SessionKind): number {
  switch (kind) {
    case SessionKind.ShortBreak:
      return cfg.focus.shortBreakDuration * Minute;
    case SessionKind.LongBreak:
      return cfg.focus.longBreakDuration * Minute;
    default:
      return cfg.focus.workDuration * Minute;
  }
}

/**
 * Pomodoro cycle: work → short break → … → long break every N work sessions.
 * Completed sessions are persisted so streaks and stats stay accurate.
 *
 * The hook holds no per-second state: the remaining time is derived from
 * `endAt` by whichever leaf displays it, and completion is a single timeout.
 * That keeps a running session from re-rendering the whole app every second.
 */
export function usePomodoro(
  data: RondoData,
  cfg: Config,
  onFinish: (kind: SessionKind, taskId: number) => void,
): PomodoroState {
  const [session, setSession] = useState<Session | null>(null);
  const [kind, setKind] = useState<SessionKind>(SessionKind.Work);
  const [cyclePos, setCyclePos] = useState(1);
  // Wall-clock end of the running session, so a busy event loop cannot make
  // the timer drift.
  const [endAt, setEndAt] = useState<number | null>(null);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;

  const start = useCallback(
    (taskId: number, nextKind: SessionKind = SessionKind.Work, pos = cyclePos) => {
      const duration = durationFor(cfg, nextKind);
      const created: Session = {
        id: 0,
        taskId,
        duration,
        startedAt: GoTime.utcNow(),
        completedAt: null,
        kind: nextKind,
        cyclePos: nextKind === SessionKind.Work ? pos : 0,
      };
      data.focus.create(created);
      setSession(created);
      setKind(nextKind);
      setEndAt(Date.now() + duration / 1e6);
    },
    [cfg, cyclePos, data],
  );

  const stop = useCallback(() => {
    // An abandoned session never counted; keep it out of streaks and stats.
    if (session) data.focus.delete(session.id);
    setSession(null);
    setEndAt(null);
    // Stopping also drops a queued break: the next `f` is a fresh focus
    // session, not whatever the last cycle left behind.
    setKind(SessionKind.Work);
  }, [data, session]);

  useEffect(() => {
    if (!session || endAt === null) return;
    const id = setTimeout(() => {
      data.focus.complete(session.id);
      finishRef.current(session.kind, session.taskId);

      // Advance the cycle: work → break → work…
      if (session.kind === SessionKind.Work) {
        const isLong = cyclePos >= cfg.focus.longBreakInterval;
        const breakKind = isLong
          ? SessionKind.LongBreak
          : SessionKind.ShortBreak;
        setCyclePos(isLong ? 1 : cyclePos + 1);
        if (cfg.focus.autoStartBreak) {
          start(session.taskId, breakKind);
        } else {
          setSession(null);
          setEndAt(null);
          setKind(breakKind);
        }
      } else {
        setSession(null);
        setEndAt(null);
        setKind(SessionKind.Work);
      }
    }, Math.max(endAt - Date.now(), 0));
    return () => clearTimeout(id);
  }, [session, endAt, cfg, cyclePos, data, start]);

  const toggle = useCallback(
    (taskId: number) => {
      if (session) stop();
      else start(taskId, kind);
    },
    [session, kind, start, stop],
  );

  const startCurrent = useCallback(
    (taskId: number) => start(taskId, kind),
    [start, kind],
  );

  const durationMs = (session?.duration ?? durationFor(cfg, kind)) / 1e6;
  const taskId = session ? session.taskId : null;
  const nextLabel = `${sessionKindLabel(kind)} ${formatDuration(durationFor(cfg, kind))}`;

  return useMemo(
    () => ({
      running: session !== null,
      kind,
      cyclePos,
      endAt,
      durationMs,
      label: sessionKindLabel(kind),
      nextLabel,
      taskId,
      start: startCurrent,
      stop,
      toggle,
    }),
    [
      session,
      kind,
      cyclePos,
      endAt,
      durationMs,
      nextLabel,
      taskId,
      startCurrent,
      stop,
      toggle,
    ],
  );
}
