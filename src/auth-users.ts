import type { Database } from "bun:sqlite";

// The household people who may sign in with an email code, and the sign-in
// accounts that stand for them. Household records are only read here; `seed.ts`
// stays their writer. Accounts are made only by the trusted bootstrap below,
// never from a browser request.

export interface AuthPerson {
  id: string;
  name: string;
  email: string; // normalized
}

export class AuthSetupError extends Error {}

// Trim and lowercase. Dots and +tags are left alone: they can be different mailboxes.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function looksLikeEmail(email: string): boolean {
  return email.length <= 254 && EMAIL.test(email);
}

// Everyone with auth_enabled = 1. Each needs an address, and no two can share one,
// or a code sent to that inbox couldn't say who is signing in.
export function enabledAuthPeople(db: Database): AuthPerson[] {
  const rows = db
    .query<{ id: string; name: string; email: string | null }, []>(
      "SELECT id, name, email FROM people WHERE auth_enabled = 1 ORDER BY id",
    )
    .all();
  const seen = new Map<string, string>();
  return rows.map((r) => {
    const email = normalizeEmail(r.email ?? "");
    if (!looksLikeEmail(email)) throw new AuthSetupError(`${r.id} can sign in but has no valid email address.`);
    const other = seen.get(email);
    if (other) throw new AuthSetupError(`${other} and ${r.id} can both sign in with the same email address.`);
    seen.set(email, r.id);
    return { id: r.id, name: r.name, email };
  });
}
