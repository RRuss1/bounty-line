/**
 * A small D1Database stand-in backed by Node's built-in SQLite, so tests run
 * the real migration SQL. Covers the D1 surface the Worker uses:
 * prepare/bind/first/run/all, batch and exec.
 */
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath, URL } from "node:url";

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: SQLInputValue[] = [],
  ) {}
  bind(...params: unknown[]): Statement {
    return new Statement(this.db, this.sql, params.map((p) => (typeof p === "boolean" ? Number(p) : (p as SQLInputValue))));
  }
  // D1 numbers ?1..?N; node:sqlite accepts the same positional form.
  async first<T>(col?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (col ? row[col] : { ...row }) as T;
  }
  async all<T>(): Promise<{ results: T[]; success: true }> {
    return { results: this.db.prepare(this.sql).all(...this.params).map((r) => ({ ...r })) as T[], success: true };
  }
  async run(): Promise<{ success: true; meta: { changes: number; last_row_id: number } }> {
    const r = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}

export class TestD1 {
  readonly sqlite = new DatabaseSync(":memory:");
  /** Count of statements prepared, to prove code paths never touched the database. */
  calls = 0;

  prepare(sql: string): Statement {
    this.calls++;
    return new Statement(this.sqlite, sql);
  }
  async batch(stmts: Statement[]): Promise<{ results: unknown[] }[]> {
    return Promise.all(stmts.map((s) => s.all()));
  }
  async exec(sql: string): Promise<void> {
    this.sqlite.exec(sql);
  }

  /** Applies worker/migrations/*.sql in order. */
  static migrated(): TestD1 {
    const db = new TestD1();
    const dir = fileURLToPath(new URL("../../migrations/", import.meta.url));
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) db.sqlite.exec(readFileSync(dir + f, "utf8"));
    return db;
  }

  asD1(): D1Database {
    return this as unknown as D1Database;
  }
}

/** A database that fails the test if anything touches it. */
export const forbiddenDb = (): D1Database =>
  new Proxy({} as D1Database, {
    get(_, prop) {
      throw new Error(`database accessed (${String(prop)}) before it should have been`);
    },
  });
