import { TextAttributes, type KeyEvent } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useState, type ReactNode } from "react";
import { Status, type Task } from "../../core/task/task.ts";
import { formatDuration, totalDuration } from "../../core/task/timelog.ts";
import { computeStreak } from "../../core/ui/stats.ts";
import { collectTags, SORT_LABELS, type SortKey } from "../state.ts";
import { mix, priorityColors, type TuiTheme } from "../theme.ts";
import { useCountdown } from "../hooks/useTween.ts";
import { Overlay } from "./Overlay.tsx";
import { AnimatedMeter, KeyHint, Meter } from "./primitives.tsx";

interface PanelProps {
  theme: TuiTheme;
  title: string;
  subtitle?: string;
  focused: boolean;
  children?: ReactNode;
  onMouseDown?: () => void;
}

/** Bordered panel whose chrome reflects focus, lazygit style. */
export function Panel({
  theme,
  title,
  subtitle,
  focused,
  children,
  onMouseDown,
}: PanelProps) {
  return (
    <box
      flexGrow={1}
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={focused ? theme.borderFocus : theme.border}
      title={focused ? ` ● ${title} ` : ` ${title} `}
      titleColor={focused ? theme.accent : theme.textMuted}
      bottomTitle={subtitle ? ` ${subtitle} ` : undefined}
      backgroundColor={theme.bg}
      onMouseDown={onMouseDown}
    >
      {children}
    </box>
  );
}

interface TagBarProps {
  theme: TuiTheme;
  tasks: readonly Task[];
  activeTag: string | null;
  onSelect: (tag: string | null) => void;
}

function TagChip({
  theme,
  label,
  active,
  onPress,
}: {
  theme: TuiTheme;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <box
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={
        active ? theme.secondary : hover ? theme.surfaceAlt : undefined
      }
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseDown={onPress}
    >
      <text
        fg={active ? theme.textOn : hover ? theme.text : theme.textDim}
        attributes={active ? TextAttributes.BOLD : undefined}
      >
        {label}
      </text>
    </box>
  );
}

/** Horizontal, clickable tag filter chips. */
export function TagBar({ theme, tasks, activeTag, onSelect }: TagBarProps) {
  const tags = collectTags(tasks);
  if (tags.length === 0) return null;

  return (
    <box
      flexDirection="row"
      height={1}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={mix(theme.surface, theme.bg, 0.4)}
    >
      <text fg={theme.textMuted}>{"tags "}</text>
      <TagChip
        theme={theme}
        label="all"
        active={activeTag === null}
        onPress={() => onSelect(null)}
      />
      {tags.slice(0, 12).map(({ tag, count }) => (
        <TagChip
          key={tag}
          theme={theme}
          label={`#${tag} ${count}`}
          active={activeTag === tag}
          onPress={() => onSelect(activeTag === tag ? null : tag)}
        />
      ))}
    </box>
  );
}

interface SearchBarProps {
  theme: TuiTheme;
  value: string;
  active: boolean;
  onInput: (v: string) => void;
  onSubmit: () => void;
  resultCount: number;
  totalCount: number;
}

/** Live filter bar shown above the list while searching. */
export function SearchBar({
  theme,
  value,
  active,
  onInput,
  onSubmit,
  resultCount,
  totalCount,
}: SearchBarProps) {
  const empty = value !== "" && resultCount === 0;
  return (
    <box
      flexDirection="row"
      height={1}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={mix(theme.surfaceAlt, theme.accentSoft, active ? 0.5 : 0)}
    >
      <text fg={empty ? theme.danger : theme.accent} attributes={TextAttributes.BOLD}>
        {"⌕ "}
      </text>
      <box flexGrow={1}>
        <input
          focused={active}
          value={value}
          placeholder="filter by title, description or tag…"
          onInput={onInput}
          onSubmit={onSubmit}
          backgroundColor="transparent"
          textColor={theme.text}
          placeholderColor={theme.textMuted}
          cursorColor={theme.accent}
        />
      </box>
      <text fg={empty ? theme.danger : theme.textMuted}>
        {`${resultCount}/${totalCount}`}
      </text>
    </box>
  );
}

interface StatusBarProps {
  theme: TuiTheme;
  hints: [string, string][];
  message: string | null;
  messageKind: "info" | "success" | "error";
  /** Changes whenever a new message arrives, restarting the timer bar. */
  messageId: number;
  /** How long the current toast lives; errors get longer than info. */
  messageMs: number;
  /** Omitted where sorting does not apply, e.g. the journal. */
  sort?: SortKey;
  width: number;
}

