/** Minimal ANSI styling helpers (truecolor), replacing lipgloss for output. */

const RESET = "\x1b[0m";

let colorEnabled = true;

export function setColorEnabled(enabled: boolean): void {
  colorEnabled = enabled;
}

export function isColorEnabled(): boolean {
  return colorEnabled;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
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

export function fg(color: string, s: string): string {
  if (!colorEnabled || s === "") return s;
  const [r, g, b] = hexToRgb(color);
  return `\x1b[38;2;${r};${g};${b}m${s}${RESET}`;
}

export function bg(color: string, s: string): string {
  if (!colorEnabled || s === "") return s;
  const [r, g, b] = hexToRgb(color);
  return `\x1b[48;2;${r};${g};${b}m${s}${RESET}`;
}

export function bold(s: string): string {
  return colorEnabled && s !== "" ? `\x1b[1m${s}${RESET}` : s;
}

export function italic(s: string): string {
  return colorEnabled && s !== "" ? `\x1b[3m${s}${RESET}` : s;
}

export function underline(s: string): string {
  return colorEnabled && s !== "" ? `\x1b[4m${s}${RESET}` : s;
}

export function boldFg(color: string, s: string): string {
  return bold(fg(color, s));
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

/** Visible width of a string, ignoring ANSI sequences. */
export function visibleWidth(s: string): number {
  return [...stripAnsi(s)].length;
}
