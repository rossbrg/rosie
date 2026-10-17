import type { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";

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

interface MappedUser {
  user_id: string;
  person_id: string;
  email: string;
  name: string;
}

// Make the sign-in accounts match the household: one unverified, passwordless account
// per enabled person, nothing for anyone else. Safe to re-run. When a person's address
// changes, their sessions end and the new address has to prove itself with a code;
// when a person is disabled (or an account has no person), the account is deleted,
// which ends its sessions too.
export function bootstrapAuthUsers(db: Database, now: Date): { created: number; updated: number; revoked: number } {
  const counts = { created: 0, updated: 0, revoked: 0 };
  const stamp = now.toISOString();
  db.transaction(() => {
    const people = new Map(enabledAuthPeople(db).map((p) => [p.id, p]));
    const mapped = db
      .query<MappedUser, []>(
        `SELECT m.user_id, m.person_id, u.email, u.name FROM auth_household_user m JOIN auth_user u ON u.id = m.user_id`,
      )
      .all();

    // Accounts no enabled person stands behind: gone, with their sessions and codes' targets.
    const orphans = db
      .query<{ id: string }, []>("SELECT id FROM auth_user WHERE id NOT IN (SELECT user_id FROM auth_household_user)")
      .all()
      .map((u) => u.id);
    const disabled = mapped.filter((m) => !people.has(m.person_id)).map((m) => m.user_id);
    for (const id of [...orphans, ...disabled]) {
      db.run("DELETE FROM auth_user WHERE id = ?", [id]);
      counts.revoked++;
    }

    // Moved addresses: end the sessions and park the old address first, so two
    // people swapping addresses can't collide on the unique email.
    const moved = mapped.filter((m) => people.has(m.person_id) && m.email !== people.get(m.person_id)!.email);
    for (const m of moved) {
      db.run("DELETE FROM auth_session WHERE userId = ?", [m.user_id]);
      db.run(`UPDATE auth_user SET email = ?, emailVerified = 0, updatedAt = ? WHERE id = ?`, [`moving:${m.user_id}`, stamp, m.user_id]);
      counts.revoked++;
    }

    // Codes are tied to an address, not an account. Whatever just changed, no code
    // issued before this run can sign anyone in.
    db.run("DELETE FROM auth_verification WHERE identifier LIKE 'sign-in-otp-%'");

    for (const p of people.values()) {
      const m = mapped.find((x) => x.person_id === p.id);
      if (m) {
        if (m.email === p.email && m.name === p.name) continue;
        db.run("UPDATE auth_user SET email = ?, name = ?, updatedAt = ? WHERE id = ?", [p.email, p.name, stamp, m.user_id]);
        counts.updated++;
        continue;
      }
      const id = randomBytes(24).toString("base64url");
      db.run(
        `INSERT INTO auth_user (id, name, email, emailVerified, image, createdAt, updatedAt) VALUES (?, ?, ?, 0, NULL, ?, ?)`,
        [id, p.name, p.email, stamp, stamp],
      );
      db.run("INSERT INTO auth_household_user (user_id, person_id) VALUES (?, ?)", [id, p.id]);
      counts.created++;
    }
  }).immediate();
  return counts;
}

// The household person a verified session belongs to, checked fresh on every request:
// the account must map to a person who may still sign in, its address must have been
// proven, and it must still be that person's address.
export function mappedAuthPerson(db: Database, userId: string, verifiedEmail: string): AuthPerson | null {
  const row = db
    .query<{ id: string; name: string; email: string | null; user_email: string; verified: number }, [string]>(
      `SELECT p.id, p.name, p.email, u.email AS user_email, u.emailVerified AS verified
       FROM auth_household_user m JOIN auth_user u ON u.id = m.user_id JOIN people p ON p.id = m.person_id
       WHERE m.user_id = ? AND p.auth_enabled = 1`,
    )
    .get(userId);
  if (!row || row.verified !== 1) return null;
  const email = normalizeEmail(row.email ?? "");
  if (!looksLikeEmail(email) || email !== row.user_email || email !== normalizeEmail(verifiedEmail)) return null;
  return { id: row.id, name: row.name, email };
}

// Every enabled person has an account at their current address. The server checks
// this before listening, so a seed change without a bootstrap fails loudly.
export function checkAuthProvisioned(db: Database): AuthPerson[] {
  const people = enabledAuthPeople(db);
  if (people.length === 0) throw new AuthSetupError("Nobody can sign in: set \"auth_enabled\": true for someone in seed/household.local.json and run `bun run seed`.");
  for (const p of people) {
    const ok = db
      .query("SELECT 1 FROM auth_household_user m JOIN auth_user u ON u.id = m.user_id WHERE m.person_id = ? AND u.email = ?")
      .get(p.id, p.email);
    if (!ok) throw new AuthSetupError(`${p.id}'s sign-in account doesn't match the household; run \`bun run auth:bootstrap\`.`);
  }
  return people;
}
