import { describe, expect, test } from "bun:test";
import type { ScrollBoxRenderable } from "@opentui/core";
import { testRender } from "@opentui/react/test-utils";
import {
  act,
  createElement,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { defaultConfig, type Config } from "../src/core/config/config.ts";
import { openMemory } from "../src/core/database/db.ts";
import { SessionKind } from "../src/core/focus/focus.ts";
import { RondoData } from "../src/tui/data.ts";
import { usePomodoro, type PomodoroState } from "../src/tui/hooks/usePomodoro.ts";
import { useSmoothScrollIntoView } from "../src/tui/hooks/useSmoothScroll.ts";
import { useCountdown, useTween } from "../src/tui/hooks/useTween.ts";

// OpenTUI's React root re-renders itself once the renderer is ready, outside
// of act(). The warning is library-internal noise, so keep it out of the report.
const consoleError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("not wrapped in act")) {
    return;
  }
  consoleError(...args);
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Mounts a probe component and hands back a setter for its props, so a hook
 * can be driven through real renders without a full App around it.
 */
async function mountProbe<P>(
  initial: P,
  render: (props: P) => ReactNode,
  size = { width: 40, height: 10 },
) {
  let update!: (next: P) => void;
  function Probe() {
    const [props, setProps] = useState(initial);
    update = setProps;
    return render(props);
  }
  let setup!: Awaited<ReturnType<typeof testRender>>;
  await act(async () => {
    setup = await testRender(createElement(Probe), size);
  });
  await setup.flush();

  const set = async (next: P) => {
    await act(async () => {
      update(next);
    });
    await setup.flush();
  };
  const settle = async (ms: number) => {
    await act(async () => {
      await sleep(ms);
    });
    await setup.flush();
  };
  return { set, settle, ...setup };
}

describe("useTween", () => {
  test("a resetKey change snaps to the target in the same render", async () => {
    const seen: number[] = [];
    const probe = await mountProbe(
      { target: 0, key: 1 },
      ({ target, key }) => {
        const value = useTween(target, 200, key);
        seen.push(value);
        return createElement("text", null, value.toFixed(2));
      },
    );

    await probe.set({ target: 1, key: 2 });
    expect(probe.captureCharFrame()).toContain("1.00");
    expect(seen.every((v) => v === 0 || v === 1)).toBe(true);

    // The same key eases, so an intermediate frame shows up before settling.
    await probe.set({ target: 0, key: 2 });
    await probe.settle(40);
    const mid = Number(probe.captureCharFrame().trim());
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);

    await probe.settle(260);
    expect(probe.captureCharFrame()).toContain("0.00");
    probe.renderer.destroy();
  });
});

describe("useCountdown", () => {
  test("only re-renders when the bar would change a cell", async () => {
    const values: number[] = [];
    const probe = await mountProbe(
      { key: 1 as number | null },
      ({ key }) => {
        const remaining = useCountdown(key, 600, 6);
        values.push(remaining);
        return createElement("text", null, remaining.toFixed(3));
      },
    );

    await probe.settle(900);
    expect(probe.captureCharFrame()).toContain("0.000");

    const distinct = [...new Set(values)];
    for (const v of distinct) {
      expect(Number.isInteger(Math.round(v * 6 * 1e6) / 1e6)).toBe(true);
    }
    // One state change per cell: 6 cells plus the initial render, with a
    // little slack for the renderer's own re-renders.
    expect(values.length).toBeLessThanOrEqual(10);
    probe.renderer.destroy();
  });
});

