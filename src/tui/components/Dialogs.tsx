import { TextAttributes, type KeyEvent, type TextareaRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Status, type Task } from "../../core/task/task.ts";
import type { PaletteAction } from "../palette.ts";
import { fuzzyIndices, fuzzyIndicesAfter, fuzzyScore } from "../state.ts";
import { mix, type TuiTheme } from "../theme.ts";
import { Button, Overlay, overlayBodyRows } from "./Overlay.tsx";
import { ChipButton, Section, highlightSpans } from "./primitives.tsx";

/** Rows a list dialog can show under its search field: the overlay body
 * minus the field and its padding, capped so a tall terminal still reads as
 * a palette rather than a full page. */
function listRows(screenHeight: number): number {
  return Math.max(3, Math.min(overlayBodyRows(screenHeight) - 5, 16));
}

/** Items matching the query, best first; the input order when it is empty. */
function rank<T>(items: readonly T[], query: string, haystack: (item: T) => string): T[] {
  if (query === "") return [...items];
  return items
    .map((item) => ({ item, score: fuzzyScore(query, haystack(item)) }))
    .filter((r) => r.score !== null)
    .sort((x, y) => (y.score ?? 0) - (x.score ?? 0))
    .map((r) => r.item);
}

interface ConfirmDialogProps {
  theme: TuiTheme;
  title: string;
  message: string;
  /** What is about to be acted on, quoted under the message so the user can
   * tell the target even when nothing on screen is highlighted. */
  excerpt?: string;
  detail?: string;
  confirmLabel?: string;
  screenWidth: number;
  screenHeight: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Destructive-action confirmation with keyboard and mouse affordances. */
export function ConfirmDialog({
  theme,
  title,
  message,
  excerpt,
  detail,
  confirmLabel = "Delete",
  screenWidth,
  screenHeight,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useKeyboard((key: KeyEvent) => {
    if (key.name === "escape" || key.name === "n") onCancel();
    // Enter is too easy to press by reflex to let it destroy things, and
    // every confirm in this app is destructive: only y goes through.
    if (key.name === "y") onConfirm();
  });

  return (
    <Overlay
      theme={theme}
      title={title}
      width={58}
      screenWidth={screenWidth}
      screenHeight={screenHeight}
      accent={theme.danger}
      footer="y confirm · n / esc cancel"
      onBackdropClick={onCancel}
    >
      <box paddingTop={1} paddingBottom={1} flexDirection="column">
        <text fg={theme.text} wrapMode="word">
          {message}
        </text>
        {excerpt ? (
          <text fg={theme.textDim} wrapMode="none" truncate>
            {`"${excerpt}"`}
          </text>
        ) : null}
        {detail ? (
          <box flexDirection="row" paddingTop={1}>
            <text fg={theme.warning}>{"⚠ "}</text>
            <text fg={theme.warning} wrapMode="word" flexGrow={1}>
              {detail}
            </text>
          </box>
        ) : null}
      </box>
      <box flexDirection="row" paddingBottom={1}>
        <Button theme={theme} label={confirmLabel} danger onPress={onConfirm} />
        <Button theme={theme} label="Cancel" onPress={onCancel} />
      </box>
    </Overlay>
  );
}

export interface PromptChip {
  /** Single character that submits the chip while the field still holds the
   * value it opened with. */
  key: string;
  label: string;
  value: string;
}

interface PromptDialogProps {
  theme: TuiTheme;
  title: string;
  label: string;
  placeholder?: string;
  initial?: string;
  /** Multiline prompts keep enter as a new line; ctrl+s saves. Single-line
   * prompts still wrap long text into view, but enter submits. */
  multiline?: boolean;
  /** Quick answers under the field. Clicking one, or pressing its key before
   * the field is edited, submits its value as-is. */
  chips?: PromptChip[];
  /** Keep the dialog open after each accepted value and clear the field, so
   * a series can be entered without reopening; esc ends it. */
  stayOpen?: boolean;
  screenWidth: number;
  screenHeight: number;
  /** Return a message to reject the value: it shows inline under the field
   * instead of as a toast hidden behind the scrim. */
  onSubmit: (value: string) => string | void;
  onCancel: () => void;
}

/** Single-field prompt for subtasks, journal entries, notes and time logs. */
export function PromptDialog({
  theme,
  title,
  label,
  placeholder,
  initial = "",
  multiline = false,
  chips,
  stayOpen = false,
  screenWidth,
  screenHeight,
  onSubmit,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(0);
  const areaRef = useRef<TextareaRenderable | null>(null);
  const lastText = useRef(initial);

  // Editing continues at the end, like an input would.
  useEffect(() => {
    const area = areaRef.current;
    if (area) area.cursorOffset = area.plainText.length;
  }, []);

  const currentValue = () => areaRef.current?.plainText ?? value;

  const deliver = (text: string) => {
    const problem = onSubmit(text);
    if (typeof problem === "string") {
      setError(problem);
      return;
    }
    if (!stayOpen) return;
    const area = areaRef.current;
    if (area) {
      area.setText("");
      area.cursorOffset = 0;
    }
    lastText.current = "";
    setValue("");
    setError(null);
    setAccepted((n) => n + 1);
  };

  const submit = () => {
    const text = currentValue().trim();
    if (text === "") {
      setError("Cannot be empty");
      return;
    }
    deliver(text);
  };

  useKeyboard((key: KeyEvent) => {
    if (key.name === "escape") {
      onCancel();
      return;
    }
    if (key.ctrl && key.name === "s") {
      submit();
      return;
    }
    if (!multiline && key.name === "return") {
      submit();
      return;
    }
    if (!chips || key.ctrl || key.meta) return;
    // A prompt pre-filled with the current value — re-dating a task that
    // already has a due date — must answer the chip letters too; they stop
    // firing as soon as the user types over what was there.
    const text = currentValue();
    if (text !== "" && text !== initial) return;
    const chip = chips.find((c) => c.key === key.sequence);
    if (chip) {
      // Claim the key before the textarea inserts it as text.
      key.preventDefault();
      deliver(chip.value);
    }
  });

  // One-line prompts still use a textarea so long values wrap into view; the
  // newline enter leaves behind collapses right back into a space. The error
  // only clears when the text truly changes, so the enter that triggered it
  // does not immediately wipe it.
  const handleChange = () => {
    const area = areaRef.current;
    if (!area) return;
    const text = area.plainText;
    if (!multiline && text.includes("\n")) {
      // A trailing newline is the enter that just submitted: drop it rather
      // than turn it into a space, or the rejected value would look changed.
      const flat = text.replace(/\s*\n\s*$/, "").replace(/\s*\n\s*/g, " ");
      area.setText(flat);
      area.cursorOffset = flat.length;
      return;
    }
    setValue(text);
    if (text.trim() !== lastText.current.trim()) {
      lastText.current = text;
      setError(null);
    }
  };

  // A stray click on the scrim only closes a prompt that has nothing to lose.
  const cancelIfPristine = () => {
    if (currentValue().trim() === "") onCancel();
  };

  const verb = stayOpen ? "add" : "save";
  const end = stayOpen ? "esc done" : "esc cancel";
  const footer = multiline
    ? `ctrl+s ${verb} · enter new line · ${end}`
    : `enter ${verb} · ${end}`;

  return (
    <Overlay
      theme={theme}
      title={title}
      subtitle={accepted > 0 ? `${accepted} added · esc done` : label}
      width={64}
      screenWidth={screenWidth}
      screenHeight={screenHeight}
      footer={footer}
      onBackdropClick={cancelIfPristine}
      onClose={onCancel}
    >
      <box flexDirection="column" paddingTop={1}>
        <box
          border
          borderStyle="rounded"
          borderColor={error ? theme.danger : theme.accent}
          backgroundColor={mix(theme.surfaceAlt, theme.accentSoft, 0.4)}
          height={multiline ? 8 : 5}
        >
          <textarea
            ref={areaRef}
            focused
            initialValue={initial}
            placeholder={placeholder}
            wrapMode="word"
            onContentChange={handleChange}
            backgroundColor="transparent"
            textColor={theme.text}
            placeholderColor={theme.textMuted}
            cursorColor={theme.accent}
          />
        </box>

        {chips && chips.length > 0 ? (
          <box flexDirection="row" paddingTop={1}>
            {chips.map((chip) => (
              <ChipButton
                key={chip.key}
                theme={theme}
                label={`${chip.key} ${chip.label}`}
                onPress={() => deliver(chip.value)}
              />
            ))}
          </box>
        ) : null}

        {error ? (
          <box paddingTop={1}>
            <text fg={theme.danger} attributes={TextAttributes.BOLD}>
              {`⚠ ${error}`}
            </text>
          </box>
        ) : null}

        <box flexDirection="row" paddingTop={1}>
          <Button
            theme={theme}
            label={stayOpen ? "Add" : "Save"}
            primary
            onPress={submit}
          />
          <Button
            theme={theme}
            label={stayOpen ? "Done" : "Cancel"}
            onPress={onCancel}
          />
        </box>
      </box>
    </Overlay>
  );
}

type PaletteItem =
  | { kind: "action"; action: PaletteAction }
  | { kind: "task"; task: Task };

type PaletteLine =
  | { kind: "header"; group: string }
  | { kind: "item"; item: PaletteItem; index: number };

const TASK_GROUP = "Task";

function paletteKey(item: PaletteItem): string {
  return item.kind === "action" ? item.action.id : `task-${item.task.id}`;
}

/** Actions reordered so each group is contiguous, in order of first
 * appearance, which lets the palette print one header per group. */
function groupActions(actions: readonly PaletteAction[]): PaletteAction[] {
  const groups: string[] = [];
  for (const a of actions) if (!groups.includes(a.group)) groups.push(a.group);
  return groups.flatMap((g) => actions.filter((a) => a.group === g));
}

interface CommandPaletteProps {
  theme: TuiTheme;
  actions: PaletteAction[];
  /** Tasks a query can jump to; they follow the matching actions. */
  tasks?: Task[];
  screenWidth: number;
  screenHeight: number;
  onPickTask?: (id: number) => void;
  /** Called with the id of the action that ran, for the Recent group. */
  onRun?: (id: string) => void;
  onClose: () => void;
}

/** Ctrl+K palette: fuzzy-search every action in the app, and every task. */
export function CommandPalette({
  theme,
  actions,
  tasks,
  screenWidth,
  screenHeight,
  onPickTask,
  onRun,
  onClose,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  // Actions and tasks are ranked together, or a command that merely matches
  // as a scattered subsequence would outrank the task whose title was typed.
  // The sort is stable, so an action still wins an exact tie.
  const items = useMemo<PaletteItem[]>(() => {
    if (query === "") {
      return groupActions(actions).map((action) => ({ kind: "action", action }));
    }
    const hits: { item: PaletteItem; score: number }[] = [];
    for (const action of actions) {
      const score = fuzzyScore(query, `${action.group} ${action.label}`);
      if (score !== null) hits.push({ item: { kind: "action", action }, score });
    }
    for (const task of tasks ?? []) {
      const score = fuzzyScore(query, `#${task.id} ${task.title}`);
      if (score !== null) hits.push({ item: { kind: "task", task }, score });
    }
    hits.sort((x, y) => y.score - x.score);
    return hits.map((h) => h.item);
  }, [actions, query, tasks]);

  // Section headers only while the list is grouped; with a query the groups
  // interleave, so each row carries its own dim prefix instead.
  const lines = useMemo<PaletteLine[]>(() => {
    const out: PaletteLine[] = [];
    let last: string | null = null;
    items.forEach((item, i) => {
      if (query === "") {
        const group = item.kind === "action" ? item.action.group : TASK_GROUP;
        if (group !== last) {
          out.push({ kind: "header", group });
          last = group;
        }
      }
      out.push({ kind: "item", item, index: i });
    });
    return out;
  }, [items, query]);

  const selected = Math.min(index, Math.max(items.length - 1, 0));
  const rows = listRows(screenHeight);
  // The window slides over the full line list, so every item stays reachable.
  const selectedLine = lines.findIndex((l) => l.kind === "item" && l.index === selected);
  const windowStart = Math.max(0, selectedLine - (rows - 1));
  const visible = lines.slice(windowStart, windowStart + rows);

  const pick = (item: PaletteItem) => {
    onClose();
    if (item.kind === "action") {
      onRun?.(item.action.id);
      item.action.run();
    } else onPickTask?.(item.task.id);
  };

  useKeyboard((key: KeyEvent) => {
    if (key.name === "escape") {
      onClose();
      return;
    }
    if (key.name === "down" || (key.ctrl && key.name === "n")) {
      setIndex((i) => Math.min(i + 1, items.length - 1));
    }
    if (key.name === "up" || (key.ctrl && key.name === "p")) {
      setIndex((i) => Math.max(i - 1, 0));
    }
    if (key.name === "return") {
      const item = items[selected];
      if (item) pick(item);
    }
  });

  return (
    <Overlay
      theme={theme}
      title="Command palette"
      width={70}
      screenWidth={screenWidth}
      screenHeight={screenHeight}
      footer="↑↓ move · enter run · esc close"
      onBackdropClick={onClose}
    >
      <SearchField
        theme={theme}
        glyph="› "
        placeholder={tasks ? "Type a command or a task…" : "Type a command…"}
        value={query}
        onInput={(v) => {
          setQuery(v);
          setIndex(0);
        }}
      />

      <box flexDirection="column" paddingTop={1}>
        {items.length === 0 ? (
          <text fg={theme.textMuted}>No matching command</text>
        ) : (
          visible.map((line) =>
            line.kind === "header" ? (
              <Section key={`group-${line.group}`} theme={theme} title={line.group} paddingTop={0} />
            ) : (
              <PaletteRow
                key={paletteKey(line.item)}
                theme={theme}
                item={line.item}
                query={query}
                selected={line.index === selected}
                prefixed={query !== ""}
                onPress={() => pick(line.item)}
                onHover={() => setIndex(line.index)}
              />
            ),
          )
        )}
      </box>
    </Overlay>
  );
}

interface SearchFieldProps {
  theme: TuiTheme;
  glyph: string;
  placeholder: string;
  value: string;
  onInput: (value: string) => void;
}

function SearchField({ theme, glyph, placeholder, value, onInput }: SearchFieldProps) {
  return (
    <box
      flexDirection="row"
      border
      borderStyle="rounded"
      borderColor={theme.accent}
      backgroundColor={mix(theme.surfaceAlt, theme.accentSoft, 0.4)}
      height={3}
      paddingLeft={1}
    >
      <text fg={theme.accent} attributes={TextAttributes.BOLD}>
        {glyph}
      </text>
      <box flexGrow={1}>
        <input
          focused
          value={value}
          placeholder={placeholder}
          onInput={onInput}
          backgroundColor="transparent"
          textColor={theme.text}
          placeholderColor={theme.textMuted}
          cursorColor={theme.accent}
        />
      </box>
    </box>
  );
}

interface FuzzyPickerProps<T> {
  theme: TuiTheme;
  title: string;
  subtitle?: string;
  items: readonly T[];
  haystack: (item: T) => string;
  keyOf: (item: T) => string | number;
  placeholder: string;
  emptyText: string;
  screenWidth: number;
  screenHeight: number;
  onPick: (item: T) => void;
  onClose: () => void;
  /** `query` is the live search text, so a row can light its matches. */
  renderRow: (item: T, selected: boolean, query: string) => ReactNode;
}

/** Search field over a list, shared by the task and tag pickers. */
function FuzzyPicker<T>({
  theme,
  title,
  subtitle,
  items,
  haystack,
  keyOf,
  placeholder,
  emptyText,
  screenWidth,
  screenHeight,
  onPick,
  onClose,
  renderRow,
}: FuzzyPickerProps<T>) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const results = useMemo(() => rank(items, query, haystack), [haystack, items, query]);

  const selected = Math.min(index, Math.max(results.length - 1, 0));
  const rows = listRows(screenHeight);
  const windowStart = Math.max(0, selected - (rows - 1));
  const visible = results.slice(windowStart, windowStart + rows);

  useKeyboard((key: KeyEvent) => {
    if (key.name === "escape") {
      onClose();
      return;
    }
    if (key.name === "down" || (key.ctrl && key.name === "n")) {
      setIndex((i) => Math.min(i + 1, results.length - 1));
    }
    if (key.name === "up" || (key.ctrl && key.name === "p")) {
      setIndex((i) => Math.max(i - 1, 0));
    }
    if (key.name === "return") {
      const item = results[selected];
      if (item !== undefined) onPick(item);
    }
  });

  return (
    <Overlay
      theme={theme}
      title={title}
      subtitle={subtitle}
      width={70}
      screenWidth={screenWidth}
      screenHeight={screenHeight}
      footer="↑↓ move · enter pick · esc close"
      onBackdropClick={onClose}
    >
      <SearchField
        theme={theme}
        glyph="⌕ "
        placeholder={placeholder}
        value={query}
        onInput={(v) => {
          setQuery(v);
          setIndex(0);
        }}
      />

      <box flexDirection="column" paddingTop={1}>
        {results.length === 0 ? (
          <text fg={theme.textMuted}>{emptyText}</text>
        ) : (
          visible.map((item, i) => {
            const isSelected = windowStart + i === selected;
            return (
              <box
                key={keyOf(item)}
                flexDirection="row"
                backgroundColor={isSelected ? theme.selectionBg : undefined}
                onMouseOver={() => setIndex(windowStart + i)}
                onMouseDown={() => onPick(item)}
              >
                <text
                  flexShrink={0}
                  fg={isSelected ? theme.accent : theme.borderSubtle}
                >
                  {isSelected ? "┃ " : "│ "}
                </text>
                {renderRow(item, isSelected, query)}
              </box>
            );
          })
        )}
      </box>
    </Overlay>
  );
}

interface TaskPickerDialogProps {
  theme: TuiTheme;
  title: string;
  subtitle?: string;
  tasks: Task[];
  screenWidth: number;
  screenHeight: number;
  onPick: (taskId: number) => void;
  onClose: () => void;
}

const taskHaystack = (t: Task) => `${t.title} ${t.tags.join(" ")}`;
const taskKey = (t: Task) => t.id;

/** Fuzzy task chooser used for picking blockers. */
export function TaskPickerDialog({
  theme,
  title,
  subtitle,
  tasks,
  screenWidth,
  screenHeight,
  onPick,
  onClose,
}: TaskPickerDialogProps) {
  return (
    <FuzzyPicker
      theme={theme}
      title={title}
      subtitle={subtitle}
      items={tasks}
      haystack={taskHaystack}
      keyOf={taskKey}
      placeholder="Type to filter tasks…"
      emptyText="No matching task"
      screenWidth={screenWidth}
      screenHeight={screenHeight}
      onPick={(task) => onPick(task.id)}
      onClose={onClose}
      renderRow={(task, isSelected, query) => {
        const tone =
          task.status === Status.Done
            ? theme.textMuted
            : isSelected
              ? theme.text
              : theme.textDim;
        const attributes = isSelected ? TextAttributes.BOLD : undefined;
        // Ranked on the title and its tags; a hit on a tag alone lights
        // nothing, which is honest about where the match was.
        const lit = fuzzyIndices(query, task.title) ?? [];
        return (
          <>
            <text flexShrink={0} fg={theme.textMuted}>
              {`#${task.id}`.padEnd(5)}
            </text>
            <text
              fg={tone}
              attributes={attributes}
              flexGrow={1}
              wrapMode="none"
              truncate
            >
              {highlightSpans(task.title, lit, tone, theme.accent, attributes)}
            </text>
          </>
        );
      }}
    />
  );
}

export interface TagCount {
  tag: string;
  count: number;
}

/** `tag: null` is the "all" row, which clears the tag filter. */
type TagRow = { tag: string | null; count: number };

interface TagPickerDialogProps {
  theme: TuiTheme;
  title?: string;
  subtitle?: string;
  tags: TagCount[];
  screenWidth: number;
  screenHeight: number;
  onPick: (tag: string | null) => void;
  onClose: () => void;
}

const tagHaystack = (row: TagRow) => row.tag ?? "all";
const tagKey = (row: TagRow) => row.tag ?? "*";

/** Fuzzy tag chooser for the tag filter; "all" leads the list. */
export function TagPickerDialog({
  theme,
  title = "Filter by tag",
  subtitle,
  tags,
  screenWidth,
  screenHeight,
  onPick,
  onClose,
}: TagPickerDialogProps) {
  const rows = useMemo<TagRow[]>(
    () => [{ tag: null, count: 0 }, ...tags],
    [tags],
  );

  return (
    <FuzzyPicker
      theme={theme}
      title={title}
      subtitle={subtitle}
      items={rows}
      haystack={tagHaystack}
      keyOf={tagKey}
      placeholder="Type to filter tags…"
      emptyText="No matching tag"
      screenWidth={screenWidth}
      screenHeight={screenHeight}
      onPick={(row) => onPick(row.tag)}
      onClose={onClose}
      renderRow={(row, isSelected, query) => {
        const tone = isSelected ? theme.text : theme.textDim;
        const attributes = isSelected ? TextAttributes.BOLD : undefined;
        const label = row.tag === null ? "all" : `#${row.tag}`;
        // The row prints a "#" the haystack does not carry.
        const lit = (fuzzyIndices(query, tagHaystack(row)) ?? []).map(
          (i) => (row.tag === null ? i : i + 1),
        );
        return (
        <>
          <text
            fg={tone}
            attributes={attributes}
            flexGrow={1}
            wrapMode="none"
            truncate
          >
            {highlightSpans(label, lit, tone, theme.accent, attributes)}
          </text>
          <text flexShrink={0} fg={theme.textMuted}>
            {row.tag === null ? "clear filter" : String(row.count)}
          </text>
        </>
        );
      }}
    />
  );
}

function PaletteRow({
  theme,
  item,
  query,
  selected,
  prefixed,
  onPress,
  onHover,
}: {
  theme: TuiTheme;
  item: PaletteItem;
  query: string;
  selected: boolean;
  /** Print the group before the label; otherwise rows sit under a header. */
  prefixed: boolean;
  onPress: () => void;
  onHover: () => void;
}) {
  const group = item.kind === "action" ? item.action.group : TASK_GROUP;
  const label = item.kind === "action" ? item.action.label : item.task.title;
  const hint = item.kind === "action" ? item.action.hint : undefined;
  // Ranked against "group label" or "#id title"; only the label is drawn,
  // so its hits are re-based on it.
  const lit =
    item.kind === "action"
      ? fuzzyIndicesAfter(query, `${group} `, label)
      : fuzzyIndicesAfter(query, `#${item.task.id} `, label);
  const tone = selected ? theme.text : theme.textDim;
  const attributes = selected ? TextAttributes.BOLD : undefined;
  return (
    <box
      flexDirection="row"
      paddingLeft={prefixed ? 0 : 2}
      backgroundColor={selected ? theme.selectionBg : undefined}
      onMouseOver={onHover}
      onMouseDown={onPress}
    >
      <text flexShrink={0} fg={selected ? theme.accent : theme.borderSubtle}>
        {selected ? "┃ " : "│ "}
      </text>
      {prefixed ? (
        <text flexShrink={0} fg={theme.textMuted}>
          {group.padEnd(8)}
        </text>
      ) : null}
      {item.kind === "task" ? (
        <text flexShrink={0} fg={theme.textMuted}>
          {`#${item.task.id}`.padEnd(5)}
        </text>
      ) : null}
      <text
        fg={tone}
        attributes={attributes}
        flexGrow={1}
        wrapMode="none"
        truncate
      >
        {highlightSpans(label, lit, tone, theme.accent, attributes)}
      </text>
      {hint ? (
        <box backgroundColor={theme.surfaceAlt} paddingLeft={1} paddingRight={1}>
          <text fg={theme.textMuted}>{hint}</text>
        </box>
      ) : null}
    </box>
  );
}
