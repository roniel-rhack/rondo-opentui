import type { Database } from "bun:sqlite";
import {
  DateOnly,
  GoTime,
  RFC3339,
  parseDateOnly,
  parseRFC3339,
} from "../time.ts";
import type { Duration } from "../duration.ts";
import { RecurFreq } from "./recur.ts";
import {
  Priority,
  Status,
  type Subtask,
  type Task,
  type TaskNote,
  type TimeLog,
} from "./task.ts";

interface TaskRow {
  id: number;
  title: string;
  description: string;
  status: number;
  priority: number;
  due_date: string | null;
  created_at: string | null;
  updated_at: string | null;
  recur_freq: number;
  recur_interval: number;
  metadata: string;
}

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS tasks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status      INTEGER NOT NULL DEFAULT 0,
      priority    INTEGER NOT NULL DEFAULT 0,
      due_date    TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS subtasks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      completed  INTEGER NOT NULL DEFAULT 0,
      position   INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS tags (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      name    TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tags_task ON tags(task_id)`,
  `CREATE TABLE IF NOT EXISTS time_logs (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id   INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      duration  INTEGER NOT NULL,
      note      TEXT NOT NULL DEFAULT '',
      logged_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_time_logs_task ON time_logs(task_id)`,
  `CREATE TABLE IF NOT EXISTS task_dependencies (
      task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      blocked_by INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, blocked_by)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_task_deps_blocked_by ON task_dependencies(blocked_by)`,
  `CREATE TABLE IF NOT EXISTS task_notes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      body       TEXT NOT NULL,
      created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_task_notes_task ON task_notes(task_id)`,
];

export function addColumnIfNotExists(
  db: Database,
  table: string,
  column: string,
  colDef: string,
): void {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  if (cols.some((c) => c.name === column)) return;
  db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${colDef}`);
}

export function marshalMetadata(m: Record<string, string> | null): string {
  if (!m || Object.keys(m).length === 0) return "{}";
  return JSON.stringify(m);
}

export function parseMetadata(s: string): Record<string, string> | null {
  if (s === "" || s === "{}") return null;
  try {
    const m = JSON.parse(s) as Record<string, string>;
    if (!m || typeof m !== "object" || Object.keys(m).length === 0) return null;
    return m;
  } catch {
    return null;
  }
}

function placeholders(ids: readonly number[]): string {
  return ids.map(() => "?").join(",");
}

function emptyTask(): Task {
  return {
    id: 0,
    title: "",
    description: "",
    status: Status.Pending,
    priority: Priority.Low,
    dueDate: null,
    createdAt: GoTime.zero(),
    updatedAt: GoTime.zero(),
    subtasks: [],
    tags: [],
    metadata: null,
    recurFreq: RecurFreq.None,
    recurInterval: 0,
    timeLogs: [],
    notes: [],
    blockedByIds: [],
    blocksIds: [],
  };
}

export function newTask(fields: Partial<Task> = {}): Task {
  return { ...emptyTask(), ...fields };
}

function rowToTask(row: TaskRow): Task {
  const t = emptyTask();
  t.id = row.id;
  t.title = row.title;
  t.description = row.description;
  t.status = row.status as Status;
  t.priority = row.priority as Priority;
  t.recurFreq = row.recur_freq as RecurFreq;
  t.recurInterval = row.recur_interval;
  t.metadata = parseMetadata(row.metadata ?? "{}");
  if (row.due_date) t.dueDate = parseDateOnly(row.due_date, "utc");
  if (row.created_at) t.createdAt = parseRFC3339(row.created_at);
  if (row.updated_at) t.updatedAt = parseRFC3339(row.updated_at);
  return t;
}

export class TaskStore {
  constructor(private readonly db: Database) {
    this.migrate();
  }

  private migrate(): void {
    for (const stmt of MIGRATIONS) this.db.run(stmt);
    addColumnIfNotExists(
      this.db,
      "tasks",
      "recur_freq",
      "INTEGER NOT NULL DEFAULT 0",
    );
    addColumnIfNotExists(
      this.db,
      "tasks",
      "recur_interval",
      "INTEGER NOT NULL DEFAULT 0",
    );
    addColumnIfNotExists(
      this.db,
      "tasks",
      "metadata",
      "TEXT NOT NULL DEFAULT '{}'",
    );
  }

