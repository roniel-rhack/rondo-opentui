import { TextAttributes } from "@opentui/core";
import { useState, type ReactNode } from "react";
import { meter, mix, type TuiTheme } from "../theme.ts";
import { useEntrance, useTween } from "../hooks/useTween.ts";

interface ChipProps {
  theme: TuiTheme;
  label: string;
  color?: string;
  /** Filled chips use `color` as background; outlined ones sit on a raised
   * surface with `color` as text, like a keycap. */
  filled?: boolean;
  bold?: boolean;
  onPress?: () => void;
}

/** Small rounded-looking label used for tags, counts, statuses and filters. */
export function Chip({
  theme,
  label,
  color,
  filled = false,
  bold = false,
  onPress,
}: ChipProps) {
  const tone = color ?? theme.textDim;
  return (
    <box
      flexDirection="row"
      backgroundColor={filled ? tone : theme.surfaceAlt}
      paddingLeft={1}
      paddingRight={1}
      onMouseDown={onPress}
    >
      <text
        fg={filled ? theme.textOn : tone}
        attributes={bold ? TextAttributes.BOLD : undefined}
      >
        {label}
      </text>
    </box>
  );
}

interface ChipButtonProps {
  theme: TuiTheme;
  label: string;
  onPress: () => void;
}

/** Keycap-styled clickable chip, used for quick presets under form fields. */
export function ChipButton({ theme, label, onPress }: ChipButtonProps) {
  const [hover, setHover] = useState(false);
  return (
    // Fixed width and no wrapping: a row of chips wider than its column would
    // otherwise break a label across two lines and steal a row from the form.
    <box
      flexShrink={0}
      paddingLeft={1}
      paddingRight={1}
      marginRight={1}
      backgroundColor={
        hover ? mix(theme.surfaceAlt, theme.accentSoft, 0.6) : theme.surfaceAlt
      }
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseDown={onPress}
    >
      <text fg={theme.accent} wrapMode="none">
        {label}
      </text>
    </box>
  );
}

interface MeterProps {
  theme: TuiTheme;
  ratio: number;
  width: number;
  color?: string;
  trackColor?: string;
  /** Use a thinner glyph for hairline meters such as the toast timer. */
  thin?: boolean;
}

/** Sub-cell accurate progress bar built from eighth-block characters. */
export function Meter({
  theme,
  ratio,
  width,
  color,
  trackColor,
  thin = false,
}: MeterProps) {
  if (thin) {
    const filled = Math.round(Math.min(Math.max(ratio, 0), 1) * width);
    return (
      <text>
        <span fg={color ?? theme.accent}>{"▁".repeat(filled)}</span>
        <span fg={trackColor ?? theme.track}>
          {"▁".repeat(Math.max(width - filled, 0))}
        </span>
      </text>
    );
  }

  const { full, partial, rest } = meter(ratio, width);
  return (
    <text>
      <span fg={color ?? theme.accent}>{full + partial}</span>
      <span fg={trackColor ?? theme.track}>{"░".repeat(rest)}</span>
    </text>
  );
}

interface AnimatedMeterProps extends MeterProps {
  /** Fill from empty on mount, for meters that appear with an overlay. */
  animateIn?: boolean;
  /** When this changes the meter snaps instead of easing from the old value. */
  resetKey?: unknown;
}

/** Meter that eases towards its target, so progress changes read as motion. */
export function AnimatedMeter({
  animateIn = false,
  resetKey,
  ...props
}: AnimatedMeterProps) {
  const ratio = useTween(props.ratio, 260, resetKey);
  const entrance = useEntrance(animateIn ? 260 : 0);
  return <Meter {...props} ratio={ratio * entrance} />;
}

interface SectionProps {
  theme: TuiTheme;
  title: string;
  accent?: string;
  children?: ReactNode;
  paddingTop?: number;
}

/** Labelled block used inside the detail panel and overlays. */
export function Section({
  theme,
  title,
  accent,
  children,
  paddingTop = 1,
}: SectionProps) {
  return (
    <box flexDirection="column" paddingTop={paddingTop}>
      <box flexDirection="row">
        <text fg={accent ?? theme.textMuted} attributes={TextAttributes.BOLD}>
          {title.toUpperCase()}
        </text>
        <text fg={theme.borderSubtle}>{"  "}</text>
      </box>
      {children}
    </box>
  );
}

