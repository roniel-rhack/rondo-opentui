import {
  TextAttributes,
  type BoxRenderable,
  type ScrollBoxRenderable,
} from "@opentui/core";
import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
  type RefObject,
} from "react";
import {
  formatDate,
  formatDateShort,
  formatDateTime,
  type Config,
} from "../../core/config/config.ts";
import { RecurFreq, recurFreqString } from "../../core/task/recur.ts";
import {
  Status,
  completedSubtasks,
  priorityString,
  statusString,
  type Task,
} from "../../core/task/task.ts";
import { formatDuration, totalDuration } from "../../core/task/timelog.ts";
import { GoTime } from "../../core/time.ts";
import { DueLevel, dueStatus } from "../../core/ui/overdue.ts";
import { useSmoothScrollIntoView } from "../hooks/useSmoothScroll.ts";
import { detailRows, dueSentence, type DetailRow } from "../state.ts";
import { priorityColors, type TuiTheme } from "../theme.ts";
import { fitCells } from "../text.ts";
import {
  AnimatedMeter,
  Chip,
  EmptyState,
  KeyHint,
  MarkdownText,
  Section,
} from "./primitives.tsx";

/** Keyboard access to reading without changing the selected row. */
export interface TaskDetailHandle {
  /** Scrolls the panel by `lines`; negative scrolls up. */
  scrollBy: (lines: number) => void;
  getScrollTop: () => number;
  getViewportHeight: () => number;
  scrollTo: (top: number) => void;
  toggleDescription: () => void;
  revealSelection: () => void;
}

interface TaskDetailProps {
  theme: TuiTheme;
  cfg: Config;
  task: Task | null;
  focused: boolean;
  /** Position in `detailRows(task)`: subtasks, then notes, then time logs. */
  cursor: number;
  onSelectRow: (index: number) => void;
  /** Index inside `task.subtasks`, not the unified cursor. */
  onToggleSubtask: (subIndex: number) => void;
  /** Whether a blocker of this task is still open; a Done blocker does not
   * block, and the list row draws the same distinction. */
  blocked: boolean;
  /** The running focus session is attached to this task. */
  focusing?: boolean;
  blockedByTitles: Map<number, string>;
  /** Clicking a tag chip filters the list by it. */
  onFilterTag?: (tag: string) => void;
  onEditTask?: () => void;
  sectionStateRef?: RefObject<TaskDetailSectionState>;
  ref?: Ref<TaskDetailHandle>;
}

function Field({
  theme,
  label,
  value,
  color,
}: {
  theme: TuiTheme;
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <box flexDirection="row">
      <text fg={theme.textMuted}>{label.padEnd(11)}</text>
      <text fg={color ?? theme.text} flexGrow={1} wrapMode="word">
        {value}
      </text>
    </box>
  );
}

function useRowBackground(theme: TuiTheme, selected: boolean) {
  const [hover, setHover] = useState(false);
  return {
    background: selected
      ? theme.selectionBg
      : hover
        ? theme.hoverBg
        : undefined,
    onMouseOver: () => setHover(true),
    onMouseOut: () => setHover(false),
  };
}

function Rail({ theme, selected }: { theme: TuiTheme; selected: boolean }) {
  return (
    <text flexShrink={0} fg={selected ? theme.accent : theme.borderSubtle}>
      {selected ? "┃" : "│"}
    </text>
  );
}

interface SubtaskRowProps {
  theme: TuiTheme;
  id: string;
  title: string;
  completed: boolean;
  selected: boolean;
  onSelect: () => void;
  onToggle: () => void;
}

/** Like a task row: the row selects, only the checkbox toggles. */
function SubtaskRow({
  theme,
  id,
  title,
  completed,
  selected,
  onSelect,
  onToggle,
}: SubtaskRowProps) {
  const row = useRowBackground(theme, selected);
  return (
    <box
      id={id}
      flexDirection="row"
      backgroundColor={row.background}
      onMouseOver={row.onMouseOver}
      onMouseOut={row.onMouseOut}
      onMouseDown={onSelect}
    >
      <Rail theme={theme} selected={selected} />
      <box
        flexShrink={0}
        paddingLeft={1}
        paddingRight={1}
        onMouseDown={(event) => {
          event.stopPropagation();
          onToggle();
        }}
      >
        <text fg={completed ? theme.success : theme.textMuted}>
          {completed ? "▣" : "▢"}
        </text>
      </box>
      <text
        fg={completed ? theme.textMuted : theme.text}
        attributes={completed ? TextAttributes.STRIKETHROUGH : undefined}
        flexGrow={1}
        wrapMode="none"
        truncate
      >
        {title}
      </text>
    </box>
  );
}

