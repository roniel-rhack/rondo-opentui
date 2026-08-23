/**
 * Design tokens for the TUI.
 *
 * The palette is intentionally richer than the CLI one: a neutral gray base in
 * the VS Code Dark Modern range with layered surfaces, a cyan accent, a violet
 * secondary and semantic colors that keep their meaning in both light and dark
 * mode. Components never hard-code a color — everything comes from here.
 */
export interface TuiTheme {
  dark: boolean;

  /** Page background. */
  bg: string;
  /** Panels and bars sitting on the background. */
  surface: string;
  /** Raised elements: chips, inputs, headers. */
  surfaceAlt: string;
  /** Highest layer: overlays. */
  surfaceHigh: string;

  border: string;
  borderSubtle: string;
  borderFocus: string;

  text: string;
  textDim: string;
  textMuted: string;
  /** Text drawn on top of accent/danger fills. */
  textOn: string;

  accent: string;
  accentDim: string;
  accentSoft: string;
  secondary: string;

  success: string;
  warning: string;
  danger: string;
  info: string;

  selectionBg: string;
  hoverBg: string;
  /** Backdrop behind modals. */
  scrim: string;
  /** Track color for progress bars and meters. */
  track: string;
}

const DARK: TuiTheme = {
  dark: true,

  bg: "#1e1e1e",
  surface: "#252526",
  surfaceAlt: "#2d2d30",
  surfaceHigh: "#333336",

  border: "#3c3c3c",
  borderSubtle: "#2b2b2b",
  borderFocus: "#22d3ee",

  text: "#e4e4e4",
  textDim: "#a6a6a6",
  // 4.8:1 on bg — muted, but still readable hints and placeholders.
  textMuted: "#8a8a8a",
  textOn: "#0d1417",

  accent: "#22d3ee",
  accentDim: "#0e7f92",
  accentSoft: "#123840",
  secondary: "#c5a5ff",

  success: "#4ade80",
  warning: "#fbbf24",
  danger: "#fb7185",
  info: "#60a5fa",

  selectionBg: "#2b3b41",
  hoverBg: "#2a2d2e",
  scrim: "#101010",
  track: "#3c3c3c",
};

const LIGHT: TuiTheme = {
  dark: false,

  bg: "#f7f8fc",
  surface: "#ffffff",
  surfaceAlt: "#eef1f8",
  surfaceHigh: "#ffffff",

  border: "#d5dae7",
  borderSubtle: "#e6eaf3",
  borderFocus: "#0e7490",

  text: "#101527",
  textDim: "#4b5570",
  // 4.7:1 on bg — the old #8a93ab measured 2.9 and was unreadable.
  textMuted: "#667089",
  textOn: "#ffffff",

  accent: "#0e7490",
  accentDim: "#3aa7bd",
  accentSoft: "#d7eef4",
  secondary: "#6d28d9",

  success: "#047857",
  warning: "#b45309",
  danger: "#be123c",
  info: "#1d4ed8",

  // 1.27:1 on bg and 1.16 against hover; #dde7f5 measured 1.18 and 1.07.
  selectionBg: "#d3dff2",
  hoverBg: "#eaeef7",
  scrim: "#c9cfdd",
  track: "#dde2ec",
};

export function tuiTheme(dark: boolean): TuiTheme {
  return dark ? DARK : LIGHT;
}

/** Priority colors, indexed by Priority. Low uses textDim, not textMuted:
 * as the fill of a selected segmented option, textMuted read as disabled. */
export function priorityColors(t: TuiTheme): string[] {
  return [t.textDim, t.info, t.warning, t.danger];
}

/** Blends two hex colors, ratio 0 → a, 1 → b. Used for fades and meters. */
export function mix(a: string, b: string, ratio: number): string {
  const clamp = Math.min(Math.max(ratio, 0), 1);
  const pa = hex(a);
  const pb = hex(b);
  const to = (x: number, y: number) =>
    Math.round(x + (y - x) * clamp)
      .toString(16)
      .padStart(2, "0");
  return `#${to(pa[0], pb[0])}${to(pa[1], pb[1])}${to(pa[2], pb[2])}`;
}

function hex(color: string): [number, number, number] {
  const h = color.replace("#", "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

/** Horizontal bar built from eighth-blocks, so meters read smoothly. */
const EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];

export function meter(ratio: number, width: number): { full: string; partial: string; rest: number } {
  const clamped = Math.min(Math.max(ratio, 0), 1);
  const exact = clamped * width;
  const full = Math.floor(exact);
  // A fraction above 15/16 rounds to a whole block, which is past the end of
  // the table; the clamp keeps the lookup inside it.
  const remainder = Math.min(Math.round((exact - full) * 8), EIGHTHS.length - 1);
  return {
    full: "█".repeat(full),
    partial: remainder > 0 ? (EIGHTHS[remainder] ?? "") : "",
    rest: Math.max(width - full - (remainder > 0 ? 1 : 0), 0),
  };
}
