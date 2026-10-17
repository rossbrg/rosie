import { Database } from "bun:sqlite";

// Each entry runs once, in order. Never edit a shipped migration; add a new one.
// (Migration 1 has not shipped to a household database yet.)
const MIGRATIONS: string[] = [
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
