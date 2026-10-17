import type { Database } from "bun:sqlite";
import { addDays } from "./dates";
import { enqueue } from "./notify";

export interface Schedule {
  id: string;
  item_id: string;
  title: string;
  interval_days: number;
  lead_days: number;
  overdue_days: number;
  owner_id: string | null;
  checklist: string | null;
  starts_on: string;
  active: number;
}

export interface Occurrence {
  id: number;
  schedule_id: string;
  occurrence_key: string;
  due_on: string;
  owner_id: string | null;
  status: "open" | "done";
  created_at: string;
  overdue_alerted_at: string | null;
}

export interface Completion {
  id: number;
  occurrence_id: number | null;
  schedule_id: string | null;
  item_id: string;
  title: string;
  completed_on: string;
  completed_by: string | null;
  notes: string | null;
  source_url: string | null;
  created_at: string;
}

// A missed nightly run is reported once the last good run is older than this.
export const STALE_RUN_HOURS = 36;

// Next due comes from the last real completion, not from the previous due date,
// so a late completion pushes the whole schedule out. `basis` names the completion
// it was computed from (0 = the schedule's start date) and goes into the occurrence
// key, so an early completion that lands on the same due date still gets a new one.
export function nextDue(db: Database, schedule: Schedule): { due: string; basis: number } {
  const last = db
    .query<{ id: number; completed_on: string }, [string]>(
      "SELECT id, completed_on FROM completions WHERE schedule_id = ? ORDER BY completed_on DESC, id DESC LIMIT 1",
    )
    .get(schedule.id);
  return last
    ? { due: addDays(last.completed_on, schedule.interval_days), basis: last.id }
    : { due: schedule.starts_on, basis: 0 };
}

export interface NightlySummary {
  created: string[];
  overdue: number[];
  missedPreviousRun: boolean;
}

// Creates due occurrences and queues reminders. Safe to run any number of times a day.
export function planMaintenance(
  db: Database,
  today: string,
  now: Date,
  alertPersonId: string | undefined,
): NightlySummary {
  const summary: NightlySummary = { created: [], overdue: [], missedPreviousRun: false };

  db.transaction(() => {
    const schedules = db.query<Schedule, []>("SELECT * FROM schedules WHERE active = 1").all();
    for (const s of schedules) {
      const open = db
        .query<Occurrence, [string]>("SELECT * FROM occurrences WHERE schedule_id = ? AND status = 'open'")
        .get(s.id);

      if (open) {
        if (!open.overdue_alerted_at && today > addDays(open.due_on, s.overdue_days) && open.owner_id) {
          enqueue(
            db,
            `overdue:${open.occurrence_key}`,
            open.owner_id,
            {
              subject: `Overdue: ${s.title}`,
              body: `"${s.title}" was due ${open.due_on} and hasn't been marked done.`,
            },
            now,
          );
          db.run("UPDATE occurrences SET overdue_alerted_at = ? WHERE id = ?", [now.toISOString(), open.id]);
          summary.overdue.push(open.id);
        }
        continue;
      }

      const { due, basis } = nextDue(db, s);
      if (today < addDays(due, -s.lead_days)) continue;

      const key = `${s.id}:${basis}:${due}`;
      const inserted = db.run(
        `INSERT INTO occurrences (schedule_id, occurrence_key, due_on, owner_id, created_at)
         VALUES (?, ?, ?, ?, ?) ON CONFLICT (occurrence_key) DO NOTHING`,
        [s.id, key, due, s.owner_id, now.toISOString()],
      );
      if (inserted.changes === 0) continue; // already created (and completed) on an earlier run
      summary.created.push(key);
      if (s.owner_id) {
        enqueue(
          db,
          `due:${key}`,
          s.owner_id,
          {
            subject: `Due ${due}: ${s.title}`,
            body: [`"${s.title}" is due ${due}.`, s.checklist ? `\n${s.checklist}` : ""].join(""),
          },
          now,
        );
      }
    }

    const lastOk = db
      .query<{ t: string | null }, []>("SELECT MAX(finished_at) AS t FROM runs WHERE kind = 'nightly' AND status = 'ok'")
      .get()?.t;
    if (lastOk && hoursBetween(lastOk, now) > STALE_RUN_HOURS && alertPersonId) {
      summary.missedPreviousRun = true;
      enqueue(
        db,
        `missed-run:${today}`,
        alertPersonId,
        {
          subject: "Rosie missed a nightly check",
          body: `The last successful maintenance check finished ${lastOk}. Reminders may be late.`,
        },
        now,
      );
    }
  })();

  return summary;
}

export class CompletionError extends Error {}

// Marks an occurrence done and records who did it. Completing twice returns the
// first completion instead of writing a second one.
export function completeOccurrence(
  db: Database,
  occurrenceId: number,
  personId: string,
  completedOn: string,
  notes: string | null,
  now: Date,
): Completion {
  return db.transaction(() => {
    const occ = db.query<Occurrence, [number]>("SELECT * FROM occurrences WHERE id = ?").get(occurrenceId);
    if (!occ) throw new CompletionError(`no occurrence ${occurrenceId}`);
    const existing = db
      .query<Completion, [number]>("SELECT * FROM completions WHERE occurrence_id = ?")
      .get(occurrenceId);
    if (existing) return existing;

    const s = db.query<Schedule, [string]>("SELECT * FROM schedules WHERE id = ?").get(occ.schedule_id)!;
    db.run(
      `INSERT INTO completions (occurrence_id, schedule_id, item_id, title, completed_on, completed_by, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [occ.id, s.id, s.item_id, s.title, completedOn, personId, notes, now.toISOString()],
    );
    db.run("UPDATE occurrences SET status = 'done' WHERE id = ?", [occ.id]);
    // Read back what was saved rather than trusting the write.
    return db.query<Completion, [number]>("SELECT * FROM completions WHERE occurrence_id = ?").get(occ.id)!;
  })();
}

export function health(db: Database, now: Date): { ok: boolean; lastOk: string | null } {
  const lastOk =
    db
      .query<{ t: string | null }, []>("SELECT MAX(finished_at) AS t FROM runs WHERE kind = 'nightly' AND status = 'ok'")
      .get()?.t ?? null;
  return { ok: lastOk !== null && hoursBetween(lastOk, now) <= STALE_RUN_HOURS, lastOk };
}

function hoursBetween(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / 3_600_000;
}