describe("useSmoothScrollIntoView", () => {
  const ROWS = 40;
  let box: ScrollBoxRenderable | null = null;

  function List({ target, revision }: { target: string; revision: number }) {
    const ref = useRef<ScrollBoxRenderable | null>(null);
    useSmoothScrollIntoView(ref, target, revision);
    const rows = Array.from({ length: ROWS }, (_, i) =>
      createElement("text", { key: i, id: `row-${i}` }, `row ${i}`),
    );
    return createElement(
      "scrollbox",
      {
        ref: (r: ScrollBoxRenderable | null) => {
          ref.current = r;
          box = r;
        },
        focused: false,
        height: 6,
      },
      ...rows,
    );
  }

  test("snaps when the jump is longer than the viewport", async () => {
    const probe = await mountProbe(
      { target: "row-0", revision: 0 },
      (props) => createElement(List, props),
    );
    const height = box!.viewport.height;

    await probe.set({ target: "row-30", revision: 0 });
    expect(box!.scrollTop).toBe(31 - height);
    probe.renderer.destroy();
  });

  test("snaps when a new target arrives mid-animation", async () => {
    const probe = await mountProbe(
      { target: "row-0", revision: 0 },
      (props) => createElement(List, props),
    );
    const height = box!.viewport.height;

    // A short hop eases: right after the first frame the box has not moved.
    await probe.set({ target: `row-${height}`, revision: 0 });
    expect(box!.scrollTop).toBeLessThan(height);

    await probe.set({ target: `row-${height + 2}`, revision: 0 });
    expect(box!.scrollTop).toBe(height + 3 - height);

    await probe.settle(150);
    expect(box!.scrollTop).toBe(height + 3 - height);
    probe.renderer.destroy();
  });

  test("a revision change brings the same target back into view", async () => {
    const probe = await mountProbe(
      { target: "row-0", revision: 0 },
      (props) => createElement(List, props),
    );
    const height = box!.viewport.height;
    await probe.set({ target: "row-30", revision: 0 });
    expect(box!.scrollTop).toBe(31 - height);

    box!.scrollTop = 0;
    await probe.set({ target: "row-30", revision: 1 });
    expect(box!.scrollTop).toBe(31 - height);
    probe.renderer.destroy();
  });
});

describe("usePomodoro", () => {
  function fastConfig(): Config {
    const cfg = defaultConfig();
    // Minutes, so a 60 ms session is 0.001.
    cfg.focus.workDuration = 0.001;
    cfg.focus.shortBreakDuration = 0.001;
    return cfg;
  }

  async function mountPomodoro(cfg: Config) {
    const data = new RondoData(openMemory(), cfg);
    const finished: [SessionKind, number][] = [];
    const states: PomodoroState[] = [];
    const probe = await mountProbe({ tick: 0 }, () => {
      const state = usePomodoro(data, cfg, (kind, taskId) => {
        finished.push([kind, taskId]);
      });
      states.push(state);
      return createElement("text", null, state.nextLabel);
    });
    const latest = () => states[states.length - 1]!;
    const call = async (fn: (s: PomodoroState) => void) => {
      await act(async () => {
        fn(latest());
      });
      await probe.flush();
    };
    return { ...probe, data, finished, states, latest, call };
  }

  test("finishing a work session reports the task and queues a break", async () => {
    const p = await mountPomodoro(fastConfig());
    expect(p.latest().nextLabel).toBe("Focus 0m");

    await p.call((s) => s.start(7));
    expect(p.latest().running).toBe(true);
    expect(p.latest().taskId).toBe(7);
    expect(p.latest().endAt).not.toBeNull();

    await p.settle(150);
    expect(p.finished).toEqual([[SessionKind.Work, 7]]);
    expect(p.latest().running).toBe(false);
    expect(p.latest().kind).toBe(SessionKind.ShortBreak);
    expect(p.latest().nextLabel).toBe("Break 0m");
    p.renderer.destroy();
  });

  test("stop resets the queued kind to work", async () => {
    const p = await mountPomodoro(fastConfig());

    await p.call((s) => s.start(1));
    await p.settle(150);
    expect(p.latest().kind).toBe(SessionKind.ShortBreak);

    await p.call((s) => s.toggle(1));
    expect(p.latest().running).toBe(true);
    expect(p.latest().kind).toBe(SessionKind.ShortBreak);

    await p.call((s) => s.stop());
    expect(p.latest().running).toBe(false);
    expect(p.latest().kind).toBe(SessionKind.Work);
    expect(p.latest().nextLabel).toBe("Focus 0m");
    p.renderer.destroy();
  });

  test("the returned state is stable across unrelated renders", async () => {
    const p = await mountPomodoro(defaultConfig());
    const before = p.latest();

    await p.set({ tick: 1 });
    expect(p.latest()).toBe(before);

    await p.call((s) => s.start(3));
    expect(p.latest()).not.toBe(before);
    const running = p.latest();
    await p.set({ tick: 2 });
    expect(p.latest()).toBe(running);
    await p.call((s) => s.stop());
    p.renderer.destroy();
  });
});
