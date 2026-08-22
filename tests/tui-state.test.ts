import { describe, expect, test } from "bun:test";
import { Hour, Minute } from "../src/core/duration.ts";
import { RecurFreq } from "../src/core/task/recur.ts";
import { newTask } from "../src/core/task/store.ts";
import { Priority, Status } from "../src/core/task/task.ts";
import { DueLevel } from "../src/core/ui/overdue.ts";
import { DateOnly, GoTime, parseDateOnly } from "../src/core/time.ts";
import {
  TABS,
  VIEWS,
  VIEW_LABELS,
  blockedIds,
  clampIndex,
  collectTags,
  detailRows,
  doneToday,
  emptyFilters,
  fitHints,
  fitTags,
  fuzzyScore,
  groupTasks,
  indexOfId,
  loggedSince,
  pageSize,
  parseFilterQuery,
  parseQuickAdd,
  plural,
  relativeDue,
  tabCounts,
  visibleTasks,
  type Hint,
} from "../src/tui/state.ts";

function task(fields: Parameters<typeof newTask>[0]) {
  return newTask({ createdAt: GoTime.now(), ...fields });
}

const due = (s: string) => parseDateOnly(s, "utc");

const sample = [
  task({
    id: 1,
    title: "Write report",
    status: Status.Pending,
    priority: Priority.High,
    tags: ["work"],
    createdAt: GoTime.date(2026, 3, 1),
    dueDate: GoTime.date(2026, 3, 10),
  }),
  task({
    id: 2,
    title: "Buy milk",
    status: Status.Done,
    priority: Priority.Low,
    tags: ["home"],
    createdAt: GoTime.date(2026, 3, 2),
  }),
  task({
    id: 3,
    title: "Refactor parser",
    status: Status.InProgress,
    priority: Priority.Urgent,
    tags: ["work", "code"],
    createdAt: GoTime.date(2026, 3, 3),
    dueDate: GoTime.date(2026, 3, 5),
  }),
];

// Friday 2026-08-21, 15:00, pinned to UTC so the machine's zone cannot leak in.
const now = GoTime.date(2026, 8, 21, 15, 0, 0, 0, "utc");

describe("fuzzyScore", () => {
  test("matches subsequences and rejects misses", () => {
    expect(fuzzyScore("wr", "Write report")).not.toBeNull();
    expect(fuzzyScore("zzz", "Write report")).toBeNull();
    expect(fuzzyScore("", "anything")).toBe(0);
  });

  test("prefers consecutive matches", () => {
    const consecutive = fuzzyScore("rep", "report")!;
    const scattered = fuzzyScore("rep", "rxexp")!;
    expect(consecutive).toBeGreaterThan(scattered);
  });
});

describe("TABS", () => {
  test("carry a digit key in header order", () => {
    expect(TABS.map((t) => t.key)).toEqual(["1", "2", "3", "4"]);
  });
});

describe("views", () => {
  test("order and labels", () => {
    expect(VIEWS).toEqual(["all", "today", "overdue", "week", "blocked"]);
    for (const v of VIEWS) expect(VIEW_LABELS[v]).toBeTruthy();
    expect(emptyFilters.view).toBe("all");
  });
});

