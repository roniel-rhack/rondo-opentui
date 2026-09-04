import { TextAttributes, type InputRenderable, type KeyEvent, type ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Config } from "../../core/config/config.ts";
import type { TuiTheme } from "../theme.ts";
import { Button, Overlay } from "./Overlay.tsx";

interface SettingsOverlayProps {
  theme: TuiTheme;
  cfg: Config;
  screenWidth: number;
  screenHeight: number;
  onSave: (cfg: Config) => void;
  onCancel: () => void;
}

interface NumberField {
  id: string;
  label: string;
  min: number;
  max: number;
  get: (c: Config) => number;
  set: (c: Config, v: number) => Config;
}

interface BoolField {
  id: string;
  label: string;
  get: (c: Config) => boolean;
  set: (c: Config, v: boolean) => Config;
}

const NUMBER_FIELDS: NumberField[] = [
  {
    id: "work",
    label: "Work duration (min)",
    min: 1,
    max: 120,
    get: (c) => c.focus.workDuration,
    set: (c, v) => ({ ...c, focus: { ...c.focus, workDuration: v } }),
  },
  {
    id: "short",
    label: "Short break (min)",
    min: 1,
    max: 60,
    get: (c) => c.focus.shortBreakDuration,
    set: (c, v) => ({ ...c, focus: { ...c.focus, shortBreakDuration: v } }),
  },
  {
    id: "long",
    label: "Long break (min)",
    min: 1,
    max: 120,
    get: (c) => c.focus.longBreakDuration,
    set: (c, v) => ({ ...c, focus: { ...c.focus, longBreakDuration: v } }),
  },
  {
    id: "interval",
    label: "Sessions per long break",
    min: 1,
    max: 10,
    get: (c) => c.focus.longBreakInterval,
    set: (c, v) => ({ ...c, focus: { ...c.focus, longBreakInterval: v } }),
  },
  {
    id: "goal",
    label: "Daily goal",
    min: 1,
    max: 100,
    get: (c) => c.focus.dailyGoal,
    set: (c, v) => ({ ...c, focus: { ...c.focus, dailyGoal: v } }),
  },
];

const BOOL_FIELDS: BoolField[] = [
  {
    id: "auto",
    label: "Auto-start breaks",
    get: (c) => c.focus.autoStartBreak,
    set: (c, v) => ({ ...c, focus: { ...c.focus, autoStartBreak: v } }),
  },
  {
    id: "sound",
    label: "Sound on completion",
    get: (c) => c.focus.sound,
    set: (c, v) => ({ ...c, focus: { ...c.focus, sound: v } }),
  },
];

/** Theme preference cycles auto → dark → light. "" means auto. */
const THEME_VALUES = ["", "dark", "light"] as const;
const themeLabel = (v: string) => (v === "" ? "auto" : v);

