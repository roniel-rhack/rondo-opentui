import { TextAttributes, type KeyEvent, type TextareaRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Status, type Task } from "../../core/task/task.ts";
import { fuzzyScore } from "../state.ts";
import { mix, type TuiTheme } from "../theme.ts";
import { Button, Overlay } from "./Overlay.tsx";

interface ConfirmDialogProps {
  theme: TuiTheme;
  title: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  danger?: boolean;
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
  detail,
  confirmLabel = "Delete",
  danger = true,
  screenWidth,
  screenHeight,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useKeyboard((key: KeyEvent) => {
    if (key.name === "escape" || key.name === "n") onCancel();
    // Enter is too easy to press by reflex to let it destroy things; only
    // an explicit y confirms a destructive dialog.
    if (key.name === "y" || (key.name === "return" && !danger)) onConfirm();
  });

  return (
    <Overlay
      theme={theme}
      title={title}
      width={58}
      screenWidth={screenWidth}
      screenHeight={screenHeight}
      accent={danger ? theme.danger : theme.accent}
      footer={danger ? "y confirm · n / esc cancel" : "y / enter confirm · n cancel"}
      onBackdropClick={onCancel}
    >
      <box paddingTop={1} paddingBottom={1} flexDirection="column">
        <text fg={theme.text} wrapMode="word">
          {message}
        </text>
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
        <Button
          theme={theme}
          label={confirmLabel}
          danger={danger}
          primary={!danger}
          onPress={onConfirm}
        />
        <Button theme={theme} label="Cancel" onPress={onCancel} />
      </box>
    </Overlay>
  );
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
  screenWidth: number;
  screenHeight: number;
  onSubmit: (value: string) => void;
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
  screenWidth,
  screenHeight,
  onSubmit,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const areaRef = useRef<TextareaRenderable | null>(null);
  const lastText = useRef(initial);

  // Editing continues at the end, like an input would.
  useEffect(() => {
    const area = areaRef.current;
    if (area) area.cursorOffset = area.plainText.length;
  }, []);

  const currentValue = () => areaRef.current?.plainText ?? value;

  const submit = () => {
    const text = currentValue().trim();
    if (text === "") {
      setError("Cannot be empty");
      return;
    }
    onSubmit(text);
  };

  useKeyboard((key: KeyEvent) => {
    if (key.name === "escape") onCancel();
    if (key.ctrl && key.name === "s") submit();
    if (!multiline && key.name === "return") submit();
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
      const collapsed = text.replace(/\s*\n\s*/g, " ");
      const flat = collapsed.trim() === "" ? "" : collapsed;
      area.setText(flat);
      area.cursorOffset = flat.length;
      return;
    }
    setValue(text);
    if (text !== lastText.current) {
      lastText.current = text;
      setError(null);
    }
  };

  return (
    <Overlay
      theme={theme}
      title={title}
      subtitle={label}
      width={64}
      screenWidth={screenWidth}
      screenHeight={screenHeight}
      footer={
        multiline
          ? "ctrl+s save · enter new line · esc cancel"
          : "enter save · esc cancel"
      }
      onBackdropClick={onCancel}
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

        {error ? (
          <box paddingTop={1}>
            <text fg={theme.danger} attributes={TextAttributes.BOLD}>
              {`⚠ ${error}`}
            </text>
          </box>
        ) : null}

        <box flexDirection="row" paddingTop={1}>
          <Button theme={theme} label="Save" primary onPress={submit} />
          <Button theme={theme} label="Cancel" onPress={onCancel} />
        </box>
      </box>
    </Overlay>
  );
}

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  group: string;
  run: () => void;
}

interface CommandPaletteProps {
  theme: TuiTheme;
  actions: PaletteAction[];
  screenWidth: number;
  screenHeight: number;
  onClose: () => void;
}