describe("visibleTasks", () => {
  test("all tab keeps everything sorted by creation desc", () => {
    const out = visibleTasks(sample, "all", emptyFilters, "created");
    expect(out.map((t) => t.id)).toEqual([3, 2, 1]);
  });

  test("active tab hides done tasks", () => {
    const out = visibleTasks(sample, "active", emptyFilters, "created");
    expect(out.map((t) => t.id)).toEqual([3, 1]);
  });

  test("done tab keeps only completed tasks", () => {
    const out = visibleTasks(sample, "done", emptyFilters, "created");
    expect(out.map((t) => t.id)).toEqual([2]);
  });

  test("tag filter", () => {
    const out = visibleTasks(
      sample,
      "all",
      { ...emptyFilters, tag: "code" },
      "created",
    );
    expect(out.map((t) => t.id)).toEqual([3]);
  });

  test("query filter keeps matches only", () => {
    const out = visibleTasks(
      sample,
      "all",
      { ...emptyFilters, query: "refac" },
      "created",
    );
    expect(out.map((t) => t.id)).toEqual([3]);
  });

  test("sort by priority then due date", () => {
    expect(
      visibleTasks(sample, "all", emptyFilters, "priority").map((t) => t.id),
    ).toEqual([3, 1, 2]);
    expect(
      visibleTasks(sample, "all", emptyFilters, "due").map((t) => t.id),
    ).toEqual([3, 1, 2]);
  });

  test("the sort key still applies while a query is active (2.14)", () => {
    const tasks = [
      task({ id: 1, title: "alpha one", createdAt: GoTime.date(2026, 3, 1), dueDate: due("2026-09-01") }),
      task({ id: 2, title: "alpha two", createdAt: GoTime.date(2026, 3, 2), dueDate: due("2026-08-01") }),
      task({ id: 3, title: "alpha three", createdAt: GoTime.date(2026, 3, 3) }),
    ];
    const q = { ...emptyFilters, query: "alpha" };
    expect(visibleTasks(tasks, "all", q, "created").map((t) => t.id)).toEqual([3, 2, 1]);
    expect(visibleTasks(tasks, "all", q, "due").map((t) => t.id)).toEqual([2, 1, 3]);
  });

  test("fuzzy score breaks ties inside the sort key", () => {
    const created = GoTime.date(2026, 3, 1);
    const tasks = [
      task({ id: 1, title: "xrxexpx", createdAt: created, dueDate: due("2026-09-01") }),
      task({ id: 2, title: "report", createdAt: created, dueDate: due("2026-09-01") }),
    ];
    const out = visibleTasks(tasks, "all", { ...emptyFilters, query: "rep" }, "due");
    expect(out.map((t) => t.id)).toEqual([2, 1]);
  });

  test("due sort: undated last, then priority desc, then created desc (5.17)", () => {
    const tasks = [
      task({ id: 1, priority: Priority.Low, createdAt: GoTime.date(2026, 3, 1), dueDate: due("2026-09-01") }),
      task({ id: 2, priority: Priority.High, createdAt: GoTime.date(2026, 3, 1), dueDate: due("2026-09-01") }),
      task({ id: 3, priority: Priority.High, createdAt: GoTime.date(2026, 3, 5), dueDate: due("2026-09-01") }),
      task({ id: 4, priority: Priority.Urgent, createdAt: GoTime.date(2026, 3, 9) }),
      task({ id: 5, priority: Priority.Low, createdAt: GoTime.date(2026, 3, 1), dueDate: due("2026-08-01") }),
    ];
    const out = visibleTasks(tasks, "all", emptyFilters, "due");
    expect(out.map((t) => t.id)).toEqual([5, 3, 2, 1, 4]);
  });

  test("done tab with the created sort orders by completion time (5.18)", () => {
    const tasks = [
      task({ id: 1, status: Status.Done, createdAt: GoTime.date(2026, 3, 1), updatedAt: GoTime.date(2026, 8, 21) }),
      task({ id: 2, status: Status.Done, createdAt: GoTime.date(2026, 3, 9), updatedAt: GoTime.date(2026, 8, 1) }),
      task({ id: 3, status: Status.Done, createdAt: GoTime.date(2026, 3, 5), updatedAt: GoTime.date(2026, 8, 21) }),
    ];
    expect(visibleTasks(tasks, "done", emptyFilters, "created").map((t) => t.id)).toEqual([3, 1, 2]);
    expect(visibleTasks(tasks, "all", emptyFilters, "created").map((t) => t.id)).toEqual([2, 3, 1]);
  });

  describe("views (3.8)", () => {
    const tasks = [
      task({ id: 1, title: "late", dueDate: due("2026-08-19") }),
      task({ id: 2, title: "today", dueDate: due("2026-08-21") }),
      task({ id: 3, title: "in a week", dueDate: due("2026-08-28") }),
      task({ id: 4, title: "later", dueDate: due("2026-08-29") }),
      task({ id: 5, title: "undated" }),
      task({ id: 6, title: "blocked", blockedByIds: [5] }),
      task({ id: 7, title: "freed", blockedByIds: [8] }),
      task({ id: 8, title: "finished blocker", status: Status.Done }),
    ];
    const view = (v: (typeof VIEWS)[number]) =>
      visibleTasks(tasks, "all", { ...emptyFilters, view: v }, "created", now)
        .map((t) => t.id)
        .sort();

    test("today", () => expect(view("today")).toEqual([2]));
    test("overdue", () => expect(view("overdue")).toEqual([1]));
    test("week spans today through +7 days", () => expect(view("week")).toEqual([2, 3]));
    test("blocked ignores Done blockers", () => expect(view("blocked")).toEqual([6]));
    test("all", () => expect(view("all").length).toBe(8));
  });

  describe("query tokens (3.7)", () => {
    const tasks = [
      task({ id: 1, title: "Deploy", tags: ["infra"], priority: Priority.High, dueDate: due("2026-08-21") }),
      task({ id: 2, title: "Deploy docs", tags: ["docs"], priority: Priority.Low, dueDate: due("2026-08-10") }),
      task({ id: 3, title: "Rotate keys", tags: ["infra"], priority: Priority.High, recurFreq: RecurFreq.Weekly }),
      task({ id: 4, title: "Waiting", blockedByIds: [1] }),
    ];
    const q = (query: string) =>
      visibleTasks(tasks, "all", { ...emptyFilters, query }, "created", now)
        .map((t) => t.id)
        .sort();

    test("#tag is exact", () => expect(q("#infra")).toEqual([1, 3]));
    test("#tag plus text", () => expect(q("#infra dep")).toEqual([1]));
    test("!priority", () => expect(q("!high")).toEqual([1, 3]));
    test("due:", () => {
      expect(q("due:today")).toEqual([1]);
      expect(q("due:overdue")).toEqual([2]);
    });
    test("is:", () => {
      expect(q("is:blocked")).toEqual([4]);
      expect(q("is:recurring")).toEqual([3]);
    });
  });
});

