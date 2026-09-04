import { describe, expect, test } from "bun:test";
import { Hour, Minute } from "../src/core/duration.ts";
import { RecurFreq } from "../src/core/task/recur.ts";
import { newTask } from "../src/core/task/store.ts";
import { Priority, Status } from "../src/core/task/task.ts";
import { DueLevel } from "../src/core/ui/overdue.ts";
import { DateOnly, GoTime, parseDateOnly } from "../src/core/time.ts";
import {
  DUE_CHIPS,
  TABS,
  VIEWS,
  VIEW_LABELS,
  blockedIds,
  durationInput,
  exportFileName,
  exportTasksContent,
  parseDueInput,
  parseTimeLogInput,
  sortToast,
  statusToast,
  stepPriority,
  timeLogInput,
  uniquePath,
  clampIndex,
  collectTags,
  detailRows,
  doneToday,
  emptyFilters,
  fitChips,
  fitHints,
  fitTags,
  fuzzyIndices,
  fuzzyIndicesAfter,
  fuzzyScore,
  plainExcerpt,
  groupTasks,
  dueSentence,
  hintKeysMissingFromHelp,
  HELP_SECTIONS,
  indexOfId,
  indexOfNoteDate,
  rowGap,
  cycleDensity,
  clampRatio,
  listWidthFor,
  openFirst,
  excerptOf,
  hintSpecs,
  loggedSince,
  pageSize,
  parseFilterQuery,
  parseQuickAdd,
  plural,
  relativeDue,
  tabCounts,
  visibleTasks,
  nextView,
  viewToast,
  viewSubtitle,
  cycleTag,
  toggleInSet,
  bulkToast,
  withTasks,
  restoreTuiState,
  restoredTag,
  type Hint,
} from "../src/tui/state.ts";
import { defaultTuiState } from "../src/core/config/tui-state.ts";

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

  test("a finished task lands in Done, not in Overdue (5.2)", () => {
    const finished = task({ id: 7, dueDate: due("2026-08-19") });
    finished.status = Status.Done;
    const groups = groupTasks([...tasks, finished], "due", now);
    expect(groups.map((g) => [g.label, g.tasks.map((t) => t.id)])).toEqual([
      ["Overdue", [1]],
      ["Today", [2]],
      ["This week", [3, 4]],
      ["Later", [5]],
      ["No date", [6]],
      ["Done", [7]],
    ]);
  });
});

describe("restoredTag (4.1)", () => {
  const tagged = [task({ id: 1 }), task({ id: 2 })];
  tagged[0]!.tags = ["Work"];

  test("keeps a tag some task still carries, drops the rest", () => {
    expect(restoredTag("work", tagged)).toBe("work");
    expect(restoredTag("gone", tagged)).toBe(null);
    expect(restoredTag(null, tagged)).toBe(null);
  });
});

describe("dueSentence (5.1)", () => {
  test("says the distance in words", () => {
    expect(dueSentence(due("2026-08-21"), now)).toBe("today");
    expect(dueSentence(due("2026-08-22"), now)).toBe("tomorrow");
    expect(dueSentence(due("2026-08-20"), now)).toBe("yesterday");
    expect(dueSentence(due("2026-08-18"), now)).toBe("3 days overdue");
    expect(dueSentence(due("2026-08-22"), now)).toBe("tomorrow");
    expect(dueSentence(due("2026-08-31"), now)).toBe("in 10 days");
  });
});

describe("fitChips (1.7)", () => {
  test("takes the chips that fit and stops", () => {
    const labels = ["today", "tomorrow", "+1w", "none"];
    expect(fitChips(labels, 40)).toBe(4);
    expect(fitChips(labels, 24)).toBe(2);
    expect(fitChips(labels, 7)).toBe(0);
    expect(fitChips([], 40)).toBe(0);
  });
});

