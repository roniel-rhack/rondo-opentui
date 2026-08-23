import { TextAttributes, type KeyEvent } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { memo, useState, type ReactNode } from "react";
import { Status, type Task } from "../../core/task/task.ts";
import { formatDuration, totalDuration } from "../../core/task/timelog.ts";
import { GoTime } from "../../core/time.ts";
import { computeStreak } from "../../core/ui/stats.ts";
import {
  HELP_SECTIONS,
  fitHints,
  fitTags,
  loggedSince,
  plural,
  SORT_LABELS,
  type Hint,
  type HelpSection,
  type SortKey,
  type ToastKind,
} from "../state.ts";
import { mix, priorityColors, type TuiTheme } from "../theme.ts";
import { useCountdown } from "../hooks/useTween.ts";
import { Overlay } from "./Overlay.tsx";
import { AnimatedMeter, KeyHint, Meter } from "./primitives.tsx";
import type { TagCount } from "./Dialogs.tsx";

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

interface PanelDividerProps {
  theme: TuiTheme;
  /** Column the pointer is dragged to, in screen coordinates. */
  onDrag: (x: number) => void;
}

/** The column between the panels: visible as a hairline, lit while the
 * pointer is over it so it reads as the drag handle it is. */
export function PanelDivider({ theme, onDrag }: PanelDividerProps) {
  const [hover, setHover] = useState(false);
  return (
    <box
      width={1}
      flexShrink={0}
      backgroundColor={hover ? theme.borderFocus : theme.border}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseDrag={(event) => onDrag(event.x)}
    />
  );
}

interface TagBarProps {
  theme: TuiTheme;
  /** Tags in use, most used first; the caller memoizes them per task list. */
  tags: readonly TagCount[];
  activeTag: string | null;
  width: number;
  onSelect: (tag: string | null) => void;
  /** Pressed on the "+N" chip when not every tag fits; opens the tag picker. */
  onMore?: () => void;
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
      flexShrink={0}
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
        wrapMode="none"
      >
        {label}
      </text>
    </box>
  );
}

/** Horizontal, clickable tag filter chips. */
export const TagBar = memo(function TagBar({
  theme,
  tags,
  activeTag,
  width,
  onSelect,
  onMore,
}: TagBarProps) {
  if (tags.length === 0) return null;

  const available = width - 2;
  let { shown, hidden } = fitTags(tags, available);
  // An active tag that got trimmed would be a filter the user cannot see or
  // clear, so only then does it move to the front.
  const active = tags.find((t) => t.tag === activeTag);
  if (active && !shown.includes(active)) {
    ({ shown, hidden } = fitTags(
      [active, ...tags.filter((t) => t !== active)],
      available,
    ));
  }

  return (
    <box
      flexDirection="row"
      flexShrink={0}
      height={1}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={theme.surface}
    >
      <text fg={theme.textMuted} flexShrink={0}>
        {"tags "}
      </text>
      <TagChip
        theme={theme}
        label="all"
        active={activeTag === null}
        onPress={() => onSelect(null)}
      />
      {shown.map(({ tag, count }) => (
        <TagChip
          key={tag}
          theme={theme}
          label={`#${tag} ${count}`}
          active={activeTag === tag}
          onPress={() => onSelect(activeTag === tag ? null : tag)}
        />
      ))}
      {hidden > 0 ? (
        <TagChip
          theme={theme}
          label={`+${hidden}`}
          active={false}
          onPress={() => onMore?.()}
        />
      ) : null}
    </box>
  );
});

interface SearchBarProps {
  theme: TuiTheme;
  value: string;
  active: boolean;
  onInput: (v: string) => void;
  onSubmit: () => void;
  /** What the field matches, which differs per tab: the task grammar names
   * its tokens, the journal only has entry text. */
  placeholder: string;
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
  placeholder,
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
          placeholder={placeholder}
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
  hints: readonly Hint[];
  message: string | null;
  messageKind: ToastKind;
  /** Changes whenever a new message arrives, restarting the timer bar. */
  messageId: number;
  /** How long the current toast lives; errors get longer than info. */
  messageMs: number;
  /** Omitted where sorting does not apply, e.g. the journal. */
  sort?: SortKey;
  /** Clicking the sort segment cycles the order, like `o`. */
  onCycleSort?: () => void;
  width: number;
}

function SortSegment({
  theme,
  label,
  onPress,
}: {
  theme: TuiTheme;
  label: string;
  onPress?: () => void;
}) {
  const [hover, setHover] = useState(false);
  const lit = hover && onPress !== undefined;
  return (
    <box
      flexShrink={0}
      paddingLeft={1}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseDown={onPress}
    >
      <text fg={lit ? theme.text : theme.textMuted} wrapMode="none">
        {label}
      </text>
    </box>
  );
}

