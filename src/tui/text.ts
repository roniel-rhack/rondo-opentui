const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function cellWidth(text: string): number {
  return Bun.stringWidth(text);
}

export function fitCells(text: string, available: number): string {
  const width = Math.max(0, Math.floor(available));
  if (width === 0) return "";
  if (cellWidth(text) <= width) return text;
  let used = 0;
  let result = "";
  for (const { segment } of graphemes.segment(text)) {
    const size = cellWidth(segment);
    if (used + size > width - 1) break;
    used += size;
    result += segment;
  }
  return `${result.trimEnd()}…`;
}
