import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { authOptions, type AuthService } from "../src/auth";
import { bootstrapAuthUsers } from "../src/auth-users";
import { CONFIG, COOKIE, get, household, mailbox, ORIGIN, post, service, sessionFrom, signIn } from "./auth-helpers";

// The real library against a throwaway database, with the clock it reads moved by
// Bun's test clock, and a fake mailbox in place of Resend.

let db: Database;
let box: ReturnType<typeof mailbox>;
let auth: AuthService;
const T0 = new Date("2026-10-17T12:00:00Z").getTime();
const at = (seconds: number) => setSystemTime(new Date(T0 + seconds * 1000));

beforeEach(() => {
  at(0);
  db = household();
  box = mailbox();
  auth = service(db, box);
});
afterEach(() => setSystemTime());

const send = (email = "ross@example.com") => auth.submit("send-code", post("/sign-in/send-code", { email }));
const verify = (code: string, email = "ross@example.com") => auth.submit("verify-code", post("/sign-in/verify-code", { email, code }));
const wrong = (code: string) => (code === "000000" ? "111111" : "000000");
const count = (table: string) => db.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()!.n;

describe("the library matches Rosie's schema", () => {
  test("its migration planner finds nothing to create or add", async () => {
    const { toBeCreated, toBeAdded } = await getMigrations(authOptions(db, CONFIG, () => {}) as never);
    expect(toBeCreated).toEqual([]);
    expect(toBeAdded).toEqual([]);
  });

  test("only the four routes Rosie uses answer, even on the raw handler", async () => {
    const raw = betterAuth(authOptions(db, CONFIG, () => {}) as never) as unknown as {
      handler: (r: Request) => Promise<Response>;
      api: Record<string, { path?: string; options?: { method?: string | string[] } }>;
    };
    const paths = Object.values(raw.api)
      .map((e) => e.path)
      .filter((p): p is string => !!p)
      .map((p) => p.replace(/:(\w+)/g, "x"));
    expect(paths.length).toBeGreaterThan(30);
    const allowed = ["/email-otp/send-verification-otp", "/sign-in/email-otp", "/sign-out", "/get-session"];
    for (const path of paths.filter((p) => !allowed.includes(p))) {
      for (const method of ["GET", "POST"]) {
        const res = await raw.handler(
          new Request(`${ORIGIN}/api/auth${path}`, {
            method,
            headers: { origin: ORIGIN, "content-type": "application/json" },
            body: method === "POST" ? JSON.stringify({ email: "x@example.com", password: "p".repeat(12), name: "X" }) : undefined,
          }),
        );
        expect({ path, method, status: res.status }).toEqual({ path, method, status: 404 });
      }
    }
    expect(count("auth_user")).toBe(1);
  });
});

