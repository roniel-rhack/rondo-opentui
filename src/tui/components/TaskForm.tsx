import { TextAttributes, type KeyEvent } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useRef, useState, type ReactNode } from "react";
import type { TextareaRenderable } from "@opentui/core";
import { RecurFreq, recurFreqString } from "../../core/task/recur.ts";
import { Priority, priorityString } from "../../core/task/task.ts";
import { DateOnly, GoTime, parseDateOnly } from "../../core/time.ts";
import { mix, priorityColors, type TuiTheme } from "../theme.ts";
import { Button, Overlay } from "./Overlay.tsx";

export interface TaskFormValues {
  title: string;
  description: string;
  priority: Priority;
  due: string;
  tags: string;
  recur: RecurFreq;
}

export const emptyTaskForm: TaskFormValues = {
  title: "",
  description: "",
  priority: Priority.Low,
  due: "",
  tags: "",
  recur: RecurFreq.None,
};

interface TaskFormProps {
  theme: TuiTheme;
  title: string;
  initial: TaskFormValues;
  screenWidth: number;
  screenHeight: number;
  onSubmit: (values: TaskFormValues) => void;
  onCancel: () => void;
}

const FIELDS = [
  "title",
  "description",
  "due",
  "tags",
  "priority",
  "recur",
] as const;
type FieldId = (typeof FIELDS)[number];

const PRIORITIES = [
  Priority.Low,
  Priority.Medium,
  Priority.High,
  Priority.Urgent,
];
const RECURRENCES = [
  RecurFreq.None,
  RecurFreq.Daily,
  RecurFreq.Weekly,
  RecurFreq.Monthly,
  RecurFreq.Yearly,
];

/** Compact labels so the segmented control fits next to Priority. */
const RECUR_LABELS: Record<number, string> = {
  [RecurFreq.None]: "none",
  [RecurFreq.Daily]: "day",
  [RecurFreq.Weekly]: "week",
  [RecurFreq.Monthly]: "month",
  [RecurFreq.Yearly]: "year",
};

/** Quick presets so a due date rarely needs typing. */
const DATE_SHORTCUTS: { label: string; days: number | null }[] = [
  { label: "today", days: 0 },
  { label: "tomorrow", days: 1 },
  { label: "+1w", days: 7 },
  { label: "none", days: null },
];

function validate(values: TaskFormValues): string | null {
  if (values.title.trim() === "") return "Title is required";
  if (values.due.trim() !== "") {
    try {
      parseDateOnly(values.due.trim(), "utc");
    } catch {
      return "Due date must be YYYY-MM-DD";
    }
  }
  return null;
}

