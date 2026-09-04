import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { useImperativeHandle, useRef, useState, type Ref } from "react";
import {
  formatNoteTitle,
  formatTime,
  type Config,
} from "../../core/config/config.ts";
import type { Note } from "../../core/journal/journal.ts";
import { GoTime } from "../../core/time.ts";
import { useSmoothScrollIntoView } from "../hooks/useSmoothScroll.ts";
import { journalExcerpt, searchJournal } from "../journal-search.ts";
import { fuzzyIndices, plainExcerpt, plural } from "../state.ts";
import { mix, type TuiTheme } from "../theme.ts";
import { EmptyState, MarkdownText, highlightSpans } from "./primitives.tsx";

interface NoteListProps {
  query?: string;
  theme: TuiTheme;
  cfg: Config;
  notes: Note[];
  /** Overrides the default empty message, e.g. while a search filters. */
  emptyText?: string;
  /** Outer width of the panel, borders included; sizes the preview line. */
  width?: number;
  selected: number;
  focused: boolean;
  onSelect: (index: number) => void;
}

/** Panel borders, the rail and its indent, trailing padding, scrollbar. */
const PREVIEW_CHROME = 2 + 2 + 1 + 1;

/** Left panel of the Journal tab: one row per day. */
export function NoteList({
  query = "",
  theme,
  cfg,
  notes,
  emptyText,
  width = 40,
  selected,
  focused,
  onSelect,
}: NoteListProps) {
  if (notes.length === 0) {
    return emptyText ? (
      <EmptyState theme={theme} icon="⌕" title="No matches" hint={emptyText} />
    ) : (
      <EmptyState
        theme={theme}
        icon="✎"
        title="No journal notes yet"
        hint="Press a to write about today"
      />
    );
  }

  const now = GoTime.now();

  return (
    <NoteRows
      query={query}
      theme={theme}
      cfg={cfg}
      notes={notes}
      width={width}
      selected={selected}
      focused={focused}
      now={now}
      onSelect={onSelect}
    />
  );
}

interface NoteRowsProps extends NoteListProps {
  width: number;
  now: GoTime;
}

/** Scroll container that follows the selected day. */
function NoteRows({
  query = "",
  theme,
  cfg,
  notes,
  width,
  selected,
  focused,
  now,
  onSelect,
}: NoteRowsProps) {
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const selectedId = notes[selected]?.id;
  const previewWidth = Math.max(width - PREVIEW_CHROME, 8);

  useSmoothScrollIntoView(
    scrollRef,
    selectedId === undefined ? undefined : `note-row-${selectedId}`,
  );

  return (
    <scrollbox
      ref={scrollRef}
      // Never focused, or the scrollbox would answer j/k itself and fight the
      // cursor-driven scrolling. Wheel and drag still work.
      focused={false}
      flexGrow={1}
      scrollX={false}
      scrollbarOptions={{
        showArrows: false,
        trackOptions: {
          backgroundColor: theme.bg,
          foregroundColor: theme.border,
        },
      }}
      contentOptions={{ flexDirection: "column" }}
    >
      {notes.map((note, index) => {
        const isSelected = index === selected;
        const rail = isSelected ? "┃" : "│";
        const railTone = isSelected && focused ? theme.accent : theme.borderSubtle;
        const match = searchJournal([note], query)[0]?.entryIds[0];
        const entry = note.entries.find((entry) => entry.id === match) ?? note.entries[0];
        const preview = query.trim() === ""
          ? plainExcerpt(entry?.body ?? "", previewWidth)
          : journalExcerpt(entry?.body ?? "", query, previewWidth);
        return (
          <box
            key={note.id}
            id={`note-row-${note.id}`}
            flexDirection="column"
            backgroundColor={isSelected ? theme.selectionBg : undefined}
            onMouseDown={() => onSelect(index)}
          >
            <box flexDirection="row" paddingRight={1}>
              <text flexShrink={0} fg={railTone}>
                {rail}
              </text>
              <text
                fg={note.hidden ? theme.textMuted : theme.text}
                attributes={isSelected ? TextAttributes.BOLD : undefined}
                flexGrow={1}
                wrapMode="none"
                truncate
              >
                {` ${formatNoteTitle(cfg, note.date, now)}`}
              </text>
              <text flexShrink={0} fg={theme.textDim}>
                {`${plural(note.entries.length, "entry", "entries")}${
                  note.hidden ? " · hidden" : ""
                }`}
              </text>
            </box>
            <box flexDirection="row" paddingRight={1}>
              <text flexShrink={0} fg={railTone}>
                {rail}
              </text>
              <text fg={theme.textMuted} wrapMode="none">
                {" "}
                {highlightSpans(preview, fuzzyIndices(query.trim(), preview) ?? [], theme.textMuted, theme.accent)}
              </text>
            </box>
          </box>
        );
      })}
    </scrollbox>
  );
}