describe("parseFilterQuery", () => {
  test("empty", () => {
    expect(parseFilterQuery("")).toEqual({ text: "", tags: [], priority: null, due: null, is: [] });
  });

  test("splits tokens from free text", () => {
    expect(parseFilterQuery("fix #infra !high due:week is:blocked build")).toEqual({
      text: "fix build",
      tags: ["infra"],
      priority: Priority.High,
      due: "week",
      is: ["blocked"],
    });
  });

  test("numeric and long priority names", () => {
    expect(parseFilterQuery("!1").priority).toBe(Priority.Low);
    expect(parseFilterQuery("!4").priority).toBe(Priority.Urgent);
    expect(parseFilterQuery("!medium").priority).toBe(Priority.Medium);
    expect(parseFilterQuery("!med").priority).toBe(Priority.Medium);
  });

  test("unknown tokens stay text", () => {
    expect(parseFilterQuery("!9 due:never c#")).toEqual({
      text: "!9 due:never c#",
      tags: [],
      priority: null,
      due: null,
      is: [],
    });
  });
});

describe("blockedIds", () => {
  test("only open blockers block", () => {
    const tasks = [
      task({ id: 1, status: Status.Done }),
      task({ id: 2 }),
      task({ id: 3, blockedByIds: [1] }),
      task({ id: 4, blockedByIds: [1, 2] }),
    ];
    expect([...blockedIds(tasks)]).toEqual([4]);
  });
});