/** Modal form used for creating and editing tasks. */
export function TaskForm({
  theme,
  title,
  initial,
  screenWidth,
  screenHeight,
  onSubmit,
  onCancel,
}: TaskFormProps) {
  const [values, setValues] = useState<TaskFormValues>(initial);
  const descriptionRef = useRef<TextareaRenderable | null>(null);
  const [fieldIndex, setFieldIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const field: FieldId = FIELDS[fieldIndex] ?? "title";
  const focus = (id: FieldId) => setFieldIndex(FIELDS.indexOf(id));

  const submit = () => {
    // The textarea owns its buffer, so read the latest text straight from it.
    const description = descriptionRef.current?.plainText ?? values.description;
    const values2 = { ...values, description };
    setValues(values2);

    const problem = validate(values2);
    if (problem) {
      setError(problem);
      return;
    }
    onSubmit(values2);
  };

  const cycle = (delta: number) => {
    if (field === "priority") {
      const idx = PRIORITIES.indexOf(values.priority);
      const next = (idx + delta + PRIORITIES.length) % PRIORITIES.length;
      setValues({ ...values, priority: PRIORITIES[next]! });
    } else if (field === "recur") {
      const idx = RECURRENCES.indexOf(values.recur);
      const next = (idx + delta + RECURRENCES.length) % RECURRENCES.length;
      setValues({ ...values, recur: RECURRENCES[next]! });
    }
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
    if (key.name === "tab") {
      setFieldIndex(
        (i) => (i + (key.shift ? -1 : 1) + FIELDS.length) % FIELDS.length,
      );
      return;
    }
    // Arrow keys navigate between fields, except inside the textarea where they
    // belong to the editor.
    if (field !== "description") {
      if (key.name === "down") {
        setFieldIndex((i) => Math.min(i + 1, FIELDS.length - 1));
        return;
      }
      if (key.name === "up") {
        setFieldIndex((i) => Math.max(i - 1, 0));
        return;
      }
    }
    if (field === "priority" || field === "recur") {
      if (key.name === "left") cycle(-1);
      if (key.name === "right") cycle(1);
      if (key.name === "space") cycle(1);
      if (key.name === "return") submit();
    }
  });

  const label = (id: FieldId, text: string, hint?: string) => (
    <box flexDirection="row">
      <text
        fg={field === id ? theme.accent : theme.textMuted}
        attributes={field === id ? TextAttributes.BOLD : undefined}
      >
        {text}
      </text>
      {hint ? <text fg={theme.textMuted}>{`  ${hint}`}</text> : null}
    </box>
  );

  const frame = (id: FieldId, height: number, children: ReactNode) => (
    <box
      border
      borderStyle="rounded"
      borderColor={field === id ? theme.accent : theme.border}
      backgroundColor={
        field === id ? mix(theme.surfaceAlt, theme.accentSoft, 0.5) : theme.surfaceAlt
      }
      height={height}
      onMouseDown={() => focus(id)}
    >
      {children}
    </box>
  );

  const textInput = (
    id: FieldId,
    placeholder: string,
    value: string,
    onInput: (v: string) => void,
  ) =>
    frame(
      id,
      3,
      <input
        focused={field === id}
        value={value}
        placeholder={placeholder}
        onInput={onInput}
        onSubmit={submit}
        backgroundColor="transparent"
        textColor={theme.text}
        placeholderColor={theme.textMuted}
        cursorColor={theme.accent}
      />,
    );

  const segmented = (
    id: FieldId,
    options: { label: string; active: boolean; color: string; onPress: () => void }[],
  ) => (
    <box
      flexDirection="row"
      border
      borderStyle="rounded"
      borderColor={field === id ? theme.accent : theme.border}
      backgroundColor={theme.surfaceAlt}
      height={3}
      paddingLeft={1}
      paddingRight={1}
      onMouseDown={() => focus(id)}
    >
      {options.map((option) => (
        <box
          key={option.label}
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={option.active ? option.color : undefined}
          onMouseDown={() => {
            focus(id);
            option.onPress();
          }}
        >
          <text
            fg={option.active ? theme.textOn : theme.textDim}
            attributes={option.active ? TextAttributes.BOLD : undefined}
          >
            {option.label}
          </text>
        </box>
      ))}
    </box>
  );

  return (
    <Overlay
      theme={theme}
      title={title}
      subtitle="tab move · ←→ choose · ctrl+s save"
      width={76}
      height={Math.min(screenHeight - 2, 26)}
      screenWidth={screenWidth}
      screenHeight={screenHeight}
      footer="tab / shift+tab field · ctrl+s save · esc cancel"
      onBackdropClick={onCancel}
    >
      {label("title", "Title")}
      {textInput("title", "What needs doing?", values.title, (v) =>
        setValues({ ...values, title: v }),
      )}

      {label("description", "Description", "markdown · multiline")}
      {frame(
        "description",
        6,
        <textarea
          ref={descriptionRef}
          focused={field === "description"}
          initialValue={values.description}
          placeholder="Details, links, checklists…"
          onContentChange={() =>
            setValues((prev) => ({
              ...prev,
              description: descriptionRef.current?.plainText ?? prev.description,
            }))
          }
          backgroundColor="transparent"
          textColor={theme.text}
          placeholderColor={theme.textMuted}
          cursorColor={theme.accent}
        />,
      )}

      <box flexDirection="row">
        <box flexGrow={1} paddingRight={1} flexDirection="column">
          {label("due", "Due date")}
          {textInput("due", "YYYY-MM-DD", values.due, (v) =>
            setValues({ ...values, due: v }),
          )}
          <box flexDirection="row">
            {DATE_SHORTCUTS.map((shortcut) => (
              <box
                key={shortcut.label}
                paddingLeft={1}
                paddingRight={1}
                onMouseDown={() => {
                  focus("due");
                  setValues({
                    ...values,
                    due:
                      shortcut.days === null
                        ? ""
                        : GoTime.now()
                            .addDate(0, 0, shortcut.days)
                            .format(DateOnly),
                  });
                }}
              >
                <text fg={theme.accentDim}>{shortcut.label}</text>
              </box>
            ))}
          </box>
        </box>

        <box flexGrow={1} flexDirection="column">
          {label("tags", "Tags", "comma separated")}
          {textInput("tags", "work, home", values.tags, (v) =>
            setValues({ ...values, tags: v }),
          )}
        </box>
      </box>

      <box flexDirection="row">
        <box flexDirection="column" flexGrow={1} paddingRight={1}>
          {label("priority", "Priority")}
          {segmented(
            "priority",
            PRIORITIES.map((p) => ({
              label: priorityString(p),
              active: values.priority === p,
              color: priorityColors(theme)[p] ?? theme.accent,
              onPress: () => setValues({ ...values, priority: p }),
            })),
          )}
        </box>

        <box flexDirection="column" flexGrow={1}>
          {label("recur", "Repeats")}
          {segmented(
            "recur",
            RECURRENCES.map((r) => ({
              label: RECUR_LABELS[r] ?? recurFreqString(r),
              active: values.recur === r,
              color: theme.secondary,
              onPress: () => setValues({ ...values, recur: r }),
            })),
          )}
        </box>
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
    </Overlay>
  );
}
