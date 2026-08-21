import { TextAttributes } from "@opentui/core";
import { useState } from "react";
import {
  formatDate,
  formatDateTime,
  type Config,
} from "../../core/config/config.ts";
import { recurFreqString } from "../../core/task/recur.ts";
import {
  RecurFreq,
} from "../../core/task/recur.ts";
import {
  Status,
  completedSubtasks,
  priorityString,
  statusString,
  type Task,
} from "../../core/task/task.ts";
import { formatDuration, totalDuration } from "../../core/task/timelog.ts";
import { GoTime } from "../../core/time.ts";
import { DueLevel, dueBadge, dueStatus } from "../../core/ui/overdue.ts";
import { priorityColors, type TuiTheme } from "../theme.ts";
import {
  AnimatedMeter,
  Chip,
  EmptyState,
  MarkdownText,
  Section,
} from "./primitives.tsx";

interface TaskDetailProps {
  theme: TuiTheme;
  cfg: Config;
  task: Task | null;
  focused: boolean;
  subtaskIndex: number;
  onSelectSubtask: (index: number) => void;
  onToggleSubtask: (index: number) => void;
  blockedByTitles: Map<number, string>;
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

interface SubtaskRowProps {
  theme: TuiTheme;
  title: string;
  completed: boolean;
  selected: boolean;
  onPress: () => void;
}

function SubtaskRow({
  theme,
  title,
  completed,
  selected,
  onPress,
}: SubtaskRowProps) {
  const [hover, setHover] = useState(false);
  return (
    <box
      flexDirection="row"
      backgroundColor={
        selected ? theme.selectionBg : hover ? theme.hoverBg : undefined
      }
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseDown={onPress}
    >
      <text flexShrink={0} fg={selected ? theme.accent : theme.borderSubtle}>
        {selected ? "┃" : "│"}
      </text>
      <text flexShrink={0} fg={completed ? theme.success : theme.textMuted}>
        {completed ? " ▣ " : " ▢ "}
      </text>
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

/** Right panel: everything known about the selected task. */
export function TaskDetail({
  theme,
  cfg,
  task,
  focused,
  subtaskIndex,
  onSelectSubtask,
  onToggleSubtask,
  blockedByTitles,
}: TaskDetailProps) {
  if (!task) {
    return (
      <EmptyState
        theme={theme}
        icon="◇"
        title="Nothing selected"
        hint="Pick a task on the left to see its details"
      />
    );
  }

  const now = GoTime.now();
  const level = task.dueDate ? dueStatus(task.dueDate, now) : DueLevel.None;
  const dueColor =
    level === DueLevel.Overdue
      ? theme.danger
      : level === DueLevel.Today
        ? theme.warning
        : theme.text;
  const logged = totalDuration(task.timeLogs);
  const done = task.status === Status.Done;
  const subtaskRatio =
    task.subtasks.length > 0
      ? completedSubtasks(task) / task.subtasks.length
      : 0;

  const statusColor = done
    ? theme.success
    : task.status === Status.InProgress
      ? theme.accent
      : theme.textDim;

  return (
    <scrollbox
      focused={focused}
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
        <Chip
          theme={theme}
          label={statusString(task.status)}
          color={statusColor}
          filled={done}
          bold
        />
        <box width={1} />
        <Chip
          theme={theme}
          label={priorityString(task.priority)}
          color={priorityColors(theme)[task.priority] ?? theme.textDim}
        />
        {task.blockedByIds.length > 0 ? (
          <>
            <box width={1} />
            <Chip theme={theme} label="BLOCKED" color={theme.danger} filled bold />
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
          <Field
            theme={theme}
            label="Due"
            value={`${formatDate(cfg, task.dueDate)}${
              dueBadge(level) ? `  ${dueBadge(level)}` : ""
            }`}
            color={dueColor}
          />
        ) : null}
        <Field
          theme={theme}
          label="Created"
          value={formatDate(cfg, task.createdAt)}
          color={theme.textDim}
        />
        {logged > 0 ? (
          <Field theme={theme} label="Logged" value={formatDuration(logged)} />
        ) : null}
        {task.tags.length > 0 ? (
          <Field
            theme={theme}
            label="Tags"
            value={task.tags.map((t) => `#${t}`).join("  ")}
            color={theme.secondary}
          />
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

      {task.description !== "" ? (
        <Section theme={theme} title="Description">
          <MarkdownText theme={theme} content={task.description} />
        </Section>
      ) : (
        <Section theme={theme} title="Description">
          <text fg={theme.textMuted}>press e to describe this task</text>
        </Section>
      )}

      {task.subtasks.length === 0 ? (
        <Section theme={theme} title="Subtasks">
          <text fg={theme.textMuted}>press t to add a step</text>
        </Section>
      ) : (
        <Section theme={theme} title="Subtasks">
          <box flexDirection="row" paddingBottom={1}>
            <AnimatedMeter
              theme={theme}
              ratio={subtaskRatio}
              width={16}
              color={subtaskRatio === 1 ? theme.success : theme.accent}
            />
            <text fg={theme.textMuted}>
              {`  ${completedSubtasks(task)}/${task.subtasks.length}`}
            </text>
          </box>
          {task.subtasks.map((st, index) => (
            <SubtaskRow
              key={st.id}
              theme={theme}
              title={st.title}
              completed={st.completed}
              selected={focused && index === subtaskIndex}
              onPress={() => {
                onSelectSubtask(index);
                onToggleSubtask(index);
              }}
            />
          ))}
        </Section>
      )}

      {task.notes.length === 0 ? (
        <Section theme={theme} title="Notes">
          <text fg={theme.textMuted}>press n to write one</text>
        </Section>
      ) : (
        <Section theme={theme} title="Notes">
          {task.notes.map((n) => (
            <box key={n.id} flexDirection="column" paddingBottom={1}>
              <text fg={theme.textMuted}>
                {`▪ ${formatDateTime(cfg, n.createdAt)}`}
              </text>
              <text fg={theme.text} wrapMode="word" paddingLeft={2}>
                {n.body}
              </text>
            </box>
          ))}
        </Section>
      )}

      {task.timeLogs.length === 0 ? (
        <Section theme={theme} title="Time">
          <text fg={theme.textMuted}>press L to log time</text>
        </Section>
      ) : (
        <Section theme={theme} title="Time">
          {task.timeLogs.map((tl) => (
            <box key={tl.id} flexDirection="row">
              <text fg={theme.textMuted}>
                {`${formatDate(cfg, tl.loggedAt).padEnd(14)}`}
              </text>
              <text fg={theme.accent}>{formatDuration(tl.duration)}</text>
              {tl.note !== "" ? (
                <text fg={theme.textDim}>{`  ${tl.note}`}</text>
              ) : null}
            </box>
          ))}
        </Section>
      )}

      <box height={1} />
    </scrollbox>
  );
}
