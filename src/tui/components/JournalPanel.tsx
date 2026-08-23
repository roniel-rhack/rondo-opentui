import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { useRef, useState } from "react";
import {
  formatNoteTitle,
  formatTime,
  type Config,
} from "../../core/config/config.ts";
import type { Note } from "../../core/journal/journal.ts";
import { GoTime } from "../../core/time.ts";
import { useSmoothScrollIntoView } from "../hooks/useSmoothScroll.ts";
import { plural } from "../state.ts";
import { mix, type TuiTheme } from "../theme.ts";
import { EmptyState, MarkdownText } from "./primitives.tsx";

interface NoteListProps {
  theme: TuiTheme;
  cfg: Config;
  notes: Note[];
  /** Overrides the default empty message, e.g. while a search filters. */
  emptyText?: string;
  selected: number;
  focused: boolean;
  onSelect: (index: number) => void;
}

/** Left panel of the Journal tab: one row per day. */
export function NoteList({
  theme,
  cfg,
  notes,
  emptyText,
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
      theme={theme}
      cfg={cfg}
      notes={notes}
      selected={selected}
      focused={focused}
      now={now}
      onSelect={onSelect}
    />
  );
}

interface NoteRowsProps extends NoteListProps {
  now: GoTime;
}

/** Scroll container that follows the selected day. */
function NoteRows({
  theme,
  cfg,
  notes,
  selected,
  focused,
  now,
  onSelect,
}: NoteRowsProps) {
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const selectedId = notes[selected]?.id;

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
        return (
          <box
            key={note.id}
            id={`note-row-${note.id}`}
            flexDirection="row"
            paddingRight={1}
            backgroundColor={isSelected ? theme.selectionBg : undefined}
            onMouseDown={() => onSelect(index)}
          >
            <text
              flexShrink={0}
              fg={isSelected && focused ? theme.accent : theme.borderSubtle}
            >
              {isSelected ? "┃" : "│"}
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
        );
      })}
    </scrollbox>
  );
}

interface EntryListProps {
  theme: TuiTheme;
  cfg: Config;
  note: Note | null;
  selected: number;
  focused: boolean;
  onSelect: (index: number) => void;
}

/** Right panel of the Journal tab: the selected day's entries. */
export function EntryList({
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
  theme,
  cfg,
  note,
  selected,
  focused,
  onSelect,
}: EntryListProps & { note: Note }) {
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const selectedId = note.entries[selected]?.id;

  useSmoothScrollIntoView(
    scrollRef,
    selectedId === undefined ? undefined : `entry-${selectedId}`,
  );

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
        <text fg={active ? theme.accent : theme.textMuted}>{time}</text>
        <MarkdownText theme={theme} content={body} />
      </box>
    </box>
  );
}
