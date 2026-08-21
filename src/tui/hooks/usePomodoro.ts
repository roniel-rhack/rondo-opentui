import { useCallback, useEffect, useRef, useState } from "react";
import type { Config } from "../../core/config/config.ts";
import { Minute } from "../../core/duration.ts";
import {
  SessionKind,
  formatTimer,
  sessionKindLabel,
  type Session,
} from "../../core/focus/focus.ts";
import { GoTime } from "../../core/time.ts";
import type { RondoData } from "../data.ts";

export interface PomodoroState {
  running: boolean;
  kind: SessionKind;
  cyclePos: number;
  remainingMs: number;
  /** 0 → just started, 1 → finished. Drives the header meter. */
  progress: number;
  label: string;
  timer: string | null;
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
 */
export function usePomodoro(
  data: RondoData,
  cfg: Config,
  onFinish: (kind: SessionKind) => void,
): PomodoroState {
  const [session, setSession] = useState<Session | null>(null);
  const [kind, setKind] = useState<SessionKind>(SessionKind.Work);
  const [cyclePos, setCyclePos] = useState(1);
  const [remainingMs, setRemainingMs] = useState(0);
  // Wall-clock end of the running session. Remaining time is always derived
  // from it, so a busy event loop cannot make the timer drift.
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
      setRemainingMs(duration / 1e6);
      setEndAt(Date.now() + duration / 1e6);
    },
    [cfg, cyclePos, data],
  );

  const stop = useCallback(() => {
    // An abandoned session never counted; keep it out of streaks and stats.
    if (session) data.focus.delete(session.id);
    setSession(null);
    setEndAt(null);
    setRemainingMs(0);
  }, [data, session]);

  useEffect(() => {
    if (!session || endAt === null) return;
    const id = setInterval(() => {
      const remaining = Math.max(endAt - Date.now(), 0);
      setRemainingMs(remaining);
      if (remaining > 0) return;

      clearInterval(id);
      data.focus.complete(session.id);
      finishRef.current(session.kind);

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
    }, 1000);
    return () => clearInterval(id);
  }, [session, endAt, cfg, cyclePos, data, start]);

  const toggle = useCallback(
    (taskId: number) => {
      if (session) stop();
      else start(taskId, kind);
    },
    [session, kind, start, stop],
  );

  const totalMs = (session?.duration ?? durationFor(cfg, kind)) / 1e6;

  return {
    running: session !== null,
    kind,
    cyclePos,
    remainingMs,
    progress: totalMs > 0 ? 1 - remainingMs / totalMs : 0,
    label: sessionKindLabel(kind),
    timer: session ? formatTimer(remainingMs * 1e6) : null,
    taskId: session ? session.taskId : null,
    start: (taskId: number) => start(taskId, kind),
    stop,
    toggle,
  };
}
