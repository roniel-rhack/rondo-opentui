import type { Database } from "bun:sqlite";
import {
  DateOnly,
  GoTime,
  RFC3339,
  parseDateOnly,
  parseRFC3339,
} from "../time.ts";
import type { Entry, Note } from "./journal.ts";

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS journal_notes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      date       TEXT NOT NULL UNIQUE,
      hidden     INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS journal_entries (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id    INTEGER NOT NULL REFERENCES journal_notes(id) ON DELETE CASCADE,
      body       TEXT NOT NULL,
      created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_journal_entries_note ON journal_entries(note_id)`,
  `CREATE INDEX IF NOT EXISTS idx_journal_notes_date ON journal_notes(date)`,
];

interface NoteRow {
  id: number;
  date: string;
  hidden: number;
  created_at: string;
  updated_at: string;
}

interface EntryRow {
  id: number;
  note_id: number;
  body: string;
  created_at: string;
}

function rowToNote(r: NoteRow): Note {
  return {
    id: r.id,
    date: parseDateOnly(r.date, "utc"),
    hidden: r.hidden !== 0,
    createdAt: parseRFC3339(r.created_at),
    updatedAt: parseRFC3339(r.updated_at),
    entries: [],
  };
}

function rowToEntry(r: EntryRow): Entry {
  return {
    id: r.id,
    noteId: r.note_id,
    body: r.body,
    createdAt: parseRFC3339(r.created_at),
  };
}

export class JournalStore {
  constructor(private readonly db: Database) {
    for (const stmt of MIGRATIONS) this.db.run(stmt);
  }

  /** Notes ordered by date descending; hidden ones are optional. */
  listNotes(includeHidden: boolean): Note[] {
    let query = `SELECT id, date, hidden, created_at, updated_at FROM journal_notes`;
    if (!includeHidden) query += ` WHERE hidden = 0`;
    query += ` ORDER BY date DESC`;

    const notes = (this.db.query(query).all() as NoteRow[]).map(rowToNote);
    if (notes.length === 0) return notes;

    const entries = this.listAllEntries(notes.map((n) => n.id));
    for (const n of notes) n.entries = entries.get(n.id) ?? [];
    return notes;
  }

  private listAllEntries(noteIds: number[]): Map<number, Entry[]> {
    const rows = this.db
      .query(
        `SELECT id, note_id, body, created_at FROM journal_entries WHERE note_id IN (${noteIds
          .map(() => "?")
          .join(",")}) ORDER BY created_at ASC`,
      )
      .all(...noteIds) as EntryRow[];
    const m = new Map<number, Entry[]>();
    for (const r of rows) {
      const list = m.get(r.note_id) ?? [];
      list.push(rowToEntry(r));
      m.set(r.note_id, list);
    }
    return m;
  }

  /** Returns the note for dateStr (YYYY-MM-DD), creating it when missing. */
  getOrCreate(dateStr: string): Note {
    const now = GoTime.utcNow().format(RFC3339);
    this.db.run(
      `INSERT OR IGNORE INTO journal_notes (date, hidden, created_at, updated_at) VALUES (?,0,?,?)`,
      [dateStr, now, now],
    );

    const row = this.db
      .query(
        `SELECT id, date, hidden, created_at, updated_at FROM journal_notes WHERE date = ?`,
      )
      .get(dateStr) as NoteRow | null;
    if (!row) throw new Error(`get note for ${dateStr}: not found`);

    const note = rowToNote(row);
    note.entries = this.listEntries(note.id);
    return note;
  }

  getOrCreateToday(): Note {
    return this.getOrCreate(GoTime.now().format(DateOnly));
  }

  addEntry(noteId: number, body: string): void {
    const now = GoTime.utcNow().format(RFC3339);
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO journal_entries (note_id, body, created_at) VALUES (?,?,?)`,
        [noteId, body, now],
      );
      this.db.run(`UPDATE journal_notes SET updated_at = ? WHERE id = ?`, [
        now,
        noteId,
      ]);
    })();
  }

  updateEntry(entryId: number, body: string): void {
    const now = GoTime.utcNow().format(RFC3339);
    this.db.transaction(() => {
      const res = this.db.run(`UPDATE journal_entries SET body = ? WHERE id = ?`, [
        body,
        entryId,
      ]);
      if (res.changes === 0) throw new Error(`entry ${entryId} not found`);
      this.db.run(
        `UPDATE journal_notes SET updated_at = ? WHERE id = (SELECT note_id FROM journal_entries WHERE id = ?)`,
        [now, entryId],
      );
    })();
  }

  deleteEntry(entryId: number): void {
    this.db.transaction(() => {
      const row = this.db
        .query(`SELECT note_id FROM journal_entries WHERE id = ?`)
        .get(entryId) as { note_id: number } | null;
      if (!row) throw new Error(`find entry note: entry ${entryId} not found`);
      this.db.run(`DELETE FROM journal_entries WHERE id = ?`, [entryId]);
      this.db.run(`UPDATE journal_notes SET updated_at = ? WHERE id = ?`, [
        GoTime.utcNow().format(RFC3339),
        row.note_id,
      ]);
    })();
  }

  toggleHidden(noteId: number): void {
    const res = this.db.run(
      `UPDATE journal_notes SET hidden = NOT hidden WHERE id = ?`,
      [noteId],
    );
    if (res.changes === 0) throw new Error(`note ${noteId} not found`);
  }

  restoreEntry(noteId: number, body: string, createdAt: GoTime): void {
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO journal_entries (note_id, body, created_at) VALUES (?,?,?)`,
        [noteId, body, createdAt.format(RFC3339)],
      );
      this.db.run(`UPDATE journal_notes SET updated_at = ? WHERE id = ?`, [
        GoTime.utcNow().format(RFC3339),
        noteId,
      ]);
    })();
  }

  listEntries(noteId: number): Entry[] {
    const rows = this.db
      .query(
        `SELECT id, note_id, body, created_at FROM journal_entries WHERE note_id = ? ORDER BY created_at ASC`,
      )
      .all(noteId) as EntryRow[];
    return rows.map(rowToEntry);
  }
}