/** Bottom bar: key hints, or the active toast with a draining timer bar. */
export function StatusBar({
  theme,
  hints,
  message,
  messageKind,
  messageId,
  messageMs,
  sort,
  width,
}: StatusBarProps) {
  const remaining = useCountdown(message ? messageId : null, messageMs);

  const tone =
    messageKind === "error"
      ? theme.danger
      : messageKind === "success"
        ? theme.success
        : theme.accent;

  const icon =
    messageKind === "error" ? "✕" : messageKind === "success" ? "✓" : "•";

  const shown = width < 84 ? hints.slice(0, 4) : hints;

  return (
    <box flexDirection="column">
      <box
        flexDirection="row"
        height={1}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={theme.surface}
      >
        {message ? (
          <box flexDirection="row" flexGrow={1}>
            <text fg={tone} attributes={TextAttributes.BOLD}>
              {`${icon} `}
            </text>
            <text fg={theme.text} flexGrow={1} wrapMode="none" truncate>
              {message}
            </text>
          </box>
        ) : (
          <box flexDirection="row" flexGrow={1}>
            {shown.map(([key, label]) => (
              <KeyHint key={key} theme={theme} keyLabel={key} action={label} />
            ))}
          </box>
        )}
        {sort ? (
          <text fg={theme.textMuted}>{`⇅ ${SORT_LABELS[sort]}`}</text>
        ) : null}
      </box>

      {/* Toast timer: a hairline that drains as the message expires. The row
          is always present so the layout never jumps when a toast appears. */}
      <box height={1} flexDirection="row">
        <Meter
          theme={theme}
          ratio={message ? remaining : 0}
          width={width}
          color={tone}
          trackColor={theme.bg}
          thin
        />
      </box>
    </box>
  );
}

interface HelpOverlayProps {
  theme: TuiTheme;
  screenWidth: number;
  screenHeight: number;
  onClose: () => void;
}

const HELP_SECTIONS: [string, [string, string][]][] = [
  [
    "Navigation",
    [
      ["j / k, ↑ / ↓", "Move selection"],
      ["h / l, 1 / 2", "Switch panel"],
      ["tab / shift+tab", "Switch view"],
      ["g / G", "Jump to first / last"],
      ["click", "Select row, toggle status glyph"],
      ["wheel", "Scroll lists"],
    ],
  ],
  [
    "Tasks",
    [
      ["a", "Add task"],
      ["e", "Edit task"],
      ["d", "Delete task"],
      ["space / s", "Cycle status"],
      ["t", "Add subtask"],
      ["n", "Add note"],
      ["L", "Log time (\"45m note\")"],
      ["o", "Cycle sort order"],
      ["/", "Filter tasks"],
      ["#", "Toggle tag bar"],
    ],
  ],
  [
    "Journal",
    [
      ["a", "Add entry to today"],
      ["e", "Edit entry"],
      ["d", "Delete entry"],
      ["/", "Search entries"],
      ["H", "Show hidden notes"],
      ["x", "Hide / restore note"],
    ],
  ],
  [
    "Global",
    [
      ["ctrl+k", "Command palette"],
      ["P", "Focus settings"],
      ["< / >, drag", "Resize panels"],
      ["F1 / F2 / F3", "Sort by created / due / priority"],
      ["f", "Start / stop focus timer"],
      ["S", "Statistics"],
      ["u", "Undo last delete"],
      ["T", "Toggle light / dark"],
      ["?", "This help"],
      ["q", "Quit"],
    ],
  ],
];

export function HelpOverlay({
  theme,
  screenWidth,
  screenHeight,
  onClose,
}: HelpOverlayProps) {
  useKeyboard((key: KeyEvent) => {
    if (key.name === "escape" || key.sequence === "?") {
      onClose();
    }
  });

  return (
    <Overlay
      theme={theme}
      title="Keyboard & mouse"
      subtitle="everything is clickable too"
      width={74}
      height={Math.min(screenHeight - 2, 30)}
      screenWidth={screenWidth}
      screenHeight={screenHeight}
      footer="esc close"
      onBackdropClick={onClose}
    >
      <scrollbox focused flexGrow={1} contentOptions={{ flexDirection: "column" }}>
        {HELP_SECTIONS.map(([section, rows]) => (
          <box key={section} flexDirection="column" paddingBottom={1}>
            <text fg={theme.accent} attributes={TextAttributes.BOLD}>
              {section.toUpperCase()}
            </text>
            {rows.map(([key, label]) => (
              <box key={key} flexDirection="row">
                <text fg={theme.text}>{key.padEnd(18)}</text>
                <text fg={theme.textDim}>{label}</text>
              </box>
            ))}
          </box>
        ))}
      </scrollbox>
    </Overlay>
  );
}