describe("parseQuickAdd (3.2)", () => {
  test("plain title", () => {
    expect(parseQuickAdd("  Ship   it ", now)).toEqual({
      title: "Ship it",
      tags: [],
      priority: null,
      due: undefined,
      recur: null,
    });
  });

  test("every token kind", () => {
    const out = parseQuickAdd("Ship it #infra @tomorrow !3 ~w #release", now);
    expect(out.title).toBe("Ship it");
    expect(out.tags).toEqual(["infra", "release"]);
    expect(out.priority).toBe(Priority.High);
    expect(out.due!.format(DateOnly)).toBe("2026-08-22");
    expect(out.recur).toBe(RecurFreq.Weekly);
  });

  test("due tokens", () => {
    expect(parseQuickAdd("x @today", now).due!.format(DateOnly)).toBe("2026-08-21");
    expect(parseQuickAdd("x @tom", now).due!.format(DateOnly)).toBe("2026-08-22");
    expect(parseQuickAdd("x @+3d", now).due!.format(DateOnly)).toBe("2026-08-24");
    expect(parseQuickAdd("x @+1w", now).due!.format(DateOnly)).toBe("2026-08-28");
    expect(parseQuickAdd("x @2026-12-24", now).due!.format(DateOnly)).toBe("2026-12-24");
    expect(parseQuickAdd("x @none", now).due).toBeNull();
  });

  test("priority and recurrence spellings", () => {
    expect(parseQuickAdd("x !urgent", now).priority).toBe(Priority.Urgent);
    expect(parseQuickAdd("x !1", now).priority).toBe(Priority.Low);
    expect(parseQuickAdd("x !med", now).priority).toBe(Priority.Medium);
    expect(parseQuickAdd("x ~daily", now).recur).toBe(RecurFreq.Daily);
    expect(parseQuickAdd("x ~m", now).recur).toBe(RecurFreq.Monthly);
    expect(parseQuickAdd("x ~y", now).recur).toBe(RecurFreq.Yearly);
    expect(parseQuickAdd("x ~none", now).recur).toBe(RecurFreq.None);
  });

  test("unknown tokens stay in the title", () => {
    const out = parseQuickAdd("email bob@example.com about C# !9 ~q @someday", now);
    expect(out.title).toBe("email bob@example.com about C# !9 ~q @someday");
    expect(out.tags).toEqual([]);
    expect(out.priority).toBeNull();
    expect(out.due).toBeUndefined();
    expect(out.recur).toBeNull();
  });
});

describe("fitHints (1.4)", () => {
  const hints: Hint[] = [
    { key: "a", label: "add" },
    { key: "e", label: "edit" },
    { key: "space", label: "status" },
    { key: "d", label: "delete" },
    { key: "^k", label: "palette" },
    { key: "?", label: "help" },
  ];
  const cost = (h: Hint) => h.key.length + 3 + h.label.length + 1;
  const total = hints.reduce((n, h) => n + cost(h), 0);

  test("everything fits", () => {
    expect(fitHints(hints, total)).toEqual(hints);
  });

  test("drops from the end but keeps ? and ^k", () => {
    const out = fitHints(hints, total - 1);
    expect(out.map((h) => h.key)).toEqual(["a", "e", "space", "^k", "?"]);
  });

  test("keeps the run callbacks", () => {
    const run = () => {};
    const out = fitHints([{ key: "a", label: "add", run }], 20);
    expect(out[0]!.run).toBe(run);
  });

  test("falls back to keycaps only", () => {
    const out = fitHints(hints, 20);
    expect(out.every((h) => h.label === "")).toBe(true);
    expect(out.map((h) => h.key)).toContain("?");
    expect(out.map((h) => h.key)).toContain("^k");
    expect(out.reduce((n, h) => n + h.key.length + 4, 0)).toBeLessThanOrEqual(20);
  });

  test("zero width yields nothing", () => {
    expect(fitHints(hints, 0)).toEqual([]);
  });
});

