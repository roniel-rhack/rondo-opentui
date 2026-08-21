import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { GoTime, parseDateOnly } from "../time.ts";

/**
 * Creates a backup of the database with VACUUM INTO, named
 * backup-YYYY-MM-DD.db inside dir, and prunes backups older than retainDays.
 */
export function backup(db: Database, dir: string, retainDays: number): void {
  mkdirSync(dir, { recursive: true });

  const name = `backup-${GoTime.now().format("2006-01-02")}.db`;
  const dest = join(dir, name);

  if (existsSync(dest)) {
    pruneBackups(dir, retainDays);
    return;
  }

  db.run(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  pruneBackups(dir, retainDays);
}

/** Removes backup-YYYY-MM-DD.db files older than retainDays days. */
export function pruneBackups(dir: string, retainDays: number): void {
  const cutoff = GoTime.now().addDate(0, 0, -retainDays);

  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) continue;
    if (!name.startsWith("backup-") || !name.endsWith(".db")) continue;

    const dateStr = name.slice("backup-".length, name.length - ".db".length);
    let stamp: GoTime;
    try {
      stamp = parseDateOnly(dateStr, "local");
    } catch {
      continue; // not a valid backup file name
    }
    if (stamp.before(cutoff)) unlinkSync(path);
  }
}
