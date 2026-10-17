import type { Database } from "bun:sqlite";
import { createHmac } from "node:crypto";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins/email-otp";
import type { EmailAuthConfig } from "./auth-config";
import { consumeCodeRequest } from "./auth-limits";
import { CodeDeliveryError, type CodeSender } from "./auth-mail";
import { renderSignIn, type SignInState } from "./auth-page";
import { checkAuthProvisioned, enabledAuthPeople, looksLikeEmail, mappedAuthPerson, normalizeEmail, type AuthPerson } from "./auth-users";
import { validToken } from "./csrf";

// Email-code sign-in. Better Auth keeps the codes (hashed) and the sessions in
// Rosie's database; this module is the only way in. Its raw handler is never
// served: the page's forms post to Rosie's own routes, which check the origin,
// the body and the household rules, then call the library over its HTTP handler
// so the library's own protections (origin check, rate limits) run too.

export type AuthAction = "send-code" | "verify-code" | "sign-out";

export interface AuthResolution {
  person: AuthPerson | null;
  // Set-Cookie headers (a renewed or cleared session) to add to whatever is returned.
  headers: Headers;
}

export interface AuthService {
  // Rosie's own address (BETTER_AUTH_URL): the only Origin a change may come from.
  origin: string;
  resolve(request: Request): Promise<AuthResolution>;
  submit(action: AuthAction, request: Request): Promise<Response>;
}

export const SESSION_DAYS = 30;
const DAY = 86_400;
const BASE_PATH = "/api/auth";
// The library would otherwise read the client address from X-Forwarded-For, which
// anyone can send. Rosie sets this header itself on every call (see `bucket`), so
// nothing a browser sends picks which of the library's rate-limit buckets is used.
const CLIENT_HEADER = "x-rosie-client";
// The only library routes Rosie uses; everything else is refused even internally.
const ROUTES = new Set(["/email-otp/send-verification-otp", "/sign-in/email-otp", "/sign-out", "/get-session"]);
const MAX_BODY = 8 * 1024;
const FIELDS: Record<AuthAction, string[]> = {
  "send-code": ["email"],
  "verify-code": ["email", "code"],
  "sign-out": ["csrf"],
};

export function authOptions(db: Database, config: EmailAuthConfig, capture: (email: string, code: string) => void) {
  return {
    appName: "Rosie",
    database: db,
    baseURL: config.baseURL,
    basePath: BASE_PATH,
    secret: config.secret,
    trustedOrigins: [config.baseURL],
    telemetry: { enabled: false },
    logger: { level: "error" as const },
    user: { modelName: "auth_user", changeEmail: { enabled: false }, deleteUser: { enabled: false } },
    session: {
      modelName: "auth_session",
      expiresIn: SESSION_DAYS * DAY,
      updateAge: DAY,
      // Every request reads the session from the database, so signing out or being
      // disabled takes effect at once.
      cookieCache: { enabled: false },
    },
    account: { modelName: "auth_account", accountLinking: { enabled: false } },
    verification: { modelName: "auth_verification" },
    emailAndPassword: { enabled: false },
    rateLimit: {
      enabled: true,
      storage: "database" as const,
      modelName: "auth_rate_limit",
      window: 60,
      max: 30,
      // Signing out must always work; a full bucket would leave the session alive.
      customRules: { "/sign-out": false as const },
    },
    advanced: {
      useSecureCookies: true,
      cookiePrefix: "rosie",
      // Host-only (no Domain), so the cookie never leaves Rosie's own address.
      defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" },
      disableOriginCheck: false,
      disableCSRFCheck: false,
      ipAddress: { ipAddressHeaders: [CLIENT_HEADER] },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (!ROUTES.has(ctx.path)) throw new APIError("NOT_FOUND");
      }),
    },
    // Accounts come only from `bun run auth:bootstrap`. A session is only ever made
    // for a verified account that belongs to a person who may sign in.
    databaseHooks: {
      user: { create: { before: async () => false as const } },
      account: { create: { before: async () => false as const } },
      session: {
        create: {
          before: async (session: { userId: string }) => {
            const email = db.query<{ email: string }, [string]>("SELECT email FROM auth_user WHERE id = ?").get(session.userId)?.email;
            return email && mappedAuthPerson(db, session.userId, email) ? undefined : (false as const);
          },
        },
      },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 3,
        disableSignUp: true,
        // Keyed with the server secret, so a copy of the database alone can't be
        // used to try all million codes offline.
        storeOTP: { hash: async (otp: string) => createHmac("sha256", config.secret).update(otp).digest("base64url") },
        resendStrategy: "rotate",
        // Hand the code back to `submit`, which sends it and can tell the person if
        // sending failed (the library would only log it).
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type === "sign-in") capture(email, otp);
        },
      }),
    ],
  };
}

