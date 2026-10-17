import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";

interface SeedFile {
  people?: { id: string; name: string; login?: string; email?: string; ntfy_topic?: string }[];
  items?: { id: string; name: string; brand?: string; model?: string; notes?: string; source_url?: string }[];
  schedules?: {
    id: string;
    item_id: string;
    title: string;
    interval_days: number;
    lead_days?: number;
    overdue_days?: number;
    owner_id?: string | null;
    checklist?: string;
    starts_on: string;
    active?: boolean;
  }[];
  history?: {
    item_id: string;
    schedule_id?: string;
    title: string;
    completed_on: string;
    completed_by?: string;
    notes?: string;
    source_url?: string;
  }[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Strict YYYY-MM-DD that is a real calendar day (rejects 2026-2-9 and 2026-02-30).
function checkDate(value: string, where: string): void {
  const d = new Date(`${value}T00:00:00Z`);
  if (!DATE.test(value) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new Error(`${where}: "${value}" is not a YYYY-MM-DD date`);
  }
}

// Upserts the seed so it can be re-run after edits. People's logins, emails and
// push topics live in an untracked `*.local.json` next to the seed and override it.
// They are only ever filled in, never cleared, so seeding without the local file is safe.
export function seed(db: Database, path: string, now: Date): void {
  const base = JSON.parse(readFileSync(path, "utf8")) as SeedFile;
  const localPath = path.replace(/\.json$/, ".local.json");
  const local: SeedFile = existsSync(localPath) ? JSON.parse(readFileSync(localPath, "utf8")) : {};
  const people = new Map((base.people ?? []).map((p) => [p.id, p]));
  for (const p of local.people ?? []) people.set(p.id, { ...people.get(p.id), ...p });
  for (const s of base.schedules ?? []) checkDate(s.starts_on, `schedule ${s.id} starts_on`);
  for (const h of base.history ?? []) checkDate(h.completed_on, `history "${h.title}" completed_on`);

  db.transaction(() => {
    for (const p of people.values()) {
      db.run(
        `INSERT INTO people (id, name, login, email, ntfy_topic) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, login = COALESCE(excluded.login, people.login),
           email = COALESCE(excluded.email, people.email), ntfy_topic = COALESCE(excluded.ntfy_topic, people.ntfy_topic)`,
        [p.id, p.name, p.login ?? null, p.email ?? null, p.ntfy_topic ?? null],
      );
    }
    for (const i of base.items ?? []) {
      db.run(
        `INSERT INTO items (id, name, brand, model, notes, source_url) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, brand = excluded.brand, model = excluded.model,
           notes = excluded.notes, source_url = excluded.source_url`,
        [i.id, i.name, i.brand ?? null, i.model ?? null, i.notes ?? null, i.source_url ?? null],
      );
    }
    for (const s of base.schedules ?? []) {
      db.run(
        `INSERT INTO schedules (id, item_id, title, interval_days, lead_days, overdue_days, owner_id, checklist, starts_on, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET item_id = excluded.item_id, title = excluded.title,
           interval_days = excluded.interval_days, lead_days = excluded.lead_days, overdue_days = excluded.overdue_days,
           owner_id = excluded.owner_id, checklist = excluded.checklist, starts_on = excluded.starts_on,
           active = excluded.active`,
        [
          s.id,
          s.item_id,
          s.title,
          s.interval_days,
          s.lead_days ?? 7,
          s.overdue_days ?? 14,
          s.owner_id ?? null,
          s.checklist ?? null,
          s.starts_on,
          s.active === false ? 0 : 1,
        ],
      );
    }
    for (const h of base.history ?? []) {
      // Imported history has no occurrence; dedupe on its source page, or on what and when.
      const seen = h.source_url
        ? db.query("SELECT 1 FROM completions WHERE source_url = ?").get(h.source_url)
        : db
            .query("SELECT 1 FROM completions WHERE occurrence_id IS NULL AND item_id = ? AND title = ? AND completed_on = ?")
            .get(h.item_id, h.title, h.completed_on);
      if (seen) continue;
      db.run(
        `INSERT INTO completions (schedule_id, item_id, title, completed_on, completed_by, notes, source_url, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          h.schedule_id ?? null,
          h.item_id,
          h.title,
          h.completed_on,
          h.completed_by ?? null,
          h.notes ?? null,
          h.source_url ?? null,
          now.toISOString(),
        ],
      );
    }
  }).immediate();
}