interface StatsOverlayProps {
  theme: TuiTheme;
  tasks: readonly Task[];
  completionsByDay: Record<string, number>;
  todayFocus: number;
  focusGoal: number;
  streakDays: number;
  screenWidth: number;
  screenHeight: number;
  onClose: () => void;
}

function StatRow({
  theme,
  label,
  value,
  ratio,
  color,
  width = 26,
}: {
  theme: TuiTheme;
  label: string;
  value: number | string;
  ratio: number;
  color: string;
  width?: number;
}) {
  return (
    <box flexDirection="row">
      <text fg={theme.textDim}>{label.padEnd(12)}</text>
      <AnimatedMeter theme={theme} ratio={ratio} width={width} color={color} />
      <text fg={theme.text}>{` ${value}`}</text>
    </box>
  );
}

const SPARKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

export function StatsOverlay({
  theme,
  tasks,
  completionsByDay,
  todayFocus,
  focusGoal,
  streakDays,
  screenWidth,
  screenHeight,
  onClose,
}: StatsOverlayProps) {
  useKeyboard((key: KeyEvent) => {
    if (key.name === "escape" || key.sequence === "S") onClose();
  });

  const total = tasks.length;
  const done = tasks.filter((t) => t.status === Status.Done).length;
  const active = tasks.filter((t) => t.status === Status.InProgress).length;
  const pending = total - done - active;
  const openTasks = tasks.filter((t) => t.status !== Status.Done);
  const byPriority = [0, 1, 2, 3].map(
    (p) => openTasks.filter((t) => t.priority === p).length,
  );
  const maxPriority = Math.max(...byPriority, 1);
  const logged = tasks.reduce((sum, t) => sum + totalDuration(t.timeLogs), 0);

  const { current, longest, data } = computeStreak(completionsByDay, 30);
  const maxDay = Math.max(...data, 1);
  const spark = data
    .map((v) => SPARKS[Math.min(Math.trunc((v * 7) / maxDay), 7)]!)
    .join("");

  return (
    <Overlay
      theme={theme}
      title="Statistics"
      subtitle={`${total} tasks · ${formatDuration(logged)} logged`}
      width={66}
      screenWidth={screenWidth}
      screenHeight={screenHeight}
      footer="esc close"
      onBackdropClick={onClose}
    >
      <box flexDirection="column" paddingTop={1}>
        <text fg={theme.accent} attributes={TextAttributes.BOLD}>
          TASKS
        </text>
        <StatRow theme={theme} label="done" value={done} ratio={done / (total || 1)} color={theme.success} />
        <StatRow theme={theme} label="in progress" value={active} ratio={active / (total || 1)} color={theme.accent} />
        <StatRow theme={theme} label="todo" value={pending} ratio={pending / (total || 1)} color={theme.textDim} />

        <box height={1} />
        <text fg={theme.accent} attributes={TextAttributes.BOLD}>
          OPEN BY PRIORITY
        </text>
        {["low", "medium", "high", "urgent"].map((label, i) => (
          <StatRow
            key={label}
            theme={theme}
            label={label}
            value={byPriority[i] ?? 0}
            ratio={(byPriority[i] ?? 0) / maxPriority}
            color={priorityColors(theme)[i] ?? theme.textDim}
          />
        ))}

        <box height={1} />
        <text fg={theme.accent} attributes={TextAttributes.BOLD}>
          FOCUS
        </text>
        <StatRow
          theme={theme}
          label="today"
          value={`${todayFocus} / ${focusGoal}`}
          ratio={focusGoal > 0 ? todayFocus / focusGoal : 0}
          color={theme.warning}
        />
        <box flexDirection="row">
          <text fg={theme.textDim}>{"streak      "}</text>
          <text fg={theme.text}>{`${streakDays} days`}</text>
          <text fg={theme.textDim}>{"    logged  "}</text>
          <text fg={theme.text}>{formatDuration(logged)}</text>
        </box>

        <box height={1} />
        <text fg={theme.accent}>{spark}</text>
        <text fg={theme.textMuted}>
          {`last 30 days · current ${current}d · longest ${longest}d`}
        </text>
      </box>
    </Overlay>
  );
}
