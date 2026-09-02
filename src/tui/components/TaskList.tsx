import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDate, type Config } from "../../core/config/config.ts";
import { RecurFreq } from "../../core/task/recur.ts";
import {
  Priority,
  Status,
  completedSubtasks,
  type Task,
} from "../../core/task/task.ts";
import type { GoTime } from "../../core/time.ts";
import { DueLevel } from "../../core/ui/overdue.ts";
import { useSmoothScrollIntoView } from "../hooks/useSmoothScroll.ts";
import { useFlash } from "../hooks/useTween.ts";
import {
  fuzzyIndices,
  groupTasks,
  metaWidthFor,
  relativeDue,
  type SortKey,
  type TaskGroup,
} from "../state.ts";
import { mix, priorityColors, type TuiTheme } from "../theme.ts";
import { EmptyState, highlightSpans } from "./primitives.tsx";

interface TaskListProps {
  theme: TuiTheme;
  cfg: Config;
  tasks: Task[];
  selected: number;
  focused: boolean;
  /** Outer width of the list panel, borders included. */
  width: number;
  /** Blank lines between rows; the caller resolves it from the density. */
  gap: number;
  sort: SortKey;
  now: GoTime;
  /** Tasks with an open blocker. */
  blocked: ReadonlySet<number>;
  /** Tasks marked for a bulk action. */
  marked?: ReadonlySet<number>;
  /** Free text of the active filter; the letters it matched light up in
   * each title, so the ranking is explained rather than a mystery. */
  query?: string;
  /** Task the running focus session is attached to, marked in its row so
   * the header timer and the list agree on what is being worked on. */
  focusTaskId?: number | null;
  /** In-place refresh counts per task; a row glows when its count moves. */
  revisions?: ReadonlyMap<number, number>;
  onSelect: (index: number) => void;
  onActivate: (index: number) => void;
  onToggleStatus: (index: number) => void;
  /** A double click on a row; the caller opens it for editing. */
  onOpen?: (index: number) => void;
  emptyIcon: string;
  emptyTitle: string;
  emptyHint?: string;
}

function dueColorFor(theme: TuiTheme, level: DueLevel, selected: boolean): string {
  switch (level) {
    case DueLevel.Overdue:
      // Most backlogs are mostly overdue; a full-strength red on every row
      // turns the dark list into noise. The blend reads louder than danger
      // on the light palette, so that one keeps the plain color.
      return theme.dark ? mix(theme.danger, theme.textMuted, 0.35) : theme.danger;
    case DueLevel.Today:
      return theme.warning;
    case DueLevel.Soon:
      return theme.info;
    default:
      return selected ? theme.textDim : theme.textMuted;
  }
}

const STATUS_GLYPH = ["○", "◐", "✓"];

/** Two-column priority marks; Low stays unmarked so the column reads as a
 * highlight rather than a badge on every row. */
const PRIORITY_GLYPH: Record<number, string> = {
  [Priority.Medium]: "△",
  [Priority.High]: "▲",
  [Priority.Urgent]: "◆",
};

/** Column widths for the metadata cells, so rows line up as a grid. */
const DUE_WIDTH = 11;
const PROGRESS_WIDTH = 10;
const MAX_VISIBLE_TAGS = 2;

/** Fixed columns around the title: panel borders, rail, glyph box, the
 * trailing padding and the scrollbar gutter. */
const ROW_CHROME = 2 + 1 + 3 + 1 + 1;

/** Two clicks on the same row inside this window open it for editing. */
const DOUBLE_CLICK_MS = 400;

/** Section headers take the tone of what they hold, so the eye lands on
 * the overdue block before reading a word. */
function groupTone(theme: TuiTheme, label: string): string {
  switch (label) {
    case "Overdue":
    case "Urgent":
      return theme.dark ? mix(theme.danger, theme.textMuted, 0.25) : theme.danger;
    case "Today":
    case "High":
      return theme.warning;
    case "This week":
    case "Medium":
      return theme.info;
    case "Done":
      return theme.success;
    default:
      return theme.textMuted;
  }
}

