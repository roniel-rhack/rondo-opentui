import { TextAttributes } from "@opentui/core";
import { useState, type ReactNode } from "react";
import { mix, type TuiTheme } from "../theme.ts";
import { useEntrance } from "../hooks/useTween.ts";

interface OverlayProps {
  theme: TuiTheme;
  title: string;
  /** Optional short line under the title, e.g. context for the dialog. */
  subtitle?: string;
  width: number;
  height?: number;
  screenWidth: number;
  screenHeight: number;
  accent?: string;
  footer?: string;
  onBackdropClick?: () => void;
  children?: ReactNode;
}

/**
 * Centered modal drawn above the app with a backdrop that fades in. Unlike the
 * Go version — which replaced the whole screen — the interface behind stays
 * visible, so you never lose context while editing.
 */
export function Overlay({
  theme,
  title,
  subtitle,
  width,
  height,
  screenWidth,
  screenHeight,
  accent,
  footer,
  onBackdropClick,
  children,
}: OverlayProps) {
  const entrance = useEntrance();
  const tone = accent ?? theme.accent;

  const boxWidth = Math.min(width, Math.max(screenWidth - 4, 20));
  const left = Math.max(Math.floor((screenWidth - boxWidth) / 2), 0);
  const boxHeight = height
    ? Math.min(height, Math.max(screenHeight - 2, 6))
    : undefined;
  const top = boxHeight
    ? Math.max(Math.floor((screenHeight - boxHeight) / 2), 0)
    : Math.max(Math.floor(screenHeight / 8), 1);

  return (
    <>
      {/* Backdrop and modal are siblings: nesting them would make the dialog
          inherit the scrim's opacity and turn its text translucent. */}
      <box
        position="absolute"
        left={0}
        top={0}
        width={screenWidth}
        height={screenHeight}
        zIndex={100}
        backgroundColor={theme.scrim}
        opacity={0.72 * entrance}
        onMouseDown={onBackdropClick}
      />

      <box
        position="absolute"
        left={left}
        top={top}
        width={boxWidth}
        height={boxHeight}
        zIndex={101}
        border
        borderStyle="rounded"
        borderColor={mix(theme.border, tone, entrance)}
        backgroundColor={theme.surfaceHigh}
        flexDirection="column"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <box
          flexDirection="row"
          height={1}
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={theme.surfaceAlt}
        >
          <text fg={tone} attributes={TextAttributes.BOLD}>
            {title}
          </text>
          {subtitle ? (
            <text fg={theme.textMuted} flexGrow={1} truncate>
              {`  ${subtitle}`}
            </text>
          ) : (
            <box flexGrow={1} />
          )}
          <box onMouseDown={onBackdropClick} paddingLeft={1}>
            <text fg={theme.textMuted}>✕</text>
          </box>
        </box>

        <box
          flexDirection="column"
          flexGrow={1}
          paddingLeft={2}
          paddingRight={2}
        >
          {children}
        </box>

        {footer ? (
          <box
            height={1}
            paddingLeft={2}
            paddingRight={2}
            backgroundColor={theme.surfaceAlt}
          >
            <text fg={theme.textMuted} truncate>
              {footer}
            </text>
          </box>
        ) : null}
      </box>
    </>
  );
}

interface ButtonProps {
  theme: TuiTheme;
  label: string;
  primary?: boolean;
  danger?: boolean;
  onPress: () => void;
}

/** Clickable button with a hover state, used inside overlays. */
export function Button({ theme, label, primary, danger, onPress }: ButtonProps) {
  const [hover, setHover] = useState(false);

  const base = danger ? theme.danger : primary ? theme.accent : theme.surfaceAlt;
  const bg = hover ? mix(base, theme.text, danger || primary ? 0.15 : 0.08) : base;
  const fg = danger || primary ? theme.textOn : theme.text;

  return (
    <box
      paddingLeft={2}
      paddingRight={2}
      marginRight={1}
      backgroundColor={bg}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseDown={onPress}
    >
      <text fg={fg} attributes={TextAttributes.BOLD}>
        {label}
      </text>
    </box>
  );
}