describe("fitTags (1.9)", () => {
  const tags = [
    { tag: "work", count: 12 },
    { tag: "home", count: 3 },
    { tag: "infra", count: 1 },
  ];

  test("all fit", () => {
    expect(fitTags(tags, 80)).toEqual({ shown: tags, hidden: 0 });
  });

  test("hides the tail and counts it", () => {
    // Reserve 15, "work 12" costs 10, "home 3" costs 9.
    expect(fitTags(tags, 34)).toEqual({ shown: tags.slice(0, 2), hidden: 1 });
    expect(fitTags(tags, 25)).toEqual({ shown: tags.slice(0, 1), hidden: 2 });
  });

  test("too narrow for anything", () => {
    expect(fitTags(tags, 10)).toEqual({ shown: [], hidden: 3 });
  });
});

describe("relativeDue (5.1)", () => {
  const rel = (s: string) => relativeDue(due(s), now);

  test("near days", () => {
    expect(rel("2026-08-21")).toEqual({ label: "today", level: DueLevel.Today });
    expect(rel("2026-08-22")).toEqual({ label: "tomorrow", level: DueLevel.Soon });
    expect(rel("2026-08-20")).toEqual({ label: "yesterday", level: DueLevel.Overdue });
    expect(rel("2026-08-18")).toEqual({ label: "3d late", level: DueLevel.Overdue });
  });

  test("weekday within the week", () => {
    expect(rel("2026-08-23")).toEqual({ label: "Sun", level: DueLevel.Soon });
    expect(rel("2026-08-27")).toEqual({ label: "Thu", level: DueLevel.Far });
  });

  test("day count up to two weeks, then a date", () => {
    expect(rel("2026-08-28")).toEqual({ label: "in 7d", level: DueLevel.Far });
    expect(rel("2026-09-04")).toEqual({ label: "in 14d", level: DueLevel.Far });
    expect(rel("2026-09-05")).toEqual({ label: "Sep 05", level: DueLevel.Far });
  });

  test("late evening local time still counts the calendar day", () => {
    const late = GoTime.date(2026, 8, 21, 23, 30, 0, 0, "utc");
    expect(relativeDue(due("2026-08-21"), late).label).toBe("today");
  });
});

describe("groupTasks (5.1)", () => {
  const tasks = [
    task({ id: 1, priority: Priority.Urgent, dueDate: due("2026-08-19") }),
    task({ id: 2, priority: Priority.Low, dueDate: due("2026-08-21") }),
    task({ id: 3, priority: Priority.High, dueDate: due("2026-08-25") }),
    task({ id: 4, priority: Priority.High, dueDate: due("2026-08-28") }),
    task({ id: 5, priority: Priority.Medium, dueDate: due("2026-09-15") }),
    task({ id: 6, priority: Priority.Low }),
  ];

  test("due groups, empty ones omitted", () => {
    const groups = groupTasks(tasks, "due", now);
    expect(groups.map((g) => [g.label, g.tasks.map((t) => t.id)])).toEqual([
      ["Overdue", [1]],
      ["Today", [2]],
      ["This week", [3, 4]],
      ["Later", [5]],
      ["No date", [6]],
    ]);
    expect(groupTasks(tasks.slice(1, 3), "due", now).map((g) => g.label)).toEqual([
      "Today",
      "This week",
    ]);
  });

  test("priority groups", () => {
    const groups = groupTasks(tasks, "priority", now);
    expect(groups.map((g) => [g.label, g.tasks.map((t) => t.id)])).toEqual([
      ["Urgent", [1]],
      ["High", [3, 4]],
      ["Medium", [5]],
      ["Low", [2, 6]],
    ]);
  });

  test("created is one unlabeled group", () => {
    const groups = groupTasks(tasks, "created", now);
    expect(groups.length).toBe(1);
    expect(groups[0]!.label).toBe("");
    expect(groups[0]!.tasks.length).toBe(6);
  });

  test("no tasks, no groups", () => {
    expect(groupTasks([], "due", now)).toEqual([]);
  });
});

describe("indexOfId (2.7)", () => {
  const items = [{ id: 5 }, { id: 9 }, { id: 2 }];

  test("finds the id", () => {
    expect(indexOfId(items, 2, 0)).toBe(2);
  });

  test("falls back to the clamped index", () => {
    expect(indexOfId(items, 7, 1)).toBe(1);
    expect(indexOfId(items, null, 10)).toBe(2);
    expect(indexOfId([], 1, 3)).toBe(0);
  });
});