/** Four-dot progress, easier to scan than a tiny bar. */
function progressDots(completed: number, total: number): string {
  if (total === 0) return "";
  const filled = Math.round((completed / total) * 4);
  return `${"●".repeat(filled)}${"○".repeat(4 - filled)} ${completed}/${total}`;
}

function tagCellFor(tags: readonly string[], max: number): string {
  if (tags.length === 0) return "";
  const shown = tags.slice(0, max).map((t) => `#${t}`);
  const extra = tags.length - shown.length;
  return `${shown.join(" ")}${extra > 0 ? ` +${extra}` : ""}`;
}

/** Trims the tail: the renderer elides in the middle, which reads badly. */
function fit(text: string, space: number): string {
  if (text.length <= space) return text;
  if (space <= 1) return space === 1 ? "…" : "";
  return `${text.slice(0, space - 1).trimEnd()}…`;
}

/** Everything a row needs, as primitives, so React.memo can skip it. */
interface RowModel {
  id: number;
  title: string;
  status: Status;
  priority: Priority;
  recurring: boolean;
  blocked: boolean;
  marked: boolean;
  /** The running focus session is attached to this task. */
  focusing: boolean;
  dueLabel: string;
  dueLevel: DueLevel;
  progress: string;
  tags: string;
  /** "✓ date" for completed tasks; empty otherwise. */
  doneLabel: string;
  /** Title positions the filter text matched; empty without a query. */
  matches: number[];
  /** Changes after mount make the row glow: an in-place refresh from this
   * session, or a newer stored timestamp from another connection. */
  flashKey: string;
}

interface RowProps extends RowModel {
  index: number;
  theme: TuiTheme;
  selected: boolean;
  focused: boolean;
  showMeta: boolean;
  /** Columns available to the title once every fixed cell is placed. */
  titleSpace: number;
  /** Columns available to the metadata line. */
  metaWidth: number;
  /** Whether the list reserves its mark gutter, which it does as soon as one
   * task is marked. */
  showMarks: boolean;
  onSelect: (index: number) => void;
  onToggleStatus: (index: number) => void;
}

