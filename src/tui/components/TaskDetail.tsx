import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import {
  memo,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
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
  scrollTo: (top: number) => void;
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

/** Right panel: everything known about the selected task. */
export const TaskDetail = memo(function TaskDetail({
  task,
  ref,
  ...props
}: TaskDetailProps) {
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
  return <TaskBody {...props} task={task} ref={ref} />;
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
  ref,
}: Omit<TaskDetailProps, "task"> & { task: Task }) {
  const scrollRef = useRef<ScrollBoxRenderable | null>(null);
  const rows = detailRows(task);
  const current = rows[cursor];
  const isSelected = (row: DetailRow) =>
    focused && current !== undefined && detailRowId(row) === detailRowId(current);

  // Another task starts at its title; the cursor row remembered from the
  // previous one must not leave the panel scrolled to the bottom.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [task.id]);

  const stopScrolling = useSmoothScrollIntoView(
    scrollRef,
    focused && current ? detailRowId(current) : undefined,
  );

  useImperativeHandle(
    ref,
    () => ({
      getScrollTop: () => scrollRef.current?.scrollTop ?? 0,
      scrollTo: (top) => {
        stopScrolling();
        scrollRef.current?.scrollTo(top);
      },
      scrollBy: (lines) => {
        stopScrolling();
        scrollRef.current?.scrollBy({ x: 0, y: lines });
      },
    }),
    [stopScrolling],
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
  if (!hasDescription) affordances.push(["e", "describe"]);
  if (!hasSubtasks) affordances.push(["t", "subtask"]);
  if (!hasNotes) affordances.push(["n", "note"]);
  if (!hasLogs) affordances.push(["L", "time"]);

  return (
    <scrollbox
      ref={scrollRef}
      // Never focused: a focused scrollbox answers j/k itself and would move
      // the viewport on top of the cursor. The cursor row is scrolled into
      // view instead, and page scrolling moves the viewport independently.
      focused={false}
      flexGrow={1}
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
      <box flexDirection="row" paddingTop={1}>
        <text flexShrink={0} fg={statusColor} attributes={TextAttributes.BOLD}>
          {done ? "✓ " : task.status === Status.InProgress ? "◐ " : "○ "}
        </text>
        <text
          fg={done ? theme.textDim : theme.text}
          attributes={TextAttributes.BOLD}
          wrapMode="word"
          flexGrow={1}
        >
          {task.title}
        </text>
      </box>

      <box flexDirection="row" paddingTop={1}>
        <box flexDirection="row" flexShrink={0}>
          <Chip
            theme={theme}
            label={statusString(task.status)}
            color={statusColor}
            filled={done}
            bold
          />
          {done ? (
            <text fg={theme.textMuted}>
              {`· ${formatDateShort(cfg, task.updatedAt, now)}`}
            </text>
          ) : null}
        </box>
        <box width={1} />
        <Chip
          theme={theme}
          label={priorityString(task.priority)}
          color={priorityColors(theme)[task.priority] ?? theme.textDim}
        />
        {blocked ? (
          <>
            <box width={1} />
            <Chip theme={theme} label="BLOCKED" color={theme.danger} filled bold />
          </>
        ) : null}
        {focusing ? (
          <>
            <box width={1} />
            <Chip theme={theme} label="▶ FOCUSING" color={theme.warning} filled bold />
          </>
        ) : null}
        {task.recurFreq !== RecurFreq.None ? (
          <>
            <box width={1} />
            <Chip
              theme={theme}
              label={`↻ ${recurFreqString(task.recurFreq)}`}
              color={theme.secondary}
            />
          </>
        ) : null}
      </box>

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
                    label={`#${t}`}
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
        <Section theme={theme} title="Description">
          <MarkdownText theme={theme} content={task.description} />
        </Section>
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
                onSelect={() => onSelectRow(index)}
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
                onSelect={() => onSelectRow(at)}
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
                onSelect={() => onSelectRow(at)}
              />
            );
          })}
        </Section>
      ) : null}

      <Section theme={theme} title="Details">
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
      </Section>

      <box height={1} />
    </scrollbox>
  );
}
