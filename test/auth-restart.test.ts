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

describe("the bootstrap command", () => {
  // Runs `bun src/main.ts auth-bootstrap` for real, settings passed in the environment
  // (dummy values), never as arguments.
  const ENV = {
    ROSIE_AUTH_MODE: "email-otp",
    BETTER_AUTH_URL: "https://rosie.example.ts.net",
    BETTER_AUTH_SECRET: "test-secret-0123456789-abcdefghijklmnop",
    RESEND_API_KEY: "re_test_dummy_key",
    ROSIE_EMAIL_FROM: "rosie@example.com",
  };
  const bootstrap = async (dbPath: string) => {
    const p = Bun.spawn([process.execPath, join(import.meta.dir, "..", "src", "main.ts"), "auth-bootstrap"], {
      cwd: dir,
      env: { PATH: process.env.PATH, ...ENV, ROSIE_DB: dbPath },
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = (await new Response(p.stdout).text()) + (await new Response(p.stderr).text());
    return { code: await p.exited, out };
  };

  test("turning everyone off removes their sessions, and re-enabling doesn't bring an old cookie back", async () => {
    const path = join(dir, "rosie.sqlite");
    const box = mailbox();
    let db = household(openDb(path));
    const cookie = await signIn(service(db, box), box);
    db.run("UPDATE people SET auth_enabled = 0 WHERE id = 'ross'");
    db.close();

    const off = await bootstrap(path);
    expect(off.code).toBe(0);
    expect(off.out).toContain("0 created, 0 updated, 1 revoked");
    expect(off.out).toContain("Nobody can sign in now");
    expect(off.out).not.toContain(ENV.BETTER_AUTH_SECRET);

    db = openDb(path);
    expect(db.query("SELECT count(*) AS n FROM auth_session").get()).toEqual({ n: 0 });
    db.run("UPDATE people SET auth_enabled = 1 WHERE id = 'ross'");
    db.close();
    expect((await bootstrap(path)).out).toContain("1 created");

    db = openDb(path);
    const handle = createHandler(db, { timeZone: "UTC", auth: service(db, box) });
    expect((await handle(get("/", { Cookie: cookie }))).headers.get("Location")).toBe("/sign-in");
    db.close();
  });
});