describe("codes", () => {
  test("six digits, hashed in the database, good for five minutes", async () => {
    const res = await send();
    expect(res.status).toBe(200);
    const code = box.last();
    expect(code).toMatch(/^\d{6}$/);
    const rows = db.query<{ value: string; expiresAt: string; createdAt: string }, []>("SELECT value, expiresAt, createdAt FROM auth_verification").all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.value).not.toContain(code);
    expect(Date.parse(rows[0]!.expiresAt) - Date.parse(rows[0]!.createdAt)).toBe(300_000);
    expect(count("outbox")).toBe(0);
  });

  test("a code opens a session for ross, once", async () => {
    await send();
    const code = box.last();
    const res = await verify(code);
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/");
    const cookie = sessionFrom(res);
    expect((await auth.resolve(get("/", { Cookie: cookie }))).person?.id).toBe("ross");
    at(10);
    expect((await verify(code)).status).toBe(400);
    expect(count("auth_session")).toBe(1);
  });

  test("three wrong tries use the code up", async () => {
    await send();
    const code = box.last();
    // Spaced out so the library's own one-minute limit on sign-in attempts isn't what stops it.
    for (let i = 0; i < 3; i++) {
      at(i * 61);
      expect((await verify(wrong(code))).status).toBe(400);
    }
    at(3 * 61);
    const res = await verify(code);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("Too many wrong codes");
    expect(count("auth_session")).toBe(0);
  });

  test("an expired code is refused with a useful message", async () => {
    await send();
    at(301);
    const res = await verify(box.last());
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("expired");
  });

  test("a new code replaces the old one, even when the old email arrives late", async () => {
    await send();
    const first = box.last();
    at(61);
    await send();
    const second = box.last();
    expect(second).not.toBe(first); // vanishingly unlikely to collide; if so, rerun
    expect((await verify(first)).status).toBe(400);
    at(70);
    expect((await verify(second)).status).toBe(303);
  });

  test("a new code comes with a fresh set of tries", async () => {
    await send();
    for (let i = 0; i < 2; i++) {
      at(i * 30);
      await verify(wrong(box.last()));
    }
    at(61);
    await send();
    at(70);
    await verify(wrong(box.last()));
    at(130);
    expect((await verify(box.last())).status).toBe(303);
  });

  test("two tabs submitting the same code get exactly one session", async () => {
    await send();
    const code = box.last();
    const results = await Promise.all([verify(code), verify(code), verify(code)]);
    expect(results.map((r) => r.status).sort()).toEqual([303, 400, 400]);
    expect(count("auth_session")).toBe(1);
  });

  test("resend waits a minute; the page says how long", async () => {
    await send();
    at(20);
    const res = await send();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("40");
    expect(await res.text()).toContain("Wait 40 seconds");
    expect(box.sent).toHaveLength(1);
  });
});

describe("who gets a code", () => {
  test("unknown and disabled addresses get the same page, no email and no account", async () => {
    const ross = await send("ross@example.com");
    const page = (html: string, email: string) => html.replaceAll(email, "EMAIL");
    const rossPage = page(await ross.text(), "ross@example.com");
    for (const email of ["carly@example.com", "stranger@example.com", " Another@Example.com"]) {
      const res = await send(email);
      expect(res.status).toBe(ross.status);
      expect(page(await res.text(), email.trim().toLowerCase())).toBe(rossPage);
    }
    expect(box.sent.map((s) => s.email)).toEqual(["ross@example.com"]);
    expect(count("auth_user")).toBe(1);
    expect(count("auth_verification")).toBe(1);
  });

  test("Carly's reminder address can't sign in, even with a guessed code", async () => {
    await send("carly@example.com");
    for (let i = 0; i < 3; i++) {
      at(i * 30);
      expect((await verify("123456", "carly@example.com")).status).toBe(400);
    }
    expect(count("auth_session")).toBe(0);
    expect(count("auth_user")).toBe(1);
  });

  test("someone disabled between the code and its use gets no session", async () => {
    await send();
    db.run("UPDATE people SET auth_enabled = 0 WHERE id = 'ross'");
    expect((await verify(box.last())).status).toBe(400);
    expect(count("auth_session")).toBe(0);
  });

  test("a failed email leaves no usable code, and a later retry works", async () => {
    box.failNext = 1;
    const res = await send();
    expect(res.status).toBe(502);
    expect(await res.text()).toContain("send the email");
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(count("auth_verification")).toBe(0);
    expect((await verify(box.last())).status).toBe(400);
    at(61);
    expect((await send()).status).toBe(200);
    at(70);
    expect((await verify(box.last())).status).toBe(303);
  });
});

