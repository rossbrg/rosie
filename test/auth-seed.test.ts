import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enabledAuthPeople } from "../src/auth-users";
import { migrate, MIGRATIONS } from "../src/db";
import { seed } from "../src/seed";

// A throwaway household: the checked-in seed's shape, made-up addresses.
let dir: string;
let db: Database;
const now = new Date("2026-10-17T12:00:00Z");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rosie-seed-"));
  db = new Database(":memory:", { strict: true });
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function seedWith(local: object | null, base: object = BASE): void {
  const path = join(dir, "household.json");
  writeFileSync(path, JSON.stringify(base));
  const localPath = join(dir, "household.local.json");
  rmSync(localPath, { force: true });
  if (local) writeFileSync(localPath, JSON.stringify(local));
  seed(db, path, now);
}

const BASE = {
  people: [
    { id: "ross", name: "Ross" },
    { id: "carly", name: "Carly" },
  ],
  items: [{ id: "mini-split", name: "Mini-split" }],
  schedules: [{ id: "vacuum", item_id: "mini-split", title: "Vacuum inserts", interval_days: 91, owner_id: "ross", starts_on: "2026-10-22" }],
};
const ADDRESSES = {
  people: [
    { id: "ross", login: "ross@example.com", email: "Ross@Example.com " },
    { id: "carly", login: "carly@example.com", email: "carly@example.com" },
  ],
};

const person = (id: string) =>
  db.query<{ auth_enabled: number; email: string | null }, [string]>("SELECT auth_enabled, email FROM people WHERE id = ?").get(id)!;

function snapshotHousehold() {
  return Object.fromEntries(
    ["people", "items", "schedules", "occurrences", "completions"].map((t) => [t, db.query(`SELECT * FROM ${t} ORDER BY rowid`).all()]),
  );
}

describe("who may sign in", () => {
  test("nobody, until the private seed says so; a reminder address is not an invitation", () => {
    seedWith(ADDRESSES);
    expect(person("ross").auth_enabled).toBe(0);
    expect(person("carly").auth_enabled).toBe(0);
    expect(enabledAuthPeople(db)).toEqual([]);
  });

  test("an explicit true enables, omission keeps it, an explicit false disables", () => {
    const ross = (extra: object) => ({ people: [{ ...ADDRESSES.people[0], ...extra }, ADDRESSES.people[1]] });
    seedWith(ross({ auth_enabled: true }));
    expect(person("ross").auth_enabled).toBe(1);
    expect(person("carly").auth_enabled).toBe(0);
    expect(enabledAuthPeople(db)).toEqual([{ id: "ross", name: "Ross", email: "ross@example.com" }]);

    seedWith(ross({}));
    expect(person("ross").auth_enabled).toBe(1);
    seedWith(null);
    expect(person("ross").auth_enabled).toBe(1);

    seedWith(ross({ auth_enabled: false }));
    expect(person("ross").auth_enabled).toBe(0);
  });

  test("normalizing for sign-in doesn't rewrite the stored reminder address", () => {
    seedWith({ people: [{ ...ADDRESSES.people[0], auth_enabled: true }] });
    expect(person("ross").email).toBe("Ross@Example.com ");
    expect(enabledAuthPeople(db)[0]!.email).toBe("ross@example.com");
  });

  test("dots and +tags are different addresses", () => {
    seedWith({
      people: [
        { id: "ross", email: "ross+rosie@example.com", auth_enabled: true },
        { id: "carly", email: "r.oss@example.com", auth_enabled: true },
      ],
    });
    expect(enabledAuthPeople(db).map((p) => p.email)).toEqual(["r.oss@example.com", "ross+rosie@example.com"]);
  });

  test("an enabled person without an address, or two sharing one, rolls the whole seed back", () => {
    seedWith(ADDRESSES);
    const before = snapshotHousehold();
    expect(() => seedWith({ people: [{ id: "ross", auth_enabled: true, email: "  " }] }, { ...BASE, people: [{ id: "ross", name: "Ross R" }] })).toThrow(
      /no valid email/,
    );
    expect(snapshotHousehold()).toEqual(before);

    const newcomer = { id: "guest", name: "Guest" };
    expect(() =>
      seedWith(
        {
          people: [
            { id: "ross", auth_enabled: true },
            { id: "carly", email: " ROSS@example.com", auth_enabled: true },
          ],
        },
        { ...BASE, people: [...BASE.people, newcomer] },
      ),
    ).toThrow(/same email/);
    expect(snapshotHousehold()).toEqual(before);
  });

  test("auth_enabled must be a boolean", () => {
    expect(() => seedWith({ people: [{ id: "ross", auth_enabled: "yes" }] })).toThrow(/true or false/);
    expect(() => seedWith({ people: [{ id: "ross", auth_enabled: 1 }] })).toThrow(/true or false/);
  });
});

describe("upgrading an existing database", () => {
  test("adding the flag keeps every household record and enables nobody", () => {
    const old = new Database(":memory:", { strict: true });
    old.exec("PRAGMA foreign_keys = ON");
    old.exec("CREATE TABLE schema_version (version INTEGER NOT NULL); INSERT INTO schema_version VALUES (0)");
    const before = MIGRATIONS.findIndex((m) => m.includes("auth_enabled"));
    expect(before).toBeGreaterThan(0);
    for (const m of MIGRATIONS.slice(0, before)) old.exec(m);
    old.run("UPDATE schema_version SET version = ?", [before]);
    old.run("INSERT INTO people (id, name, login, email) VALUES ('ross', 'Ross', 'ross@example.com', 'ross@example.com'), ('carly', 'Carly', NULL, 'carly@example.com')");
    old.run("INSERT INTO items (id, name) VALUES ('mini-split', 'Mini-split')");
    old.run("INSERT INTO completions (item_id, title, completed_on, completed_by, created_at) VALUES ('mini-split', 'Vacuumed', '2026-10-01', 'ross', '2026-10-01T00:00:00Z')");
    const snapshot = () => ({
      people: old.query("SELECT id, name, login, email, ntfy_topic FROM people ORDER BY id").all(),
      completions: old.query("SELECT * FROM completions").all(),
    });
    const was = snapshot();

    migrate(old);
    migrate(old); // a second run is a no-op
    expect(snapshot()).toEqual(was);
    expect(old.query("SELECT id, auth_enabled FROM people ORDER BY id").all()).toEqual([
      { id: "carly", auth_enabled: 0 },
      { id: "ross", auth_enabled: 0 },
    ]);
    expect(() => old.run("UPDATE people SET auth_enabled = 2 WHERE id = 'ross'")).toThrow();
  });
});
