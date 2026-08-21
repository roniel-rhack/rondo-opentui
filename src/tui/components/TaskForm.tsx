import { TextAttributes, type KeyEvent } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { TextareaRenderable } from "@opentui/core";
import { RecurFreq, recurFreqString } from "../../core/task/recur.ts";
import { Priority, priorityString } from "../../core/task/task.ts";
import { DateOnly, GoTime } from "../../core/time.ts";
import { parseDueInput } from "../state.ts";
import { mix, priorityColors, type TuiTheme } from "../theme.ts";
import { Button, Overlay } from "./Overlay.tsx";
import { ChipButton } from "./primitives.tsx";

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
  /** Existing tags offered as clickable chips, most used first. */
  knownTags?: string[];
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

/** Compact labels so the segmented control fits next to Priority; cased
 * like the priority labels so the two controls read as one system. */
const RECUR_LABELS: Record<number, string> = {
  [RecurFreq.None]: "None",
  [RecurFreq.Daily]: "Day",
  [RecurFreq.Weekly]: "Week",
  [RecurFreq.Monthly]: "Month",
  [RecurFreq.Yearly]: "Year",
};

/** Quick presets so a due date rarely needs typing. */
const DATE_SHORTCUTS: { label: string; days: number | null }[] = [
  { label: "today", days: 0 },
  { label: "tomorrow", days: 1 },
  { label: "+1w", days: 7 },
  { label: "none", days: null },
];

interface Problem {
  field: FieldId;
  message: string;
}

function validate(values: TaskFormValues): Problem | null {
  if (values.title.trim() === "") {
    return { field: "title", message: "Title is required" };
  }
  if (values.due.trim() !== "") {
    try {
      parseDueInput(values.due, GoTime.now());
    } catch {
      return {
        field: "due",
        message: "Due date must be YYYY-MM-DD, today, tomorrow or +Nd/+Nw",
      };
    }
  }
  return null;
}

/** Modal form used for creating and editing tasks. */
export function TaskForm({
  theme,
  title,
  initial,
  knownTags = [],
  screenWidth,
  screenHeight,
  onSubmit,
  onCancel,
}: TaskFormProps) {
  const [values, setValues] = useState<TaskFormValues>(initial);
  const titleRef = useRef<TextareaRenderable | null>(null);
  const descriptionRef = useRef<TextareaRenderable | null>(null);
  const [fieldIndex, setFieldIndex] = useState(0);
  const [error, setError] = useState<Problem | null>(null);

  const field: FieldId = FIELDS[fieldIndex] ?? "title";
  const focus = (id: FieldId) => setFieldIndex(FIELDS.indexOf(id));

  // Editing continues at the end of the title, like the old input did.
  useEffect(() => {
    const area = titleRef.current;
    if (area) area.cursorOffset = area.plainText.length;
  }, []);

  const submit = () => {
    // The textareas own their buffers, so read the latest text from the refs.
    // The title is conceptually one line: whatever enter left behind in the
    // buffer collapses back into spaces.
    const rawTitle = titleRef.current?.plainText ?? values.title;
    const title = rawTitle.replace(/\s+/g, " ").trim();
    const description = descriptionRef.current?.plainText ?? values.description;
    const values2 = { ...values, title, description };
    setValues(values2);

    const problem = validate(values2);
    if (problem) {
      setError(problem);
      return;
    }
    onSubmit(values2);
  };

  const clearError = () => setError(null);
  const lastTitle = useRef(initial.title);

  // The title is one line: the newline a failed enter-submit leaves behind
  // collapses back into a space, and the error survives that non-change.
  const handleTitleChange = () => {
    const area = titleRef.current;
    if (!area) return;
    const text = area.plainText;
    if (text.includes("\n")) {
      const collapsed = text.replace(/\s*\n\s*/g, " ");
      const flat = collapsed.trim() === "" ? "" : collapsed;
      area.setText(flat);
      area.cursorOffset = flat.length;
      return;
    }
    setValues((prev) => ({ ...prev, title: text }));
    if (text !== lastTitle.current) {
      lastTitle.current = text;
      clearError();
    }
  };

  const appendTag = (tag: string) => {
    const current = values.tags
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t !== "");
    if (current.includes(tag)) return;
    setValues({ ...values, tags: [...current, tag].join(", ") });
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
    // Enter still submits from the title even though it is a textarea; the
    // stray newline it inserts is collapsed on read.
    if (key.name === "return" && field === "title") {
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
      // The offending field wears the error, not just the message below.
      borderColor={
        error?.field === id
          ? theme.danger
          : field === id
            ? theme.accent
            : theme.border
      }
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
        onInput={(v) => {
          clearError();
          onInput(v);
        }}
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
      height={Math.min(screenHeight - 2, 28)}
      screenWidth={screenWidth}
      screenHeight={screenHeight}
      footer="tab / shift+tab field · ctrl+s save · esc cancel"
      onBackdropClick={onCancel}
    >
      {label("title", "Title")}
      {/* A textarea so long titles wrap into view instead of scrolling away
          under the cursor; enter still submits. */}
      {frame(
        "title",
        5,
        <textarea
          ref={titleRef}
          focused={field === "title"}
          initialValue={values.title}
          placeholder="What needs doing?"
          wrapMode="word"
          onContentChange={handleTitleChange}
          backgroundColor="transparent"
          textColor={theme.text}
          placeholderColor={theme.textMuted}
          cursorColor={theme.accent}
        />,
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
          {label("due", "Due date", "or today / +3d")}
          {textInput("due", "YYYY-MM-DD", values.due, (v) =>
            setValues({ ...values, due: v }),
          )}
          <box flexDirection="row">
            {DATE_SHORTCUTS.map((shortcut) => (
              <ChipButton
                key={shortcut.label}
                theme={theme}
                label={shortcut.label}
                onPress={() => {
                  focus("due");
                  clearError();
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
              />
            ))}
          </box>
        </box>

        <box flexGrow={1} flexDirection="column">
          {label("tags", "Tags", "comma separated")}
          {textInput("tags", "work, home", values.tags, (v) =>
            setValues({ ...values, tags: v }),
          )}
          {knownTags.length > 0 ? (
            <box flexDirection="row">
              {knownTags.slice(0, 4).map((tag) => (
                <ChipButton
                  key={tag}
                  theme={theme}
                  label={`#${tag}`}
                  onPress={() => {
                    focus("tags");
                    appendTag(tag);
                  }}
                />
              ))}
            </box>
          ) : null}
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
            {`⚠ ${error.message}`}
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
