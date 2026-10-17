import { Database } from "bun:sqlite";
import type { EmailAuthConfig } from "../src/auth-config";
import { createAuthService, type AuthService } from "../src/auth";
import { bootstrapAuthUsers } from "../src/auth-users";
import { migrate } from "../src/db";

// Shared set-up for the sign-in tests: a made-up household in a throwaway database,
// dummy settings, and a fake mailbox in place of Resend. Nothing here sends email.

export const ORIGIN = "https://rosie.example.ts.net";
export const COOKIE = "__Secure-rosie.session_token";

export const CONFIG: EmailAuthConfig = {
  mode: "email-otp",
  baseURL: ORIGIN,
  secret: "test-secret-0123456789-abcdefghijklmnop",
  resendKey: "re_test_dummy_key",
  emailFrom: "Rosie <rosie@example.com>",
};

export function household(db = new Database(":memory:", { strict: true })): Database {
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  db.run(`INSERT INTO people (id, name, login, email, auth_enabled) VALUES
      ('ross', 'Ross', 'ross@example.com', 'ross@example.com', 1),
      ('carly', 'Carly', 'carly@example.com', 'carly@example.com', 0)
    ON CONFLICT (id) DO NOTHING`);
  bootstrapAuthUsers(db, new Date());
  return db;
}

export interface Mailbox {
  sent: { email: string; code: string }[];
  failNext: number;
  last(email?: string): string;
}

export function mailbox(): Mailbox & { send: (email: string, code: string) => Promise<void> } {
  const box = {
    sent: [] as { email: string; code: string }[],
    failNext: 0,
    last(email = "ross@example.com") {
      const hit = box.sent.filter((s) => s.email === email).at(-1);
      if (!hit) throw new Error(`no code sent to ${email}`);
      return hit.code;
    },
    async send(email: string, code: string) {
      box.sent.push({ email, code });
      if (box.failNext > 0) {
        box.failNext--;
        throw new Error("simulated Resend outage");
      }
    },
  };
  return box;
}

export function service(db: Database, box: ReturnType<typeof mailbox>): AuthService {
  return createAuthService(db, CONFIG, { sendCode: box.send, now: () => new Date() });
}

// A form post from Rosie's own page, the way a browser sends it through `tailscale serve`.
export function post(path: string, fields: Record<string, string>, headers: Record<string, string> = {}): Request {
  return new Request(`http://127.0.0.1:8787${path}`, {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/x-www-form-urlencoded",
      ...headers,
    },
    body: new URLSearchParams(fields).toString(),
  });
}

export function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://127.0.0.1:8787${path}`, { headers });
}

// The session cookie a response set, as a Cookie header value.
export function sessionFrom(res: Response): string {
  const set = res.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE}=`));
  if (!set) throw new Error("no session cookie set");
  return set.split(";")[0]!;
}

export async function signIn(auth: AuthService, box: ReturnType<typeof mailbox>, email = "ross@example.com"): Promise<string> {
  await auth.submit("send-code", post("/sign-in/send-code", { email }));
  const res = await auth.submit("verify-code", post("/sign-in/verify-code", { email, code: box.last(email) }));
  if (res.status !== 303) throw new Error(`sign-in failed: ${res.status}`);
  return sessionFrom(res);
}
