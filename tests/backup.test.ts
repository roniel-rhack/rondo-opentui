import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backup } from "../src/core/database/backup.ts";
import { GoTime } from "../src/core/time.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "rondo-bak-"));
}

/** VACUUM INTO does not work with :memory:, so use a temp file. */
function newTestDB(): Database {
  const db = new Database(join(tempDir(), "test.db"), { create: true });
  db.run("CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)");
  db.run("INSERT INTO t (val) VALUES ('hello')");
  return db;
}

describe("backup", () => {
  test("creates a usable backup file", () => {
    const db = newTestDB();
    const dir = join(tempDir(), "backups");

    backup(db, dir, 7);

    const path = join(dir, `backup-${GoTime.now().format("2006-01-02")}.db`);
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).size).toBeGreaterThan(0);

    const bdb = new Database(path);
    const row = bdb.query("SELECT val FROM t WHERE id = 1").get() as {
      val: string;
    };
    expect(row.val).toBe("hello");
    bdb.close();
  });

  test("creates nested directories", () => {
    const db = newTestDB();
    const dir = join(tempDir(), "nested", "deep", "backups");
    backup(db, dir, 7);
    expect(existsSync(dir)).toBe(true);
  });

  test("prunes old files and keeps recent ones", () => {
    const db = newTestDB();
    const dir = tempDir();

    const oldDate = GoTime.now().addDate(0, 0, -10).format("2006-01-02");
    const recentDate = GoTime.now().addDate(0, 0, -2).format("2006-01-02");

    const oldFile = join(dir, `backup-${oldDate}.db`);
    const recentFile = join(dir, `backup-${recentDate}.db`);
    const unrelatedFile = join(dir, "not-a-backup.txt");
    for (const f of [oldFile, recentFile, unrelatedFile]) {
      writeFileSync(f, "data");
    }

    backup(db, dir, 7);

    expect(existsSync(oldFile)).toBe(false);
    expect(existsSync(recentFile)).toBe(true);
    expect(existsSync(unrelatedFile)).toBe(true);
    expect(
      existsSync(join(dir, `backup-${GoTime.now().format("2006-01-02")}.db`)),
    ).toBe(true);
  });

  test("is idempotent for the same day", () => {
    const db = newTestDB();
    const dir = tempDir();
    backup(db, dir, 7);
    const path = join(dir, `backup-${GoTime.now().format("2006-01-02")}.db`);
    const size = statSync(path).size;

    db.run("INSERT INTO t (val) VALUES ('second')");
    backup(db, dir, 7);

    expect(statSync(path).size).toBe(size);
  });
});