/** Bottom bar: key hints, or the active toast with a draining timer bar. */
export const StatusBar = memo(function StatusBar({
  theme,
  hints,
  message,
  messageKind,
  messageId,
  messageMs,
  sort,
  onCycleSort,
  width,
}: StatusBarProps) {
  const remaining = useCountdown(message ? messageId : null, messageMs, width);

  const tone =
    messageKind === "error"
      ? theme.danger
      : messageKind === "undo"
        ? theme.warning
        : messageKind === "success"
          ? theme.success
          : theme.accent;

  const icon =
    messageKind === "error"
      ? "✕"
      : messageKind === "undo"
        ? "↶"
        : messageKind === "success"
          ? "✓"
          : "•";

  const sortLabel = sort ? `⇅ ${SORT_LABELS[sort]}` : "";
  // Horizontal padding, then the sort segment and its leading gap.
  const available = width - 2 - (sort ? sortLabel.length + 1 : 0);
  const shown = fitHints(hints, available);

  return (
    <box flexDirection="column" flexShrink={0}>
      <box
        flexDirection="row"
        height={1}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={theme.surface}
      >
        {message ? (
          <box flexDirection="row" flexGrow={1} minWidth={0}>
            <text fg={tone} attributes={TextAttributes.BOLD} flexShrink={0}>
              {`${icon} `}
            </text>
            <text fg={theme.text} flexGrow={1} wrapMode="none" truncate>
              {message}
            </text>
          </box>
        ) : (
          <box flexDirection="row" flexGrow={1} minWidth={0}>
            {shown.map((hint) => (
              <KeyHint
                key={hint.key}
                theme={theme}
                keyLabel={hint.key}
                action={hint.label}
                onPress={hint.run}
              />
            ))}
          </box>
        )}
        {sort ? (
          <SortSegment theme={theme} label={sortLabel} onPress={onCycleSort} />
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
});

interface HelpOverlayProps {
  theme: TuiTheme;
  screenWidth: number;
  screenHeight: number;
  onClose: () => void;
}

// Balanced for the wide layout: 38 and 33 rows; the body scrolls for the
// rest. Marks sits with the filters because both narrow what the keys act on.
const HELP_COLUMNS: [HelpSection[], HelpSection[]] = [
  [HELP_SECTIONS[0]!, HELP_SECTIONS[1]!, HELP_SECTIONS[5]!, HELP_SECTIONS[6]!],
  [HELP_SECTIONS[3]!, HELP_SECTIONS[2]!, HELP_SECTIONS[4]!],
];

function HelpColumn({
  theme,
  sections,
  keyWidth,
}: {
  theme: TuiTheme;
  sections: readonly HelpSection[];
  keyWidth: number;
}) {
  return (
    <box flexDirection="column" minWidth={0}>
      {sections.map(([section, rows]) => (
        <box key={section} flexDirection="column" paddingBottom={1}>
          <text fg={theme.accent} attributes={TextAttributes.BOLD}>
            {section.toUpperCase()}
          </text>
          {rows.map(([key, label], i) => (
            <box key={`${i}-${key}`} flexDirection="row">
              <text fg={theme.text} flexShrink={0}>
                {key.padEnd(keyWidth)}
              </text>
              <text fg={theme.textDim} wrapMode="none" truncate>
                {label}
              </text>
            </box>
          ))}
        </box>
      ))}
    </box>
  );
}

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

  const twoColumns = screenWidth >= 110;

  return (
    <Overlay
      theme={theme}
      title="Keyboard & mouse"
      subtitle="everything is clickable too"
      width={twoColumns ? 104 : 74}
      height={Math.min(screenHeight - 2, twoColumns ? 36 : 30)}
      screenWidth={screenWidth}
      screenHeight={screenHeight}
      footer="↑↓ / j k scroll · esc close"
      onBackdropClick={onClose}
    >
      <scrollbox focused flexGrow={1} contentOptions={{ flexDirection: "column" }}>
        {twoColumns ? (
          <box flexDirection="row">
            <box flexGrow={1} flexBasis={0} minWidth={0}>
              <HelpColumn theme={theme} sections={HELP_COLUMNS[0]} keyWidth={16} />
            </box>
            <box width={2} flexShrink={0} />
            <box flexGrow={1} flexBasis={0} minWidth={0}>
              <HelpColumn theme={theme} sections={HELP_COLUMNS[1]} keyWidth={13} />
            </box>
          </box>
        ) : (
          <HelpColumn theme={theme} sections={HELP_SECTIONS} keyWidth={17} />
        )}
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
      <AnimatedMeter theme={theme} ratio={ratio} width={width} color={color} animateIn />
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

  // Same windows as `timelog summary --days`: today since local midnight,
  // the week as a rolling seven days.
  const now = GoTime.now();
  const { year, month, day } = now.parts;
  const midnight = GoTime.date(year, month, day, 0, 0, 0, 0, "local");
  const loggedToday = loggedSince(tasks, midnight);
  const loggedWeek = loggedSince(tasks, now.addDate(0, 0, -7));

  const { current, longest, data } = computeStreak(completionsByDay, 30);
  const maxDay = Math.max(...data, 1);
  const spark = data
    .map((v) => SPARKS[Math.min(Math.trunc((v * 7) / maxDay), 7)]!)
    .join("");

  return (
    <Overlay
      theme={theme}
      title="Statistics"
      subtitle={`${plural(total, "task")} · ${formatDuration(logged)} logged`}
      width={66}
      height={Math.min(screenHeight - 2, 24)}
      screenWidth={screenWidth}
      screenHeight={screenHeight}
      footer="esc close"
      onBackdropClick={onClose}
    >
      <scrollbox
        focused
        flexGrow={1}
        contentOptions={{ flexDirection: "column", paddingTop: 1 }}
      >
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
          <text fg={theme.text}>{`${streakDays} ${streakDays === 1 ? "day" : "days"}`}</text>
        </box>
        <box flexDirection="row">
          <text fg={theme.textDim}>{"logged      "}</text>
          <text fg={theme.text}>
            {`${formatDuration(logged)} · today ${formatDuration(loggedToday)} · 7d ${formatDuration(loggedWeek)}`}
          </text>
        </box>

        <box height={1} />
        <text fg={theme.accent}>{spark}</text>
        <text fg={theme.textMuted}>
          {`last 30 days · current ${current}d · longest ${longest}d`}
        </text>
      </scrollbox>
    </Overlay>
  );
}
