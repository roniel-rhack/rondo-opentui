import { dateTitle, type Note } from "../core/journal/journal.ts";
import { fuzzyIndices, plainExcerpt } from "./state.ts";
import { cellWidth } from "./text.ts";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export interface JournalSearchResult {
  note: Note;
  entryIds: number[];
}

export function searchJournal(
  notes: readonly Note[],
  query: string,
): JournalSearchResult[] {
  const needle = query.trim();
  return notes.flatMap((note) => {
    const entryIds = needle === ""
      ? []
      : note.entries
          .filter((entry) => fuzzyIndices(needle, entry.body) !== null)
          .map((entry) => entry.id);
    return needle === "" || entryIds.length > 0 || fuzzyIndices(needle, dateTitle(note)) !== null
      ? [{ note, entryIds }]
      : [];
  });
}

export function journalExcerpt(body: string, query: string, width: number): string {
  const plain = plainExcerpt(body, Number.MAX_SAFE_INTEGER);
  const first = fuzzyIndices(query.trim(), plain)?.[0] ?? 0;
  const segments = [...graphemes.segment(plain)];
  let at = segments.findLastIndex((segment) => segment.index <= first);
  let context = 0;
  const before = Math.min(12, Math.floor(width / 4));
  while (at > 0) {
    const size = cellWidth(segments[at - 1]!.segment);
    if (context + size > before) break;
    context += size;
    at--;
  }
  const start = segments[at]?.index ?? 0;
  const prefix = start > 0 ? "…" : "";
  return `${prefix}${plainExcerpt(plain.slice(start), width - cellWidth(prefix))}`;
}