  list(): Task[] {
    const rows = this.db
      .query(
        `SELECT id, title, description, status, priority, due_date, created_at, updated_at, recur_freq, recur_interval, metadata
         FROM tasks ORDER BY created_at DESC`,
      )
      .all() as TaskRow[];

    const tasks = rows.map(rowToTask);
    const ids = tasks.map((t) => t.id);
    if (ids.length === 0) return tasks;

    const subtasks = this.listAllSubtasks(ids);
    const tags = this.listAllTags(ids);
    const timeLogs = this.listAllTimeLogs(ids);
    const notes = this.listAllNotes(ids);
    const blockedBy = this.listAllBlockerIds(ids);
    const blocks = this.listAllBlocksIds(ids);

    for (const t of tasks) {
      t.subtasks = subtasks.get(t.id) ?? [];
      t.tags = tags.get(t.id) ?? [];
      t.timeLogs = timeLogs.get(t.id) ?? [];
      t.notes = notes.get(t.id) ?? [];
      t.blockedByIds = blockedBy.get(t.id) ?? [];
      t.blocksIds = blocks.get(t.id) ?? [];
    }
    return tasks;
  }

  private listAllSubtasks(ids: number[]): Map<number, Subtask[]> {
    const rows = this.db
      .query(
        `SELECT id, task_id, title, completed, position FROM subtasks WHERE task_id IN (${placeholders(ids)}) ORDER BY position`,
      )
      .all(...ids) as {
      id: number;
      task_id: number;
      title: string;
      completed: number;
      position: number;
    }[];
    const m = new Map<number, Subtask[]>();
    for (const r of rows) {
      const list = m.get(r.task_id) ?? [];
      list.push({
        id: r.id,
        title: r.title,
        completed: r.completed !== 0,
        position: r.position,
      });
      m.set(r.task_id, list);
    }
    return m;
  }

  private listAllTags(ids: number[]): Map<number, string[]> {
    const rows = this.db
      .query(
        `SELECT task_id, name FROM tags WHERE task_id IN (${placeholders(ids)})`,
      )
      .all(...ids) as { task_id: number; name: string }[];
    const m = new Map<number, string[]>();
    for (const r of rows) {
      const list = m.get(r.task_id) ?? [];
      list.push(r.name);
      m.set(r.task_id, list);
    }
    return m;
  }

  private listAllTimeLogs(ids: number[]): Map<number, TimeLog[]> {
    const rows = this.db
      .query(
        `SELECT id, task_id, duration, note, logged_at FROM time_logs WHERE task_id IN (${placeholders(ids)}) ORDER BY logged_at DESC`,
      )
      .all(...ids) as {
      id: number;
      task_id: number;
      duration: number;
      note: string;
      logged_at: string;
    }[];
    const m = new Map<number, TimeLog[]>();
    for (const r of rows) {
      const list = m.get(r.task_id) ?? [];
      list.push({
        id: r.id,
        taskId: r.task_id,
        duration: r.duration,
        note: r.note,
        loggedAt: parseRFC3339(r.logged_at),
      });
      m.set(r.task_id, list);
    }
    return m;
  }

  private listAllNotes(ids: number[]): Map<number, TaskNote[]> {
    const rows = this.db
      .query(
        `SELECT id, task_id, body, created_at FROM task_notes WHERE task_id IN (${placeholders(ids)}) ORDER BY created_at ASC`,
      )
      .all(...ids) as {
      id: number;
      task_id: number;
      body: string;
      created_at: string;
    }[];
    const m = new Map<number, TaskNote[]>();
    for (const r of rows) {
      const list = m.get(r.task_id) ?? [];
      list.push({
        id: r.id,
        taskId: r.task_id,
        body: r.body,
        createdAt: parseRFC3339(r.created_at),
      });
      m.set(r.task_id, list);
    }
    return m;
  }

  private listAllBlockerIds(ids: number[]): Map<number, number[]> {
    const rows = this.db
      .query(
        `SELECT task_id, blocked_by FROM task_dependencies WHERE task_id IN (${placeholders(ids)})`,
      )
      .all(...ids) as { task_id: number; blocked_by: number }[];
    const m = new Map<number, number[]>();
    for (const r of rows) {
      const list = m.get(r.task_id) ?? [];
      list.push(r.blocked_by);
      m.set(r.task_id, list);
    }
    return m;
  }

  private listAllBlocksIds(ids: number[]): Map<number, number[]> {
    const rows = this.db
      .query(
        `SELECT blocked_by, task_id FROM task_dependencies WHERE blocked_by IN (${placeholders(ids)})`,
      )
      .all(...ids) as { blocked_by: number; task_id: number }[];
    const m = new Map<number, number[]>();
    for (const r of rows) {
      const list = m.get(r.blocked_by) ?? [];
      list.push(r.task_id);
      m.set(r.blocked_by, list);
    }
    return m;
  }

  private listSubtasks(taskId: number): Subtask[] {
    return (
      this.db
        .query(
          `SELECT id, title, completed, position FROM subtasks WHERE task_id = ? ORDER BY position`,
        )
        .all(taskId) as {
        id: number;
        title: string;
        completed: number;
        position: number;
      }[]
    ).map((r) => ({
      id: r.id,
      title: r.title,
      completed: r.completed !== 0,
      position: r.position,
    }));
  }