describe("sessions", () => {
  test("the cookie is host-only, HttpOnly, Secure, SameSite=Lax and lasts 30 days", async () => {
    await send();
    const res = await verify(box.last());
    const set = res.headers.getSetCookie();
    expect(set).toHaveLength(1);
    expect(set[0]).toMatch(new RegExp(`^${COOKIE.replace(".", "\\.")}=[^;]+; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax$`));
    expect(set[0]).not.toMatch(/Domain=/i);
  });

  test("a tampered or made-up cookie is nobody", async () => {
    const cookie = await signIn(auth, box);
    const [name, value] = cookie.split("=") as [string, string];
    const [token, signature] = decodeURIComponent(value).split(".") as [string, string];
    const flipped = `${name}=${encodeURIComponent(`${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}.${signature}`)}`;
    expect((await auth.resolve(get("/", { Cookie: flipped }))).person).toBeNull();
    expect((await auth.resolve(get("/", { Cookie: `${name}=${token}` }))).person).toBeNull();
    expect((await auth.resolve(get("/", { Cookie: `${name}=garbage` }))).person).toBeNull();
    expect((await auth.resolve(get("/", { Cookie: `better-auth.session_token=${value}` }))).person).toBeNull();
    expect((await auth.resolve(get("/", { Cookie: cookie }))).person?.id).toBe("ross");
  });

  test("renewed at most daily, and the renewal's cookie is passed on", async () => {
    const cookie = await signIn(auth, box);
    const expires = () => db.query<{ e: string }, []>("SELECT expiresAt AS e FROM auth_session").get()!.e;
    const before = expires();
    at(12 * 3600);
    let r = await auth.resolve(get("/", { Cookie: cookie }));
    expect(r.person?.id).toBe("ross");
    expect(r.headers.getSetCookie()).toEqual([]);
    expect(expires()).toBe(before);
    at(25 * 3600);
    r = await auth.resolve(get("/", { Cookie: cookie }));
    expect(r.person?.id).toBe("ross");
    expect(Date.parse(expires())).toBe(T0 + 25 * 3600_000 + 30 * 86_400_000);
    const renewed = r.headers.getSetCookie();
    expect(renewed).toHaveLength(1);
    expect(renewed[0]).toContain("Max-Age=2592000");
  });

  test("an expired session is nobody", async () => {
    const cookie = await signIn(auth, box);
    at(31 * 86_400);
    expect((await auth.resolve(get("/", { Cookie: cookie }))).person).toBeNull();
  });

  test("disabling someone shuts them out on their next request", async () => {
    const cookie = await signIn(auth, box);
    db.run("UPDATE people SET auth_enabled = 0 WHERE id = 'ross'");
    expect((await auth.resolve(get("/", { Cookie: cookie }))).person).toBeNull();
    db.run("UPDATE people SET email = 'ross.new@example.com', auth_enabled = 1 WHERE id = 'ross'");
    expect((await auth.resolve(get("/", { Cookie: cookie }))).person).toBeNull();
  });
});

