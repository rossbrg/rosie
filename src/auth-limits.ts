import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { normalizeEmail } from "./auth-users";

// How often anyone can ask for a sign-in code. Every request counts, whether or not
// the address can sign in, so the answer looks the same either way. The counts live
// in the database, so restarting the server doesn't reset them, and they are keyed
// by address and overall, never by a forwarded client address someone could fake.
export const COOLDOWN_SECONDS = 60;
export const PER_ADDRESS_PER_HOUR = 5;
export const ALL_PER_HOUR = 20;

const HOUR = 3_600_000;

export type LimitDecision = { allowed: true } | { allowed: false; retryAfter: number };

// Checks every budget and records the request in one immediate transaction, so two
// tabs or two processes can't both take the same slot.
export function consumeCodeRequest(db: Database, email: string, now: Date): LimitDecision {
  const t = now.getTime();
  const key = createHash("sha256").update(normalizeEmail(email)).digest("hex");
  const wait = (until: number): LimitDecision => ({ allowed: false, retryAfter: Math.max(1, Math.ceil((until - t) / 1000)) });

  return db.transaction((): LimitDecision => {
    db.run("DELETE FROM auth_code_requests WHERE requested_at <= ?", [t - HOUR]);
    const mine = db
      .query<{ at: number }, [string]>("SELECT requested_at AS at FROM auth_code_requests WHERE email_hash = ? ORDER BY requested_at")
      .all(key)
      .map((r) => r.at);
    const last = mine.at(-1);
    if (last !== undefined && t - last < COOLDOWN_SECONDS * 1000) return wait(last + COOLDOWN_SECONDS * 1000);
    if (mine.length >= PER_ADDRESS_PER_HOUR) return wait(mine[mine.length - PER_ADDRESS_PER_HOUR]! + HOUR);
    const all = db
      .query<{ at: number }, [number]>("SELECT requested_at AS at FROM auth_code_requests ORDER BY requested_at DESC LIMIT ?")
      .all(ALL_PER_HOUR)
      .map((r) => r.at);
    if (all.length >= ALL_PER_HOUR) return wait(all[ALL_PER_HOUR - 1]! + HOUR);
    db.run("INSERT INTO auth_code_requests (email_hash, requested_at) VALUES (?, ?)", [key, t]);
    return { allowed: true };
  }).immediate();
}
