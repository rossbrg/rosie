import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALL_PER_HOUR, consumeCodeRequest, PER_ADDRESS_PER_HOUR } from "../src/auth-limits";
import { migrate, openDb } from "../src/db";

let db: Database;
const t0 = new Date("2026-10-17T12:00:00Z").getTime();
const at = (seconds: number) => new Date(t0 + seconds * 1000);

beforeEach(() => {
  db = new Database(":memory:", { strict: true });
  migrate(db);
});

describe("code request budgets", () => {
  test("one code a minute per address, however it's spelled", () => {
    expect(consumeCodeRequest(db, "ross@example.com", at(0))).toEqual({ allowed: true });
    expect(consumeCodeRequest(db, " Ross@Example.COM", at(30))).toEqual({ allowed: false, retryAfter: 30 });
    expect(consumeCodeRequest(db, "ross@example.com", at(59.5))).toEqual({ allowed: false, retryAfter: 1 });
    expect(consumeCodeRequest(db, "ross@example.com", at(60))).toEqual({ allowed: true });
    // A different address has its own cooldown.
    expect(consumeCodeRequest(db, "carly@example.com", at(61))).toEqual({ allowed: true });
  });

  test("at most five an hour per address", () => {
    for (let i = 0; i < PER_ADDRESS_PER_HOUR; i++) expect(consumeCodeRequest(db, "ross@example.com", at(i * 120))).toEqual({ allowed: true });
    // The first of the five ages out an hour after it was made.
    expect(consumeCodeRequest(db, "ross@example.com", at(10 * 60))).toEqual({ allowed: false, retryAfter: 3000 });
    expect(consumeCodeRequest(db, "ross@example.com", at(3600))).toEqual({ allowed: true });
  });

  test("at most twenty an hour overall, counting unknown addresses", () => {
    for (let i = 0; i < ALL_PER_HOUR; i++) expect(consumeCodeRequest(db, `stranger${i}@example.com`, at(i))).toEqual({ allowed: true });
    expect(consumeCodeRequest(db, "ross@example.com", at(100))).toEqual({ allowed: false, retryAfter: 3500 });
    expect(consumeCodeRequest(db, "ross@example.com", at(3600))).toEqual({ allowed: true });
  });

  test("refused requests don't count, and old rows are pruned", () => {
    consumeCodeRequest(db, "ross@example.com", at(0));
    for (let i = 1; i < 10; i++) consumeCodeRequest(db, "ross@example.com", at(i));
    expect(db.query("SELECT count(*) AS n FROM auth_code_requests").get()).toEqual({ n: 1 });
    consumeCodeRequest(db, "carly@example.com", at(3601));
    expect(db.query("SELECT count(*) AS n FROM auth_code_requests").get()).toEqual({ n: 1 });
  });

  test("addresses aren't stored in the clear", () => {
    consumeCodeRequest(db, "ross@example.com", at(0));
    expect(JSON.stringify(db.query("SELECT * FROM auth_code_requests").all())).not.toContain("ross");
  });
});

describe("across restarts and processes", () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "rosie-limits-"))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("a restart doesn't reset the cooldown", () => {
    const path = join(dir, "r.sqlite");
    const first = openDb(path);
    expect(consumeCodeRequest(first, "ross@example.com", at(0))).toEqual({ allowed: true });
    first.close();
    const second = openDb(path);
    expect(consumeCodeRequest(second, "ross@example.com", at(10))).toEqual({ allowed: false, retryAfter: 50 });
    second.close();
  });

  test("processes racing for one cooldown slot: exactly one wins", async () => {
    const path = join(dir, "r.sqlite");
    openDb(path).close();
    const limits = join(import.meta.dir, "..", "src", "auth-limits.ts");
    const start = Date.now() + 500;
    // Already migrated above; each racer only waits on the lock, like a second server would.
    const script = `
      const { consumeCodeRequest } = await import(${JSON.stringify(limits)});
      const { Database } = await import("bun:sqlite");
      const db = new Database(${JSON.stringify(path)}, { strict: true });
      db.exec("PRAGMA busy_timeout = 5000");
      while (Date.now() < ${start}) {}
      console.log(JSON.stringify(consumeCodeRequest(db, "ross@example.com", new Date(${t0}))));`;
    const runs = Array.from({ length: 4 }, () => Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" }));
    const outputs = await Promise.all(runs.map(async (p) => ((await p.exited) === 0 ? await new Response(p.stdout).text() : await new Response(p.stderr).text())));
    if (outputs.some((o) => !o.trim().startsWith("{"))) throw new Error(outputs.join("\n"));
    const results = outputs.map((o) => JSON.parse(o.trim()));
    expect(results.filter((r) => r.allowed).length).toBe(1);
    expect(results.filter((r) => !r.allowed && r.retryAfter === 60).length).toBe(3);
  });
});
