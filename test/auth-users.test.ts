import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { AuthSetupError, bootstrapAuthUsers, checkAuthProvisioned, mappedAuthPerson } from "../src/auth-users";
import { migrate, MIGRATIONS } from "../src/db";

// Made-up household; no real addresses.
let db: Database;
const now = new Date("2026-10-17T12:00:00Z");

beforeEach(() => {
  db = new Database(":memory:", { strict: true });
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  db.run(`INSERT INTO people (id, name, login, email, auth_enabled) VALUES
    ('ross', 'Ross', 'ross@example.com', 'Ross@Example.com', 1),
    ('carly', 'Carly', 'carly@example.com', 'carly@example.com', 0)`);
});

const users = () => db.query<{ id: string; email: string; emailVerified: number }, []>("SELECT id, email, emailVerified FROM auth_user").all();
const userOf = (person: string) =>
  db.query<{ user_id: string }, [string]>("SELECT user_id FROM auth_household_user WHERE person_id = ?").get(person)?.user_id;
const verify = (userId: string) => db.run("UPDATE auth_user SET emailVerified = 1 WHERE id = ?", [userId]);
const addSession = (userId: string, token: string) =>
  db.run(
    `INSERT INTO auth_session (id, expiresAt, token, createdAt, updatedAt, userId) VALUES (?, '2026-11-16T12:00:00.000Z', ?, ?, ?, ?)`,
    [token, token, now.toISOString(), now.toISOString(), userId],
  );
const sessions = () => db.query<{ n: number }, []>("SELECT count(*) AS n FROM auth_session").get()!.n;
// Household tables are only ever written by seeding in production; tests set state directly.
const setPerson = (sql: string) => db.run(sql);

describe("provisioning sign-in accounts", () => {
  test("the migration can run twice", () => {
    migrate(db);
    expect(db.query("SELECT version FROM schema_version").get()).toEqual({ version: MIGRATIONS.length });
  });

  test("Ross gets one unverified, passwordless account; Carly gets none", () => {
    expect(bootstrapAuthUsers(db, now)).toEqual({ created: 1, updated: 0, revoked: 0 });
    expect(bootstrapAuthUsers(db, now)).toEqual({ created: 0, updated: 0, revoked: 0 });
    expect(users()).toEqual([{ id: userOf("ross")!, email: "ross@example.com", emailVerified: 0 }]);
    expect(userOf("carly")).toBeUndefined();
    expect(db.query("SELECT count(*) AS n FROM auth_account").get()).toEqual({ n: 0 });
  });

  test("the account-to-person link is one to one", () => {
    bootstrapAuthUsers(db, now);
    const id = userOf("ross")!;
    expect(() => db.run("INSERT INTO auth_household_user (user_id, person_id) VALUES (?, 'carly')", [id])).toThrow();
    db.run(`INSERT INTO auth_user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('x', 'X', 'x@example.com', 1, '', '')`);
    expect(() => db.run("INSERT INTO auth_household_user (user_id, person_id) VALUES ('x', 'ross')")).toThrow();
  });

  test("a moved address ends sessions and has to be proven again", () => {
    bootstrapAuthUsers(db, now);
    const id = userOf("ross")!;
    verify(id);
    addSession(id, "s1");
    setPerson("UPDATE people SET email = 'ross.new@example.com' WHERE id = 'ross'");
    expect(bootstrapAuthUsers(db, now)).toEqual({ created: 0, updated: 1, revoked: 1 });
    expect(users()).toEqual([{ id, email: "ross.new@example.com", emailVerified: 0 }]);
    expect(sessions()).toBe(0);
  });

  test("two people swapping addresses don't collide", () => {
    setPerson("UPDATE people SET auth_enabled = 1 WHERE id = 'carly'");
    bootstrapAuthUsers(db, now);
    setPerson("UPDATE people SET email = CASE id WHEN 'ross' THEN 'carly@example.com' ELSE 'ross@example.com' END");
    expect(bootstrapAuthUsers(db, now)).toEqual({ created: 0, updated: 2, revoked: 2 });
    expect(db.query("SELECT u.email FROM auth_user u JOIN auth_household_user m ON m.user_id = u.id WHERE m.person_id = 'ross'").get()).toEqual({
      email: "carly@example.com",
    });
  });

  test("disabling a person deletes their account and sessions; stray accounts go too", () => {
    bootstrapAuthUsers(db, now);
    addSession(userOf("ross")!, "s1");
    db.run(`INSERT INTO auth_user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('stray', 'Stray', 'stray@example.com', 1, '', '')`);
    setPerson("UPDATE people SET auth_enabled = 0 WHERE id = 'ross'");
    expect(bootstrapAuthUsers(db, now)).toEqual({ created: 0, updated: 0, revoked: 2 });
    expect(users()).toEqual([]);
    expect(sessions()).toBe(0);
    expect(db.query("SELECT id FROM people ORDER BY id").all()).toEqual([{ id: "carly" }, { id: "ross" }]);
  });

  test("the server refuses to start until every enabled person is provisioned", () => {
    expect(() => checkAuthProvisioned(db)).toThrow(AuthSetupError);
    bootstrapAuthUsers(db, now);
    expect(checkAuthProvisioned(db).map((p) => p.id)).toEqual(["ross"]);
    setPerson("UPDATE people SET email = 'ross.new@example.com' WHERE id = 'ross'");
    expect(() => checkAuthProvisioned(db)).toThrow(/auth:bootstrap/);
    setPerson("UPDATE people SET auth_enabled = 0");
    expect(() => checkAuthProvisioned(db)).toThrow(/Nobody can sign in/);
  });
});

describe("resolving a session's person", () => {
  test("only a verified account at the person's current address resolves", () => {
    bootstrapAuthUsers(db, now);
    const id = userOf("ross")!;
    expect(mappedAuthPerson(db, id, "ross@example.com")).toBeNull(); // not verified yet
    verify(id);
    expect(mappedAuthPerson(db, id, "ross@example.com")).toEqual({ id: "ross", name: "Ross", email: "ross@example.com" });
    expect(mappedAuthPerson(db, id, "someone@example.com")).toBeNull();
    expect(mappedAuthPerson(db, "no-such-user", "ross@example.com")).toBeNull();

    setPerson("UPDATE people SET email = 'ross.new@example.com' WHERE id = 'ross'");
    expect(mappedAuthPerson(db, id, "ross@example.com")).toBeNull(); // before any re-bootstrap
  });

  test("disabling a person blocks them at once, without a bootstrap", () => {
    bootstrapAuthUsers(db, now);
    const id = userOf("ross")!;
    verify(id);
    setPerson("UPDATE people SET auth_enabled = 0 WHERE id = 'ross'");
    expect(mappedAuthPerson(db, id, "ross@example.com")).toBeNull();
  });
});
