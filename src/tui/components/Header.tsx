import { TextAttributes } from "@opentui/core";
import React, { useState } from "react";
import type { TuiTheme } from "../theme.ts";
import { TABS, type TabCounts, type TabId } from "../state.ts";
import { Meter } from "./primitives.tsx";

interface HeaderProps {
  theme: TuiTheme;
  activeTab: TabId;
  counts: TabCounts;
  onSelectTab: (tab: TabId) => void;
  /** Remaining time as MM:SS, or null when no session is running. */
  timer: string | null;
  timerLabel: string;
  timerRatio: number;
  timerColor: string;
  /** Title of the task the session is attached to, when there is one. */
  timerTask?: string;
  cycleDots: string;
  clock: string;
  compact: boolean;
}

interface TabButtonProps {
  theme: TuiTheme;
  label: string;
  icon: string;
  count: number;
  active: boolean;
  compact: boolean;
  onPress: () => void;
}

function TabButton({
  theme,
  label,
  icon,
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
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={bg}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseDown={onPress}
    >
      <text fg={fg} attributes={active ? TextAttributes.BOLD : undefined}>
        {compact ? icon : `${icon} ${label}`}
      </text>
      <text fg={active ? theme.textOn : theme.textMuted}>{` ${count}`}</text>
    </box>
  );
}

/** Top bar: brand, clickable tabs, live focus timer and clock. */
export function Header({
  theme,
  activeTab,
  counts,
  onSelectTab,
  timer,
  timerLabel,
  timerRatio,
  timerColor,
  timerTask,
  cycleDots,
  clock,
  compact,
}: HeaderProps) {
  return (
    <box flexDirection="column">
      <box
        flexDirection="row"
        alignItems="center"
        height={1}
        backgroundColor={theme.surface}
        paddingLeft={1}
        paddingRight={1}
      >
        <text fg={theme.accent} attributes={TextAttributes.BOLD}>
          {compact ? "◆" : "◆ RonDO"}
        </text>
        <box width={2} />

        {TABS.map((tab, index) => (
          <React.Fragment key={tab.id}>
            {/* Tasks and the journal are separate things; keep them apart. */}
            {index > 0 && TABS[index - 1]!.group !== tab.group ? (
              <text fg={theme.border}>{compact ? "│" : " │ "}</text>
            ) : null}
            <TabButton
              theme={theme}
              label={tab.label}
              icon={tab.icon}
              count={counts[tab.id]}
              active={tab.id === activeTab}
              compact={compact}
              onPress={() => onSelectTab(tab.id)}
            />
          </React.Fragment>
        ))}

        <box flexGrow={1} />

        {timer ? (
          <box flexDirection="row" paddingRight={1}>
            {timerTask && !compact ? (
              <text fg={theme.textDim}>{`${timerTask} · `}</text>
            ) : null}
            <text fg={timerColor} attributes={TextAttributes.BOLD}>
              {`${timerLabel} ${timer} `}
            </text>
            {compact ? null : (
              <>
                {/* The task title takes the meter's room; keep whichever fits. */}
                {timerTask ? null : (
                  <Meter
                    theme={theme}
                    ratio={timerRatio}
                    width={10}
                    color={timerColor}
                  />
                )}
                <text fg={theme.textMuted}>{` ${cycleDots}`}</text>
              </>
            )}
          </box>
        ) : null}
        <text fg={theme.textMuted}>{clock}</text>
      </box>

    </box>
  );
}