describe("loggedSince (5.19)", () => {
  const log = (id: number, duration: number, at: string) => {
    const [y, m, d] = at.split("-").map(Number) as [number, number, number];
    return {
      id,
      taskId: 1,
      duration,
      note: "",
      loggedAt: GoTime.date(y, m, d, 12, 0, 0, 0, "utc"),
    };
  };
  const tasks = [
    task({ id: 1, timeLogs: [log(1, Hour, "2026-08-21"), log(2, 30 * Minute, "2026-08-10")] }),
    task({ id: 2, timeLogs: [log(3, 15 * Minute, "2026-08-20")] }),
  ];

  test("sums logs after the cutoff", () => {
    expect(loggedSince(tasks, now.addDate(0, 0, -7))).toBe(Hour + 15 * Minute);
    expect(loggedSince(tasks, now.addDate(0, 0, -30))).toBe(Hour + 45 * Minute);
    expect(loggedSince(tasks, now.addDate(0, 0, 1))).toBe(0);
  });
});

describe("doneToday (5.18)", () => {
  test("counts Done tasks updated on now's day", () => {
    const tasks = [
      task({ id: 1, status: Status.Done, updatedAt: GoTime.date(2026, 8, 21, 9, 0, 0, 0, "utc") }),
      task({ id: 2, status: Status.Done, updatedAt: GoTime.date(2026, 8, 20, 23, 0, 0, 0, "utc") }),
      task({ id: 3, status: Status.Pending, updatedAt: GoTime.date(2026, 8, 21, 9, 0, 0, 0, "utc") }),
    ];
    expect(doneToday(tasks, now)).toBe(1);
  });
});

describe("detailRows (3.10)", () => {
  test("subtasks, then notes, then time logs, indexed per kind", () => {
    const t = task({
      id: 1,
      subtasks: [
        { id: 11, title: "a", completed: false, position: 0 },
        { id: 12, title: "b", completed: true, position: 1 },
      ],
      notes: [{ id: 21, taskId: 1, body: "n", createdAt: now }],
      timeLogs: [
        { id: 31, taskId: 1, duration: Hour, note: "", loggedAt: now },
        { id: 32, taskId: 1, duration: Hour, note: "", loggedAt: now },
      ],
    });
    expect(detailRows(t)).toEqual([
      { kind: "subtask", id: 11, index: 0 },
      { kind: "subtask", id: 12, index: 1 },
      { kind: "note", id: 21, index: 0 },
      { kind: "timelog", id: 31, index: 0 },
      { kind: "timelog", id: 32, index: 1 },
    ]);
    expect(detailRows(task({ id: 2 }))).toEqual([]);
  });
});

describe("copy helpers", () => {
  test("plural", () => {
    expect(plural(1, "task")).toBe("1 task");
    expect(plural(2, "task")).toBe("2 tasks");
    expect(plural(0, "entry", "entries")).toBe("0 entries");
  });

  test("pageSize keeps one row of overlap and never drops below one", () => {
    expect(pageSize(24, 3, 6)).toBe(5);
    expect(pageSize(10, 3, 6)).toBe(1);
    expect(pageSize(3, 3, 6)).toBe(1);
  });
});

describe("helpers", () => {
  test("tabCounts", () => {
    expect(tabCounts(sample, 4)).toEqual({
      all: 3,
      active: 2,
      done: 1,
      journal: 4,
    });
  });

  test("collectTags sorts by frequency", () => {
    expect(collectTags(sample)).toEqual([
      { tag: "work", count: 2 },
      { tag: "code", count: 1 },
      { tag: "home", count: 1 },
    ]);
  });

  test("clampIndex", () => {
    expect(clampIndex(-3, 5)).toBe(0);
    expect(clampIndex(9, 5)).toBe(4);
    expect(clampIndex(2, 5)).toBe(2);
    expect(clampIndex(2, 0)).toBe(0);
  });
});
