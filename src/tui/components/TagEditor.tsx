import { useKeyboard } from "@opentui/react";
import { useMemo, useRef, useState } from "react";
import type { Task } from "../../core/task/task.ts";
import type { TuiTheme } from "../theme.ts";
import { Button, fixedOverlayBodyRows, Overlay } from "./Overlay.tsx";

interface TagEditorProps {
  theme: TuiTheme;
  tasks: Task[];
  knownTags: readonly string[];
  screenWidth: number;
  screenHeight: number;
  onSubmit: (changes: { add: string[]; remove: string[] }) => void;
  onClose: () => void;
}

export function TagEditor({ theme, tasks, knownTags, screenWidth, screenHeight, onSubmit, onClose }: TagEditorProps) {
  const [query, setQuery] = useState("");
  const [listFocused, setListFocused] = useState(false);
  const [index, setIndex] = useState(0);
  const [changes, setChanges] = useState<Map<string, boolean>>(() => new Map());
  const latestQuery = useRef(query);
  const latestIndex = useRef(index);
  const latestListFocused = useRef(listFocused);
  const latestChanges = useRef(changes);
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const task of tasks) {
      for (const tag of new Set(task.tags)) result.set(tag, (result.get(tag) ?? 0) + 1);
    }
    return result;
  }, [tasks]);
  const getRows = (search: string, draft: Map<string, boolean>) => {
    const tags = [...new Set([...knownTags, ...counts.keys(), ...draft.keys()])].sort((a, b) => a.localeCompare(b));
    const typedTag = search.trim();
    const rows = tags.filter((tag) => tag.toLowerCase().includes(typedTag.toLowerCase()))
      .map((tag) => ({ tag, create: false }));
    if (typedTag && !tags.includes(typedTag)) rows.push({ tag: typedTag, create: true });
    return { tags, rows };
  };
  const { tags, rows } = getRows(query, changes);
  const selected = Math.min(index, Math.max(rows.length - 1, 0));
  const visibleRows = Math.max(1, fixedOverlayBodyRows(screenHeight, 22) - 5);
  const windowStart = Math.max(0, selected - visibleRows + 1);

  const select = (value: number) => {
    latestIndex.current = value;
    setIndex(value);
  };
  const focusList = (value: boolean) => {
    latestListFocused.current = value;
    setListFocused(value);
  };
  const toggle = (tag: string) => {
    const next = new Map(latestChanges.current);
    const count = counts.get(tag) ?? 0;
    const checked = next.get(tag) ?? (count === tasks.length && count > 0);
    const value = !checked;
    if ((value && count === tasks.length) || (!value && count === 0)) next.delete(tag);
    else next.set(tag, value);
    latestChanges.current = next;
    setChanges(next);
  };
  const pick = (rowIndex?: number) => {
    const currentRows = getRows(latestQuery.current, latestChanges.current).rows;
    const currentIndex = rowIndex ?? Math.min(latestIndex.current, Math.max(currentRows.length - 1, 0));
    const row = currentRows[currentIndex];
    if (!row) return;
    toggle(row.tag);
    select(row.create
      ? getRows(latestQuery.current, latestChanges.current).rows.findIndex((item) => item.tag === row.tag)
      : currentIndex);
  };
  const save = () => {
    onSubmit({
      add: [...latestChanges.current].filter(([, checked]) => checked).map(([tag]) => tag),
      remove: [...latestChanges.current].filter(([, checked]) => !checked).map(([tag]) => tag),
    });
  };

  useKeyboard((key) => {
    if (key.name === "escape") {
      key.preventDefault();
      onClose();
    } else if (key.ctrl && key.name === "s") {
      key.preventDefault();
      save();
    } else if (key.name === "tab") {
      key.preventDefault();
      focusList(!latestListFocused.current);
    } else if (key.name === "up" || key.name === "down") {
      key.preventDefault();
      focusList(true);
      const count = getRows(latestQuery.current, latestChanges.current).rows.length;
      select(Math.max(0, Math.min(count - 1, latestIndex.current + (key.name === "down" ? 1 : -1))));
    } else if (key.name === "return" || (latestListFocused.current && key.name === "space")) {
      key.preventDefault();
      pick();
    }
  });

  return (
    <Overlay theme={theme} title="Edit tags" width={64} height={22}
      screenWidth={screenWidth} screenHeight={screenHeight} onClose={onClose}
      footer="ctrl+s save · esc cancel">
      <box height={1} flexShrink={0} onMouseDown={() => focusList(false)}>
        <input focused={!listFocused} value={query} placeholder="Search or create tag…"
          onInput={(value) => {
            if (value === latestQuery.current) return;
            latestQuery.current = value;
            setQuery(value);
            select(0);
          }}
          backgroundColor={theme.surfaceAlt} textColor={theme.text}
          placeholderColor={theme.textMuted} cursorColor={theme.accent} />
      </box>
      <text height={1} flexShrink={0} fg={theme.textMuted} wrapMode="none" truncate>
        {`${tasks.length} ${tasks.length === 1 ? "task" : "tasks"} · ${tags.length} tags · ${changes.size} changed`}
      </text>
      <box flexDirection="column" height={visibleRows} flexShrink={0}
        onMouseScroll={(event) => {
          if (event.scroll?.direction !== "up" && event.scroll?.direction !== "down") return;
          event.stopPropagation();
          focusList(true);
          const step = event.scroll.direction === "down" ? 1 : -1;
          const count = getRows(latestQuery.current, latestChanges.current).rows.length;
          select(Math.max(0, Math.min(count - 1, latestIndex.current + step)));
        }}>
        {rows.length === 0 ? <text fg={theme.textMuted}>No tags yet · type to create</text> :
          rows.slice(windowStart, windowStart + visibleRows).map((row, offset) => {
            const count = counts.get(row.tag) ?? 0;
            const changed = changes.get(row.tag);
            const effectiveCount = changed === undefined ? count : changed ? tasks.length : 0;
            const checked = effectiveCount === tasks.length && effectiveCount > 0;
            const mark = checked ? "[x]" : effectiveCount > 0 ? "[-]" : "[ ]";
            const active = windowStart + offset === selected;
            return (
              <box key={row.tag} height={1} flexShrink={0} flexDirection="row"
                backgroundColor={active ? theme.selectionBg : undefined}
                onMouseDown={() => {
                  focusList(true);
                  pick(windowStart + offset);
                }}>
                <text fg={checked ? theme.accent : theme.text} flexGrow={1} wrapMode="none" truncate>
                  {row.create ? `+ Create #${row.tag}` : `${mark} #${row.tag}`}
                </text>
                <text fg={theme.textMuted} flexShrink={0}>
                  {row.create ? "" : ` ${effectiveCount}/${tasks.length}`}
                </text>
              </box>
            );
          })}
      </box>
      <text height={1} flexShrink={0} fg={theme.textMuted}>↑↓ move · enter toggle/create</text>
      <text height={1} flexShrink={0} fg={theme.textMuted}>
        {listFocused ? "tab search · space toggle" : "tab list · space types"}
      </text>
      <box height={1} flexShrink={0} flexDirection="row">
        <Button theme={theme} label="Save" primary onPress={save} />
        <Button theme={theme} label="Cancel" onPress={onClose} />
      </box>
    </Overlay>
  );
}
