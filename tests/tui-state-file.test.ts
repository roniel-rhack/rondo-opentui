import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configDir } from "../src/core/config/config.ts";
import {
  defaultTuiState,
  loadTuiState,
  saveTuiState,
  tuiStatePath,
} from "../src/core/config/tui-state.ts";

let previousHome: string | undefined;
let home: string;

beforeEach(() => {
  previousHome = process.env.RONDO_HOME;
  home = mkdtempSync(join(tmpdir(), "rondo-tui-state-"));
  process.env.RONDO_HOME = home;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.RONDO_HOME;
  else process.env.RONDO_HOME = previousHome;
});

describe("tui-state file", () => {
  test("lives next to config.json and never inside it", () => {
    expect(tuiStatePath()).toBe(join(configDir(), "tui-state.json"));
    expect(tuiStatePath()).toBe(join(home, "tui-state.json"));

    saveTuiState(defaultTuiState());

    expect(existsSync(join(home, "tui-state.json"))).toBe(true);
    expect(existsSync(join(home, "config.json"))).toBe(false);
  });

  test("missing file yields defaults", () => {
    expect(loadTuiState()).toEqual(defaultTuiState());
    // The app opens on the due sort, so a fresh state must agree.
    expect(defaultTuiState().sort).toBe("due");
  });

  test("round-trips every field", () => {
    const state = {
      tab: "done",
      sort: "due",
      tagBar: true,
      tag: "work",
      view: "today",
      selectedTaskId: 42,
      selectedNoteDate: "2026-08-22",
      density: "dense" as const,
    };

    saveTuiState(state);

    expect(loadTuiState()).toEqual(state);
    expect(JSON.parse(readFileSync(tuiStatePath(), "utf8"))).toEqual(state);
  });

  test("creates the directory when it does not exist yet", () => {
    process.env.RONDO_HOME = join(home, "nested", "deeper");

    saveTuiState({ ...defaultTuiState(), tab: "all" });

    expect(loadTuiState().tab).toBe("all");
  });

  test("invalid JSON falls back to defaults without throwing", () => {
    writeFileSync(tuiStatePath(), "{ not json", "utf8");
    expect(loadTuiState()).toEqual(defaultTuiState());
  });

  test("wrong field types fall back per field", () => {
    writeFileSync(
      tuiStatePath(),
      JSON.stringify({
        tab: 7,
        sort: "priority",
        tagBar: "yes",
        tag: 3,
        view: null,
        selectedTaskId: "12",
        selectedNoteDate: 20260822,
        density: "huge",
      }),
      "utf8",
    );

    expect(loadTuiState()).toEqual({ ...defaultTuiState(), sort: "priority" });
  });

  test("a non-object document falls back to defaults", () => {
    writeFileSync(tuiStatePath(), "[1,2,3]", "utf8");
    expect(loadTuiState()).toEqual(defaultTuiState());
    writeFileSync(tuiStatePath(), "null", "utf8");
    expect(loadTuiState()).toEqual(defaultTuiState());
  });
});
