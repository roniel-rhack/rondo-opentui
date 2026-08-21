import { bold, fg, italic, visibleWidth, bg as bgColor } from "./ansi.ts";
import { theme } from "./colors.ts";

const BOLD_RE = /\*\*(.+?)\*\*/g;
const ITALIC_RE = /\*(.+?)\*/g;
const CODE_RE = /`(.+?)`/g;

/**
 * Renders markdown-formatted text with ANSI styling for terminal display.
 * Supports headings, blockquotes, bullet lists and inline bold/italic/code.
 */
export function renderMarkdown(s: string, width: number): string {
  const w = width > 0 ? width : 80;
  if (s === "") return "";

  const lines: string[] = [];

  for (const line of s.split("\n")) {
    if (line.startsWith("## ")) {
      lines.push(bold(fg(theme.white, wrapText(line.slice(3), w))));
    } else if (line.startsWith("# ")) {
      lines.push(bold(fg(theme.cyan, wrapText(line.slice(2), w))));
    } else if (line.startsWith("> ")) {
      lines.push(
        fg(theme.dimGray, `▎ ${wrapText(line.slice(2), Math.max(w - 4, 1))}`),
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      const text = wrapText(renderInlineStyles(line.slice(2)), Math.max(w - 4, 1));
      lines.push(fg(theme.cyan, "  * ") + fg(theme.white, text));
    } else if (line.trim() === "") {
      lines.push("");
    } else {
      lines.push(fg(theme.white, wrapText(renderInlineStyles(line), w)));
    }
  }

  return lines.join("\n");
}

/** Applies inline bold, italic and code formatting. */
export function renderInlineStyles(s: string): string {
  // Code first, so that bold/italic markers inside code spans are left alone.
  let out = s.replace(CODE_RE, (_m, inner: string) =>
    bgColor(theme.dimGray, inner),
  );
  out = out.replace(BOLD_RE, (_m, inner: string) => bold(inner));
  out = out.replace(ITALIC_RE, (_m, inner: string) => italic(inner));
  return out;
}

/** Wraps text at the given width, breaking on spaces. */
export function wrapText(s: string, width: number): string {
  if (width <= 0) return s;
  if (visibleWidth(s) <= width) return s;

  const words = s.split(/\s+/).filter((w) => w !== "");
  let result = "";
  let lineLen = 0;

  words.forEach((word, i) => {
    const wLen = visibleWidth(word);
    if (i > 0 && lineLen + 1 + wLen > width) {
      result += "\n";
      lineLen = 0;
    } else if (i > 0) {
      result += " ";
      lineLen++;
    }
    result += word;
    lineLen += wLen;
  });

  return result;
}