const TaskRow = memo(function TaskRow({
  index,
  id,
  title,
  status,
  priority,
  recurring,
  blocked,
  marked,
  focusing,
  dueLabel,
  dueLevel,
  progress,
  tags,
  doneLabel,
  matches,
  flashKey,
  theme,
  selected,
  focused,
  showMeta,
  titleSpace,
  metaWidth,
  showMarks,
  onSelect,
  onToggleStatus,
}: RowProps) {
  const [hover, setHover] = useState(false);
  const flash = useFlash(flashKey);

  const done = status === Status.Done;
  const priorityColor = priorityColors(theme)[priority] ?? theme.textMuted;
  const statusColor = done
    ? theme.success
    : status === Status.InProgress
      ? theme.accent
      : theme.textMuted;

  // The selection keeps its fill whether or not the list has focus; the rail
  // and the bold title are what say "keys go here". An edit tints the row
  // for a moment on top of that, then fades back.
  const restingBg = selected
    ? theme.selectionBg
    : hover
      ? theme.hoverBg
      : undefined;
  const background =
    flash > 0
      ? mix(restingBg ?? theme.bg, theme.accentSoft, flash * 0.9)
      : restingBg;

  // The rail says where the cursor is; a mark is a second, independent state
  // and gets its own column, or marking the row under the cursor would be
  // invisible.
  const rail = selected
    ? { glyph: "┃", color: focused ? theme.accent : theme.border }
    : blocked
      ? { glyph: "│", color: theme.danger }
      : { glyph: " ", color: theme.border };

  const priorityGlyph = done ? undefined : PRIORITY_GLYPH[priority];
  const mutedTone = selected ? theme.textDim : theme.textMuted;
  const dueTone = dueColorFor(theme, dueLevel, selected);
  const progressTone = theme.dark ? theme.textDim : theme.accent;

  // Fixed cells on the title line eat into the title's room.
  const extras =
    (blocked ? 2 : 0) +
    (focusing ? 2 : 0) +
    (recurring ? 2 : 0) +
    (priorityGlyph ? 2 : 0);
  const shownTitle = fit(title, Math.max(titleSpace - extras, 0));
  // Only letters that survived the trim light up; the ellipsis never does.
  const lit = matches.filter((i) => i < shownTitle.length && shownTitle[i] === title[i]);
  const titleTone = done ? theme.textMuted : selected ? theme.text : theme.textDim;
  const titleAttributes = done
    ? TextAttributes.STRIKETHROUGH
    : selected && focused
      ? TextAttributes.BOLD
      : undefined;

  // Second line, left-packed: an empty due cell does not hold its column.
  let dueCell = "";
  let progressCell = "";
  let tagCell = "";
  if (!done) {
    dueCell = dueLabel === "" ? "" : dueLabel.padEnd(DUE_WIDTH);
    progressCell =
      progress === "" ? "" : tags === "" ? progress : progress.padEnd(PROGRESS_WIDTH);
    tagCell = fit(tags, Math.max(metaWidth - dueCell.length - progressCell.length, 0));
  }
  const hasMeta = done || dueCell !== "" || progressCell !== "" || tagCell !== "";

  return (
    <box
      id={`task-row-${id}`}
      flexDirection="column"
      backgroundColor={background}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseDown={() => onSelect(index)}
    >
      <box flexDirection="row" paddingRight={1}>
        {/* flexShrink 0 on every fixed cell: an overflowing no-wrap title
            would otherwise squeeze their padding away. */}
        <text flexShrink={0} fg={rail.color}>
          {rail.glyph}
        </text>

        {showMarks ? (
          <text flexShrink={0} fg={marked ? theme.accent : theme.textMuted}>
            {marked ? "✓" : "·"}
          </text>
        ) : null}

        <box
          flexShrink={0}
          paddingLeft={1}
          paddingRight={1}
          onMouseDown={(event) => {
            event.stopPropagation();
            onToggleStatus(index);
          }}
        >
          <text fg={statusColor} attributes={TextAttributes.BOLD}>
            {STATUS_GLYPH[status] ?? "○"}
          </text>
        </box>

        {blocked ? (
          <text flexShrink={0} fg={theme.danger}>
            {"⊘ "}
          </text>
        ) : null}

        {focusing ? (
          <text flexShrink={0} fg={theme.warning} attributes={TextAttributes.BOLD}>
            {"▶ "}
          </text>
        ) : null}

        <text
          fg={titleTone}
          attributes={titleAttributes}
          flexGrow={1}
          // The title is trimmed by hand above; no-wrap keeps the row one
          // line tall should a width estimate ever be off.
          wrapMode="none"
        >
          {highlightSpans(shownTitle, lit, titleTone, theme.accent, titleAttributes)}
        </text>

        {recurring ? (
          <text flexShrink={0} fg={done ? theme.textMuted : theme.secondary}>
            {" ↻"}
          </text>
        ) : null}

        {priorityGlyph ? (
          <box flexShrink={0} paddingLeft={1}>
            <text fg={priorityColor} attributes={TextAttributes.BOLD}>
              {priorityGlyph}
            </text>
          </box>
        ) : null}
      </box>

      {showMeta && hasMeta ? (
        <box flexDirection="row" paddingRight={1}>
          {/* The rail continues here so both lines read as one block. */}
          <text flexShrink={0} fg={rail.color}>
            {`${rail.glyph}${showMarks ? " " : ""}   `}
          </text>
          <text wrapMode="none" flexGrow={1}>
            {done ? (
              <span fg={mutedTone}>{doneLabel}</span>
            ) : (
              <>
                <span fg={dueTone}>{dueCell}</span>
                {/* accentDim measures under 3:1 as text; rails only. */}
                <span fg={progressTone}>{progressCell}</span>
                <span fg={theme.secondary}>{tagCell}</span>
              </>
            )}
          </text>
        </box>
      ) : null}
    </box>
  );
});

interface ListCallbacks {
  onSelect: (index: number) => void;
  onActivate: (index: number) => void;
  onToggleStatus: (index: number) => void;
  onOpen?: (index: number) => void;
}