interface NoteRowProps {
  theme: TuiTheme;
  id: string;
  stamp: string;
  body: string;
  selected: boolean;
  onSelect: () => void;
}

function NoteRow({ theme, id, stamp, body, selected, onSelect }: NoteRowProps) {
  const row = useRowBackground(theme, selected);
  return (
    <box
      id={id}
      flexDirection="row"
      paddingBottom={1}
      backgroundColor={row.background}
      onMouseOver={row.onMouseOver}
      onMouseOut={row.onMouseOut}
      onMouseDown={onSelect}
    >
      <Rail theme={theme} selected={selected} />
      <box flexDirection="column" flexGrow={1} paddingLeft={1}>
        <text fg={selected ? theme.accent : theme.textMuted}>{stamp}</text>
        <text fg={theme.text} wrapMode="word">
          {body}
        </text>
      </box>
    </box>
  );
}

interface TimeLogRowProps {
  theme: TuiTheme;
  id: string;
  date: string;
  duration: string;
  note: string;
  selected: boolean;
  onSelect: () => void;
}

function TimeLogRow({
  theme,
  id,
  date,
  duration,
  note,
  selected,
  onSelect,
}: TimeLogRowProps) {
  const row = useRowBackground(theme, selected);
  return (
    <box
      id={id}
      flexDirection="row"
      backgroundColor={row.background}
      onMouseOver={row.onMouseOver}
      onMouseOut={row.onMouseOut}
      onMouseDown={onSelect}
    >
      <Rail theme={theme} selected={selected} />
      <text flexShrink={0} fg={theme.textMuted}>{` ${date.padEnd(14)}`}</text>
      <text flexShrink={0} fg={theme.accent}>
        {duration}
      </text>
      {note !== "" ? (
        <text fg={theme.textDim} wrapMode="none" truncate>
          {`  ${note}`}
        </text>
      ) : null}
    </box>
  );
}

/** Renderable id of a detail row, the target of the cursor scroll. */
export function detailRowId(row: DetailRow): string {
  return `${row.kind}-${row.id}`;
}

interface DetailSections {
  description: boolean;
  details: boolean;
}

export type TaskDetailSectionState = Map<number, DetailSections>;

const expandedSections: DetailSections = { description: true, details: true };

/** Right panel: everything known about the selected task. */
export const TaskDetail = memo(function TaskDetail({
  task,
  ref,
  sectionStateRef,
  ...props
}: TaskDetailProps) {
  const localSectionsRef = useRef<TaskDetailSectionState>(new Map());
  const sectionsRef = sectionStateRef ?? localSectionsRef;
  const [, setSectionRevision] = useState(0);
  const taskId = task?.id;
  const toggleSection = useCallback(
    (section: keyof DetailSections) => {
      if (taskId === undefined) return;
      const sections = sectionsRef.current.get(taskId) ?? expandedSections;
      sectionsRef.current.set(taskId, { ...sections, [section]: !sections[section] });
      setSectionRevision((revision) => revision + 1);
    },
    [taskId, sectionsRef],
  );
  if (!task) {
    return (
      <EmptyState
        theme={props.theme}
        icon="◇"
        title="Nothing selected"
        hint="Pick a task on the left to see its details"
      />
    );
  }
  return (
    <TaskBody
      {...props}
      task={task}
      ref={ref}
      sections={sectionsRef.current.get(task.id) ?? expandedSections}
      onToggleSection={toggleSection}
    />
  );
});