describe("requests into the sign-in steps", () => {
  test("must come from Rosie's own page", async () => {
    const tries = [
      post("/sign-in/send-code", { email: "ross@example.com" }, { Origin: "https://evil.example" }),
      post("/sign-in/send-code", { email: "ross@example.com" }, { Origin: "http://rosie.example.ts.net" }),
      post("/sign-in/send-code", { email: "ross@example.com" }, { Origin: "null" }),
      post("/sign-in/send-code", { email: "ross@example.com" }, { "Sec-Fetch-Site": "cross-site" }),
      post("/sign-in/send-code", { email: "ross@example.com" }, { "Sec-Fetch-Site": "same-site" }),
    ];
    const noOrigin = new Request("http://127.0.0.1:8787/sign-in/send-code", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "email=ross%40example.com",
    });
    for (const req of [...tries, noOrigin]) expect((await auth.submit("send-code", req)).status).toBe(403);
    expect(box.sent).toEqual([]);
  });

  test("must be a small form with only the expected fields", async () => {
    expect((await auth.submit("send-code", post("/sign-in/send-code", { email: "ross@example.com", person_id: "carly" }))).status).toBe(400);
    expect((await auth.submit("verify-code", post("/sign-in/verify-code", { email: "ross@example.com", code: "1", type: "sign-up" }))).status).toBe(400);
    const twice = post("/sign-in/send-code", {});
    expect((await auth.submit("send-code", new Request(twice, { body: "email=a%40example.com&email=ross%40example.com" }))).status).toBe(400);
    const json = post("/sign-in/send-code", {}, { "Content-Type": "application/json" });
    expect((await auth.submit("send-code", new Request(json, { body: JSON.stringify({ email: "ross@example.com" }) }))).status).toBe(415);
    const big = new Request(post("/sign-in/send-code", {}), { body: `email=${"a".repeat(9000)}` });
    expect((await auth.submit("send-code", big)).status).toBe(413);
    const sneaky = new Request(post("/sign-in/send-code", {}), {
      body: new ReadableStream({
        start(c) {
          for (let i = 0; i < 20; i++) c.enqueue(new TextEncoder().encode("a".repeat(1024)));
          c.close();
        },
      }),
    });
    expect((await auth.submit("send-code", sneaky)).status).toBe(413);
    expect((await auth.submit("send-code", get("/sign-in/send-code", { Origin: ORIGIN }))).status).toBe(404);
    expect(box.sent).toEqual([]);
  });

  test("a malformed address or code gets a retry message, not a crash", async () => {
    const bad = await auth.submit("send-code", post("/sign-in/send-code", { email: "not-an-email" }));
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain("Enter your email address");
    for (const code of ["", "12345", "1234567", "abcdef"]) {
      const res = await verify(code);
      expect(res.status).toBe(400);
      expect(await res.text()).toContain("6-digit code");
    }
    expect(count("auth_rate_limit")).toBe(0);
  });

  test("auth pages are never cached", async () => {
    for (const res of [await send(), await verify("000000")]) expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("found in review", () => {
  test("a code issued before a bootstrap can't be used after it", async () => {
    await send();
    const code = box.last();
    bootstrapAuthUsers(db, new Date());
    expect((await verify(code)).status).toBe(400);
    expect(count("auth_session")).toBe(0);
  });

  test("an address moved to someone else doesn't carry its pending code to them", async () => {
    db.run("UPDATE people SET email = 'shared@example.com' WHERE id = 'ross'");
    bootstrapAuthUsers(db, new Date());
    await send("shared@example.com");
    const code = box.last("shared@example.com");
    db.run("UPDATE people SET email = 'ross@example.com' WHERE id = 'ross'");
    db.run("UPDATE people SET email = 'shared@example.com', auth_enabled = 1 WHERE id = 'carly'");
    bootstrapAuthUsers(db, new Date());
    expect((await verify(code, "shared@example.com")).status).toBe(400);
    expect(count("auth_session")).toBe(0);
  });

  test("wrong codes for a known and an unknown address meet the same limit", async () => {
    const burst = async (email: string) => {
      const statuses = [];
      for (let i = 0; i < 4; i++) statuses.push((await verify("123456", email)).status);
      return statuses;
    };
    const unknown = await burst("stranger@example.com");
    at(120);
    const carly = await burst("carly@example.com");
    at(240);
    const ross = await burst("ross@example.com");
    expect(unknown).toEqual([400, 400, 400, 429]);
    expect(carly).toEqual(unknown);
    expect(ross).toEqual(unknown);
  });

  test("codes are stored keyed with the server secret, not as a bare hash", async () => {
    await send();
    const code = box.last();
    const bare = new Bun.CryptoHasher("sha256").update(code).digest("base64url");
    const stored = db.query<{ value: string }, []>("SELECT value FROM auth_verification").get()!.value;
    expect(stored.startsWith(`${bare}:`)).toBe(false);
  });

  test("wrong codes for made-up addresses can't lock Ross out", async () => {
    await send();
    for (let i = 0; i < 6; i++) await verify("123456", `stranger${i}@example.com`);
    expect((await verify(box.last())).status).toBe(303);
  });

  test("a junk session cookie sent first doesn't hide the real one", async () => {
    const cookie = await signIn(auth, box);
    const junk = `${COOKIE}=junk.value`;
    expect((await auth.resolve(get("/", { Cookie: `${junk}; ${cookie}` }))).person?.id).toBe("ross");
    expect((await auth.resolve(get("/", { Cookie: `${junk}; ${junk}; ${junk}; ${cookie}` }))).person).toBeNull();
  });
});
