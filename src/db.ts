import { Database } from "bun:sqlite";

// Each entry runs once, in order. Never edit a shipped migration; add a new one.
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE people (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    login TEXT UNIQUE,            -- Tailscale login used to identify the caller
    email TEXT,
    ntfy_topic TEXT
  );

  CREATE TABLE items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    brand TEXT,
    model TEXT,
    notes TEXT,
    source_url TEXT               -- where this record was imported from (e.g. a Notion page)
  );

  CREATE TABLE schedules (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id),
    title TEXT NOT NULL,
    interval_days INTEGER NOT NULL CHECK (interval_days > 0),
    lead_days INTEGER NOT NULL DEFAULT 7 CHECK (lead_days >= 0),
    overdue_days INTEGER NOT NULL DEFAULT 14 CHECK (overdue_days >= 0),
    owner_id TEXT REFERENCES people(id),
    checklist TEXT,
    starts_on TEXT NOT NULL,      -- first due date when there is no completion yet
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE occurrences (
    id INTEGER PRIMARY KEY,
    schedule_id TEXT NOT NULL REFERENCES schedules(id),
    occurrence_key TEXT NOT NULL UNIQUE,  -- schedule id + completion basis + due date; makes creation idempotent
    due_on TEXT NOT NULL,
    owner_id TEXT REFERENCES people(id),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),
    created_at TEXT NOT NULL,
    overdue_alerted_at TEXT
  );

  CREATE TABLE completions (
    id INTEGER PRIMARY KEY,
    occurrence_id INTEGER UNIQUE REFERENCES occurrences(id),
    schedule_id TEXT REFERENCES schedules(id),
    item_id TEXT NOT NULL REFERENCES items(id),
    title TEXT NOT NULL,
    completed_on TEXT NOT NULL,
    completed_by TEXT REFERENCES people(id),
    notes TEXT,
    source_url TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE runs (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,           -- 'nightly' or 'completion'
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'error')),
    summary TEXT,
    error TEXT
  );

  CREATE TABLE outbox (
    id INTEGER PRIMARY KEY,
    dedupe_key TEXT NOT NULL UNIQUE,      -- one row per message per channel, ever
    person_id TEXT NOT NULL REFERENCES people(id),
    occurrence_id INTEGER REFERENCES occurrences(id),  -- reminders about a task; cancelled when it closes
    channel TEXT NOT NULL CHECK (channel IN ('email', 'push')),
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    sent_at TEXT,
    claimed_at TEXT,                      -- set while one process is sending it
    cancelled_at TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  `
  -- Something a person told Rosie in their own words, and how she answered.
  CREATE TABLE requests (
    id INTEGER PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES people(id),
    text TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'answered', 'error')),
    reply TEXT,
    error TEXT,
    model TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    created_at TEXT NOT NULL,
    finished_at TEXT
  );

  -- A change Rosie proposed from a request. Nothing is written until the person approves it.
  CREATE TABLE proposals (
    id INTEGER PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES requests(id),
    action TEXT NOT NULL,                 -- validated action, JSON
    summary TEXT NOT NULL,                -- what approving it will do, written by code, not the model
    status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'applied', 'dismissed', 'failed')),
    decided_by TEXT REFERENCES people(id),
    decided_at TEXT,
    error TEXT
  );

  -- Set on the first snooze, so the page can say what it was originally due.
  ALTER TABLE occurrences ADD COLUMN snoozed_from TEXT;
  `,
  `
  -- Every model call "Tell Rosie" makes, for the daily cap and for seeing what the model did.
  CREATE TABLE model_calls (
    id INTEGER PRIMARY KEY,
    request_id INTEGER NOT NULL REFERENCES requests(id),
    attempt INTEGER NOT NULL,             -- 2 is the retry after validation refused something
    day TEXT NOT NULL,                    -- household date the daily cap counts against
    interpreter TEXT NOT NULL,            -- what was configured, e.g. "claude-cli:opus → codex-cli:default"
    model TEXT,                           -- what answered
    prompt_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ok', 'rejected', 'invalid', 'unavailable')),
    duration_ms INTEGER NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    raw TEXT,                             -- the model's answer as it came back
    rejected TEXT,                        -- JSON list of why validation refused actions
    error TEXT,                           -- why it failed, or why earlier fallbacks didn't answer
    created_at TEXT NOT NULL
  );
  CREATE INDEX model_calls_day ON model_calls (day);
  `,
  `
  -- Who may sign in with an email code. Off unless the private seed turns it on;
  -- a reminder address alone never lets anyone in.
  ALTER TABLE people ADD COLUMN auth_enabled INTEGER NOT NULL DEFAULT 0 CHECK (auth_enabled IN (0, 1));
  `,
  `
  -- Email sign-in, in the tables better-auth 1.7.10 generates for its email-code plugin
  -- (column names and types are the library's; only the table names are Rosie's).
  -- test/auth-users.test.ts checks the library still finds nothing to add.
  CREATE TABLE auth_user ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);
  CREATE TABLE auth_session ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "auth_user" ("id") on delete cascade);
  CREATE TABLE auth_account ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "auth_user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);
  CREATE TABLE auth_verification ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);
  CREATE TABLE auth_rate_limit ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);
  CREATE INDEX auth_session_userId_idx ON auth_session ("userId");
  CREATE INDEX auth_account_userId_idx ON auth_account ("userId");
  CREATE INDEX auth_verification_identifier_idx ON auth_verification ("identifier");

  -- Which household person a sign-in account is. Written only by the trusted bootstrap
  -- (\`bun run auth:bootstrap\`), never from a request; one account per person and back.
  CREATE TABLE auth_household_user (
    user_id TEXT PRIMARY KEY REFERENCES auth_user(id) ON DELETE CASCADE,
    person_id TEXT NOT NULL UNIQUE REFERENCES people(id)
  );
  `,
  `
  -- Each request for a sign-in code, known address or not, for the cooldown and the
  -- hourly limits (src/auth-limits.ts). Addresses are stored hashed; rows older than an
  -- hour are pruned as new requests arrive.
  CREATE TABLE auth_code_requests (
    id INTEGER PRIMARY KEY,
    email_hash TEXT NOT NULL,
    requested_at INTEGER NOT NULL         -- milliseconds since the epoch
  );
  CREATE INDEX auth_code_requests_email ON auth_code_requests (email_hash, requested_at);
  CREATE INDEX auth_code_requests_time ON auth_code_requests (requested_at);
  `,
];

export function openDb(path: string): Database {
  const db = new Database(path, { create: true, strict: true });
  // `serve` and `nightly` are separate processes on one file; wait for the other's write.
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

export function migrate(db: Database): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = db.query<{ version: number }, []>("SELECT version FROM schema_version").get();
  let version = row?.version ?? 0;
  if (!row) db.run("INSERT INTO schema_version (version) VALUES (0)");
  for (; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version]!);
      db.run("UPDATE schema_version SET version = ?", [version + 1]);
    })();
  }
}
