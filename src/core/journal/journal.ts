import { GoTime } from "../time.ts";

/** A single day's journal. One note per calendar day. */
export interface Note {
  id: number;
  /** Midnight of the note's day. */
  date: GoTime;
  hidden: boolean;
  createdAt: GoTime;
  updatedAt: GoTime;
  entries: Entry[];
}

export interface Entry {
  id: number;
  noteId: number;
  body: string;
  createdAt: GoTime;
}

/** Human-readable date label used as the note title. */
export function dateTitle(n: Pick<Note, "date">, now = GoTime.now()): string {
  const p = now.parts;
  const today = GoTime.date(p.year, p.month, p.day, 0, 0, 0, 0, n.date.loc);
  const yesterday = today.addDate(0, 0, -1);
  const weekAgo = today.addDate(0, 0, -6);

  if (n.date.equal(today)) return `Today, ${n.date.format("Jan 02")}`;
  if (n.date.equal(yesterday)) return `Yesterday, ${n.date.format("Jan 02")}`;
  if (n.date.after(weekAgo)) return n.date.format("Mon, Jan 02");
  if (n.date.year() === p.year) return n.date.format("Jan 02");
  return n.date.format("Jan 02, 2006");
}

export function entryCountLabel(n: Pick<Note, "entries">): string {
  return `${n.entries.length} entries`;
}
