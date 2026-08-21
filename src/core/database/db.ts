import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Data directory. Defaults to ~/.todo-app (same as the Go build) and can be
 * redirected with RONDO_HOME, which is handy for tests and throwaway profiles.
 */
export function dataDir(): string {
  return process.env.RONDO_HOME ?? join(homedir(), ".todo-app");
}

export function dbPath(): string {
  return join(dataDir(), "todo.db");
}

export function backupsDir(): string {
  return join(dataDir(), "backups");
}

/** Opens the shared SQLite database used by every store. */
export function open(path = dbPath()): Database {
  mkdirSync(dataDir(), { recursive: true });
  const db = new Database(path, { create: true });
  db.run("PRAGMA journal_mode=WAL");
  db.run("PRAGMA foreign_keys=ON");
  return db;
}

/** In-memory database with the same pragmas, used by tests. */
export function openMemory(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys=ON");
  return db;
}