describe("help table (5.16)", () => {
  test("documents every key the status bar hints at", () => {
    expect(hintKeysMissingFromHelp()).toEqual([]);
  });

  test("names the confirm-dialog keys", () => {
    const rows = HELP_SECTIONS.flatMap(([, r]) => r);
    expect(rows.some(([key]) => key === "y / n")).toBe(true);
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

describe("indexOfNoteDate (2.7)", () => {
  const note = (id: number, date: string) => ({
    id,
    date: parseDateOnly(date),
    hidden: false,
    createdAt: now,
    updatedAt: now,
    entries: [],
  });
  const notes = [note(3, "2026-08-22"), note(2, "2026-08-21"), note(1, "2026-08-10")];

  test("finds the day", () => {
    expect(indexOfNoteDate(notes, "2026-08-21", 0)).toBe(1);
  });

  test("falls back to the clamped index", () => {
    expect(indexOfNoteDate(notes, "2026-01-01", 1)).toBe(1);
    expect(indexOfNoteDate(notes, null, 9)).toBe(2);
    expect(indexOfNoteDate([], "2026-08-21", 2)).toBe(0);
  });
});

describe("clampRatio / listWidthFor (1.10)", () => {
  test("keeps both panels above their minimum width", () => {
    expect(clampRatio(0.8, 80)).toBeCloseTo(39 / 80);
    expect(clampRatio(0.2, 80)).toBeCloseTo(34 / 80);
    expect(clampRatio(0.4, 100)).toBe(0.4);
    expect(listWidthFor(0.8, 80)).toBe(39);
    expect(listWidthFor(0.2, 80)).toBe(34);
    expect(listWidthFor(0.4, 100)).toBe(40);
  });

  test("a terminal too narrow for both panels gives the list its minimum", () => {
    expect(listWidthFor(0.5, 72)).toBe(34);
    expect(listWidthFor(0.1, 72)).toBe(34);
  });
});

describe("density (1.6)", () => {
  test("the blank line between rows follows the density, not the height", () => {
    expect(rowGap("comfortable", 24)).toBe(1);
    expect(rowGap("dense", 50)).toBe(0);
    expect(rowGap("auto", 24)).toBe(0);
    expect(rowGap("auto", 30)).toBe(1);
  });

  test("z cycles auto, dense, comfortable", () => {
    expect(cycleDensity("auto")).toBe("dense");
    expect(cycleDensity("dense")).toBe("comfortable");
    expect(cycleDensity("comfortable")).toBe("auto");
  });
});

describe("openFirst (3.11)", () => {
  test("done tasks move behind open ones, order otherwise kept", () => {
    const tasks = [
      task({ id: 1, status: Status.Done }),
      task({ id: 2, status: Status.Pending }),
      task({ id: 3, status: Status.Done }),
      task({ id: 4, status: Status.InProgress }),
    ];
    expect(openFirst(tasks).map((t) => t.id)).toEqual([2, 4, 1, 3]);
  });
});

describe("excerptOf (2.6)", () => {
  test("flattens whitespace and trims to one line with an ellipsis", () => {
    expect(excerptOf("Shipped the\nopentui  port")).toBe("Shipped the opentui port");
    const long = "x".repeat(60);
    expect(excerptOf(long)).toHaveLength(48);
    expect(excerptOf(long).endsWith("…")).toBe(true);
    expect(excerptOf("short", 10)).toBe("short");
  });
});

describe("hintSpecs (5.4)", () => {
  const keys = (specs: ReturnType<typeof hintSpecs>) => specs.map((h) => h.key);

  test("every list ends with the palette and help", () => {
    for (const tab of ["active", "journal"] as const) {
      for (const panel of [0, 1] as const) {
        for (const searching of [false, true]) {
          const specs = hintSpecs({ tab, panel, compact: false, searching });
          expect(keys(specs).slice(-2)).toEqual(["^k", "?"]);
        }
      }
    }
  });

  test("searching explains the filter keys", () => {
    const specs = hintSpecs({ tab: "active", panel: 1, compact: false, searching: true });
    expect(specs.map((h) => `${h.key} ${h.label}`)).toEqual([
      "↑↓ move",
      "enter keep",
      "esc clear",
      "^k palette",
      "? help",
    ]);
  });

  test("compact task lists prioritize capture, completion and search before details", () => {
    const compact = hintSpecs({ tab: "active", panel: 0, compact: true, searching: false });
    expect(keys(compact).slice(0, 3)).toEqual(["a", "space", "/"]);
    expect(compact.find((hint) => hint.action === "details")?.key).toBe("enter");
    expect(keys(hintSpecs({ tab: "active", panel: 0, compact: false, searching: false }))[0]).toBe("a");
    expect(keys(hintSpecs({ tab: "journal", panel: 0, compact: true, searching: false }))[0]).toBe("l");
  });

  test("the journal day list does not offer edit or delete; its entries do", () => {
    const days = keys(hintSpecs({ tab: "journal", panel: 0, compact: false, searching: false }));
    expect(days).not.toContain("e");
    expect(days).not.toContain("d");
    expect(days).toContain("a");
    expect(days).toContain("A");
    const entries = keys(hintSpecs({ tab: "journal", panel: 1, compact: false, searching: false }));
    expect(entries).toContain("e");
    expect(entries).toContain("d");
  });

  test("the task list offers the block picker; the detail panel edits rows", () => {
    const list = hintSpecs({ tab: "active", panel: 0, compact: false, searching: false });
    expect(list.find((h) => h.key === "b")?.action).toBe("block");
    expect(list.find((h) => h.key === "space")?.action).toBe("done");
    expect(list.find((h) => h.key === "s")?.action).toBe("start");
    expect(list.find((h) => h.key === "@")?.action).toBe("due");
    const detail = hintSpecs({ tab: "active", panel: 1, compact: false, searching: false, row: "subtask" });
    expect(detail.find((h) => h.key === "enter")?.label).toBe("edit");
    expect(detail.find((h) => h.key === "space")?.label).toBe("toggle");
  });

  test("3.10: detail hints follow the row kind", () => {
    const ctx = { tab: "active" as const, panel: 1 as const, compact: false, searching: false };
    const note = keys(hintSpecs({ ...ctx, row: "note" }));
    expect(note).not.toContain("space");
    expect(note.slice(0, 3)).toEqual(["enter", "d", "n"]);
    const log = keys(hintSpecs({ ...ctx, row: "timelog" }));
    expect(log.slice(0, 3)).toEqual(["enter", "d", "L"]);
    const empty = keys(hintSpecs({ ...ctx, row: null }));
    expect(empty).not.toContain("enter");
    expect(empty).not.toContain("d");
    expect(empty.slice(0, 3)).toEqual(["t", "n", "L"]);
  });

  test("a subtask is called a subtask in both hint lists", () => {
    const list = hintSpecs({
      tab: "active",
      panel: 0,
      compact: false,
      searching: false,
    });
    const detail = hintSpecs({
      tab: "active",
      panel: 1,
      compact: false,
      searching: false,
      row: "subtask",
    });
    expect(list.find((h) => h.key === "t")?.label).toBe("subtask");
    expect(detail.find((h) => h.key === "t")?.label).toBe("subtask");
  });

  test("marks replace the list keys with the bulk ones", () => {
    const specs = hintSpecs({
      tab: "active",
      panel: 0,
      compact: false,
      searching: false,
      marked: 2,
    });
    expect(specs.map((h) => `${h.key} ${h.label}`)).toEqual([
      "space done",
      "d delete",
      "+ - priority",
      "@ due",
      "esc clear marks",
      "m mark",
      "^k palette",
      "? help",
    ]);
  });

  test("a completed task's keys reopen and restart, and say so", () => {
    const ctx = {
      tab: "done" as const,
      panel: 0 as const,
      compact: false,
      searching: false,
    };
    const open = hintSpecs(ctx);
    expect(open.find((h) => h.key === "space")?.label).toBe("done");
    expect(open.find((h) => h.key === "s")?.label).toBe("start");
    const done = hintSpecs({ ...ctx, done: true });
    expect(done.find((h) => h.key === "space")?.label).toBe("reopen");
    expect(done.find((h) => h.key === "s")?.label).toBe("restart");
    // The keycaps still run the same actions, so clicking them keeps working.
    expect(done.find((h) => h.key === "space")?.action).toBe("done");
    expect(done.find((h) => h.key === "s")?.action).toBe("start");
  });
});

describe("mutation helpers (3.1, 3.3, 3.16, 2.14)", () => {
  test("stepPriority walks the scale and stops at both ends", () => {
    expect(stepPriority(Priority.Low, 1)).toBe(Priority.Medium);
    expect(stepPriority(Priority.High, 1)).toBe(Priority.Urgent);
    expect(stepPriority(Priority.Urgent, 1)).toBeNull();
    expect(stepPriority(Priority.Medium, -1)).toBe(Priority.Low);
    expect(stepPriority(Priority.Low, -1)).toBeNull();
  });

  test("statusToast names the spawned occurrence only when there is one", () => {
    expect(statusToast(3, Status.Done, null)).toBe("#3 → Done · u undo");
    expect(statusToast(3, Status.Done, 9)).toBe("#3 → Done · next is #9 · u undo");
    expect(statusToast(3, Status.InProgress, null)).toBe("#3 → In Progress · u undo");
  });

  test("sortToast flags an active filter", () => {
    expect(sortToast("due", false)).toBe("Sorted by due date");
    expect(sortToast("priority", true)).toBe("Sorted by priority (filter active)");
  });

  test("uniquePath numbers a taken name before the extension", () => {
    const taken = new Set(["/x/rondo.md", "/x/rondo-2.md", "/x/plain", "/x.y/plain"]);
    const exists = (p: string) => taken.has(p);
    expect(uniquePath("/x/rondo.md", exists)).toBe("/x/rondo-3.md");
    expect(uniquePath("/x/fresh.md", exists)).toBe("/x/fresh.md");
    expect(uniquePath("/x/plain", exists)).toBe("/x/plain-2");
    expect(uniquePath("/x.y/plain", exists)).toBe("/x.y/plain-2");
  });

  test("exportFileName is dated", () => {
    const now = GoTime.date(2026, 8, 22, 10, 0, 0, 0, "local");
    expect(exportFileName("md", now)).toBe("rondo-2026-08-22.md");
    expect(exportFileName("json", now)).toBe("rondo-2026-08-22.json");
  });

  test("exportTasksContent leaves the journal out", () => {
    const tasks = [task({ id: 1, title: "Only me" })];
    expect(exportTasksContent("md", tasks)).toContain("Only me");
    expect(exportTasksContent("md", tasks)).not.toContain("Journal");
    const json = JSON.parse(exportTasksContent("json", tasks));
    expect(json.tasks[0].title).toBe("Only me");
    expect(json.journal).toBeUndefined();
  });

  test("timeLogInput round-trips through parseTimeLogInput", () => {
    expect(durationInput(90 * Minute)).toBe("1h30m");
    expect(durationInput(2 * Hour)).toBe("2h");
    expect(durationInput(0)).toBe("0m");
    const text = timeLogInput({ duration: 90 * Minute, note: "pairing" });
    expect(text).toBe("1h30m pairing");
    expect(parseTimeLogInput(text)).toEqual({ duration: 90 * Minute, note: "pairing" });
    expect(timeLogInput({ duration: 45 * Minute, note: "" })).toBe("45m");
  });

  test("every due chip is a token the parser accepts", () => {
    const now = GoTime.date(2026, 8, 22, 10, 0, 0, 0, "local");
    expect(DUE_CHIPS.map((c) => c.key)).toEqual(["t", "m", "w", "n"]);
    expect(parseDueInput("today", now)!.format(DateOnly)).toBe("2026-08-22");
    expect(parseDueInput("tomorrow", now)!.format(DateOnly)).toBe("2026-08-23");
    expect(parseDueInput("+1w", now)!.format(DateOnly)).toBe("2026-08-29");
    expect(parseDueInput("none", now)).toBeNull();
  });
});

describe("views, tags and marks (3.7, 3.8, 3.15)", () => {
  test("nextView walks the ring and wraps", () => {
    expect(nextView("all")).toBe("today");
    expect(nextView("blocked")).toBe("all");
    expect(viewToast("week")).toBe("View: This week");
  });

  test("viewSubtitle counts the narrowed view against the tab", () => {
    expect(viewSubtitle("overdue", 3, 12)).toBe("3 overdue of 12");
    expect(viewSubtitle("week", 0, 5)).toBe("0 this week of 5");
  });

  test("cycleTag walks all → tags → all in both directions", () => {
    const tags = [{ tag: "code" }, { tag: "work" }];
    expect(cycleTag(tags, null, 1)).toBe("code");
    expect(cycleTag(tags, "code", 1)).toBe("work");
    expect(cycleTag(tags, "work", 1)).toBeNull();
    expect(cycleTag(tags, null, -1)).toBe("work");
    expect(cycleTag(tags, "code", -1)).toBeNull();
    // A tag that no longer exists restarts from "all".
    expect(cycleTag(tags, "gone", 1)).toBe("code");
    expect(cycleTag([], null, 1)).toBeNull();
  });

  test("toggleInSet never mutates its input", () => {
    const set = new Set([1]);
    const added = toggleInSet(set, 2);
    expect([...added]).toEqual([1, 2]);
    expect([...toggleInSet(added, 1)]).toEqual([2]);
    expect([...set]).toEqual([1]);
  });

  test("bulkToast names the count and the undo key", () => {
    expect(bulkToast(3, "Done")).toBe("3 tasks → Done · u undo");
    expect(bulkToast(1, "High")).toBe("1 task → High · u undo");
  });
});

describe("withTasks (6.5)", () => {
  test("swaps only the refreshed tasks and drops the deleted ones", () => {
    const fresh = task({ id: 1, title: "Write report (v2)" });
    const out = withTasks(sample, new Map([[1, fresh], [2, null]]));
    expect(out.map((t) => t.id)).toEqual([1, 3]);
    expect(out[0]).toBe(fresh);
    expect(out[1]).toBe(sample[2]);
  });
});

describe("restoreTuiState (4.1)", () => {
  test("keeps known values and falls back on unknown ones", () => {
    const saved = {
      ...defaultTuiState(),
      tab: "done",
      sort: "priority",
      tagBar: true,
      tag: "work",
      view: "overdue",
      selectedTaskId: 7,
      selectedNoteDate: "2026-08-22",
      density: "dense" as const,
    };
    expect(restoreTuiState(saved)).toEqual({
      tab: "done",
      sort: "priority",
      tagBar: true,
      tag: "work",
      view: "overdue",
      selectedTaskId: 7,
      selectedNoteDate: "2026-08-22",
      density: "dense",
    });
    const odd = restoreTuiState({ ...saved, tab: "nope", sort: "title", view: "soon" });
    expect(odd.tab).toBe("active");
    expect(odd.sort).toBe("due");
    expect(odd.view).toBe("all");
  });
});

describe("hintSpecs with marks (3.15)", () => {
  test("marked tasks turn the list hints into bulk keys", () => {
    const specs = hintSpecs({ tab: "active", panel: 0, compact: false, searching: false, marked: 2 });
    expect(specs.map((h) => h.key)).toEqual(["space", "d", "+ -", "@", "esc", "m", "^k", "?"]);
    expect(specs.find((h) => h.key === "esc")?.action).toBe("clearMarks");
    const plain = hintSpecs({ tab: "active", panel: 0, compact: false, searching: false, marked: 0 });
    expect(plain.map((h) => h.key)).toContain("v");
    expect(plain.map((h) => h.key)).toContain("#");
    expect(plain.map((h) => h.key)).toContain("m");
  });
});

describe("fuzzyIndices", () => {
  test("a whole occurrence wins over an earlier scattered one", () => {
    expect(fuzzyIndices("subt", "Task Add subtask")).toEqual([9, 10, 11, 12]);
    expect(fuzzyScore("subt", "Task Add subtask")).toBe(
      fuzzyScore("subt", "task add subtask"),
    );
  });

  test("falls back to the greedy walk and reports every letter", () => {
    expect(fuzzyIndices("wtr", "Write the report")).toEqual([0, 3, 10]);
    expect(fuzzyIndices("zzz", "Write the report")).toBeNull();
    expect(fuzzyIndices("", "anything")).toEqual([]);
  });

  test("re-bases on the drawn text and prefers a match inside it", () => {
    expect(fuzzyIndicesAfter("subt", "Task ", "Add subtask")).toEqual([4, 5, 6, 7]);
    // "#12 fix" only matches with the id in front; the id's hits are dropped.
    expect(fuzzyIndicesAfter("12f", "#12 ", "fix it")).toEqual([0]);
    expect(fuzzyIndicesAfter("zzz", "#12 ", "fix it")).toEqual([]);
  });
});

describe("plainExcerpt", () => {
  test("strips the markdown the app renders", () => {
    expect(plainExcerpt("# Title\n\n- **Bold** and `code` and *em*")).toBe(
      "Title Bold and code and em",
    );
  });

  test("still trims to the width with an ellipsis", () => {
    expect(plainExcerpt("> a quoted line that runs on and on", 12)).toBe(
      "a quoted li…",
    );
  });
});
