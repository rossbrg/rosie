import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import type { AuthService } from "../src/auth";
import { csrfToken } from "../src/csrf";
import { createHandler } from "../src/web";
import { COOKIE, get, household, mailbox, post, service, signIn } from "./auth-helpers";

// The page and its routes with email sign-in on: real Request/Response objects,
// the real library, a throwaway database and a fake mailbox.

let db: Database;
let box: ReturnType<typeof mailbox>;
let auth: AuthService;
let handle: (req: Request) => Promise<Response>;
const T0 = new Date("2026-10-21T12:00:00Z");
const ROSS_HEADER = { "Tailscale-User-Login": "ross@example.com" };

beforeEach(() => {
  setSystemTime(T0);
  db = household();
  db.run("INSERT INTO items (id, name) VALUES ('mini-split', 'Mini-split')");
  db.run(`INSERT INTO schedules (id, item_id, title, interval_days, owner_id, starts_on) VALUES ('vacuum', 'mini-split', 'Vacuum inserts', 91, 'ross', '2026-10-22')`);
  db.run(`INSERT INTO occurrences (id, schedule_id, occurrence_key, due_on, owner_id, created_at) VALUES (1, 'vacuum', 'k1', '2026-10-22', 'ross', '2026-10-15T00:00:00Z')`);
  // Something Carly asked for and only she can approve.
  db.run(`INSERT INTO requests (id, person_id, text, status, created_at) VALUES (1, 'carly', 'push it', 'answered', '2026-10-21T00:00:00Z')`);
  db.run(`INSERT INTO proposals (id, request_id, action, summary) VALUES (1, 1, '{"type":"snooze","task_id":1,"until":"2026-10-25"}', 'Move it')`);
  box = mailbox();
  auth = service(db, box);
  handle = createHandler(db, { timeZone: "UTC", auth, devLogin: "ross@example.com" });
});
afterEach(() => setSystemTime());

const status = (sql: string) => db.query<{ status: string }, []>(sql).get()!.status;
const occurrence = () => status("SELECT status FROM occurrences WHERE id = 1");
const proposal = () => status("SELECT status FROM proposals WHERE id = 1");
const sessions = () => db.query<{ n: number }, []>("SELECT count(*) AS n FROM auth_session").get()!.n;

const signedInCookie = () => signIn(auth, box);

