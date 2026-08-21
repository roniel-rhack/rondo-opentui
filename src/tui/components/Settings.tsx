import { TextAttributes, type KeyEvent } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useState, type ReactNode } from "react";
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

  const themeIndex = NUMBER_FIELDS.length + BOOL_FIELDS.length;
  const total = themeIndex + 1;

  const adjust = (delta: number) => {
    if (index < NUMBER_FIELDS.length) {
      const field = NUMBER_FIELDS[index]!;
      const next = Math.min(
        Math.max(field.get(draft) + delta, field.min),
        field.max,
      );
      setDraft(field.set(draft, next));
      return;
    }
    if (index < themeIndex) {
      const field = BOOL_FIELDS[index - NUMBER_FIELDS.length]!;
      setDraft(field.set(draft, !field.get(draft)));
      return;
    }
    const at = THEME_VALUES.indexOf(draft.theme as (typeof THEME_VALUES)[number]);
    const next =
      THEME_VALUES[
        (Math.max(at, 0) + delta + THEME_VALUES.length) % THEME_VALUES.length
      ]!;
    setDraft({ ...draft, theme: next });
  };

  useKeyboard((key: KeyEvent) => {
    switch (key.name) {
      case "escape":
        onCancel();
        break;
      case "down":
      case "j":
        setIndex((i) => Math.min(i + 1, total - 1));
        break;
      case "up":
      case "k":
        setIndex((i) => Math.max(i - 1, 0));
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
      case "return":
        onSave(draft);
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
      flexDirection="row"
      backgroundColor={rowIndex === index ? theme.selectionBg : undefined}
      onMouseDown={() => setIndex(rowIndex)}
    >
      <text fg={rowIndex === index ? theme.accent : theme.textMuted}>
        {rowIndex === index ? "▌ " : "  "}
      </text>
      <text fg={theme.text} flexGrow={1}>
        {label}
      </text>
      {value}
    </box>
  );

  const stepper = (value: string) => (
    <>
      <text fg={theme.textMuted}>{"← "}</text>
      <text fg={theme.accent} attributes={TextAttributes.BOLD}>
        {value.padStart(5)}
      </text>
      <text fg={theme.textMuted}>{" →"}</text>
    </>
  );

  // Booleans read as toggles, matching the subtask checkboxes; arrows would
  // suggest a range they do not have.
  const toggle = (on: boolean) => (
    <text
      fg={on ? theme.success : theme.textMuted}
      attributes={on ? TextAttributes.BOLD : undefined}
    >
      {on ? "▣ on " : "▢ off"}
    </text>
  );

  return (
    <Overlay
      theme={theme}
      title="Settings"
      width={58}
      screenWidth={screenWidth}
      screenHeight={screenHeight}
      footer="↑↓ field · ←→ / space change · enter save · esc cancel"
      onBackdropClick={onCancel}
    >
      <box flexDirection="column" paddingTop={1}>
        {NUMBER_FIELDS.map((f, i) =>
          row(f.id, f.label, stepper(String(f.get(draft))), i),
        )}
        {BOOL_FIELDS.map((f, i) =>
          row(f.id, f.label, toggle(f.get(draft)), NUMBER_FIELDS.length + i),
        )}
        {row("theme", "Theme", stepper(themeLabel(draft.theme)), themeIndex)}
      </box>
      <box flexDirection="row" paddingTop={1}>
        <Button theme={theme} label="Save" primary onPress={() => onSave(draft)} />
        <Button theme={theme} label="Cancel" onPress={onCancel} />
      </box>
    </Overlay>
  );
}
