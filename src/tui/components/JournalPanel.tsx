import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { useEffect, useRef, useState } from "react";
import {
  formatNoteTitle,
  formatTime,
  type Config,
} from "../../core/config/config.ts";
import type { Note } from "../../core/journal/journal.ts";
import { GoTime } from "../../core/time.ts";
import type { TuiTheme } from "../theme.ts";

interface NoteListProps {
  theme: TuiTheme;
  cfg: Config;
  notes: Note[];
  selected: number;
  focused: boolean;
  onSelect: (index: number) => void;
}

/** Left panel of the Journal tab: one row per day. */
export function NoteList({
  theme,
  cfg,
  notes,
  selected,
  focused,
  onSelect,
}: NoteListProps) {
  if (notes.length === 0) {
    return (
      <box flexGrow={1} alignItems="center" justifyContent="center" padding={2}>
        <text fg={theme.textMuted}>No journal notes yet — press a to write</text>
      </box>
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

  useEffect(() => {
    if (selectedId === undefined) return;
    scrollRef.current?.scrollChildIntoView(`note-row-${selectedId}`);
  }, [selectedId]);

  return (
    <scrollbox
      ref={scrollRef}
      focused={focused}
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
            <text fg={isSelected && focused ? theme.accent : theme.borderSubtle}>
              {isSelected ? "┃" : "│"}
            </text>
            <text
              fg={note.hidden ? theme.textMuted : theme.text}
              attributes={isSelected ? TextAttributes.BOLD : undefined}
              flexGrow={1}
              truncate
            >
              {` ${formatNoteTitle(cfg, note.date, now)}`}
            </text>
            <text fg={theme.textDim}>
              {`${note.entries.length}${note.hidden ? " ·hidden" : ""}`}
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
      <box flexGrow={1} alignItems="center" justifyContent="center">
        <text fg={theme.textMuted}>Select a day to read its entries</text>
      </box>
    );
  }

  if (note.entries.length === 0) {
    return (
      <box flexGrow={1} alignItems="center" justifyContent="center">
        <text fg={theme.textMuted}>No entries for this day — press a to add one</text>
      </box>
    );
  }

  return (
    <scrollbox
      focused={focused}
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
          theme={theme}
          time={formatTime(cfg, entry.createdAt)}
          body={entry.body}
          selected={focused && index === selected}
          onPress={() => onSelect(index)}
        />
      ))}
    </scrollbox>
  );
}

interface EntryRowProps {
  theme: TuiTheme;
  time: string;
  body: string;
  selected: boolean;
  onPress: () => void;
}

/** One journal entry: timestamp rail on the left, prose on the right. */
function EntryRow({ theme, time, body, selected, onPress }: EntryRowProps) {
  const [hover, setHover] = useState(false);
  return (
    <box
      flexDirection="row"
      paddingBottom={1}
      backgroundColor={
        selected ? theme.selectionBg : hover ? theme.hoverBg : undefined
      }
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseDown={onPress}
    >
      <text fg={selected ? theme.accent : theme.borderSubtle}>
        {selected ? "┃" : "│"}
      </text>
      <box flexDirection="column" flexGrow={1} paddingLeft={1}>
        <text fg={selected ? theme.accent : theme.textMuted}>{time}</text>
        <text fg={theme.text} wrapMode="word">
          {body}
        </text>
      </box>
    </box>
  );
}
