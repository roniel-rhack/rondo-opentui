import type { Note } from "../journal/journal.ts";
import {
  Status,
  priorityString,
  statusString,
  type Task,
} from "../task/task.ts";
import { RFC3339 } from "../time.ts";

/** Renders tasks as Markdown, matching the Go exporter byte for byte. */
export function writeTasks(tasks: readonly Task[] | null): string {
  let out = "# Tasks\n\n";

  if (!tasks || tasks.length === 0) {
    return `${out}_No tasks._\n`;
  }

  for (const t of tasks) {
    const checkbox = t.status === Status.Done ? "[x]" : "[ ]";
    let line = `- ${checkbox} **${t.title}**`;

    const meta: string[] = [priorityString(t.priority), statusString(t.status)];
    if (t.dueDate) meta.push(`due ${t.dueDate.format("2006-01-02")}`);
    if (t.tags.length > 0) meta.push(`tags: ${t.tags.join(", ")}`);
    if (meta.length > 0) line += ` (${meta.join(" | ")})`;

    out += `${line}\n`;
    if (t.description !== "") out += `  > ${t.description}\n`;

    for (const st of t.subtasks) {
      out += `  - ${st.completed ? "[x]" : "[ ]"} ${st.title}\n`;
    }
  }
  return out;
}

/** Renders journal notes as Markdown. */
export function writeNotes(notes: readonly Note[] | null): string {
  let out = "# Journal\n\n";

  if (!notes || notes.length === 0) {
    return `${out}_No journal entries._\n`;
  }

  notes.forEach((n, i) => {
    out += `## ${n.date.format("2006-01-02")}\n\n`;
    if (n.entries.length === 0) out += "_No entries._\n";
    for (const e of n.entries) {
      out += `- **${e.createdAt.format("15:04")}** ${e.body}\n`;
    }
    if (i < notes.length - 1) out += "\n";
  });
  return out;
}

interface JSONSubtask {
  id: number;
  title: string;
  completed: boolean;
}

interface JSONTask {
  id: number;
  title: string;
  description?: string;
  status: string;
  priority: string;
  due_date?: string;
  created_at: string;
  tags?: string[];
  subtasks?: JSONSubtask[];
}

interface JSONEntry {
  body: string;
  created_at: string;
}

interface JSONNote {
  date: string;
  entries: JSONEntry[] | null;
}

export interface ExportData {
  tasks: JSONTask[] | null;
  journal?: JSONNote[];
}

export function buildExportData(
  tasks: readonly Task[] | null,
  notes: readonly Note[] | null,
): ExportData {
  const data: ExportData = { tasks: null };

  for (const t of tasks ?? []) {
    const jt: JSONTask = {
      id: t.id,
      title: t.title,
      status: statusString(t.status),
      priority: priorityString(t.priority),
      created_at: t.createdAt.format(RFC3339),
    };
    if (t.description !== "") jt.description = t.description;
    if (t.dueDate) jt.due_date = t.dueDate.format("2006-01-02");
    if (t.tags.length > 0) jt.tags = [...t.tags];
    if (t.subtasks.length > 0) {
      jt.subtasks = t.subtasks.map((s) => ({
        id: s.id,
        title: s.title,
        completed: s.completed,
      }));
    }
    data.tasks = data.tasks ?? [];
    data.tasks.push(jt);
  }

  if (notes) {
    data.journal = notes.map((n) => ({
      date: n.date.format("2006-01-02"),
      entries:
        n.entries.length > 0
          ? n.entries.map((e) => ({
              body: e.body,
              created_at: e.createdAt.format(RFC3339),
            }))
          : null,
    }));
  }

  return data;
}

/** Serializes tasks and optional journal notes as indented JSON. */
export function writeJSON(
  tasks: readonly Task[] | null,
  notes: readonly Note[] | null,
): string {
  return `${JSON.stringify(buildExportData(tasks, notes), null, 2)}\n`;
}
