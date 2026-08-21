import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { useEffect, useRef, useState } from "react";
import { formatDateShort, type Config } from "../../core/config/config.ts";
import { RecurFreq } from "../../core/task/recur.ts";
import {
  Status,
  completedSubtasks,
  priorityLabel,
  type Task,
} from "../../core/task/task.ts";
import { GoTime } from "../../core/time.ts";
import { DueLevel, dueStatus } from "../../core/ui/overdue.ts";
import { mix, priorityColors, type TuiTheme } from "../theme.ts";
import { EmptyState } from "./primitives.tsx";

interface TaskListProps {
  theme: TuiTheme;
  cfg: Config;
  tasks: Task[];
  selected: number;
  focused: boolean;
  width: number;
  onSelect: (index: number) => void;
  onActivate: (index: number) => void;
  onToggleStatus: (index: number) => void;
  emptyIcon: string;
  emptyTitle: string;
  emptyHint?: string;
}

function dueColorFor(theme: TuiTheme, level: DueLevel): string {
  switch (level) {
    case DueLevel.Overdue:
      // Most backlogs are mostly overdue; a full-strength red on every row
      // turns the list into noise, so soften it here and keep the loud one
      // for the detail panel.
      return mix(theme.danger, theme.textMuted, 0.35);
    case DueLevel.Today:
      return theme.warning;
    case DueLevel.Soon:
      return theme.info;
    default:
      return theme.textMuted;
  }
}

const STATUS_GLYPH = ["○", "◐", "✓"];

/** Column widths for the metadata line, so rows line up as a grid. */
const META_DUE_WIDTH = 11;
const META_PROGRESS_WIDTH = 10;
const MAX_VISIBLE_TAGS = 2;

/**
 * Compact due marker. The full "OVERDUE" wording lives in the detail panel;
 * repeating it on every row turns the list into a wall of red.
 */
function dueCellFor(
  cfg: Config,
  due: GoTime,
  level: DueLevel,
  now: GoTime,
): string {
  const date = formatDateShort(cfg, due, now);
  if (level === DueLevel.Overdue) return `! ${date}`;
  if (level === DueLevel.Today) return `• ${date}`;
  return `  ${date}`;
}

/** Four-dot progress, easier to scan than a tiny bar. */
function progressDots(completed: number, total: number): string {
  if (total === 0) return "";
  const filled = Math.round((completed / total) * 4);
  return `${"●".repeat(filled)}${"○".repeat(4 - filled)} ${completed}/${total}`;
}

function tagCellFor(tags: readonly string[]): string {
  if (tags.length === 0) return "";
  const shown = tags.slice(0, MAX_VISIBLE_TAGS).map((t) => `#${t}`);
  const extra = tags.length - shown.length;
  return `${shown.join(" ")}${extra > 0 ? ` +${extra}` : ""}`;
}

interface RowProps {
  id: string;
  /** Usable columns for the metadata line, after rail and padding. */
  metaWidth: number;
  theme: TuiTheme;
  cfg: Config;
  task: Task;
  selected: boolean;
  focused: boolean;
  showMeta: boolean;
  now: GoTime;
  onSelect: () => void;
  onToggleStatus: () => void;
}