  private listTags(taskId: number): string[] {
    return (
      this.db
        .query(`SELECT name FROM tags WHERE task_id = ?`)
        .all(taskId) as { name: string }[]
    ).map((r) => r.name);
  }

  create(t: Task): void {
    const now = GoTime.utcNow();
    t.createdAt = now;
    t.updatedAt = now;
    const dueStr = t.dueDate ? t.dueDate.format(DateOnly) : null;

    this.db.transaction(() => {
      const res = this.db.run(
        `INSERT INTO tasks (title, description, status, priority, due_date, created_at, updated_at, metadata) VALUES (?,?,?,?,?,?,?,?)`,
        [
          t.title,
          t.description,
          t.status,
          t.priority,
          dueStr,
          now.format(RFC3339),
          now.format(RFC3339),
          marshalMetadata(t.metadata),
        ],
      );
      t.id = Number(res.lastInsertRowid);
      this.saveTags(t.id, t.tags);
    })();
  }

  private saveTags(taskId: number, tags: readonly string[]): void {
    this.db.run(`DELETE FROM tags WHERE task_id = ?`, [taskId]);
    for (const raw of tags ?? []) {
      const tag = raw.trim();
      if (tag === "") continue;
      this.db.run(`INSERT INTO tags (task_id, name) VALUES (?,?)`, [
        taskId,
        tag,
      ]);
    }
  }

  update(t: Task): void {
    t.updatedAt = GoTime.utcNow();
    const dueStr = t.dueDate ? t.dueDate.format(DateOnly) : null;
    this.db.transaction(() => {
      this.db.run(
        `UPDATE tasks SET title=?, description=?, status=?, priority=?, due_date=?, updated_at=?, metadata=? WHERE id=?`,
        [
          t.title,
          t.description,
          t.status,
          t.priority,
          dueStr,
          t.updatedAt.format(RFC3339),
          marshalMetadata(t.metadata),
          t.id,
        ],
      );
      this.saveTags(t.id, t.tags);
    })();
  }

  delete(id: number): void {
    this.db.run(`DELETE FROM tasks WHERE id = ?`, [id]);
  }

  addSubtask(taskId: number, title: string): void {
    const row = this.db
      .query(
        `SELECT COALESCE(MAX(position), -1) AS max_pos FROM subtasks WHERE task_id = ?`,
      )
      .get(taskId) as { max_pos: number };
    this.db.run(
      `INSERT INTO subtasks (task_id, title, position) VALUES (?,?,?)`,
      [taskId, title, row.max_pos + 1],
    );
  }

  toggleSubtask(id: number): void {
    this.db.run(`UPDATE subtasks SET completed = NOT completed WHERE id = ?`, [
      id,
    ]);
  }

  updateSubtask(id: number, title: string): void {
    this.db.run(`UPDATE subtasks SET title = ? WHERE id = ?`, [title, id]);
  }

  deleteSubtask(id: number): void {
    this.db.run(`DELETE FROM subtasks WHERE id = ?`, [id]);
  }

  addTimeLog(taskId: number, duration: Duration, note: string): void {
    this.db.run(
      `INSERT INTO time_logs (task_id, duration, note, logged_at) VALUES (?,?,?,?)`,
      [taskId, duration, note, GoTime.utcNow().format(RFC3339)],
    );
  }

