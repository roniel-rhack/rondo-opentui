import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { configDir } from "./config.ts";

export type Density = "auto" | "dense" | "comfortable";

/**
 * Session state the TUI restores on the next launch. Lives in its own file
 * because config.json is shared with the Go build, which drops unknown keys.
 */
export interface TuiState {
  tab: string;
  sort: string;
  tagBar: boolean;
  tag: string | null;
  view: string;
  selectedTaskId: number | null;
  selectedNoteDate: string | null;
  density: Density;
}

const DENSITIES: readonly Density[] = ["auto", "dense", "comfortable"];

export function defaultTuiState(): TuiState {
  return {
    tab: "active",
    sort: "created",
    tagBar: false,
    tag: null,
    view: "all",
    selectedTaskId: null,
    selectedNoteDate: null,
    density: "auto",
  };
}

export function tuiStatePath(): string {
  return join(configDir(), "tui-state.json");
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function strOrNull(v: unknown, fallback: string | null): string | null {
  return v === null || typeof v === "string" ? v : fallback;
}

function fromJSON(raw: unknown): TuiState {
  const d = defaultTuiState();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return d;
  const r = raw as Record<string, unknown>;
  return {
    tab: str(r.tab, d.tab),
    sort: str(r.sort, d.sort),
    tagBar: typeof r.tagBar === "boolean" ? r.tagBar : d.tagBar,
    tag: strOrNull(r.tag, d.tag),
    view: str(r.view, d.view),
    selectedTaskId:
      r.selectedTaskId === null || Number.isInteger(r.selectedTaskId)
        ? (r.selectedTaskId as number | null)
        : d.selectedTaskId,
    selectedNoteDate: strOrNull(r.selectedNoteDate, d.selectedNoteDate),
    density: DENSITIES.includes(r.density as Density)
      ? (r.density as Density)
      : d.density,
  };
}

/** Reads the saved state; a missing or broken file yields the defaults. */
export function loadTuiState(path = tuiStatePath()): TuiState {
  try {
    if (!existsSync(path)) return defaultTuiState();
    return fromJSON(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return defaultTuiState();
  }
}

export function saveTuiState(state: TuiState, path = tuiStatePath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
