import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { defaultConfig, loadWithWarnings } from "./core/config/config.ts";
import { backup } from "./core/database/backup.ts";
import { backupsDir, open } from "./core/database/db.ts";
import { FocusStore } from "./core/focus/store.ts";
import { JournalStore } from "./core/journal/store.ts";
import { TaskStore } from "./core/task/store.ts";
import { initTheme } from "./core/ui/colors.ts";
import { newContext, runCLI } from "./cli/index.ts";
import { isNotFound } from "./cli/errors.ts";
import { App } from "./tui/app.tsx";
import { RondoData } from "./tui/data.ts";

const db = open();

// Best-effort daily backup; never blocks startup.
try {
  backup(db, backupsDir(), 30);
} catch (err) {
  process.stderr.write(`Warning: backup failed: ${(err as Error).message}\n`);
}

let cfg = defaultConfig();
try {
  const loaded = loadWithWarnings();
  cfg = loaded.cfg;
  for (const warning of loaded.warnings) {
    process.stderr.write(`Warning: ${warning}\n`);
  }
} catch (err) {
  process.stderr.write(
    `Warning: config load failed: ${(err as Error).message}\n`,
  );
}

const args = process.argv.slice(2);

if (args.length > 0) {
  const ctx = newContext({
    taskStore: new TaskStore(db),
    journalStore: new JournalStore(db),
    focusStore: new FocusStore(db),
    cfg,
    stdin: () => {
      try {
        return require("node:fs").readFileSync(0, "utf8") as string;
      } catch {
        return "";
      }
    },
  });

  try {
    runCLI(args, ctx);
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exit(isNotFound(err) ? 3 : 1);
  }
  db.close();
  process.exit(0);
}

// Dark is the safe default; the theme can be toggled at runtime with T.
initTheme(true);

const data = new RondoData(db, cfg);
const renderer = await createCliRenderer({ exitOnCtrlC: false });

const quit = () => {
  renderer.destroy();
  db.close();
  process.exit(0);
};

createRoot(renderer).render(<App data={data} onQuit={quit} />);
