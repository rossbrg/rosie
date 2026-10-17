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

// Upserts the seed so it can be re-run after edits. People's logins, emails and
// push topics live in an untracked `*.local.json` next to the seed and override it.
export function seed(db: Database, path: string, now: Date): void {
  const base = JSON.parse(readFileSync(path, "utf8")) as SeedFile;
  const localPath = path.replace(/\.json$/, ".local.json");
  const local: SeedFile = existsSync(localPath) ? JSON.parse(readFileSync(localPath, "utf8")) : {};
  const people = new Map((base.people ?? []).map((p) => [p.id, p]));
  for (const p of local.people ?? []) people.set(p.id, { ...people.get(p.id), ...p });

  db.transaction(() => {
    for (const p of people.values()) {
      db.run(
        `INSERT INTO people (id, name, login, email, ntfy_topic) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, login = excluded.login,
           email = excluded.email, ntfy_topic = excluded.ntfy_topic`,
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
      // Imported history has no occurrence; dedupe on its source page.
      const seen = h.source_url
        ? db.query("SELECT 1 FROM completions WHERE source_url = ?").get(h.source_url)
        : null;
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
  })();
}