/** Pomodoro settings, persisted to ~/.todo-app/config.json on save. */
export function SettingsOverlay({
  theme,
  cfg,
  screenWidth,
  screenHeight,
  onSave,
  onCancel,
}: SettingsOverlayProps) {
  const [draft, setDraft] = useState<Config>(cfg);
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState<{ index: number; text: string; select: boolean } | null>(null);
  const editingRef = useRef(editing);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<InputRenderable | null>(null);
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const renderer = useRenderer();

  const themeIndex = NUMBER_FIELDS.length + BOOL_FIELDS.length;
  const total = themeIndex + 1;
  const stacked = screenWidth < 50;

  const updateEditing = (next: typeof editing) => {
    editingRef.current = next;
    setEditing(next);
  };

  useEffect(() => {
    const input = inputRef.current;
    if (!input || !editing) return;
    if (editing.select) input.selectAll();
    else input.cursorOffset = input.plainText.length;
  }, [editing?.index]);

  useEffect(() => {
    const reveal = () => scrollRef.current?.scrollChildIntoView(`settings-${index}`);
    renderer.root.on("layout-changed", reveal);
    reveal();
    return () => { renderer.root.off("layout-changed", reveal); };
  }, [renderer, index, screenHeight, error]);

  const pendingDraft = () => {
    const active = editingRef.current;
    if (!active) return draft;
    const field = NUMBER_FIELDS[active.index]!;
    const raw = inputRef.current?.value ?? active.text;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || value < field.min || value > field.max) {
      setError(`${field.label}: ${field.min}–${field.max}`);
      return null;
    }
    return field.set(draft, value);
  };

  const commitNumber = () => {
    const next = pendingDraft();
    if (!next) return null;
    setDraft(next);
    updateEditing(null);
    setError(null);
    return next;
  };

  const save = () => {
    const next = pendingDraft();
    if (next) onSave(next);
  };

  const select = (next: number) => {
    if (editing?.index === next) return;
    if (commitNumber()) setIndex(next);
  };

  const editNumber = (at: number, text?: string) => {
    if (editing?.index === at) return;
    const base = commitNumber();
    if (!base) return;
    setIndex(at);
    updateEditing({ index: at, text: text ?? String(NUMBER_FIELDS[at]!.get(base)), select: text === undefined });
  };

  const adjust = (delta: number, at = index) => {
    const base = commitNumber();
    if (!base) return;
    setIndex(at);
    if (at < NUMBER_FIELDS.length) {
      const field = NUMBER_FIELDS[at]!;
      const next = Math.min(
        Math.max(field.get(base) + delta, field.min),
        field.max,
      );
      setDraft(field.set(base, next));
      return;
    }
    if (at < themeIndex) {
      const field = BOOL_FIELDS[at - NUMBER_FIELDS.length]!;
      setDraft(field.set(base, !field.get(base)));
      return;
    }
    const current = THEME_VALUES.indexOf(base.theme as (typeof THEME_VALUES)[number]);
    const next =
      THEME_VALUES[
        (Math.max(current, 0) + delta + THEME_VALUES.length) % THEME_VALUES.length
      ]!;
    setDraft({ ...base, theme: next });
  };

  // A stray click on the scrim only closes the dialog while nothing changed.
  const pristine = !editing && JSON.stringify(draft) === JSON.stringify(cfg);

  useKeyboard((key: KeyEvent) => {
    if (key.ctrl && key.name === "s") {
      key.preventDefault();
      save();
      return;
    }
    if (key.name === "return") {
      key.preventDefault();
      save();
      return;
    }
    if (key.name === "tab") {
      key.preventDefault();
      select((index + (key.shift ? -1 : 1) + total) % total);
      return;
    }
    if (editingRef.current && !inputRef.current && /^\d$/.test(key.sequence)) {
      key.preventDefault();
      updateEditing({ ...editingRef.current, text: editingRef.current.text + key.sequence });
      return;
    }
    if (editing && !["escape", "down", "up"].includes(key.name)) return;
    if (!key.ctrl && /^\d$/.test(key.sequence) && index < NUMBER_FIELDS.length) {
      key.preventDefault();
      editNumber(index, key.sequence);
      return;
    }
    switch (key.name) {
      case "escape":
        onCancel();
        break;
      case "down":
      case "j":
        key.preventDefault();
        select(Math.min(index + 1, total - 1));
        break;
      case "up":
      case "k":
        key.preventDefault();
        select(Math.max(index - 1, 0));
        break;
      case "left":
      case "h":
        adjust(-1);
        break;
      case "right":
      case "l":
        adjust(1);
        break;
      case "space":
        adjust(1);
        break;
      default:
        break;
    }
  });

  const row = (
    id: string,
    label: string,
    value: ReactNode,
    rowIndex: number,
  ) => (
    <box
      key={id}
      id={`settings-${rowIndex}`}
      flexDirection={stacked ? "column" : "row"}
      flexShrink={0}
      backgroundColor={rowIndex === index ? theme.selectionBg : undefined}
      onMouseDown={() => select(rowIndex)}
    >
      <box flexDirection="row" flexGrow={stacked ? undefined : 1} minWidth={0} flexShrink={0}>
        <text flexShrink={0} fg={rowIndex === index ? theme.accent : theme.textMuted}>
          {rowIndex === index ? "▌ " : "  "}
        </text>
        <text fg={theme.text} flexGrow={1} wrapMode="none">
          {label}
        </text>
      </box>
      <box flexDirection="row" flexShrink={0} paddingLeft={stacked ? 2 : 0}>
        {value}
      </box>
    </box>
  );

  const stepper = (value: string, at: number) => (
    <>
      <box flexShrink={0} onMouseDown={(event) => { event.stopPropagation(); adjust(-1, at); }}>
        <text fg={theme.textMuted}>{"← "}</text>
      </box>
      {editing?.index === at ? (
        <input ref={inputRef} focused width={5} value={editing.text}
          onInput={(text) => { updateEditing({ ...editing, text }); setError(null); }}
          backgroundColor={theme.surfaceAlt} textColor={theme.accent} cursorColor={theme.accent} />
      ) : (
        <box width={5} flexShrink={0} onMouseDown={(event) => {
          event.stopPropagation();
          if (at < NUMBER_FIELDS.length) editNumber(at);
          else adjust(1, at);
        }}>
          <text fg={theme.accent} attributes={TextAttributes.BOLD}>{value.padStart(5)}</text>
        </box>
      )}
      <box flexShrink={0} onMouseDown={(event) => { event.stopPropagation(); adjust(1, at); }}>
        <text fg={theme.textMuted}>{" →"}</text>
      </box>
    </>
  );

  // Booleans read as toggles, matching the subtask checkboxes; arrows would
  // suggest a range they do not have.
  const toggle = (on: boolean, at: number) => (
    <box flexShrink={0} onMouseDown={(event) => { event.stopPropagation(); adjust(1, at); }}>
      <text
      fg={on ? theme.success : theme.textMuted}
      attributes={on ? TextAttributes.BOLD : undefined}
    >
      {on ? "▣ on " : "▢ off"}
      </text>
    </box>
  );

  return (
    <Overlay
      theme={theme}
      title="Settings"
      width={70}
      height={17}
      screenWidth={screenWidth}
      screenHeight={screenHeight}
      footer="↑↓ field · type value · ←→ change · enter save · esc cancel"
      onBackdropClick={pristine ? onCancel : undefined}
      onClose={onCancel}
    >
      <scrollbox ref={scrollRef} focused={false} flexGrow={1} minHeight={0} scrollX={false}
        contentOptions={{ flexDirection: "column", paddingTop: 1 }}>
        {NUMBER_FIELDS.map((f, i) =>
          row(f.id, f.label, stepper(String(f.get(draft)), i), i),
        )}
        {BOOL_FIELDS.map((f, i) =>
          row(f.id, f.label, toggle(f.get(draft), NUMBER_FIELDS.length + i), NUMBER_FIELDS.length + i),
        )}
        {row("theme", "Theme", stepper(themeLabel(draft.theme), themeIndex), themeIndex)}
      </scrollbox>
      {error ? <text fg={theme.danger} flexShrink={0}>{error}</text> : null}
      <box flexDirection="row" paddingTop={1} flexShrink={0}>
        <Button theme={theme} label="Save" primary onPress={save} />
        <Button theme={theme} label="Cancel" onPress={onCancel} />
      </box>
    </Overlay>
  );
}
