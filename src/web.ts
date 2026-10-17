import type { Database } from "bun:sqlite";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { todayIn } from "./dates";
import { completeOccurrence, CompletionError, health } from "./maintenance";
import { renderHome } from "./page";

export interface WebOptions {
  timeZone?: string;
  // Local development only: treat requests to localhost without a Tailscale header as this login.
  devLogin?: string;
  now?: () => Date;
}

interface Person {
  id: string;
  name: string;
}

// `tailscale serve` adds this header with the signed-in tailnet user.
const IDENTITY_HEADER = "Tailscale-User-Login";

export function createHandler(db: Database, opts: WebOptions = {}) {
  const now = opts.now ?? (() => new Date());

  function caller(req: Request): Person | null {
    const host = new URL(req.url).hostname;
    const local = host === "localhost" || host === "127.0.0.1";
    const login = req.headers.get(IDENTITY_HEADER) ?? (local ? opts.devLogin : undefined);
    if (!login) return null;
    return db.query<Person, [string]>("SELECT id, name FROM people WHERE login = ?").get(login);
  }

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/healthz") {
      const h = health(db, now());
      return Response.json(h, { status: h.ok ? 200 : 503 });
    }

    const me = caller(req);
    if (!me) return new Response("Not signed in to the household tailnet.", { status: 401 });

    const done = url.pathname.match(/^\/occurrences\/(\d+)\/complete$/);
    if (done && req.method === "POST") {
      // Identity comes from the network, not a cookie, so any page a household member
      // visits could post here. Require a same-origin request carrying this person's token.
      const site = req.headers.get("Sec-Fetch-Site");
      if (site && site !== "same-origin" && site !== "none") return new Response("Cross-site request refused.", { status: 403 });
      const form = await req.formData();
      if (!validToken(db, me.id, String(form.get("csrf") ?? ""))) {
        return new Response("Reload the page and try again.", { status: 403 });
      }
      const notes = String(form.get("notes") ?? "").trim() || null;
      try {
        completeOccurrence(db, Number(done[1]), me.id, todayIn(opts.timeZone, now()), notes, now());
      } catch (err) {
        if (err instanceof CompletionError) return new Response(err.message, { status: err.status });
        throw err;
      }
      // Relative, because Rosie only sees plain HTTP behind `tailscale serve`'s HTTPS.
      return new Response(null, { status: 303, headers: { Location: "/" } });
    }

    if (url.pathname === "/" && req.method === "GET") {
      return new Response(renderHome(db, me, todayIn(opts.timeZone, now()), csrfToken(db, me.id)), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  };
}

function csrfSecret(db: Database): string {
  db.run("INSERT INTO settings (key, value) VALUES ('csrf_secret', ?) ON CONFLICT (key) DO NOTHING", [
    randomBytes(32).toString("hex"),
  ]);
  return db.query<{ value: string }, []>("SELECT value FROM settings WHERE key = 'csrf_secret'").get()!.value;
}

export function csrfToken(db: Database, personId: string): string {
  return createHmac("sha256", csrfSecret(db)).update(personId).digest("hex");
}

function validToken(db: Database, personId: string, token: string): boolean {
  const want = Buffer.from(csrfToken(db, personId));
  const got = Buffer.from(token);
  return got.length === want.length && timingSafeEqual(got, want);
}
