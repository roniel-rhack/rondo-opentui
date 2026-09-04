import { TextAttributes } from "@opentui/core";
import React, { memo, useEffect, useState } from "react";
import { formatTimer } from "../../core/focus/focus.ts";
import { GoTime } from "../../core/time.ts";
import { cellWidth, fitCells } from "../text.ts";
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
/** Columns kept between the last tab and the focus block. The flexGrow
 * spacer collapses to nothing once the block fills the row, so the gap has
 * to be part of the budget or the title runs into the tab's count. */
const FOCUS_GAP = 2;
const METER_WIDTH = 10;
const TIMER_WIDTH = 5;
/** Shortest title worth showing: a few letters, an ellipsis and " · ". */
const MIN_TITLE = 8;

interface TabButtonProps {
  theme: TuiTheme;
  label: string;
  keycap: string;
  count: number | null;
  active: boolean;
  compact: boolean;
  onPress: () => void;
}

function tabWidth(label: string, count: number | null, compact: boolean): number {
  return 2 + (compact ? 0 : 2) + cellWidth(label) +
    (count === null ? 0 : 1 + String(count).length);
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
      {count === null ? null : (
        <text fg={active ? theme.textOn : theme.textMuted}>{` ${count}`}</text>
      )}
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
  let brand = compact ? "◆" : "◆ RonDO";
  let gap = compact ? 1 : 2;
  let divider = compact ? "│" : " │ ";
  let labels = TABS.map((tab) => tab.label);
  let compactTabs = compact;
  let showCounts = true;
  const running = focus.endAt !== null;
  const timerWidth = running
    ? cellWidth(formatTimer(Math.max(focus.endAt! - Date.now(), 0) * 1e6))
    : TIMER_WIDTH;
  const timerMinimum = running ? FOCUS_GAP + timerWidth + 1 : 0;
  const fixedWidth = () => {
    let fixed = 2 + cellWidth(brand) + gap;
    TABS.forEach((tab, index) => {
      if (index > 0 && TABS[index - 1]!.group !== tab.group) fixed += cellWidth(divider);
      fixed += tabWidth(labels[index]!, showCounts ? counts[tab.id] : null, compactTabs);
    });
    return fixed;
  };
  if (fixedWidth() + timerMinimum > width) {
    brand = "◆";
    gap = 1;
    divider = "│";
    labels = ["Act", "Done", "All", "Jnl"];
    compactTabs = false;
  }
  if (fixedWidth() + timerMinimum > width) showCounts = false;
  if (fixedWidth() + timerMinimum > width) labels = ["A", "D", "All", "J"];
  if (fixedWidth() + timerMinimum > width) {
    brand = "";
    gap = 0;
  }
  const fixed = fixedWidth();
  const showClock = fixed + timerMinimum + CLOCK_WIDTH <= width;
  const spare = width - fixed - (showClock ? CLOCK_WIDTH : 0) - FOCUS_GAP;
  const showLabel = spare >= cellWidth(focus.label) + 1 + timerWidth + 1;
  const showTimer = spare >= timerWidth + 1;
  let room = spare - (showLabel ? cellWidth(focus.label) + 1 : 0) - timerWidth - 1;
  const showMeter = !compact && room >= METER_WIDTH + 1;
  if (showMeter) room -= METER_WIDTH + 1;
  const showDots = !compact && room >= cellWidth(focus.cycleDots) + 1;
  if (showDots) room -= cellWidth(focus.cycleDots) + 1;
  const title = focus.task && !compact && room >= MIN_TITLE
    ? fitCells(focus.task, room - 3)
    : undefined;
  const idle = `next: ${focus.nextLabel}`;
  const showIdle = spare >= cellWidth(idle) + 1;

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
              label={labels[index]!}
              keycap={String(index + 1)}
              count={showCounts ? counts[tab.id] : null}
              active={tab.id === activeTab}
              compact={compactTabs}
              onPress={() => onSelectTab(tab.id)}
            />
          </React.Fragment>
        ))}

        <box flexGrow={1} />
        <box width={FOCUS_GAP} flexShrink={0} />

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
        {showClock ? <Clock theme={theme} /> : null}
      </box>
    </box>
  );
});
