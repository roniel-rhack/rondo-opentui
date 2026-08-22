import { TextAttributes, type KeyEvent } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { TextareaRenderable } from "@opentui/core";
import { RecurFreq, recurFreqString } from "../../core/task/recur.ts";
import { Priority, priorityString } from "../../core/task/task.ts";
import { DateOnly, GoTime } from "../../core/time.ts";
import { parseDueInput, parseQuickAdd, type QuickAdd } from "../state.ts";
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

/** The full form needs 28 rows; below this many the labels move into the
 * frame borders and the buttons row goes, so 20-row terminals still fit. */
const COMPACT_BELOW = 30;
const FULL_HEIGHT = 28;
const COMPACT_HEIGHT = 20;
/** Overlay width the two segmented controls were designed for. */
const FULL_WIDTH = 76;
const DUE_PREVIEW = "Mon, Jan 02";

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

function splitTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "");
}

/** Inline tokens win over the widgets; tags from both sides are merged. */
function applyQuickAdd(values: TaskFormValues, quick: QuickAdd): TaskFormValues {
  const tags = splitTags(values.tags);
  for (const tag of quick.tags) if (!tags.includes(tag)) tags.push(tag);
  return {
    ...values,
    title: quick.title,
    tags: tags.join(", "),
    priority: quick.priority ?? values.priority,
    due:
      quick.due === undefined
        ? values.due
        : quick.due === null
          ? ""
          : quick.due.format(DateOnly),
    recur: quick.recur ?? values.recur,
  };
}

function quickAddPreview(quick: QuickAdd): string | null {
  const parts = quick.tags.map((t) => `#${t}`);
  if (quick.due !== undefined) {
    parts.push(quick.due === null ? "no due" : quick.due.format(DUE_PREVIEW));
  }
  if (quick.priority !== null) parts.push(priorityString(quick.priority));
  if (quick.recur !== null) {
    parts.push(
      quick.recur === RecurFreq.None ? "no repeat" : recurFreqString(quick.recur),
    );
  }
  return parts.length === 0 ? null : `→ ${parts.join(" · ")}`;
}

function duePreview(
  due: string,
  now: GoTime,
): { text: string; valid: boolean } | null {
  if (due.trim() === "") return null;
  try {
    const parsed = parseDueInput(due, now);
    return {
      text: parsed ? `→ ${parsed.format(DUE_PREVIEW)}` : "→ no due",
      valid: true,
    };
  } catch {
    return { text: "→ invalid", valid: false };
  }
}

interface Option {
  label: string;
  active: boolean;
  color: string;
  onPress: () => void;
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

  const compact = screenHeight < COMPACT_BELOW;
  const narrow = screenWidth - 4 < FULL_WIDTH;

  // Editing continues at the end of the title, like the old input did.
  useEffect(() => {
    const area = titleRef.current;
    if (area) area.cursorOffset = area.plainText.length;
  }, []);

  // The textareas own their buffers, so read the latest text from the refs.
  // The title is conceptually one line: whatever enter left behind in the
  // buffer collapses back into spaces.
  const current = (): TaskFormValues => ({
    ...values,
    title: (titleRef.current?.plainText ?? values.title)
      .replace(/\s+/g, " ")
      .trim(),
    description: descriptionRef.current?.plainText ?? values.description,
  });

  const submit = () => {
    const latest = current();
    setValues(latest);

    const merged = applyQuickAdd(latest, parseQuickAdd(latest.title, GoTime.now()));
    const problem = validate(merged);
    if (problem) {
      setError(problem);
      return;
    }
    onSubmit(merged);
  };