function TaskBody({
  theme,
  cfg,
  task,
  focused,
  cursor,
  onSelectRow,
  onToggleSubtask,
  blocked,
  focusing = false,
  blockedByTitles,
  onFilterTag,
  onEditTask,
  sections,
  onToggleSection,
  ref,
}: Omit<TaskDetailProps, "task"> & {
  task: Task;
  sections: DetailSections;
  onToggleSection: (section: keyof DetailSections) => void;
}) {
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const titleRef = useRef<BoxRenderable | null>(null);
  const [titleWidth, setTitleWidth] = useState(0);
  const [revealRevision, setRevealRevision] = useState(0);
  const [scrollTarget, setScrollTarget] = useState<{
    id: string;
    revision: number;
  }>();
  const previous = useRef({ taskId: task.id, cursor, revealRevision });
  const rows = detailRows(task);
  const current = rows[cursor];
  const isSelected = (row: DetailRow) =>
    focused && current !== undefined && detailRowId(row) === detailRowId(current);

  useEffect(() => {
    if (previous.current.taskId !== task.id) {
      setScrollTarget(undefined);
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    } else if (
      current &&
      (previous.current.cursor !== cursor || previous.current.revealRevision !== revealRevision)
    ) {
      setScrollTarget((target) => ({
        id: detailRowId(current),
        revision: (target?.revision ?? 0) + 1,
      }));
    }
    previous.current = { taskId: task.id, cursor, revealRevision };
  }, [task.id, cursor, current, revealRevision]);

  const stopScrolling = useSmoothScrollIntoView(
    scrollRef,
    focused ? scrollTarget?.id : undefined,
    scrollTarget?.revision,
  );

  const toggleDescription = useCallback(() => {
    stopScrolling();
    setScrollTarget(undefined);
    onToggleSection("description");
    scrollRef.current?.scrollTo(0);
  }, [stopScrolling, onToggleSection]);
  const selectRow = (index: number) => {
    const row = rows[index];
    if (row) {
      setScrollTarget((target) => ({
        id: detailRowId(row),
        revision: (target?.revision ?? 0) + 1,
      }));
    }
    onSelectRow(index);
  };

  useImperativeHandle(
    ref,
    () => ({
      getScrollTop: () => scrollRef.current?.scrollTop ?? 0,
      getViewportHeight: () => scrollRef.current?.viewport.height ?? 0,
      scrollTo: (top) => {
        stopScrolling();
        setScrollTarget(undefined);
        scrollRef.current?.scrollTo(top);
      },
      scrollBy: (lines) => {
        stopScrolling();
        setScrollTarget(undefined);
        scrollRef.current?.scrollBy({ x: 0, y: lines });
      },
      toggleDescription,
      revealSelection: () => setRevealRevision((revision) => revision + 1),
    }),
    [stopScrolling, toggleDescription],
  );

  const now = GoTime.now();
  const done = task.status === Status.Done;
  // A finished task is never overdue, whatever its date says.
  const level =
    task.dueDate && !done ? dueStatus(task.dueDate, now) : DueLevel.None;
  const dueColor =
    level === DueLevel.Overdue
      ? theme.danger
      : level === DueLevel.Today
        ? theme.warning
        : theme.text;
  const logged = totalDuration(task.timeLogs);
  const subtaskRatio =
    task.subtasks.length > 0
      ? completedSubtasks(task) / task.subtasks.length
      : 0;

  const statusColor = done
    ? theme.success
    : task.status === Status.InProgress
      ? theme.accent
      : theme.textDim;

  const hasDescription = task.description !== "";
  const hasSubtasks = task.subtasks.length > 0;
  const hasNotes = task.notes.length > 0;
  const hasLogs = task.timeLogs.length > 0;
  const affordances: [string, string][] = [];
  if (!hasSubtasks) affordances.push(["t", "subtask"]);
  if (!hasNotes) affordances.push(["n", "note"]);
  if (!hasLogs) affordances.push(["L", "time"]);

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0}>
      <box flexDirection="column" flexShrink={0} paddingX={1}>
        <box flexDirection="row" height={1} flexShrink={0}>
          <text flexShrink={0} fg={statusColor} attributes={TextAttributes.BOLD}>
            {done ? "✓ " : task.status === Status.InProgress ? "◐ " : "○ "}
          </text>
          <box
            ref={titleRef}
            flexGrow={1}
            minWidth={0}
            onSizeChange={() => setTitleWidth(titleRef.current?.width ?? 0)}
          >
            <text
              fg={done ? theme.textDim : theme.text}
              attributes={TextAttributes.BOLD}
              wrapMode="none"
            >
              {fitCells(task.title, titleWidth)}
            </text>
          </box>
        </box>
        <box flexDirection="row" height={1} flexShrink={0}>
          <Chip
            theme={theme}
            label={statusString(task.status)}
            color={statusColor}
            filled={done}
            bold
          />
          <box width={1} flexShrink={0} />
          <Chip
            theme={theme}
            label={priorityString(task.priority)}
            color={priorityColors(theme)[task.priority] ?? theme.textDim}
          />
        </box>
        {onEditTask ? (
          <box height={1} flexShrink={0}>
            <KeyHint
              theme={theme}
              keyLabel="E"
              action="edit task"
              onPress={onEditTask}
            />
          </box>
        ) : null}
      </box>
      <scrollbox
        ref={scrollRef}
        // Never focused: a focused scrollbox answers j/k itself and would move
        // the viewport on top of the cursor. The cursor row is scrolled into
        // view instead, and page scrolling moves the viewport independently.
        focused={false}
        flexGrow={1}
        minHeight={0}
        scrollX={false}
        scrollbarOptions={{
          showArrows: false,
          trackOptions: {
            backgroundColor: theme.bg,
            foregroundColor: theme.border,
          },
        }}
        paddingLeft={1}
        paddingRight={1}
        contentOptions={{ flexDirection: "column" }}
      >
        {done || blocked || focusing || task.recurFreq !== RecurFreq.None ? (
          <box flexDirection="row" flexWrap="wrap" gap={1} paddingTop={1}>
            {done ? (
              <text fg={theme.textMuted}>
                {`Done · ${formatDateShort(cfg, task.updatedAt, now)}`}
              </text>
            ) : null}
            {blocked ? (
              <Chip theme={theme} label="BLOCKED" color={theme.danger} filled bold />
            ) : null}
            {focusing ? (
              <Chip theme={theme} label="▶ FOCUSING" color={theme.warning} filled bold />
            ) : null}
            {task.recurFreq !== RecurFreq.None ? (
              <Chip theme={theme} label={`↻ ${recurFreqString(task.recurFreq)}`} color={theme.secondary} />
            ) : null}
          </box>
        ) : null}

        <box paddingTop={1} flexDirection="column">
          {task.dueDate ? (
            done ? (
              <Field
                theme={theme}
                label="Was due"
                value={formatDate(cfg, task.dueDate)}
                color={theme.textDim}
              />
            ) : (
              <Field
                theme={theme}
                label="Due"
                // The date in words: no badge to decode, and the arithmetic
                // against today is already done.
                value={`${formatDate(cfg, task.dueDate)} · ${dueSentence(
                  task.dueDate,
                  now,
                )}`}
                color={dueColor}
              />
            )
          ) : null}
          {logged > 0 ? (
            <Field theme={theme} label="Logged" value={formatDuration(logged)} />
          ) : null}
          {task.tags.length > 0 ? (
            <box flexDirection="row">
              <text fg={theme.textMuted} flexShrink={0}>
                {"Tags".padEnd(11)}
              </text>
              <box flexDirection="row" flexWrap="wrap" flexGrow={1}>
                {task.tags.map((t) => (
                  <box key={t} flexDirection="row" marginRight={1}>
                    <Chip
                      theme={theme}
                      label={fitCells(`#${t}`, Math.max(2, titleWidth - 12))}
                      color={theme.secondary}
                      onPress={() => onFilterTag?.(t)}
                    />
                  </box>
                ))}
              </box>
            </box>
          ) : null}
          {task.metadata ? (
            <Field
              theme={theme}
              label="Metadata"
              value={Object.entries(task.metadata)
                .map(([k, v]) => `${k}=${v}`)
                .join(", ")}
              color={theme.textDim}
            />
          ) : null}
          {task.blockedByIds.length > 0 ? (
            <Field
              theme={theme}
              label="Blocked by"
              value={task.blockedByIds
                .map((id) => blockedByTitles.get(id) ?? `#${id}`)
                .join(", ")}
              color={theme.danger}
            />
          ) : null}
          {task.blocksIds.length > 0 ? (
            <Field
              theme={theme}
              label="Blocks"
              value={task.blocksIds
                .map((id) => blockedByTitles.get(id) ?? `#${id}`)
                .join(", ")}
              color={theme.warning}
            />
          ) : null}
        </box>

        {affordances.length > 0 ? (
          <box flexDirection="row" flexWrap="wrap" paddingTop={1}>
            {affordances.map(([key, action]) => (
              <KeyHint key={key} theme={theme} keyLabel={key} action={action} />
            ))}
          </box>
        ) : null}

        {hasDescription ? (
          <box flexDirection="column" paddingTop={1}>
            <box height={1} onMouseDown={toggleDescription}>
              <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
                {`${sections.description ? "▾" : "▸"} DESCRIPTION`}
              </text>
            </box>
            {sections.description ? (
              <MarkdownText theme={theme} content={task.description} />
            ) : null}
          </box>
        ) : null}

        {hasSubtasks ? (
          <Section theme={theme} title="Subtasks">
            <box flexDirection="row">
              <AnimatedMeter
                theme={theme}
                ratio={subtaskRatio}
                width={16}
                color={subtaskRatio === 1 ? theme.success : theme.accent}
                resetKey={task.id}
              />
              <text fg={theme.textMuted}>
                {`  ${completedSubtasks(task)}/${task.subtasks.length}`}
              </text>
            </box>
            {focused ? (
              <box height={1} />
            ) : (
              <text fg={theme.textMuted}>→ then space to check off</text>
            )}
            {task.subtasks.map((st, index) => {
              const row = rows[index]!;
              return (
                <SubtaskRow
                  key={st.id}
                  id={detailRowId(row)}
                  theme={theme}
                  title={st.title}
                  completed={st.completed}
                  selected={isSelected(row)}
                  onSelect={() => selectRow(index)}
                  onToggle={() => onToggleSubtask(index)}
                />
              );
            })}
          </Section>
        ) : null}

        {hasNotes ? (
          <Section theme={theme} title="Notes">
            {task.notes.map((n, index) => {
              const at = task.subtasks.length + index;
              const row = rows[at]!;
              return (
                <NoteRow
                  key={n.id}
                  id={detailRowId(row)}
                  theme={theme}
                  stamp={formatDateTime(cfg, n.createdAt)}
                  body={n.body}
                  selected={isSelected(row)}
                  onSelect={() => selectRow(at)}
                />
              );
            })}
          </Section>
        ) : null}

        {hasLogs ? (
          <Section theme={theme} title="Time">
            {task.timeLogs.map((tl, index) => {
              const at = task.subtasks.length + task.notes.length + index;
              const row = rows[at]!;
              return (
                <TimeLogRow
                  key={tl.id}
                  id={detailRowId(row)}
                  theme={theme}
                  date={formatDate(cfg, tl.loggedAt)}
                  duration={formatDuration(tl.duration)}
                  note={tl.note}
                  selected={isSelected(row)}
                  onSelect={() => selectRow(at)}
                />
              );
            })}
          </Section>
        ) : null}

        <box flexDirection="column" paddingTop={1}>
          <box
            height={1}
            onMouseDown={() => onToggleSection("details")}
          >
            <text fg={theme.textMuted} attributes={TextAttributes.BOLD}>
              {`${sections.details ? "▾" : "▸"} DETAILS`}
            </text>
          </box>
          {sections.details ? (
            <>
              <Field
                theme={theme}
                label="ID"
                value={`#${task.id}`}
                color={theme.textDim}
              />
              <Field
                theme={theme}
                label="Created"
                value={formatDate(cfg, task.createdAt)}
                color={theme.textDim}
              />
              <Field
                theme={theme}
                label="Updated"
                value={formatDateTime(cfg, task.updatedAt)}
                color={theme.textDim}
              />
            </>
          ) : null}
        </box>

        <box height={1} />
      </scrollbox>
    </box>
  );
}