  listTimeLogs(taskId: number): TimeLog[] {
    const rows = this.db
      .query(
        `SELECT id, task_id, duration, note, logged_at FROM time_logs WHERE task_id = ? ORDER BY logged_at DESC`,
      )
      .all(taskId) as {
      id: number;
      task_id: number;
      duration: number;
      note: string;
      logged_at: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      taskId: r.task_id,
      duration: r.duration,
      note: r.note,
      loggedAt: parseRFC3339(r.logged_at),
    }));
  }

  addNote(taskId: number, body: string): void {
    this.db.run(
      `INSERT INTO task_notes (task_id, body, created_at) VALUES (?, ?, ?)`,
      [taskId, body, GoTime.utcNow().format(RFC3339)],
    );
  }

  listNotes(taskId: number): TaskNote[] {
    const rows = this.db
      .query(
        `SELECT id, task_id, body, created_at FROM task_notes WHERE task_id = ? ORDER BY created_at ASC`,
      )
      .all(taskId) as {
      id: number;
      task_id: number;
      body: string;
      created_at: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      taskId: r.task_id,
      body: r.body,
      createdAt: parseRFC3339(r.created_at),
    }));
  }

  updateNote(id: number, body: string): void {
    this.db.run(`UPDATE task_notes SET body = ? WHERE id = ?`, [body, id]);
  }

  deleteNote(id: number): void {
    this.db.run(`DELETE FROM task_notes WHERE id = ?`, [id]);
  }

  restoreNote(taskId: number, body: string, createdAt: GoTime): void {
    this.db.run(
      `INSERT INTO task_notes (task_id, body, created_at) VALUES (?,?,?)`,
      [taskId, body, createdAt.format(RFC3339)],
    );
  }

  setBlocker(taskId: number, blockerId: number): void {
    if (taskId === blockerId) throw new Error("task cannot block itself");
    this.db.run(
      `INSERT OR IGNORE INTO task_dependencies (task_id, blocked_by) VALUES (?,?)`,
      [taskId, blockerId],
    );
  }

  removeBlocker(taskId: number, blockerId: number): void {
    this.db.run(
      `DELETE FROM task_dependencies WHERE task_id = ? AND blocked_by = ?`,
      [taskId, blockerId],
    );
  }

  listBlockerIds(taskId: number): number[] {
    return (
      this.db
        .query(`SELECT blocked_by FROM task_dependencies WHERE task_id = ?`)
        .all(taskId) as { blocked_by: number }[]
    ).map((r) => r.blocked_by);
  }

  listBlocksIds(taskId: number): number[] {
    return (
      this.db
        .query(`SELECT task_id FROM task_dependencies WHERE blocked_by = ?`)
        .all(taskId) as { task_id: number }[]
    ).map((r) => r.task_id);
  }

  /** Replaces every blocker of taskId, silently skipping self-blocks. */
  setBlockers(taskId: number, blockerIds: readonly number[] | null): void {
    this.db.transaction(() => {
      this.db.run(`DELETE FROM task_dependencies WHERE task_id = ?`, [taskId]);
      for (const bid of blockerIds ?? []) {
        if (bid === taskId) continue;
        this.db.run(
          `INSERT OR IGNORE INTO task_dependencies (task_id, blocked_by) VALUES (?,?)`,
          [taskId, bid],
        );
      }
    })();
  }

  /** Replaces every task blocked by blockerId, silently skipping self-blocks. */
  setBlocksIds(blockerId: number, blockedIds: readonly number[] | null): void {
    this.db.transaction(() => {
      this.db.run(`DELETE FROM task_dependencies WHERE blocked_by = ?`, [
        blockerId,
      ]);
      for (const tid of blockedIds ?? []) {
        if (tid === blockerId) continue;
        this.db.run(
          `INSERT OR IGNORE INTO task_dependencies (task_id, blocked_by) VALUES (?,?)`,
          [tid, blockerId],
        );
      }
    })();
  }

  updateRecurrence(taskId: number, freq: RecurFreq, interval: number): void {
    this.db.run(
      `UPDATE tasks SET recur_freq = ?, recur_interval = ? WHERE id = ?`,
      [freq, interval, taskId],
    );
  }

  /** Re-inserts a previously deleted task with its tags and subtasks. */
  restore(t: Task): void {
    const dueStr = t.dueDate ? t.dueDate.format(DateOnly) : null;
    this.db.transaction(() => {
      const res = this.db.run(
        `INSERT INTO tasks (title, description, status, priority, due_date, created_at, updated_at, recur_freq, recur_interval, metadata) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          t.title,
          t.description,
          t.status,
          t.priority,
          dueStr,
          t.createdAt.format(RFC3339),
          t.updatedAt.format(RFC3339),
          t.recurFreq,
          t.recurInterval,
          marshalMetadata(t.metadata),
        ],
      );
      t.id = Number(res.lastInsertRowid);
      this.saveTags(t.id, t.tags);
      for (const st of t.subtasks) {
        this.db.run(
          `INSERT INTO subtasks (task_id, title, completed, position) VALUES (?,?,?,?)`,
          [t.id, st.title, st.completed ? 1 : 0, st.position],
        );
      }
    })();
  }

  restoreSubtask(
    taskId: number,
    title: string,
    completed: boolean,
    position: number,
  ): void {
    this.db.run(
      `INSERT INTO subtasks (task_id, title, completed, position) VALUES (?,?,?,?)`,
      [taskId, title, completed ? 1 : 0, position],
    );
  }

  /** Returns null when no task has the given id (Go returns sql.ErrNoRows). */
  getById(id: number): Task | null {
    const row = this.db
      .query(
        `SELECT id, title, description, status, priority, due_date, created_at, updated_at, recur_freq, recur_interval, metadata FROM tasks WHERE id = ?`,
      )
      .get(id) as TaskRow | null;
    if (!row) return null;

    const t = rowToTask(row);
    t.subtasks = this.listSubtasks(t.id);
    t.tags = this.listTags(t.id);
    t.timeLogs = this.listTimeLogs(t.id);
    t.notes = this.listNotes(t.id);
    t.blockedByIds = this.listBlockerIds(t.id);
    t.blocksIds = this.listBlocksIds(t.id);
    return t;
  }
}
