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
    },
    [cfg, cyclePos, data],
  );

  const stop = useCallback(() => {
    setSession(null);
    setRemainingMs(0);
  }, []);

  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => {
      setRemainingMs((prev) => {
        const next = prev - 1000;
        if (next > 0) return next;

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
            setKind(breakKind);
          }
        } else {
          setSession(null);
          setKind(SessionKind.Work);
        }
        return 0;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [session, cfg, cyclePos, data, start]);

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
    start: (taskId: number) => start(taskId, kind),
    stop,
    toggle,
  };
}