function TaskRow({
  id,
  metaWidth,
  theme,
  cfg,
  task,
  selected,
  focused,
  showMeta,
  now,
  onSelect,
  onToggleStatus,
}: RowProps) {
  const [hover, setHover] = useState(false);

  const done = task.status === Status.Done;
  const level = task.dueDate ? dueStatus(task.dueDate, now) : DueLevel.None;
  const priorityColor = priorityColors(theme)[task.priority] ?? theme.textMuted;
  const statusColor = done
    ? theme.success
    : task.status === Status.InProgress
      ? theme.accent
      : theme.textMuted;

  const background = selected
    ? focused
      ? theme.selectionBg
      : mix(theme.selectionBg, theme.bg, 0.45)
    : hover
      ? theme.hoverBg
      : undefined;

  const railGlyph = selected ? "┃" : task.priority > 1 && !done ? "│" : " ";
  const railColor = selected ? theme.accentDim : priorityColor;

  const dueCell = task.dueDate
    ? dueCellFor(cfg, task.dueDate, level, now)
    : "";
  const dueTone = dueColorFor(theme, level);
  const progressCell = progressDots(
    completedSubtasks(task),
    task.subtasks.length,
  );
  const tagCell = tagCellFor(task.tags);
  // Completed tasks collapse to a single line: their metadata is noise.
  const hasMeta =
    !done && (dueCell !== "" || progressCell !== "" || tagCell !== "");
  // Only pad into columns when there is something to align against.
  const aligned = dueCell !== "" || progressCell !== "";
  const usedByColumns = aligned
    ? META_DUE_WIDTH + META_PROGRESS_WIDTH
    : dueCell.length + progressCell.length;
  // Trim tags ourselves: the renderer elides in the middle, which reads badly.
  const tagSpace = Math.max(metaWidth - usedByColumns, 0);
  const tagShown =
    tagCell.length > tagSpace
      ? `${tagCell.slice(0, Math.max(tagSpace - 1, 0)).trimEnd()}…`
      : tagCell;

  return (
    <box
      id={id}
      flexDirection="column"
      backgroundColor={background}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseDown={onSelect}
    >
      <box flexDirection="row" paddingRight={1}>
        {/* Priority rail doubles as the selection indicator. */}
        <text fg={selected && focused ? theme.accent : railColor}>
          {railGlyph}
        </text>

        <box
          paddingLeft={1}
          paddingRight={1}
          onMouseDown={(event) => {
            event.stopPropagation();
            onToggleStatus();
          }}
        >
          <text fg={statusColor} attributes={TextAttributes.BOLD}>
            {STATUS_GLYPH[task.status] ?? "○"}
          </text>
        </box>

        <text
          fg={done ? theme.textMuted : selected ? theme.text : theme.textDim}
          attributes={
            done
              ? TextAttributes.STRIKETHROUGH
              : selected
                ? TextAttributes.BOLD
                : undefined
          }
          flexGrow={1}
          truncate
        >
          {task.title}
        </text>

        {task.recurFreq !== RecurFreq.None ? (
          <text fg={done ? theme.textMuted : theme.secondary}>{" ↻ "}</text>
        ) : null}

        {task.priority > 1 && !done ? (
          <text fg={priorityColor} attributes={TextAttributes.BOLD}>
            {` ${priorityLabel(task.priority)} `}
          </text>
        ) : null}
      </box>

      {showMeta && hasMeta ? (
        <box flexDirection="row" paddingRight={1}>
          {/* The rail continues here so both lines read as one block. */}
          <text fg={selected && focused ? theme.accent : railColor}>
            {`${railGlyph}   `}
          </text>
          {/* One text node with spans: fixed columns that never wrap. */}
          <text wrapMode="none" flexGrow={1}>
            <span fg={done ? theme.textMuted : dueTone}>
              {aligned ? dueCell.padEnd(META_DUE_WIDTH) : dueCell}
            </span>
            <span fg={done ? theme.textMuted : theme.accentDim}>
              {aligned
                ? progressCell.padEnd(META_PROGRESS_WIDTH)
                : progressCell}
            </span>
            <span fg={done ? theme.textMuted : theme.secondary}>{tagShown}</span>
          </text>
        </box>
      ) : null}
    </box>
  );
}

/** Scrollable, mouse-aware task list. */
export function TaskList({
  theme,
  cfg,
  tasks,
  selected,
  focused,
  width,
  onSelect,
  onActivate,
  onToggleStatus,
  emptyIcon,
  emptyTitle,
  emptyHint,
}: TaskListProps) {
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

  const now = GoTime.now();
  // Below this the second line has no room for anything meaningful.
  const showMeta = width > 30;

  return (
    <ScrollingList
      theme={theme}
      cfg={cfg}
      tasks={tasks}
      selected={selected}
      focused={focused}
      showMeta={showMeta}
      width={width}
      now={now}
      onSelect={onSelect}
      onActivate={onActivate}
      onToggleStatus={onToggleStatus}
    />
  );
}

interface ScrollingListProps {
  theme: TuiTheme;
  cfg: Config;
  tasks: Task[];
  selected: number;
  focused: boolean;
  showMeta: boolean;
  width: number;
  now: GoTime;
  onSelect: (index: number) => void;
  onActivate: (index: number) => void;
  onToggleStatus: (index: number) => void;
}

/** Keeps the selected row inside the viewport as the cursor moves. */
function ScrollingList({
  theme,
  cfg,
  tasks,
  selected,
  focused,
  showMeta,
  width,
  now,
  onSelect,
  onActivate,
  onToggleStatus,
}: ScrollingListProps) {
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const selectedId = tasks[selected]?.id;
  // panel borders (2) + rail indent (4) + scrollbar gutter (2)
  const metaWidth = Math.max(width - 8, 10);

  useEffect(() => {
    if (selectedId === undefined) return;
    scrollRef.current?.scrollChildIntoView(`task-row-${selectedId}`);
  }, [selectedId]);

  return (
    <scrollbox
      ref={scrollRef}
      focused={focused}
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
      contentOptions={{ flexDirection: "column" }}
    >
      {tasks.map((task, index) => (
        <TaskRow
          key={task.id}
          id={`task-row-${task.id}`}
          metaWidth={metaWidth}
          theme={theme}
          cfg={cfg}
          task={task}
          selected={index === selected}
          focused={focused}
          showMeta={showMeta}
          now={now}
          onSelect={() => {
            onSelect(index);
            onActivate(index);
          }}
          onToggleStatus={() => onToggleStatus(index)}
        />
      ))}
    </scrollbox>
  );
}