/** Ctrl+K palette: fuzzy-search every action in the app. */
export function CommandPalette({
  theme,
  actions,
  screenWidth,
  screenHeight,
  onClose,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const results = useMemo(() => {
    if (query === "") return actions;
    return actions
      .map((a) => ({ a, score: fuzzyScore(query, `${a.group} ${a.label}`) }))
      .filter((r) => r.score !== null)
      .sort((x, y) => (y.score ?? 0) - (x.score ?? 0))
      .map((r) => r.a);
  }, [actions, query]);

  const selected = Math.min(index, Math.max(results.length - 1, 0));
  // Ten rows slide over the full result list, so every action stays reachable.
  const windowStart = Math.max(0, selected - 9);
  const visible = results.slice(windowStart, windowStart + 10);

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
      const action = results[selected];
      if (action) {
        onClose();
        action.run();
      }
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
          {"› "}
        </text>
        <box flexGrow={1}>
          <input
            focused
            value={query}
            placeholder="Type a command…"
            onInput={(v) => {
              setQuery(v);
              setIndex(0);
            }}
            backgroundColor="transparent"
            textColor={theme.text}
            placeholderColor={theme.textMuted}
            cursorColor={theme.accent}
          />
        </box>
      </box>

      <box flexDirection="column" paddingTop={1}>
        {results.length === 0 ? (
          <text fg={theme.textMuted}>No matching command</text>
        ) : (
          visible.map((action, i) => (
            <PaletteRow
              key={action.id}
              theme={theme}
              action={action}
              selected={windowStart + i === selected}
              onPress={() => {
                onClose();
                action.run();
              }}
              onHover={() => setIndex(windowStart + i)}
            />
          ))
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
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const results = useMemo(() => {
    if (query === "") return tasks;
    return tasks
      .map((t) => ({
        t,
        score: fuzzyScore(query, `${t.title} ${t.tags.join(" ")}`),
      }))
      .filter((r) => r.score !== null)
      .sort((x, y) => (y.score ?? 0) - (x.score ?? 0))
      .map((r) => r.t);
  }, [query, tasks]);

  const selected = Math.min(index, Math.max(results.length - 1, 0));
  const windowStart = Math.max(0, selected - 9);
  const visible = results.slice(windowStart, windowStart + 10);

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
      const task = results[selected];
      if (task) onPick(task.id);
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
          {"⌕ "}
        </text>
        <box flexGrow={1}>
          <input
            focused
            value={query}
            placeholder="Type to filter tasks…"
            onInput={(v) => {
              setQuery(v);
              setIndex(0);
            }}
            backgroundColor="transparent"
            textColor={theme.text}
            placeholderColor={theme.textMuted}
            cursorColor={theme.accent}
          />
        </box>
      </box>

      <box flexDirection="column" paddingTop={1}>
        {results.length === 0 ? (
          <text fg={theme.textMuted}>No matching task</text>
        ) : (
          visible.map((task, i) => {
            const isSelected = windowStart + i === selected;
            return (
              <box
                key={task.id}
                flexDirection="row"
                backgroundColor={isSelected ? theme.selectionBg : undefined}
                onMouseOver={() => setIndex(windowStart + i)}
                onMouseDown={() => onPick(task.id)}
              >
                <text
                  flexShrink={0}
                  fg={isSelected ? theme.accent : theme.borderSubtle}
                >
                  {isSelected ? "┃ " : "│ "}
                </text>
                <text flexShrink={0} fg={theme.textMuted}>
                  {`#${task.id}`.padEnd(5)}
                </text>
                <text
                  fg={
                    task.status === Status.Done
                      ? theme.textMuted
                      : isSelected
                        ? theme.text
                        : theme.textDim
                  }
                  attributes={isSelected ? TextAttributes.BOLD : undefined}
                  flexGrow={1}
                  wrapMode="none"
                  truncate
                >
                  {task.title}
                </text>
              </box>
            );
          })
        )}
      </box>
    </Overlay>
  );
}

function PaletteRow({
  theme,
  action,
  selected,
  onPress,
  onHover,
}: {
  theme: TuiTheme;
  action: PaletteAction;
  selected: boolean;
  onPress: () => void;
  onHover: () => void;
}) {
  return (
    <box
      flexDirection="row"
      backgroundColor={selected ? theme.selectionBg : undefined}
      onMouseOver={onHover}
      onMouseDown={onPress}
    >
      <text flexShrink={0} fg={selected ? theme.accent : theme.borderSubtle}>
        {selected ? "┃ " : "│ "}
      </text>
      <text flexShrink={0} fg={theme.textMuted}>{`${action.group.padEnd(8)}`}</text>
      <text
        fg={selected ? theme.text : theme.textDim}
        attributes={selected ? TextAttributes.BOLD : undefined}
        flexGrow={1}
        wrapMode="none"
        truncate
      >
        {action.label}
      </text>
      {action.hint ? (
        <box backgroundColor={theme.surfaceAlt} paddingLeft={1} paddingRight={1}>
          <text fg={theme.textMuted}>{action.hint}</text>
        </box>
      ) : null}
    </box>
  );
}
