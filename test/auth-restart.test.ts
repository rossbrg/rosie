import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/db";
import { csrfToken } from "../src/csrf";
import { createHandler } from "../src/web";
import { COOKIE, get, household, mailbox, post, service, signIn } from "./auth-helpers";

// A real database file, closed and reopened like a service restart.

let dir: string;
const T0 = new Date("2026-10-21T12:00:00Z").getTime();
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rosie-restart-"));
  setSystemTime(new Date(T0));
});
afterEach(() => {
  setSystemTime();
  rmSync(dir, { recursive: true, force: true });
});

describe("sessions survive a restart, and sign-out survives it too", () => {
  test("sign in, restart, keep using the cookie, renew it, sign out, cookie dead after another restart", async () => {
    const path = join(dir, "rosie.sqlite");
    const box = mailbox();

    let db = household(openDb(path));
    const cookie = await signIn(service(db, box), box);
    db.close();

    // Restart: a new database handle and a new auth service on the same file.
    db = household(openDb(path));
    let handle = createHandler(db, { timeZone: "UTC", auth: service(db, box) });
    const page = await handle(get("/", { Cookie: cookie }));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Ross");

    // More than a day later the session is renewed; every Set-Cookie header comes through.
    setSystemTime(new Date(T0 + 2 * 86_400_000));
    const renewed = await handle(get("/", { Cookie: cookie }));
    const set = renewed.headers.getSetCookie();
    expect(set).toHaveLength(1);
    expect(set[0]).toStartWith(`${COOKIE}=`);
    expect(set[0]).toContain("Max-Age=2592000");
    db.close();

    db = household(openDb(path));
    handle = createHandler(db, { timeZone: "UTC", auth: service(db, box) });
    expect((await handle(get("/", { Cookie: cookie }))).status).toBe(200);
    const out = await handle(post("/sign-out", { csrf: csrfToken(db, "ross") }, { Cookie: cookie }));
    expect(out.status).toBe(303);
    db.close();

    db = household(openDb(path));
    handle = createHandler(db, { timeZone: "UTC", auth: service(db, box) });
    expect((await handle(get("/", { Cookie: cookie }))).headers.get("Location")).toBe("/sign-in");
    db.close();
  });

  test("request limits are still in force after a restart", async () => {
    const path = join(dir, "rosie.sqlite");
    const box = mailbox();
    let db = household(openDb(path));
    expect((await service(db, box).submit("send-code", post("/sign-in/send-code", { email: "ross@example.com" }))).status).toBe(200);
    db.close();
    db = household(openDb(path));
    setSystemTime(new Date(T0 + 10_000));
    const again = await service(db, box).submit("send-code", post("/sign-in/send-code", { email: "ross@example.com" }));
    expect(again.status).toBe(429);
    expect(again.headers.get("Retry-After")).toBe("50");
    expect(box.sent).toHaveLength(1);
    db.close();
  });
});