describe("signing in through the page", () => {
  test("the sign-in page is a plain, uncached form with the right autofill hints", async () => {
    const res = await handle(get("/sign-in"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const html = await res.text();
    expect(html).toContain('action="/sign-in/send-code"');
    expect(html).toContain('autocomplete="email"');
    expect(html).toContain('<label for="email">');

    const sent = await handle(post("/sign-in/send-code", { email: "ross@example.com" }));
    const code = await sent.text();
    expect(code).toContain('autocomplete="one-time-code"');
    expect(code).toContain('inputmode="numeric"');
    expect(code).toContain('name="email" value="ross@example.com"');
    expect(code).not.toContain(box.last());
  });

  test("a code from the email opens the household page as ross", async () => {
    await handle(post("/sign-in/send-code", { email: "ross@example.com" }));
    const res = await handle(post("/sign-in/verify-code", { email: "ross@example.com", code: box.last() }));
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/");
    const cookie = res.headers.getSetCookie()[0]!.split(";")[0]!;
    const page = await handle(get("/", { Cookie: cookie }));
    expect(page.status).toBe(200);
    expect(page.headers.get("Cache-Control")).toBe("no-store");
    const html = await page.text();
    expect(html).toContain("Ross");
    expect(html).toContain('action="/sign-out"');
    expect((await handle(get("/sign-in", { Cookie: cookie }))).headers.get("Location")).toBe("/");
  });

  test("Carly's reminder address can't sign in", async () => {
    const sent = await handle(post("/sign-in/send-code", { email: "carly@example.com" }));
    expect(sent.status).toBe(200);
    expect(box.sent).toEqual([]);
    const res = await handle(post("/sign-in/verify-code", { email: "carly@example.com", code: "123456" }));
    expect(res.status).toBe(400);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(sessions()).toBe(0);
  });
});

describe("without a session", () => {
  test("the household page sends you to sign in, Tailscale header or not", async () => {
    for (const req of [get("/"), get("/", ROSS_HEADER), new Request("http://localhost:8787/")]) {
      const res = await handle(req);
      expect(res.status).toBe(303);
      expect(res.headers.get("Location")).toBe("/sign-in");
    }
  });

  test("changes fail without writing anything", async () => {
    const csrf = csrfToken(db, "ross");
    for (const req of [
      post("/occurrences/1/complete", { csrf }),
      post("/occurrences/1/complete", { csrf }, ROSS_HEADER),
      post("/proposals/1/approve", { csrf: csrfToken(db, "carly") }, { "Tailscale-User-Login": "carly@example.com" }),
    ]) {
      expect((await handle(req)).status).toBe(401);
    }
    expect(occurrence()).toBe("open");
    expect(proposal()).toBe("proposed");
  });

  test("the health check still answers", async () => {
    const res = await handle(get("/healthz"));
    expect([200, 503]).toContain(res.status);
    expect(await res.json()).toHaveProperty("ok");
  });

  test("the library's own routes don't exist", async () => {
    for (const req of [
      get("/api/auth/get-session"),
      get("/api/auth/ok"),
      post("/api/auth/sign-up/email", { email: "x@example.com", password: "password1234", name: "X" }),
      post("/api/auth/email-otp/send-verification-otp", { email: "ross@example.com", type: "sign-in" }),
      post("/api/auth/sign-in/email-otp", { email: "ross@example.com", otp: "123456" }),
    ]) {
      expect((await handle(req)).status).toBe(404);
    }
    expect(box.sent).toEqual([]);
  });

  test("a made-up session cookie is nobody", async () => {
    const res = await handle(get("/", { Cookie: `${COOKIE}=forged.signature` }));
    expect(res.headers.get("Location")).toBe("/sign-in");
  });
});

describe("signed in", () => {
  test("Ross can complete his task from his own page", async () => {
    const cookie = await signedInCookie();
    const res = await handle(post("/occurrences/1/complete", { csrf: csrfToken(db, "ross") }, { Cookie: cookie }));
    expect(res.status).toBe(303);
    expect(occurrence()).toBe("done");
    expect(db.query("SELECT completed_by FROM completions").get()).toEqual({ completed_by: "ross" });
  });

  test("cross-origin or tokenless changes are refused", async () => {
    const cookie = await signedInCookie();
    const csrf = csrfToken(db, "ross");
    for (const headers of <Record<string, string>[]>[
      { Cookie: cookie, Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" },
      { Cookie: cookie, Origin: "https://evil.example", "Sec-Fetch-Site": "same-origin" },
      { Cookie: cookie, Origin: "http://rosie.example.ts.net" },
    ]) {
      expect((await handle(post("/occurrences/1/complete", { csrf }, headers))).status).toBe(403);
    }
    expect((await handle(post("/occurrences/1/complete", { csrf: "nope" }, { Cookie: cookie }))).status).toBe(403);
    expect((await handle(post("/occurrences/1/complete", { csrf: csrfToken(db, "carly") }, { Cookie: cookie }))).status).toBe(403);
    expect(occurrence()).toBe("open");
  });

  test("a forged person id can't approve someone else's suggestion", async () => {
    const cookie = await signedInCookie();
    const res = await handle(
      post("/proposals/1/approve", { csrf: csrfToken(db, "ross"), person_id: "carly" }, { Cookie: cookie, "Tailscale-User-Login": "carly@example.com" }),
    );
    expect(res.status).toBe(404);
    expect(proposal()).toBe("proposed");
    expect(occurrence()).toBe("open");
  });

  test("sign-out needs this page's origin and token, then ends the session", async () => {
    const cookie = await signedInCookie();
    const csrf = csrfToken(db, "ross");
    expect((await handle(post("/sign-out", { csrf }, { Cookie: cookie, Origin: "https://evil.example" }))).status).toBe(403);
    expect((await handle(post("/sign-out", { csrf }, { Cookie: cookie, "Sec-Fetch-Site": "cross-site" }))).status).toBe(403);
    expect((await handle(post("/sign-out", { csrf: "nope" }, { Cookie: cookie }))).status).toBe(403);
    expect((await handle(get("/sign-out", { Cookie: cookie }))).status).toBe(404);
    expect(sessions()).toBe(1);

    const res = await handle(post("/sign-out", { csrf }, { Cookie: cookie }));
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/sign-in");
    expect(res.headers.getSetCookie().some((c) => c.startsWith(`${COOKIE}=;`) && /Max-Age=0/.test(c))).toBe(true);
    expect(sessions()).toBe(0);
    expect((await handle(get("/", { Cookie: cookie }))).headers.get("Location")).toBe("/sign-in");
  });

  test("a session from before an address change can't read the household", async () => {
    const cookie = await signedInCookie();
    db.run("UPDATE people SET email = 'ross.new@example.com' WHERE id = 'ross'");
    expect((await handle(get("/", { Cookie: cookie }))).headers.get("Location")).toBe("/sign-in");
  });

  test("a renewed session cookie reaches the browser on the page response", async () => {
    const cookie = await signedInCookie();
    setSystemTime(new Date(T0.getTime() + 2 * 86_400_000));
    const res = await handle(get("/", { Cookie: cookie }));
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().filter((c) => c.startsWith(`${COOKIE}=`))).toHaveLength(1);
  });
});

describe("Tailscale mode is unchanged", () => {
  test("without email sign-in the header still identifies people and sign-in routes don't exist", async () => {
    db.run("UPDATE people SET login = 'ross@example.com' WHERE id = 'ross'");
    const plain = createHandler(db, { timeZone: "UTC" });
    const page = await plain(get("/", ROSS_HEADER));
    expect(page.status).toBe(200);
    expect(await page.text()).not.toContain('action="/sign-out"');
    expect((await plain(get("/"))).status).toBe(401);
    expect((await plain(get("/sign-in", ROSS_HEADER))).status).toBe(404);
  });
});
