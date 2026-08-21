import { theme } from "../core/ui/colors.ts";
import { fg, bold as ansiBold, visibleWidth } from "../core/ui/ansi.ts";
import type { Writer } from "./writer.ts";

export interface PrinterOptions {
  format: string;
  quiet: boolean;
  noColor: boolean;
}

/** Formatted output: styled tables when color is on, tab-aligned text when not. */
export class Printer {
  constructor(
    readonly w: Writer,
    private readonly opts: PrinterOptions,
  ) {}

  get noColor(): boolean {
    return this.opts.noColor;
  }

  line(s = ""): void {
    this.w.write(`${s}\n`);
  }

  raw(s: string): void {
    this.w.write(s);
  }

  /** Prints a success message unless --quiet is set. */
  success(msg: string): void {
    if (this.opts.quiet) return;
    if (this.opts.noColor) {
      this.line(msg);
      return;
    }
    this.line(`${fg(theme.green, "✓")} ${msg}`);
  }

  bold(s: string): string {
    return this.opts.noColor ? s : ansiBold(s);
  }

  dim(s: string): string {
    return this.opts.noColor ? s : fg(theme.gray, s);
  }

  colored(s: string, color: string): string {
    return this.opts.noColor ? s : fg(color, s);
  }

  json(value: unknown): void {
    this.line(JSON.stringify(value, null, 2));
  }

  table(headers: string[], rows: string[][]): void {
    if (this.opts.noColor) {
      this.plainTable(headers, rows);
      return;
    }
    this.borderedTable(headers, rows);
  }

  private plainTable(headers: string[], rows: string[][]): void {
    const widths = headers.map((h, i) =>
      Math.max(
        visibleWidth(h),
        ...rows.map((r) => visibleWidth(r[i] ?? "")),
        0,
      ),
    );
    const renderRow = (cells: string[]) =>
      cells
        .map((c, i) =>
          i === cells.length - 1 ? c : padVisible(c, widths[i]! + 2),
        )
        .join("")
        .trimEnd();

    this.line(renderRow(headers));
    this.line(renderRow(headers.map((h) => "-".repeat(h.length))));
    for (const row of rows) this.line(renderRow(row));
  }

  private borderedTable(headers: string[], rows: string[][]): void {
    const cols = headers.length;
    const widths = headers.map((h, i) =>
      Math.max(visibleWidth(h), ...rows.map((r) => visibleWidth(r[i] ?? "")), 0),
    );
    const border = (left: string, mid: string, right: string) =>
      this.colored(
        left + widths.map((w) => "─".repeat(w + 2)).join(mid) + right,
        theme.cyan,
      );
    const vertical = this.colored("│", theme.cyan);

    const renderRow = (cells: string[], boldCells: boolean) => {
      const parts: string[] = [];
      for (let i = 0; i < cols; i++) {
        const cell = cells[i] ?? "";
        const text = boldCells ? this.bold(cell) : cell;
        parts.push(` ${padVisible(text, widths[i]! + 1)}`);
      }
      return vertical + parts.join(vertical) + vertical;
    };

    this.line(border("╭", "┬", "╮"));
    this.line(renderRow(headers, true));
    this.line(border("├", "┼", "┤"));
    for (const row of rows) this.line(renderRow(row, false));
    this.line(border("╰", "┴", "╯"));
  }
}

function padVisible(s: string, width: number): string {
  const pad = width - visibleWidth(s);
  return pad > 0 ? s + " ".repeat(pad) : s;
}
