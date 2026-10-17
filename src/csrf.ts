import type { Database } from "bun:sqlite";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// A per-person token for the page's forms, so another site can't post as someone
// whose browser (or tailnet identity) Rosie already trusts.

function csrfSecret(db: Database): string {
  db.run("INSERT INTO settings (key, value) VALUES ('csrf_secret', ?) ON CONFLICT (key) DO NOTHING", [
    randomBytes(32).toString("hex"),
  ]);
  return db.query<{ value: string }, []>("SELECT value FROM settings WHERE key = 'csrf_secret'").get()!.value;
}

export function csrfToken(db: Database, personId: string): string {
  return createHmac("sha256", csrfSecret(db)).update(personId).digest("hex");
}

export function validToken(db: Database, personId: string, token: string): boolean {
  const want = Buffer.from(csrfToken(db, personId));
  const got = Buffer.from(token);
  return got.length === want.length && timingSafeEqual(got, want);
}