  /** A stray click on the scrim only closes the form while nothing was typed. */
  const isPristine = () => {
    const latest = current();
    return (
      latest.title === initial.title.replace(/\s+/g, " ").trim() &&
      latest.description === initial.description &&
      latest.due === initial.due &&
      latest.tags === initial.tags &&
      latest.priority === initial.priority &&
      latest.recur === initial.recur
    );
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
      // Enter at the end of the line would otherwise leave a trailing space
      // that reads as a new title and wipes the error it just caused.
      const flat = text.replace(/\s*\n\s*/g, " ").replace(/\s+$/, "");
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
    const tags = splitTags(values.tags);
    if (tags.includes(tag)) return;
    setValues({ ...values, tags: [...tags, tag].join(", ") });
  };

  const cycleField = (id: FieldId, delta: number) => {
    if (id === "priority") {
      const idx = PRIORITIES.indexOf(values.priority);
      const next = (idx + delta + PRIORITIES.length) % PRIORITIES.length;
      setValues({ ...values, priority: PRIORITIES[next]! });
    } else if (id === "recur") {
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
      if (key.name === "left") cycleField(field, -1);
      if (key.name === "right") cycleField(field, 1);
      if (key.name === "space") cycleField(field, 1);
      if (key.name === "return") submit();
    }
  });

  const quick = parseQuickAdd(values.title, GoTime.now());
  const tokenPreview = quickAddPreview(quick);
  const due = duePreview(values.due, GoTime.now());

  const labelColor = (id: FieldId) =>
    error?.field === id
      ? theme.danger
      : field === id
        ? theme.accent
        : theme.textMuted;

  const frameColor = (id: FieldId) =>
    error?.field === id
      ? theme.danger
      : field === id
        ? theme.accent
        : theme.border;

  /** Full layout: a label row above each frame, with an optional hint. */
  const label = (id: FieldId, text: string, hint?: string, hintColor?: string) =>
    compact ? null : (
      <box flexDirection="row" flexShrink={0}>
        <text
          fg={labelColor(id)}
          attributes={field === id ? TextAttributes.BOLD : undefined}
        >
          {text}
        </text>
        {hint ? (
          <text fg={hintColor ?? theme.textMuted}>{`  ${hint}`}</text>
        ) : null}
      </box>
    );

  /** Compact layout: the label rides on the frame's top border instead. */
  const frameTitle = (text: string, extra?: string) =>
    compact ? ` ${text}${extra ? ` ${extra}` : ""} ` : undefined;

  const frame = (
    id: FieldId,
    layout: { height?: number; grow?: boolean; title?: string; titleColor?: string; bottomTitle?: string },
    children: ReactNode,
  ) => (
    <box
      border
      borderStyle="rounded"
      // The offending field wears the error, not just the message below.
      borderColor={frameColor(id)}
      title={layout.title}
      titleColor={layout.titleColor ?? labelColor(id)}
      bottomTitle={layout.bottomTitle ? ` ${layout.bottomTitle} ` : undefined}
      backgroundColor={
        field === id ? mix(theme.surfaceAlt, theme.accentSoft, 0.5) : theme.surfaceAlt
      }
      height={layout.grow ? undefined : layout.height}
      minHeight={layout.grow ? 3 : undefined}
      flexGrow={layout.grow ? 1 : undefined}
      flexShrink={layout.grow ? undefined : 0}
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
    layout: { title?: string; titleColor?: string } = {},
  ) =>
    frame(
      id,
      { height: 3, ...layout },
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

  // Not overflow="hidden": OpenTUI clips the hit grid with the scissor rect
  // and clicks inside stop landing. Narrow overlays switch to steppers
  // instead, so the segmented options never outgrow the frame.
  const controlFrame = (id: FieldId, title: string, children: ReactNode) => (
    <box
      flexDirection="row"
      border
      borderStyle="rounded"
      borderColor={field === id ? theme.accent : theme.border}
      title={frameTitle(title)}
      titleColor={labelColor(id)}
      backgroundColor={theme.surfaceAlt}
      height={3}
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      onMouseDown={() => focus(id)}
    >
      {children}
    </box>
  );

  const segmented = (id: FieldId, title: string, options: Option[]) =>
    controlFrame(
      id,
      title,
      options.map((option) => (
        <box
          key={option.label}
          paddingLeft={1}
          paddingRight={1}
          flexShrink={0}
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
      )),
    );

  /** Narrow terminals get the same ←/→ model the keyboard uses, as arrows. */
  const stepper = (id: FieldId, title: string, options: Option[]) => {
    const active = options.find((o) => o.active) ?? options[0]!;
    const arrow = (glyph: string, delta: number) => (
      <box
        flexShrink={0}
        onMouseDown={() => {
          focus(id);
          cycleField(id, delta);
        }}
      >
        <text fg={field === id ? theme.accent : theme.textDim}>{glyph}</text>
      </box>
    );
    return controlFrame(
      id,
      title,
      <>
        {arrow("◂ ", -1)}
        <box flexShrink={0} backgroundColor={active.color}>
          <text fg={theme.textOn} attributes={TextAttributes.BOLD}>
            {active.label}
          </text>
        </box>
        {arrow(" ▸", 1)}
      </>,
    );
  };

  const control = narrow ? stepper : segmented;

  return (
    <Overlay
      theme={theme}
      title={title}
      width={FULL_WIDTH}
      height={Math.min(screenHeight - 2, compact ? COMPACT_HEIGHT : FULL_HEIGHT)}
      screenWidth={screenWidth}
      screenHeight={screenHeight}
      footer="enter (title) / ctrl+s save · tab field · esc cancel"
      onBackdropClick={() => {
        if (isPristine()) onCancel();
      }}
      onClose={onCancel}
    >
      {label("title", "Title")}
      {/* A textarea so long titles wrap into view instead of scrolling away
          under the cursor; enter still submits. */}
      {frame(
        "title",
        {
          height: compact ? 3 : 5,
          title: frameTitle("Title"),
          bottomTitle: tokenPreview ?? undefined,
        },
        <textarea
          ref={titleRef}
          focused={field === "title"}
          initialValue={values.title}
          placeholder="What needs doing?  #tag @tomorrow !3 ~w"
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
        { grow: true, title: frameTitle("Description") },
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

      <box flexDirection="row" flexShrink={0}>
        <box flexGrow={1} paddingRight={1} flexDirection="column">
          {label(
            "due",
            "Due date",
            due ? due.text : "or today / +3d",
            due ? (due.valid ? theme.text : theme.danger) : undefined,
          )}
          {textInput(
            "due",
            "YYYY-MM-DD",
            values.due,
            (v) => setValues({ ...values, due: v }),
            {
              title: frameTitle("Due date", due?.text),
              titleColor: due && !due.valid ? theme.danger : undefined,
            },
          )}
          <box flexDirection="row" flexShrink={0}>
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
          {textInput(
            "tags",
            "work, home",
            values.tags,
            (v) => setValues({ ...values, tags: v }),
            { title: frameTitle("Tags") },
          )}
          {knownTags.length > 0 ? (
            <box flexDirection="row" flexShrink={0}>
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

      <box flexDirection="row" flexShrink={0}>
        <box flexDirection="column" flexGrow={1} paddingRight={1}>
          {label("priority", "Priority")}
          {control(
            "priority",
            "Priority",
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
          {control(
            "recur",
            "Repeats",
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
        <box height={compact ? 1 : 2} paddingTop={compact ? 0 : 1} flexShrink={0}>
          <text fg={theme.danger} attributes={TextAttributes.BOLD}>
            {`⚠ ${error.message}`}
          </text>
        </box>
      ) : null}

      {compact ? null : (
        <box flexDirection="row" paddingTop={1} flexShrink={0}>
          <Button theme={theme} label="Save" primary onPress={submit} />
          <Button theme={theme} label="Cancel" onPress={onCancel} />
        </box>
      )}
    </Overlay>
  );
}