/** Scrollable, mouse-aware task list. */
export const TaskList = memo(function TaskList({
  theme,
  cfg,
  tasks,
  selected,
  focused,
  width,
  gap,
  sort,
  now,
  blocked,
  marked,
  query = "",
  focusTaskId = null,
  revisions,
  onSelect,
  onActivate,
  onToggleStatus,
  onOpen,
  emptyIcon,
  emptyTitle,
  emptyHint,
}: TaskListProps) {
  // Rows get handlers created once; the latest callbacks live behind a ref
  // so an inline closure from the caller never re-renders every row.
  const callbacks = useRef<ListCallbacks>({ onSelect, onActivate, onToggleStatus, onOpen });
  callbacks.current = { onSelect, onActivate, onToggleStatus, onOpen };
  // A second click on the row already under the cursor opens it, the way a
  // double click does everywhere else; the first click still selects.
  const lastClick = useRef({ index: -1, at: 0 });
  const handleSelect = useCallback((index: number) => {
    callbacks.current.onSelect(index);
    callbacks.current.onActivate(index);
    const now = Date.now();
    const again =
      lastClick.current.index === index &&
      now - lastClick.current.at < DOUBLE_CLICK_MS;
    lastClick.current = again ? { index: -1, at: 0 } : { index, at: now };
    if (again) callbacks.current.onOpen?.(index);
  }, []);
  const handleToggle = useCallback((index: number) => {
    callbacks.current.onToggleStatus(index);
  }, []);

  // Due labels depend on the calendar day, not the second: a coarser key
  // keeps the row models stable while the caller's clock ticks.
  const nowKey = Math.floor(now.ms / 15_000);
  const rows = useMemo(
    () =>
      tasks.map((task) =>
        toRowModel(task, cfg, now, blocked, marked, query, focusTaskId, revisions),
      ),
    [tasks, cfg, nowKey, blocked, marked, query, focusTaskId, revisions],
  );
  const groups = useMemo(
    () => groupTasks(tasks, sort, now),
    [tasks, sort, nowKey],
  );
  const indexOf = useMemo(
    () => new Map(tasks.map((t, i) => [t.id, i])),
    [tasks],
  );

  if (tasks.length === 0) {
    return (
      <EmptyState
        theme={theme}
        icon={emptyIcon}
        title={emptyTitle}
        hint={emptyHint}
      />
    );
  }

  // One column, present for every row as soon as anything is marked, so the
  // rows keep lining up and the first mark is visible on the cursor row.
  const showMarks = (marked?.size ?? 0) > 0;
  const markGutter = showMarks ? 1 : 0;
  const metaWidth = metaWidthFor(width) - markGutter;
  // Below this the second line has no room for anything meaningful.
  const showMeta = width > 30;
  const titleSpace = Math.max(width - ROW_CHROME - markGutter, 4);

  return (
    <ScrollingList
      theme={theme}
      tasks={tasks}
      rows={rows}
      groups={groups}
      indexOf={indexOf}
      selected={selected}
      focused={focused}
      showMeta={showMeta}
      gap={gap}
      titleSpace={titleSpace}
      metaWidth={metaWidth}
      showMarks={showMarks}
      onSelect={handleSelect}
      onToggleStatus={handleToggle}
    />
  );
});

function toRowModel(
  task: Task,
  cfg: Config,
  now: GoTime,
  blocked: ReadonlySet<number>,
  marked: ReadonlySet<number> | undefined,
  query: string,
  focusTaskId: number | null,
  revisions: ReadonlyMap<number, number> | undefined,
): RowModel {
  const done = task.status === Status.Done;
  const due = task.dueDate && !done ? relativeDue(task.dueDate, now) : null;
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    recurring: task.recurFreq !== RecurFreq.None,
    blocked: blocked.has(task.id),
    marked: marked?.has(task.id) ?? false,
    focusing: focusTaskId === task.id,
    dueLabel: due?.label ?? "",
    dueLevel: due?.level ?? DueLevel.None,
    progress: progressDots(completedSubtasks(task), task.subtasks.length),
    tags: tagCellFor(task.tags, MAX_VISIBLE_TAGS),
    doneLabel: done ? `✓ ${formatDate(cfg, task.updatedAt)}` : "",
    // A task can match on its description or tags alone; then nothing in
    // the title lights up, which is honest.
    matches: query === "" ? [] : (fuzzyIndices(query, task.title) ?? []),
    flashKey: `${revisions?.get(task.id) ?? 0}/${task.updatedAt.ms}`,
  };
}

