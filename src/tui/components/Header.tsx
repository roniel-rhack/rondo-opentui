import { TextAttributes } from "@opentui/core";
import React, { memo, useEffect, useState } from "react";
import { formatTimer } from "../../core/focus/focus.ts";
import { GoTime } from "../../core/time.ts";
import type { TuiTheme } from "../theme.ts";
import { TABS, type TabCounts, type TabId } from "../state.ts";
import { Meter } from "./primitives.tsx";

export interface HeaderFocus {
  /** Wall-clock end of the running session (ms), or null when idle. */
  endAt: number | null;
  durationMs: number;
  label: string;
  color: string;
  /** Title of the task the session is attached to, when there is one. */
  task?: string;
  cycleDots: string;
  /** What `f` starts next, shown dimmed while idle. */
  nextLabel: string;
}

interface HeaderProps {
  theme: TuiTheme;
  activeTab: TabId;
  counts: TabCounts;
  onSelectTab: (tab: TabId) => void;
  focus: HeaderFocus;
  compact: boolean;
  width: number;
}

const CLOCK_WIDTH = 5;
const METER_WIDTH = 10;
const TIMER_WIDTH = 5;
/** Shortest title worth showing: a few letters, an ellipsis and " · ". */
const MIN_TITLE = 8;

interface TabButtonProps {
  theme: TuiTheme;
  label: string;
  keycap: string;
  count: number;
  active: boolean;
  compact: boolean;
  onPress: () => void;
}

function tabWidth(label: string, count: number, compact: boolean): number {
  return 2 + (compact ? 0 : 2) + label.length + 1 + String(count).length;
}

function TabButton({
  theme,
  label,
  keycap,
  count,
  active,
  compact,
  onPress,
}: TabButtonProps) {
  const [hover, setHover] = useState(false);
  const bg = active
    ? theme.accent
    : hover
      ? theme.surfaceAlt
      : theme.surface;
  const fg = active ? theme.textOn : hover ? theme.text : theme.textDim;

  return (
    <box
      flexDirection="row"
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={bg}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseDown={onPress}
    >
      {compact ? null : (
        <text fg={active ? theme.textOn : theme.textMuted}>{`${keycap} `}</text>
      )}
      <text fg={fg} attributes={active ? TextAttributes.BOLD : undefined}>
        {label}
      </text>
      <text fg={active ? theme.textOn : theme.textMuted}>{` ${count}`}</text>
    </box>
  );
}

/** Wall clock with its own 15 s tick, so the rest of the tree never sees it. */
function Clock({ theme }: { theme: TuiTheme }) {
  const [clock, setClock] = useState(() => GoTime.now().format("15:04"));

  useEffect(() => {
    const id = setInterval(() => setClock(GoTime.now().format("15:04")), 15_000);
    return () => clearInterval(id);
  }, []);

  return (
    <text fg={theme.textMuted} flexShrink={0}>
      {clock}
    </text>
  );
}

interface FocusTimerProps {
  theme: TuiTheme;
  endAt: number;
  durationMs: number;
  /** Omitted when only the digits fit. */
  label: string | null;
  color: string;
  title?: string;
  meter: boolean;
  dots: string | null;
}

/**
 * Running session readout. Owns the one-second tick: the remaining time is
 * derived from `endAt`, so nothing above this leaf re-renders per second.
 */
function FocusTimer({
  theme,
  endAt,
  durationMs,
  label,
  color,
  title,
  meter,
  dots,
}: FocusTimerProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [endAt]);

  const remainingMs = Math.max(endAt - now, 0);
  const ratio = durationMs > 0 ? 1 - remainingMs / durationMs : 0;
  const digits = formatTimer(remainingMs * 1e6);

  return (
    <box flexDirection="row" flexShrink={1} minWidth={0} paddingRight={1}>
      {title ? (
        <text fg={theme.textDim} wrapMode="none" truncate>
          {`${title} · `}
        </text>
      ) : null}
      <text fg={color} attributes={TextAttributes.BOLD} flexShrink={0}>
        {label ? `${label} ${digits}` : digits}
      </text>
      {meter ? (
        <box flexDirection="row" flexShrink={0} paddingLeft={1}>
          <Meter theme={theme} ratio={ratio} width={METER_WIDTH} color={color} />
        </box>
      ) : null}
      {dots ? (
        <text fg={theme.textMuted} flexShrink={0}>
          {` ${dots}`}
        </text>
      ) : null}
    </box>
  );
}

