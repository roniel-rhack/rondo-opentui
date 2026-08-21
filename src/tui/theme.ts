/**
 * Design tokens for the TUI.
 *
 * The palette is intentionally richer than the CLI one: a near-black blue base
 * with layered surfaces, a cyan accent, a violet secondary and semantic colors
 * that keep their meaning in both light and dark mode. Components never
 * hard-code a color — everything comes from here.
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

  bg: "#0b0d13",
  surface: "#11141d",
  surfaceAlt: "#171b27",
  surfaceHigh: "#1c2130",

  border: "#252b3b",
  borderSubtle: "#1a1f2c",
  borderFocus: "#22d3ee",

  text: "#e8ecf5",
  textDim: "#9aa4bd",
  textMuted: "#5d6780",
  textOn: "#07090f",

  accent: "#22d3ee",
  accentDim: "#0e7f92",
  accentSoft: "#0d2b33",
  secondary: "#a78bfa",

  success: "#34d399",
  warning: "#fbbf24",
  danger: "#fb7185",
  info: "#60a5fa",

  selectionBg: "#1b2333",
  hoverBg: "#151a26",
  scrim: "#05060a",
  track: "#232a3a",
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
  textMuted: "#8a93ab",
  textOn: "#ffffff",

  accent: "#0e7490",
  accentDim: "#3aa7bd",
  accentSoft: "#d7eef4",
  secondary: "#6d28d9",

  success: "#047857",
  warning: "#b45309",
  danger: "#be123c",
  info: "#1d4ed8",

  selectionBg: "#dde7f5",
  hoverBg: "#eaeef7",
  scrim: "#c9cfdd",
  track: "#dde2ec",
};

export function tuiTheme(dark: boolean): TuiTheme {
  return dark ? DARK : LIGHT;
}

/** Priority colors, indexed by Priority. */
export function priorityColors(t: TuiTheme): string[] {
  return [t.textMuted, t.info, t.warning, t.danger];
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
  const remainder = Math.round((exact - full) * 8);
  return {
    full: "█".repeat(full),
    partial: remainder > 0 ? EIGHTHS[remainder]! : "",
    rest: Math.max(width - full - (remainder > 0 ? 1 : 0), 0),
  };
}
