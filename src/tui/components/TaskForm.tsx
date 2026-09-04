import { TextAttributes, type KeyEvent } from "@opentui/core";
import { useKeyboard, useRenderer } from "@opentui/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { InputRenderable, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core";
import { RecurFreq, recurFreqString } from "../../core/task/recur.ts";
import { Priority, priorityString } from "../../core/task/task.ts";
import { DateOnly, GoTime } from "../../core/time.ts";
import { fitChips, parseDueInput, parseQuickAdd, type QuickAdd } from "../state.ts";
import { mix, priorityColors, type TuiTheme } from "../theme.ts";
import { fitCells } from "../text.ts";
import { Button, Overlay, fixedOverlayBodyRows } from "./Overlay.tsx";
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
  draft?: TaskFormValues;
  onDraftChange?: (draft: TaskFormValues | null) => void;
  onDiscard?: () => void;
  creating?: boolean;
  /** Existing tags offered as clickable chips, most used first. */
  knownTags?: string[];
  screenWidth: number;
  screenHeight: number;
  onSubmit: (values: TaskFormValues, keepOpen?: boolean) => void;
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
/** Rows the fields themselves need, before the chip rows and the error: four
 * three-row frames, plus a label above each of them in the full layout. */
const COMPACT_FIELD_ROWS = 12;
const FULL_FIELD_ROWS = 18;

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
  draft,
  onDraftChange,
  onDiscard,
  creating = false,
  knownTags = [],
  screenWidth,
  screenHeight,
  onSubmit,
  onCancel,
}: TaskFormProps) {
  const [values, setValues] = useState<TaskFormValues>(draft ?? initial);
  const baseline = useRef(initial);
  const submitted = useRef(false);
  const draftChange = useRef(onDraftChange);
  draftChange.current = onDraftChange;
  const dirty = FIELDS.some((id) => values[id] !== baseline.current[id]);
  useEffect(() => {
    if (!submitted.current) draftChange.current?.(dirty ? values : null);
  }, [values, dirty]);
  const [expanded, setExpanded] = useState(!creating);
  const [continuing, setContinuing] = useState(false);
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const renderer = useRenderer();
  const titleRef = useRef<TextareaRenderable | null>(null);
  const descriptionRef = useRef<TextareaRenderable | null>(null);
  const inputRefs = useRef<Partial<Record<FieldId, InputRenderable | null>>>({});
  const [fieldIndex, setFieldIndex] = useState(0);
  const [error, setError] = useState<Problem | null>(null);

  const field: FieldId = FIELDS[fieldIndex] ?? "title";
  const focus = (id: FieldId) => {
    if (id !== "title") setExpanded(true);
    setFieldIndex(FIELDS.indexOf(id));
  };

  const compact = screenHeight < COMPACT_BELOW;
  const narrow = screenWidth - 4 < FULL_WIDTH;
  const stacked = screenWidth < 60;

  // The overlay cannot grow past the status bar, so the optional rows are
  // budgeted against what is left: the error message always wins, and the
  // chips are what yields when the terminal is too short for both.
  const bodyRows = fixedOverlayBodyRows(
    screenHeight,
    compact ? COMPACT_HEIGHT : FULL_HEIGHT,
  );
  const errorRows = error
    ? Math.ceil((error.message.length + 2) / Math.max(Math.min(FULL_WIDTH, screenWidth - 4) - 6, 1))
    : 0;
  const spareRows =
    bodyRows - (compact ? COMPACT_FIELD_ROWS : FULL_FIELD_ROWS) -
    (stacked ? (compact ? 6 : 8) : 0) - errorRows;
  // Each column of the due/tags row keeps its own chips on one line; what
  // does not fit is dropped rather than wrapped.
  const columnWidth =
    stacked
      ? Math.min(FULL_WIDTH, screenWidth - 4) - 7
      : Math.floor((Math.min(FULL_WIDTH, screenWidth - 4) - 6) / 2) - 1;
  const dateChips = spareRows >= 1
    ? DATE_SHORTCUTS.slice(
        0,
        fitChips(
          DATE_SHORTCUTS.map((shortcut) => shortcut.label),
          columnWidth,
        ),
      )
    : [];
  const tagChips = spareRows >= 1
    ? knownTags
        .slice(0, 4)
        .slice(
          0,
          fitChips(
            knownTags.slice(0, 4).map((t) => `#${t}`),
            columnWidth,
          ),
        )
    : [];

  // Editing continues at the end of the title, like the old input did.
  useEffect(() => {
    const area = titleRef.current;
    if (area) area.cursorOffset = area.plainText.length;
  }, []);

  useEffect(() => {
    const reveal = () => {
      const box = scrollRef.current;
      const child = box?.content.findDescendantById(`task-form-${field}`);
      if (!box || !child) return;
      const offset = child.y - box.content.y;
      const height = box.viewport.height;
      const target = child.height > height
        ? offset
        : Math.max(offset + child.height - height, Math.min(box.scrollTop, offset));
      box.scrollTop = Math.max(0, Math.min(target, box.scrollHeight - height));
    };
    renderer.root.on("layout-changed", reveal);
    reveal();
    return () => { renderer.root.off("layout-changed", reveal); };
  }, [renderer, field, expanded, screenWidth, screenHeight, errorRows]);

  // The textareas own their buffers, so read the latest text from the refs.
  // The title is conceptually one line: whatever enter left behind in the
  // buffer collapses back into spaces.
  const current = (): TaskFormValues => ({
    ...values,
    title: (titleRef.current?.plainText ?? values.title)
      .replace(/\s+/g, " ")
      .trim(),
    description: descriptionRef.current?.plainText ?? values.description,
    due: inputRefs.current.due?.value ?? values.due,
    tags: inputRefs.current.tags?.value ?? values.tags,
  });

  const close = () => {
    const latest = {
      ...values,
      title: titleRef.current?.plainText ?? values.title,
      description: descriptionRef.current?.plainText ?? values.description,
      due: inputRefs.current.due?.value ?? values.due,
      tags: inputRefs.current.tags?.value ?? values.tags,
    };
    if (!submitted.current) {
      draftChange.current?.(FIELDS.some((id) => latest[id] !== baseline.current[id]) ? latest : null);
    }
    onCancel();
  };

  const submit = (keepOpen = false) => {
    const latest = current();

    const merged = applyQuickAdd(latest, parseQuickAdd(latest.title, GoTime.now()));
    const problem = validate(merged);
    if (problem) {
      setError(problem);
      focus(problem.field);
      return;
    }
    submitted.current = true;
    draftChange.current?.(null);
    onSubmit(merged, keepOpen);
    if (keepOpen) {
      const next = { ...merged, title: "", description: "" };
      baseline.current = next;
      titleRef.current?.setText("");
      descriptionRef.current?.setText("");
      lastTitle.current = "";
      setValues(next);
      submitted.current = false;
      setContinuing(true);
      setError(null);
      focus("title");
    }
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

  const clearError = (id: FieldId, value: string) => setError((problem) => {
    if (problem?.field !== id) return problem;
    if (id === "title") return parseQuickAdd(value, GoTime.now()).title.trim() ? null : problem;
    if (id === "due") {
      try {
        parseDueInput(value, GoTime.now());
      } catch {
        return problem;
      }
    }
    return null;
  });
  const lastTitle = useRef(draft?.title ?? initial.title);

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
    submitted.current = false;
    setValues((prev) => ({ ...prev, title: text }));
    if (text !== lastTitle.current) {
      lastTitle.current = text;
      clearError("title", text);
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
      close();
      return;
    }
    if (key.ctrl && key.name === "r" && onDiscard) {
      key.preventDefault();
      submitted.current = true;
      onDiscard();
      return;
    }
    if (key.ctrl && key.name === "s") {
      key.preventDefault();
      submit();
      return;
    }
    if (key.ctrl && key.name === "n" && creating) {
      key.preventDefault();
      submit(true);
      return;
    }
    // Enter still submits from the title even though it is a textarea; the
    // stray newline it inserts is collapsed on read.
    if (key.name === "return" && field === "title") {
      key.preventDefault();
      submit();
      return;
    }
    if (key.name === "tab") {
      key.preventDefault();
      setExpanded(true);
      setFieldIndex(
        (i) => (i + (key.shift ? -1 : 1) + FIELDS.length) % FIELDS.length,
      );
      return;
    }
    // Arrow keys navigate between fields, except inside the textarea where they
    // belong to the editor.
    if (field !== "description") {
      if (key.name === "down") {
        key.preventDefault();
        setExpanded(true);
        setFieldIndex((i) => Math.min(i + 1, FIELDS.length - 1));
        return;
      }
      if (key.name === "up") {
        key.preventDefault();
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
  const effective = applyQuickAdd(values, quick);
  const metadata = `${continuing ? "Keeping " : ""}${[
    priorityString(effective.priority),
    effective.due ? `due ${effective.due}` : "no due",
    effective.recur === RecurFreq.None ? "" : recurFreqString(effective.recur),
  ].filter(Boolean).join(" · ")}`;
  const metadataTags = splitTags(effective.tags).map((tag) => `#${tag}`).join(" ");
  const contentWidth = Math.max(Math.min(FULL_WIDTH, screenWidth - 4) - 6, 1);
  const end = onDraftChange ? "esc close" : "esc cancel";
  const discardHint = onDiscard ? " · ^r discard" : "";
  const footer = contentWidth < 45
    ? `${creating ? "enter" : "^s save"}${discardHint} · ${end}`
    : creating
      ? `enter save · ^n next${contentWidth < 60 ? "" : " · tab options"}${discardHint} · ${end}`
      : `^s save · tab field${discardHint} · ${end}`;
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
    compact ? ` ${text}${extra && (stacked || screenWidth >= 70) ? ` ${extra}` : ""} ` : undefined;

  const frame = (
    id: FieldId,
    layout: { height?: number; grow?: boolean; title?: string; titleColor?: string; bottomTitle?: string },
    children: ReactNode,
  ) => (
    <box
      id={`task-form-${id}`}
      border={expanded || id !== "title" ? true : []}
      borderStyle="rounded"
      // The offending field wears the error, not just the message below.
      borderColor={frameColor(id)}
      title={expanded ? layout.title : undefined}
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
        ref={(input) => { inputRefs.current[id] = input; }}
        focused={field === id}
        value={value}
        placeholder={placeholder}
        onInput={(v) => {
          clearError(id, v);
          onInput(v);
        }}
        onSubmit={() => submit()}
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
      id={`task-form-${id}`}
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
      height={expanded ? (compact ? COMPACT_HEIGHT : FULL_HEIGHT) : 10}
      screenWidth={screenWidth}
      screenHeight={screenHeight}
      footer={footer}
      onBackdropClick={() => {
        if (isPristine()) close();
      }}
      onClose={close}
    >
      {dirty && onDiscard ? (
        <box position="absolute" top={-1} right={3} height={1} zIndex={1}
          paddingLeft={1} paddingRight={1} backgroundColor={theme.surfaceAlt} onMouseDown={onDiscard}>
          <text fg={theme.danger}>Discard</text>
        </box>
      ) : null}
      <scrollbox
        ref={scrollRef}
        flexGrow={1}
        minHeight={0}
        focused={false}
        scrollX={false}
        contentOptions={{ flexDirection: "column" }}
      >
      {expanded ? label("title", "Title") : null}
      {/* A textarea so long titles wrap into view instead of scrolling away
          under the cursor; enter still submits. */}
      {frame(
        "title",
        {
          height: !expanded || compact ? 3 : 5,
          title: frameTitle("Title"),
          bottomTitle: expanded ? tokenPreview ?? undefined : undefined,
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
      {!expanded ? <>
        <text height={1} flexShrink={0} fg={theme.textDim} wrapMode="none">{fitCells(metadata, contentWidth)}</text>
        <text height={1} flexShrink={0} fg={theme.textMuted} wrapMode="none">{fitCells(metadataTags || "No tags", contentWidth)}</text>
      </> : null}

      {expanded ? <>
      {label("description", "Description", "markdown · multiline")}
      {frame(
        "description",
        { height: compact ? 3 : 5, title: frameTitle("Description") },
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

      <box flexDirection={stacked ? "column" : "row"} flexShrink={0}>
        <box flexGrow={1} flexBasis={stacked ? undefined : 0} minWidth={0}
          paddingRight={stacked ? 0 : 1} flexDirection="column">
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
          {dateChips.length > 0 ? (
          <box flexDirection="row" flexShrink={0}>
            {dateChips.map((shortcut) => (
              <ChipButton
                key={shortcut.label}
                theme={theme}
                label={shortcut.label}
                onPress={() => {
                  focus("due");
                  clearError("due", "");
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
          ) : null}
        </box>

        <box flexGrow={1} flexBasis={stacked ? undefined : 0} minWidth={0} flexDirection="column">
          {label("tags", "Tags", "comma separated")}
          {textInput(
            "tags",
            "work, home",
            values.tags,
            (v) => setValues({ ...values, tags: v }),
            { title: frameTitle("Tags") },
          )}
          {tagChips.length > 0 ? (
            <box flexDirection="row" flexShrink={0}>
              {tagChips.map((tag) => (
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

      <box flexDirection={stacked ? "column" : "row"} flexShrink={0}>
        <box flexDirection="column" flexGrow={1} flexBasis={stacked ? undefined : 0}
          minWidth={0} paddingRight={stacked ? 0 : 1}>
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

        <box flexDirection="column" flexGrow={1} flexBasis={stacked ? undefined : 0} minWidth={0}>
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

      </> : (
        <box flexDirection="row" flexShrink={0}>
          <Button theme={theme} label="More options · Tab" onPress={() => focus("description")} />
        </box>
      )}
      </scrollbox>

      {error ? (
        <box height={errorRows} flexShrink={0}>
          <text fg={theme.danger} attributes={TextAttributes.BOLD}>
            {`⚠ ${error.message}`}
          </text>
        </box>
      ) : null}

      {expanded && !compact ? (
        <box flexDirection="row" paddingTop={1} flexShrink={0}>
          {!compact ? <Button theme={theme} label="Save" primary onPress={() => submit()} /> : null}
          {!compact ? <Button theme={theme} label={onDraftChange ? "Close" : "Cancel"} onPress={close} /> : null}
        </box>
      ) : null}
    </Overlay>
  );
}