interface KeyHintProps {
  theme: TuiTheme;
  keyLabel: string;
  action: string;
  onPress?: () => void;
}

/** Keycap + action pair shown in the status bar and overlay footers. */
export function KeyHint({ theme, keyLabel, action, onPress }: KeyHintProps) {
  const [hover, setHover] = useState(false);
  const lit = hover && onPress !== undefined;
  return (
    <box
      flexDirection="row"
      flexShrink={0}
      paddingRight={1}
      onMouseOver={() => setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseDown={onPress}
    >
      <box
        backgroundColor={
          lit ? mix(theme.surfaceAlt, theme.accentSoft, 0.5) : theme.surfaceAlt
        }
        paddingLeft={1}
        paddingRight={1}
      >
        <text fg={theme.accent} attributes={TextAttributes.BOLD}>
          {keyLabel}
        </text>
      </box>
      {action !== "" ? (
        <text fg={lit ? theme.text : theme.textMuted}>{` ${action}`}</text>
      ) : null}
    </box>
  );
}

interface EmptyStateProps {
  theme: TuiTheme;
  icon: string;
  title: string;
  hint?: string;
}

/** Friendly placeholder for empty lists and panels. */
export function EmptyState({ theme, icon, title, hint }: EmptyStateProps) {
  return (
    <box flexGrow={1} alignItems="center" justifyContent="center" flexDirection="column">
      <text fg={theme.accent}>{icon}</text>
      <box height={1} />
      <text fg={theme.textDim} attributes={TextAttributes.BOLD}>
        {title}
      </text>
      {hint ? (
        <>
          <box height={1} />
          <text fg={theme.textMuted}>{hint}</text>
        </>
      ) : null}
    </box>
  );
}

interface MarkdownTextProps {
  theme: TuiTheme;
  content: string;
}

const INLINE_RE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;

/**
 * Lightweight markdown rendering for descriptions and notes: headings, bullets,
 * quotes plus inline bold, italic and code. Everything becomes styled spans, so
 * it composes with the rest of the layout instead of embedding ANSI escapes.
 */
export function MarkdownText({ theme, content }: MarkdownTextProps) {
  const lines = content.split("\n");

  return (
    <box flexDirection="column">
      {lines.map((line, i) => {
        const key = `${i}-${line.slice(0, 8)}`;

        if (line.startsWith("## ")) {
          return (
            <text key={key} fg={theme.text} attributes={TextAttributes.BOLD} wrapMode="word">
              {line.slice(3)}
            </text>
          );
        }
        if (line.startsWith("# ")) {
          return (
            <text key={key} fg={theme.accent} attributes={TextAttributes.BOLD} wrapMode="word">
              {line.slice(2)}
            </text>
          );
        }
        if (line.startsWith("> ")) {
          return (
            <box key={key} flexDirection="row">
              <text fg={theme.accent}>{"▎ "}</text>
              <text fg={theme.textMuted} wrapMode="word" flexGrow={1}>
                {line.slice(2)}
              </text>
            </box>
          );
        }
        if (line.startsWith("- ") || line.startsWith("* ")) {
          return (
            <box key={key} flexDirection="row">
              <text fg={theme.accent}>{" • "}</text>
              <text wrapMode="word" flexGrow={1}>
                {inlineSpans(theme, line.slice(2))}
              </text>
            </box>
          );
        }
        if (line.trim() === "") return <box key={key} height={1} />;

        return (
          <text key={key} fg={theme.textDim} wrapMode="word">
            {inlineSpans(theme, line)}
          </text>
        );
      })}
    </box>
  );
}

function inlineSpans(theme: TuiTheme, line: string) {
  const parts = line.split(INLINE_RE).filter((p) => p !== "");
  return parts.map((part, i) => {
    const key = `${i}-${part.slice(0, 6)}`;
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <span key={key} fg={theme.text} attributes={TextAttributes.BOLD}>
          {part.slice(2, -2)}
        </span>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <span key={key} fg={theme.secondary} bg={theme.surfaceAlt}>
          {part.slice(1, -1)}
        </span>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return (
        <span key={key} fg={theme.textDim} attributes={TextAttributes.ITALIC}>
          {part.slice(1, -1)}
        </span>
      );
    }
    return (
      <span key={key} fg={theme.textDim}>
        {part}
      </span>
    );
  });
}
