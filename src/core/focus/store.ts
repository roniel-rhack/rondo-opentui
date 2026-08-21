import type { Database } from "bun:sqlite";
import { DateOnly, GoTime, RFC3339, parseRFC3339 } from "../time.ts";
import { addColumnIfNotExists } from "../task/store.ts";
import { SessionKind, type Session } from "./focus.ts";

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS focus_sessions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id      INTEGER NOT NULL DEFAULT 0,
      duration     INTEGER NOT NULL,
      started_at   TEXT NOT NULL,
      completed_at TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_focus_sessions_task ON focus_sessions(task_id)`,
];

interface SessionRow {
  id: number;
  task_id: number;
  duration: number;
  started_at: string;
  completed_at: string | null;
  kind: number;
  cycle_pos: number;
}

function rowToSession(r: SessionRow): Session {
  return {
    id: r.id,
    taskId: r.task_id,
    duration: r.duration,
    startedAt: parseRFC3339(r.started_at),
    completedAt: r.completed_at ? parseRFC3339(r.completed_at) : null,
    kind: r.kind as SessionKind,
    cyclePos: r.cycle_pos,
  };
}

export class FocusStore {
  constructor(private readonly db: Database) {
    for (const stmt of MIGRATIONS) this.db.run(stmt);
    addColumnIfNotExists(
      this.db,
      "focus_sessions",
      "kind",
      "INTEGER NOT NULL DEFAULT 0",
    );
    addColumnIfNotExists(
      this.db,
      "focus_sessions",
      "cycle_pos",
      "INTEGER NOT NULL DEFAULT 0",
    );
  }

  create(session: Session): void {
    const completedAt = session.completedAt
      ? session.completedAt.utc().format(RFC3339)
      : null;
    const res = this.db.run(
      `INSERT INTO focus_sessions (task_id, duration, started_at, completed_at, kind, cycle_pos) VALUES (?,?,?,?,?,?)`,
      [
        session.taskId,
        session.duration,
        session.startedAt.utc().format(RFC3339),
        completedAt,
        session.kind,
        session.cyclePos,
      ],
    );
    session.id = Number(res.lastInsertRowid);
  }

  /** Removes a session outright, used when a running one is abandoned. */
  delete(id: number): void {
    this.db.run(`DELETE FROM focus_sessions WHERE id = ?`, [id]);
  }

  complete(id: number): void {
    const res = this.db.run(
      `UPDATE focus_sessions SET completed_at = ? WHERE id = ?`,
      [GoTime.utcNow().format(RFC3339), id],
    );
    if (res.changes === 0) throw new Error(`focus session ${id} not found`);
  }

  listByTask(taskId: number): Session[] {
    const rows = this.db
      .query(
        `SELECT id, task_id, duration, started_at, completed_at, kind, cycle_pos FROM focus_sessions WHERE task_id = ? ORDER BY started_at DESC`,
      )
      .all(taskId) as SessionRow[];
    return rows.map(rowToSession);
  }

  /** Completed sessions per day for the last N days, keyed by "YYYY-MM-DD". */
  completionsByDay(days: number): Record<string, number> {
    const cutoff = GoTime.utcNow().addDate(0, 0, -days).format(RFC3339);
    const rows = this.db
      .query(
        `SELECT DATE(completed_at) AS day, COUNT(*) AS count FROM focus_sessions
         WHERE completed_at IS NOT NULL AND completed_at >= ?
         GROUP BY day`,
      )
      .all(cutoff) as { day: string; count: number }[];
    const result: Record<string, number> = {};
    for (const r of rows) result[r.day] = r.count;
    return result;
  }

  todayCount(): number {
    const today = GoTime.utcNow().format(DateOnly);
    const row = this.db
      .query(
        `SELECT COUNT(*) AS count FROM focus_sessions WHERE completed_at IS NOT NULL AND DATE(completed_at) = ?`,
      )
      .get(today) as { count: number };
    return row.count;
  }

  todayWorkCount(): number {
    const today = GoTime.utcNow().format(DateOnly);
    const row = this.db
      .query(
        `SELECT COUNT(*) AS count FROM focus_sessions WHERE completed_at IS NOT NULL AND kind = 0 AND DATE(completed_at) = ?`,
      )
      .get(today) as { count: number };
    return row.count;
  }

  /** Completed work sessions per day for the last 7 days. */
  weeklySummary(): Record<string, number> {
    const cutoff = GoTime.utcNow().addDate(0, 0, -7).format(RFC3339);
    const rows = this.db
      .query(
        `SELECT DATE(completed_at) AS day, COUNT(*) AS count FROM focus_sessions
         WHERE completed_at IS NOT NULL AND kind = 0 AND completed_at >= ?
         GROUP BY day`,
      )
      .all(cutoff) as { day: string; count: number }[];
    const result: Record<string, number> = {};
    for (const r of rows) result[r.day] = r.count;
    return result;
  }

  /** Consecutive days (walking back from today) with a completed work session. */
  streak(): number {
    const days = (
      this.db
        .query(
          `SELECT DISTINCT DATE(completed_at) AS day FROM focus_sessions
           WHERE completed_at IS NOT NULL AND kind = 0
           ORDER BY day DESC`,
        )
        .all() as { day: string }[]
    ).map((r) => r.day);

    if (days.length === 0) return 0;

    let streak = 0;
    let expected = GoTime.utcNow().format(DateOnly);
    for (const day of days) {
      if (day !== expected) break;
      streak++;
      const [y, m, d] = expected.split("-").map(Number);
      expected = GoTime.date(y!, m!, d!, 0, 0, 0, 0, "utc")
        .addDate(0, 0, -1)
        .format(DateOnly);
    }
    return streak;
  }

  /** Minutes spent in completed work sessions over the last N days. */
  totalMinutesFocused(days: number): number {
    const cutoff = GoTime.utcNow().addDate(0, 0, -days).format(RFC3339);
    const row = this.db
      .query(
        `SELECT COALESCE(SUM(duration), 0) AS total FROM focus_sessions
         WHERE completed_at IS NOT NULL AND kind = 0 AND completed_at >= ?`,
      )
      .get(cutoff) as { total: number };
    return Math.trunc(row.total / 60_000_000_000);
  }
}
