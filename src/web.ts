import type { Database } from "bun:sqlite";
import { ask, askUnavailable, decide, DecisionError, type AskOptions, type Interpreter } from "./ask";
import { checkOrigin, type AuthService } from "./auth";
import { renderSignIn } from "./auth-page";
import { todayIn } from "./dates";
import { csrfToken, validToken } from "./csrf";
import { completeOccurrence, CompletionError, health } from "./maintenance";
import { renderHome } from "./page";

export interface WebOptions {
  timeZone?: string;
  // Local development only: treat requests to localhost without a Tailscale header as this login.
  // Ignored with `auth`.
  devLogin?: string;
  // Email-code sign-in. When set, a session is the only way in: the Tailscale header
  // and `devLogin` identify nobody. Without it, the Tailscale header decides.
  auth?: AuthService;
  // Reads "Tell Rosie" messages. Without one, the page doesn't offer the box.
  interpreter?: Interpreter;
  // The daily cap and who hears about trouble reaching a model.
  ask?: AskOptions;
  now?: () => Date;
}

// The longest message Rosie will read.
const MAX_MESSAGE = 2000;

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
    // The library's own routes are never served; sign-in goes through the forms below.
    if (url.pathname === "/api/auth" || url.pathname.startsWith("/api/auth/")) return new Response("Not found", { status: 404 });

    if (opts.auth) return signedIn(req, url, opts.auth);

    const me = caller(req);
    if (!me) return new Response("Not signed in to the household tailnet.", { status: 401 });
    return household(req, url, me, false);
  };

  async function signedIn(req: Request, url: URL, auth: AuthService): Promise<Response> {
    if (url.pathname === "/sign-in/send-code") return auth.submit("send-code", req);
    if (url.pathname === "/sign-in/verify-code") return auth.submit("verify-code", req);
    if (url.pathname === "/sign-out") return auth.submit("sign-out", req);

    const { person, headers } = await auth.resolve(req);
    let res: Response;
    if (url.pathname === "/sign-in" && req.method === "GET") {
      res = person
        ? new Response(null, { status: 303, headers: { Location: "/" } })
        : new Response(renderSignIn({ step: "email" }), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    } else if (!person) {
      res =
        req.method === "GET" || req.method === "HEAD"
          ? new Response(null, { status: 303, headers: { Location: "/sign-in" } })
          : new Response("Sign in first.", { status: 401 });
    } else {
      // On top of the CSRF token: household changes must come from Rosie's own address.
      res = (req.method === "POST" && checkOrigin(req, auth.origin)) || (await household(req, url, person, true));
    }
    res.headers.set("Cache-Control", "no-store");
    for (const c of headers.getSetCookie()) res.headers.append("Set-Cookie", c);
    return res;
  }

  async function household(req: Request, url: URL, me: Person, signOut: boolean): Promise<Response> {
    if (req.method === "POST") {
      // Any page a household member visits could post here. Require a same-origin
      // request carrying this person's token.
      const site = req.headers.get("Sec-Fetch-Site");
      if (site && site !== "same-origin" && site !== "none") return new Response("Cross-site request refused.", { status: 403 });
      const form = await req.formData();
      if (!validToken(db, me.id, String(form.get("csrf") ?? ""))) {
        return new Response("Reload the page and try again.", { status: 403 });
      }
      const today = todayIn(opts.timeZone, now());

      const done = url.pathname.match(/^\/occurrences\/(\d+)\/complete$/);
      if (done) {
        const notes = String(form.get("notes") ?? "").trim() || null;
        try {
          completeOccurrence(db, Number(done[1]), me.id, today, notes, now());
        } catch (err) {
          if (err instanceof CompletionError) return new Response(err.message, { status: err.status });
          throw err;
        }
        return home();
      }

      if (url.pathname === "/ask" && opts.interpreter) {
        const message = String(form.get("message") ?? "").trim();
        if (!message) return home("#ask");
        if (message.length > MAX_MESSAGE) return new Response(`Keep it under ${MAX_MESSAGE} characters.`, { status: 413 });
        await ask(db, opts.interpreter, me.id, message, today, now, opts.ask);
        return home("#ask");
      }

      const decision = url.pathname.match(/^\/proposals\/(\d+)\/(approve|dismiss)$/);
      if (decision) {
        try {
          decide(db, Number(decision[1]), me.id, decision[2] === "approve", today, now());
        } catch (err) {
          if (err instanceof DecisionError) return new Response(err.message, { status: err.status });
          throw err;
        }
        return home("#ask");
      }
    }

    if (url.pathname === "/" && req.method === "GET") {
      const today = todayIn(opts.timeZone, now());
      const askState = opts.interpreter ? { now: now(), unavailable: askUnavailable(db, today, opts.ask) } : null;
      return new Response(renderHome(db, me, today, csrfToken(db, me.id), askState, signOut), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  }
}

// Back to the page after a form post. Relative, because Rosie only sees plain HTTP
// behind `tailscale serve`'s HTTPS.
function home(anchor = ""): Response {
  return new Response(null, { status: 303, headers: { Location: `/${anchor}` } });
}

export { csrfToken };
