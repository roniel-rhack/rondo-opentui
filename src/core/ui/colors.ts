/**
 * Shared color palette. Colors are initialized by initTheme() based on the
 * detected terminal background, exactly like the Go implementation.
 */
export interface Palette {
  cyan: string;
  white: string;
  gray: string;
  dimGray: string;
  green: string;
  red: string;
  yellow: string;
  magenta: string;
  orange: string;
  /** Background for selected list items. */
  selectionBg: string;
  /** Whitespace fill for dialog overlays. */
  overlayDim: string;
  /** Panel/app background. */
  bg: string;
  /** Slightly raised surface (headers, cards). */
  surface: string;
  /** Border color for unfocused panels. */
  border: string;
}

const DARK: Palette = {
  cyan: "#00BCD4",
  white: "#FAFAFA",
  gray: "#666666",
  dimGray: "#444444",
  green: "#4CAF50",
  red: "#F44336",
  yellow: "#FFC107",
  magenta: "#E040FB",
  orange: "#FF9800",
  selectionBg: "#1a1a2e",
  overlayDim: "#111111",
  bg: "#0d0d12",
  surface: "#15151f",
  border: "#2a2a3a",
};

const LIGHT: Palette = {
  cyan: "#00838F",
  white: "#1A1A2E",
  gray: "#5C5C5C",
  dimGray: "#999999",
  green: "#2E7D32",
  red: "#C62828",
  yellow: "#AB6A00",
  magenta: "#9C27B0",
  orange: "#E65100",
  selectionBg: "#F0F0F0",
  overlayDim: "#F5F5F5",
  bg: "#FBFBFD",
  surface: "#F2F2F6",
  border: "#D8D8E0",
};

export const theme: Palette = { ...DARK };

let darkTheme = true;

export function isDark(): boolean {
  return darkTheme;
}

/** Sets the palette from the terminal background. Call once at startup. */
export function initTheme(dark: boolean): void {
  darkTheme = dark;
  Object.assign(theme, dark ? DARK : LIGHT);
}