export function createAuthService(
  db: Database,
  config: EmailAuthConfig,
  dependencies: { sendCode: CodeSender; now: () => Date },
): AuthService {
  // Refuse to serve until the household and its accounts agree.
  checkAuthProvisioned(db);

  const codes = new Map<string, string>();
  const auth = betterAuth(authOptions(db, config, (email, code) => codes.set(email, code)));
  const context = auth.$context;

  // One sign-in step at a time in this process, so a resend can't land between a
  // check and a use of the same code.
  let queue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run, run);
    queue = next.catch(() => {});
    return next;
  };

  // The library limits by client address, which Rosie can't know behind `tailscale
  // serve`. One shared bucket would let anyone on the tailnet lock Ross out with a few
  // wrong codes for made-up addresses, so each address gets its own: a private-range
  // IPv6 address derived from it (the library buckets IPv6 by /64, which holds the
  // derived part). Every address is treated the same, so the limits reveal nothing.
  function bucket(email?: string): string {
    if (!email) return "127.0.0.1";
    const h = createHmac("sha256", config.secret).update(`bucket:${email}`).digest("hex");
    return `fd${h.slice(0, 2)}:${h.slice(2, 6)}:${h.slice(6, 10)}:${h.slice(10, 14)}::1`;
  }

  function call(path: string, body: object, cookie?: string, email?: string): Promise<Response> {
    const headers = new Headers({ "content-type": "application/json", origin: config.baseURL, [CLIENT_HEADER]: bucket(email) });
    if (cookie) headers.set("cookie", cookie);
    return auth.handler(new Request(`${config.baseURL}${BASE_PATH}${path}`, { method: "POST", headers, body: JSON.stringify(body) }));
  }

  // Only session cookies are passed on; anything else the browser sends is ignored.
  // A browser can hold more than one under the same name (another host on the tailnet
  // could set one for the whole tailnet domain), so each is tried, a few at most.
  async function sessionCookies(request: Request): Promise<string[]> {
    const name = (await context).authCookies.sessionToken.name;
    return (parseCookies(request.headers.get("cookie")).get(name) ?? []).slice(0, 3).map((v) => `${name}=${v}`);
  }

  async function current(request: Request): Promise<AuthResolution & { token?: string; cookie?: string }> {
    const headers = new Headers();
    for (const cookie of await sessionCookies(request)) {
      const result = await auth.api.getSession({ headers: new Headers({ cookie }), returnHeaders: true });
      const found = result.response;
      if (!found || !found.user.emailVerified) continue;
      const person = mappedAuthPerson(db, found.user.id, found.user.email);
      if (!person) continue;
      for (const c of result.headers.getSetCookie()) headers.append("Set-Cookie", c);
      return { person, headers, token: found.session.token, cookie };
    }
    return { person: null, headers };
  }

  async function resolve(request: Request): Promise<AuthResolution> {
    const { person, headers } = await current(request);
    return { person, headers };
  }

  async function sendCode(email: string): Promise<Response> {
    if (!looksLikeEmail(email)) return page({ step: "email", email, message: "Enter your email address.", error: true }, 400);
    const limit = consumeCodeRequest(db, email, dependencies.now());
    if (!limit.allowed) {
      return page(
        { step: "code", email, message: `Wait ${waitText(limit.retryAfter)} before asking for another code.`, error: true, retryAfter: limit.retryAfter },
        429,
        { "Retry-After": String(limit.retryAfter) },
      );
    }
    // Unknown and disabled addresses get the same answer and no email, and no account.
    const sent: SignInState = { step: "code", email, retryAfter: 60 };
    if (!enabledAuthPeople(db).some((p) => p.email === email)) return page(sent, 200);

    const ctx = await context;
    const identifier = `sign-in-otp-${email}`;
    // A new code replaces any earlier one, with a fresh set of attempts.
    await ctx.internalAdapter.deleteVerificationByIdentifier(identifier);
    codes.delete(email);
    const res = await call("/email-otp/send-verification-otp", { email, type: "sign-in" }, undefined, email);
    const code = codes.get(email);
    codes.delete(email);
    try {
      if (res.status !== 200 || !code) throw new Error(`sign-in code not issued (${res.status})`);
      await dependencies.sendCode(email, code);
    } catch (err) {
      // Safe to log: CodeDeliveryError carries at most Resend's HTTP status, never the
      // key, the code or Resend's reply; the address isn't logged either.
      console.error(`Sign-in code not sent: ${err instanceof CodeDeliveryError ? err.message : `library answered ${res.status}`}`);
      // Nobody can use a code that was never delivered.
      await ctx.internalAdapter.deleteVerificationByIdentifier(identifier);
      return page(
        { step: "email", email, message: "Rosie couldn't send the email just now. Try again in a minute.", error: true },
        res.status === 429 ? 429 : 502,
      );
    }
    return page(sent, 200);
  }

  async function verifyCode(email: string, rawCode: string): Promise<Response> {
    const code = rawCode.replace(/\s/g, "");
    const retry = (message: string, status: number) => page({ step: "code", email, message, error: true }, status);
    if (!looksLikeEmail(email)) return page({ step: "email", message: "Enter your email address.", error: true }, 400);
    if (!/^\d{6}$/.test(code)) return retry("Enter the 6-digit code from the email.", 400);
    // An address that can't sign in has no code to use. It still goes through the
    // library, so it meets the same attempt limit as one that can and the answers
    // match. (The session hook in authOptions checks again.)
    if (!enabledAuthPeople(db).some((p) => p.email === email)) {
      await (await context).internalAdapter.deleteVerificationByIdentifier(`sign-in-otp-${email}`);
    }

    const res = await call("/sign-in/email-otp", { email, otp: code }, undefined, email);
    if (res.status === 429) return retry("Too many tries. Wait a minute, then try again.", 429);
    if (res.status !== 200) {
      const reason = ((await res.json().catch(() => ({}))) as { code?: string }).code;
      if (reason === "OTP_EXPIRED") return retry("That code has expired. Send a new one.", 400);
      if (reason === "TOO_MANY_ATTEMPTS") return retry("Too many wrong codes. Send a new one.", 403);
      return retry("That code isn't right. Check the email and try again.", 400);
    }
    const signedIn = (await res.json()) as { token: string; user: { id: string; email: string } };
    if (!mappedAuthPerson(db, signedIn.user.id, signedIn.user.email)) {
      await (await context).internalAdapter.deleteSession(signedIn.token);
      return retry("That code isn't right. Check the email and try again.", 400);
    }
    return redirect("/", res.headers.getSetCookie());
  }

  async function signOut(request: Request, csrf: string): Promise<Response> {
    const { person, token, cookie } = await current(request);
    if (!cookie || !person || !token) return redirect("/sign-in", []);
    if (!validToken(db, person.id, csrf)) return new Response("Reload the page and try again.", { status: 403, headers: NO_STORE });
    const res = await call("/sign-out", {}, cookie);
    // The library reports success even if it couldn't delete the session, so delete
    // it here too and only say "signed out" once it is really gone.
    try {
      db.run("DELETE FROM auth_session WHERE token = ?", [token]);
    } catch {
      // Reported below: the session is still there.
    }
    if (db.query("SELECT 1 FROM auth_session WHERE token = ?").get(token)) {
      return new Response("Rosie couldn't sign you out. Try again.", { status: 500, headers: NO_STORE });
    }
    const name = (await context).authCookies.sessionToken.name;
    const cleared = res.status === 200 ? res.headers.getSetCookie() : [];
    if (!cleared.some((c) => c.startsWith(`${name}=`))) cleared.push(`${name}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`);
    return redirect("/sign-in", cleared);
  }

  return {
    origin: config.baseURL,
    resolve,
    async submit(action, request) {
      const refused = checkOrigin(request, config.baseURL);
      if (refused) return refused;
      const form = await readForm(request, FIELDS[action]);
      if (form instanceof Response) return form;
      const email = normalizeEmail(form.get("email") ?? "");
      return serialized(() => {
        if (action === "send-code") return sendCode(email);
        if (action === "verify-code") return verifyCode(email, form.get("code") ?? "");
        return signOut(request, form.get("csrf") ?? "");
      });
    },
  };
}