export interface EntryListHandle {
  scrollBy: (lines: number) => void;
  getScrollTop: () => number;
  scrollTo: (top: number) => void;
}

interface EntryListProps {
  query?: string;
  ref?: Ref<EntryListHandle>;
  theme: TuiTheme;
  cfg: Config;
  note: Note | null;
  selected: number;
  focused: boolean;
  onSelect: (index: number) => void;
}

/** Right panel of the Journal tab: the selected day's entries. */
export function EntryList({
  query = "",
  ref,
  theme,
  cfg,
  note,
  selected,
  focused,
  onSelect,
}: EntryListProps) {
  if (!note) {
    return (
      <EmptyState
        theme={theme}
        icon="✎"
        title="Nothing selected"
        hint="Pick a day on the left to read its entries"
      />
    );
  }

  if (note.entries.length === 0) {
    return (
      <EmptyState
        theme={theme}
        icon="✎"
        title="No entries for this day"
        hint="Press A to add one"
      />
    );
  }

  return (
    <EntryRows
      query={query}
      ref={ref}
      theme={theme}
      cfg={cfg}
      note={note}
      selected={selected}
      focused={focused}
      onSelect={onSelect}
    />
  );
}

/** Scroll container that follows the selected entry. */
function EntryRows({
  query = "",
  ref,
  theme,
  cfg,
  note,
  selected,
  focused,
  onSelect,
}: EntryListProps & { note: Note }) {
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const selectedId = note.entries[selected]?.id;
  const matches = searchJournal([note], query)[0]?.entryIds ?? [];

  const stopScrolling = useSmoothScrollIntoView(
    scrollRef,
    selectedId === undefined ? undefined : `entry-${selectedId}`,
  );

  useImperativeHandle(ref, () => ({
    getScrollTop: () => scrollRef.current?.scrollTop ?? 0,
    scrollTo: (top) => {
      stopScrolling();
      scrollRef.current?.scrollTo(top);
    },
    scrollBy: (lines) => {
      stopScrolling();
      scrollRef.current?.scrollBy({ x: 0, y: lines });
    },
  }), [stopScrolling]);

  return (
    <scrollbox
      ref={scrollRef}
      // Never focused, for the same reason as the day list.
      focused={false}
      flexGrow={1}
      scrollX={false}
      scrollbarOptions={{
        showArrows: false,
        trackOptions: {
          backgroundColor: theme.bg,
          foregroundColor: theme.border,
        },
      }}
      paddingLeft={1}
      paddingRight={1}
      contentOptions={{ flexDirection: "column" }}
    >
      {note.entries.map((entry, index) => (
        <EntryRow
          key={entry.id}
          id={`entry-${entry.id}`}
          theme={theme}
          time={formatTime(cfg, entry.createdAt)}
          matchLabel={matches.includes(entry.id) ? `Match ${matches.indexOf(entry.id) + 1}/${matches.length}` : undefined}
          body={entry.body}
          selected={index === selected}
          focused={focused}
          onPress={() => onSelect(index)}
        />
      ))}
    </scrollbox>
  );
}

interface EntryRowProps {
  matchLabel?: string;
  theme: TuiTheme;
  id: string;
  time: string;
  body: string;
  selected: boolean;
  focused: boolean;
  onPress: () => void;
}

/** One journal entry: timestamp rail on the left, prose on the right. */
function EntryRow({
  matchLabel,
  theme,
  id,
  time,
  body,
  selected,
  focused,
  onPress,
}: EntryRowProps) {
  const [hover, setHover] = useState(false);
  // The selection stays visible while the day list has focus, dimmed: it is
  // what `d` and `e` will act on, so it must never be a secret.
  const background = selected
    ? focused
      ? theme.selectionBg
      : mix(theme.selectionBg, theme.bg, 0.45)
    : hover
      ? theme.hoverBg
      : matchLabel
        ? theme.accentSoft
        : undefined;
  const active = selected && focused;
  return (
    <box
      id={id}
      flexDirection="row"
      paddingBottom={1}
      backgroundColor={background}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseDown={onPress}
    >
      <text
        flexShrink={0}
        fg={active ? theme.accent : selected ? theme.textDim : theme.borderSubtle}
      >
        {selected ? "┃" : "│"}
      </text>
      <box flexDirection="column" flexGrow={1} paddingLeft={1}>
        <text fg={active || matchLabel ? theme.accent : theme.textMuted}>
          {matchLabel ? `${time} · ${matchLabel}` : time}
        </text>
        <MarkdownText theme={theme} content={body} />
      </box>
    </box>
  );
}