/** Truncated by hand: the renderer elides in the middle, which reads badly. */
function trimTitle(title: string, cap: number): string {
  return title.length > cap ? `${title.slice(0, cap - 1)}…` : title;
}

/** Top bar: brand, clickable tabs, live focus timer and clock. */
export const Header = memo(function Header({
  theme,
  activeTab,
  counts,
  onSelectTab,
  focus,
  compact,
  width,
}: HeaderProps) {
  const brand = compact ? "◆" : "◆ RonDO";
  const gap = compact ? 1 : 2;
  const divider = compact ? "│" : " │ ";

  // Everything but the timer block is fixed; the timer gets what is left and
  // sheds its optional parts (title, then dots, then meter) before any tab or
  // the clock would have to give way.
  let fixed = 2 + brand.length + gap + CLOCK_WIDTH;
  TABS.forEach((tab, index) => {
    if (index > 0 && TABS[index - 1]!.group !== tab.group) {
      fixed += divider.length;
    }
    fixed += tabWidth(tab.label, counts[tab.id], compact);
  });
  const spare = width - fixed;

  // Below the label's budget the digits alone still tell the time; below
  // even that, the header gives up on the timer rather than clip a tab.
  const showLabel = spare >= focus.label.length + 1 + TIMER_WIDTH + 1;
  const showTimer = showLabel || spare >= TIMER_WIDTH + 1;
  let room = spare - (showLabel ? focus.label.length + 1 : 0) - TIMER_WIDTH - 1;
  const showMeter = !compact && room >= METER_WIDTH + 1;
  if (showMeter) room -= METER_WIDTH + 1;
  const showDots = !compact && room >= focus.cycleDots.length + 1;
  if (showDots) room -= focus.cycleDots.length + 1;
  const title =
    focus.task && !compact && room >= MIN_TITLE
      ? trimTitle(focus.task, room - 3)
      : undefined;

  const idle = `next: ${focus.nextLabel}`;
  const showIdle = spare >= idle.length + 1;

  return (
    <box flexDirection="column" flexShrink={0}>
      <box
        flexDirection="row"
        alignItems="center"
        height={1}
        backgroundColor={theme.surface}
        paddingLeft={1}
        paddingRight={1}
      >
        <text fg={theme.accent} attributes={TextAttributes.BOLD} flexShrink={0}>
          {brand}
        </text>
        <box width={gap} flexShrink={0} />

        {TABS.map((tab, index) => (
          <React.Fragment key={tab.id}>
            {/* Tasks and the journal are separate things; keep them apart. */}
            {index > 0 && TABS[index - 1]!.group !== tab.group ? (
              <text fg={theme.border} flexShrink={0}>
                {divider}
              </text>
            ) : null}
            <TabButton
              theme={theme}
              label={tab.label}
              keycap={String(index + 1)}
              count={counts[tab.id]}
              active={tab.id === activeTab}
              compact={compact}
              onPress={() => onSelectTab(tab.id)}
            />
          </React.Fragment>
        ))}

        <box flexGrow={1} />

        {focus.endAt !== null && showTimer ? (
          <FocusTimer
            theme={theme}
            endAt={focus.endAt}
            durationMs={focus.durationMs}
            label={showLabel ? focus.label : null}
            color={focus.color}
            title={title}
            meter={showMeter}
            dots={showDots ? focus.cycleDots : null}
          />
        ) : focus.endAt === null && showIdle ? (
          <text fg={theme.textMuted} flexShrink={1} wrapMode="none" truncate>
            {`${idle} `}
          </text>
        ) : null}
        <Clock theme={theme} />
      </box>
    </box>
  );
});