const NO_STORE = { "Cache-Control": "no-store" };

function page(state: SignInState, status: number, extra: Record<string, string> = {}): Response {
  return new Response(renderSignIn(state), {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE, ...extra },
  });
}

// Relative, because Rosie only sees plain HTTP behind `tailscale serve`'s HTTPS.
function redirect(to: string, cookies: string[]): Response {
  const headers = new Headers({ Location: to, ...NO_STORE });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 303, headers });
}

function waitText(seconds: number): string {
  return seconds < 90 ? `${seconds} seconds` : `${Math.ceil(seconds / 60)} minutes`;
}

// Sign-in steps must come from Rosie's own page: an exact Origin, and no cross-site
// fetch metadata.
export function checkOrigin(request: Request, origin: string): Response | null {
  if (request.method !== "POST") return new Response("Not found", { status: 404 });
  const site = request.headers.get("Sec-Fetch-Site");
  if (request.headers.get("Origin") !== origin || (site && site !== "same-origin")) {
    return new Response("Cross-site request refused.", { status: 403, headers: NO_STORE });
  }
  return null;
}

// A small urlencoded form with only the expected fields, each at most once.
export async function readForm(request: Request, fields: string[]): Promise<Map<string, string> | Response> {
  const bad = (message: string, status = 400) => new Response(message, { status, headers: NO_STORE });
  const type = request.headers.get("Content-Type") ?? "";
  if (!type.toLowerCase().startsWith("application/x-www-form-urlencoded")) return bad("Unsupported form.", 415);
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > MAX_BODY) return bad("That's too long.", 413);
  const text = await readLimited(request, MAX_BODY);
  if (text === null) return bad("That's too long.", 413);
  const form = new Map<string, string>();
  for (const [key, value] of new URLSearchParams(text)) {
    if (!fields.includes(key) || form.has(key)) return bad("Unexpected form field.");
    form.set(key, value);
  }
  return form;
}

async function readLimited(request: Request, limit: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function parseCookies(header: string | null): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const name = part.slice(0, i).trim();
    out.set(name, [...(out.get(name) ?? []), part.slice(i + 1).trim()]);
  }
  return out;
}