interface ScrollingListProps {
  theme: TuiTheme;
  tasks: Task[];
  rows: RowModel[];
  groups: TaskGroup[];
  indexOf: Map<number, number>;
  selected: number;
  focused: boolean;
  showMeta: boolean;
  gap: number;
  titleSpace: number;
  metaWidth: number;
  showMarks: boolean;
  onSelect: (index: number) => void;
  onToggleStatus: (index: number) => void;
}

/** Keeps the selected row inside the viewport as the cursor moves. */
function ScrollingList({
  theme,
  tasks,
  rows,
  groups,
  indexOf,
  selected,
  focused,
  showMeta,
  gap,
  titleSpace,
  metaWidth,
  showMarks,
  onSelect,
  onToggleStatus,
}: ScrollingListProps) {
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const previous = useRef(selected);

  // Scroll the row *after* the selected one into view, so moving through the
  // list always keeps a row of lookahead instead of pinning the cursor to the
  // edge of the viewport.
  const direction = Math.sign(selected - previous.current);
  previous.current = selected;
  const lookahead = Math.min(
    Math.max(selected + direction, 0),
    tasks.length - 1,
  );
  const headed = groups[0]?.label !== "";
  // At the top, aim for the section header so it is not left cut off.
  const anchorId =
    lookahead === 0 && headed
      ? "task-group-0"
      : tasks[lookahead] === undefined
        ? undefined
        : `task-row-${tasks[lookahead].id}`;

  // A sort or filter reorders rows under an unchanged selection, and a
  // layout change moves them; both need the viewport to catch up. Rows that
  // changed group are remounted with no geometry yet, so the re-anchor waits
  // for the layout pass that places them.
  const renderer = useRenderer();
  const [settled, setSettled] = useState(0);
  useEffect(() => {
    const root = renderer.root;
    const onLayout = () => setSettled((n) => n + 1);
    root.once("layout-changed", onLayout);
    return () => {
      root.off("layout-changed", onLayout);
    };
  }, [renderer, groups, gap, showMeta]);
  useSmoothScrollIntoView(scrollRef, anchorId, settled);

  return (
    <scrollbox
      ref={scrollRef}
      // Never focused: the scrollbox would answer j/k/arrows itself and fight
      // the cursor-driven scrolling below. Wheel and drag still work.
      focused={false}
      flexGrow={1}
      stickyScroll={false}
      scrollX={false}
      scrollbarOptions={{
        showArrows: false,
        trackOptions: {
          backgroundColor: theme.bg,
          foregroundColor: theme.border,
        },
      }}
      // A blank line between rows keeps each task's two lines reading as one
      // block; short terminals trade it for more rows on screen.
      contentOptions={{ flexDirection: "column", gap }}
    >
      {groups.map((group, g) => (
        <box key={group.label} flexDirection="column" gap={gap}>
          {headed ? (
            <box id={`task-group-${g}`} flexDirection="row" paddingRight={1}>
              <text
                flexShrink={0}
                fg={groupTone(theme, group.label)}
                attributes={TextAttributes.BOLD}
                wrapMode="none"
              >
                {`  ${group.label.toUpperCase()}  ${group.tasks.length}`}
              </text>
              {/* A hairline to the panel edge makes the section read as a
                  band rather than a stray label between two rows. Drawn as
                  a top border so it ends where the rows end, whether or not
                  the scrollbar is taking a column. */}
              <box
                flexGrow={1}
                height={1}
                marginLeft={1}
                border={["top"]}
                borderStyle="single"
                borderColor={theme.border}
              />
            </box>
          ) : null}
          {group.tasks.map((task) => {
            const index = indexOf.get(task.id) ?? 0;
            return (
              <TaskRow
                key={task.id}
                {...rows[index]!}
                index={index}
                theme={theme}
                selected={index === selected}
                focused={focused}
                showMeta={showMeta}
                titleSpace={titleSpace}
                metaWidth={metaWidth}
                showMarks={showMarks}
                onSelect={onSelect}
                onToggleStatus={onToggleStatus}
              />
            );
          })}
        </box>
      ))}
    </scrollbox>
  );
}
