import { describe, expect, test } from "bun:test";
import { openMemory } from "../src/core/database/db.ts";
import { dateTitle } from "../src/core/journal/journal.ts";
import { JournalStore } from "../src/core/journal/store.ts";
import { DateOnly, GoTime } from "../src/core/time.ts";

function newStore(): JournalStore {
  return new JournalStore(openMemory());
}

describe("journal store", () => {
  test("getOrCreate is idempotent", () => {
    const store = newStore();
    const a = store.getOrCreate("2026-03-01");
    const b = store.getOrCreate("2026-03-01");
    expect(a.id).toBe(b.id);
    expect(a.date.format(DateOnly)).toBe("2026-03-01");
  });

  test("entries are appended and listed in order", () => {
    const store = newStore();
    const note = store.getOrCreate("2026-03-01");

    store.addEntry(note.id, "first");
    store.addEntry(note.id, "second");

    const entries = store.listEntries(note.id);
    expect(entries.map((e) => e.body)).toEqual(["first", "second"]);
    expect(entries[0]!.noteId).toBe(note.id);
  });

  test("update and delete entries", () => {
    const store = newStore();
    const note = store.getOrCreate("2026-03-01");
    store.addEntry(note.id, "original");

    const entry = store.listEntries(note.id)[0]!;
    store.updateEntry(entry.id, "edited");
    expect(store.listEntries(note.id)[0]!.body).toBe("edited");

    store.deleteEntry(entry.id);
    expect(store.listEntries(note.id).length).toBe(0);
  });

  test("updating a missing entry fails", () => {
    const store = newStore();
    expect(() => store.updateEntry(999, "x")).toThrow();
    expect(() => store.deleteEntry(999)).toThrow();
  });

  test("restoreEntry keeps the original timestamp", () => {
    const store = newStore();
    const note = store.getOrCreate("2026-03-01");
    store.addEntry(note.id, "restore me");
    const entry = store.listEntries(note.id)[0]!;
    store.deleteEntry(entry.id);

    store.restoreEntry(note.id, entry.body, entry.createdAt);

    const restored = store.listEntries(note.id)[0]!;
    expect(restored.body).toBe("restore me");
    expect(restored.createdAt.equal(entry.createdAt)).toBe(true);
  });

  test("hidden notes are filtered unless requested", () => {
    const store = newStore();
    const visible = store.getOrCreate("2026-03-02");
    const hidden = store.getOrCreate("2026-03-01");
    store.toggleHidden(hidden.id);

    expect(store.listNotes(false).map((n) => n.id)).toEqual([visible.id]);
    expect(store.listNotes(true).length).toBe(2);
    expect(store.listNotes(true)[1]!.hidden).toBe(true);
  });

  test("toggleHidden fails for unknown notes", () => {
    const store = newStore();
    expect(() => store.toggleHidden(999)).toThrow();
  });

  test("listNotes batches entries and sorts by date desc", () => {
    const store = newStore();
    const older = store.getOrCreate("2026-03-01");
    const newer = store.getOrCreate("2026-03-05");
    store.addEntry(older.id, "a");
    store.addEntry(newer.id, "b");
    store.addEntry(newer.id, "c");

    const notes = store.listNotes(false);
    expect(notes.map((n) => n.date.format(DateOnly))).toEqual([
      "2026-03-05",
      "2026-03-01",
    ]);
    expect(notes[0]!.entries.length).toBe(2);
    expect(notes[1]!.entries.length).toBe(1);
  });

  test("getOrCreateToday uses the local date", () => {
    const store = newStore();
    const note = store.getOrCreateToday();
    expect(note.date.format(DateOnly)).toBe(GoTime.now().format(DateOnly));
  });
});

describe("dateTitle", () => {
  const now = GoTime.date(2026, 3, 15, 14, 0, 0);

  test("relative labels", () => {
    const at = (y: number, m: number, d: number) => ({
      date: GoTime.date(y, m, d, 0, 0, 0, 0, "utc"),
    });
    expect(dateTitle(at(2026, 3, 15), now)).toBe("Today, Mar 15");
    expect(dateTitle(at(2026, 3, 14), now)).toBe("Yesterday, Mar 14");
    expect(dateTitle(at(2026, 3, 10), now)).toBe("Tue, Mar 10");
    expect(dateTitle(at(2026, 1, 5), now)).toBe("Jan 05");
    expect(dateTitle(at(2025, 12, 25), now)).toBe("Dec 25, 2025");
  });
});
