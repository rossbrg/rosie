import type { Database } from "bun:sqlite";
import { addDays } from "./dates";
import { cancelReminders, enqueue, outboxHealth, type OutboxHealth } from "./notify";

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
  status: "open" | "done" | "cancelled";
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
  // Open occurrences cancelled because their schedule changed (date, owner, or switched off).
  replanned: number[];
  overdue: number[];
  missedPreviousRun: boolean;
  // One bad schedule is reported here instead of stopping the others.
  errors: { schedule: string; error: string }[];
}

// Frees the occurrence key so the replacement can reuse it, and drops its queued reminders.
function cancelOccurrence(db: Database, occ: Occurrence, now: Date): void {
  db.run(
    "UPDATE occurrences SET status = 'cancelled', occurrence_key = occurrence_key || ':cancelled:' || id WHERE id = ?",
    [occ.id],
  );
  cancelReminders(db, occ.id, now);
}

function personExists(db: Database, id: string | undefined): id is string {
  return !!id && !!db.query("SELECT 1 FROM people WHERE id = ?").get(id);
}

// Creates due occurrences and queues reminders. Safe to run any number of times a day.
export function planMaintenance(
  db: Database,
  today: string,
  now: Date,
  alertPersonId: string | undefined,
): NightlySummary {
  const summary: NightlySummary = { created: [], replanned: [], overdue: [], missedPreviousRun: false, errors: [] };
  // Unowned schedules fall back to the alert person so nothing goes unheard.
  const fallback = personExists(db, alertPersonId) ? alertPersonId : null;

  const planOne = (s: Schedule) => {
    let open = db
      .query<Occurrence, [string]>("SELECT * FROM occurrences WHERE schedule_id = ? AND status = 'open'")
      .get(s.id);
    if (!s.active) {
      if (open) {
        cancelOccurrence(db, open, now);
        summary.replanned.push(open.id);
      }
      return;
    }

    const { due, basis } = nextDue(db, s);
    const key = `${s.id}:${basis}:${due}`;
    // The schedule was edited (start date, interval, owner) or history was imported
    // since this occurrence was created: replace it with one that matches.
    if (open && (open.occurrence_key !== key || open.owner_id !== s.owner_id)) {
      cancelOccurrence(db, open, now);
      summary.replanned.push(open.id);
      open = null;
    }
    const recipient = s.owner_id ?? fallback;

    if (open) {
      if (!open.overdue_alerted_at && today > addDays(open.due_on, s.overdue_days) && recipient) {
        enqueue(
          db,
          `overdue:${open.id}`,
          recipient,
          {
            subject: `Overdue: ${s.title}`,
            body: `"${s.title}" was due ${open.due_on} and hasn't been marked done.`,
          },
          now,
          open.id,
        );
        db.run("UPDATE occurrences SET overdue_alerted_at = ? WHERE id = ?", [now.toISOString(), open.id]);
        summary.overdue.push(open.id);
      }
      return;
    }

    if (today < addDays(due, -s.lead_days)) return;
    const inserted = db.run(
      `INSERT INTO occurrences (schedule_id, occurrence_key, due_on, owner_id, created_at)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT (occurrence_key) DO NOTHING`,
      [s.id, key, due, s.owner_id, now.toISOString()],
    );
    if (inserted.changes === 0) return; // already created (and completed) on an earlier run
    const occId = Number(inserted.lastInsertRowid);
    summary.created.push(key);
    if (recipient) {
      enqueue(
        db,
        `due:${occId}`,
        recipient,
        {
          subject: `Due ${due}: ${s.title}`,
          body: [`"${s.title}" is due ${due}.`, s.checklist ? `\n${s.checklist}` : ""].join(""),
        },
        now,
        occId,
      );
    }
  };

  db.transaction(() => {
    for (const s of db.query<Schedule, []>("SELECT * FROM schedules ORDER BY id").all()) {
      // Each schedule plans in its own savepoint, so one bad row can't block the rest.
      try {
        db.transaction(() => planOne(s))();
      } catch (err) {
        summary.errors.push({ schedule: s.id, error: String(err) });
      }
    }

    const lastOk = lastNightlyOk(db);
    if (lastOk && hoursBetween(lastOk, now) > STALE_RUN_HOURS) {
      summary.missedPreviousRun = true;
      if (fallback) {
        enqueue(
          db,
          `missed-run:${today}`,
          fallback,
          {
            subject: "Rosie missed a nightly check",
            body: `The last successful maintenance check finished ${lastOk}. Reminders may be late.`,
          },
          now,
        );
      }
    }
    if (alertPersonId && !fallback) {
      summary.errors.push({ schedule: "-", error: `ROSIE_ALERT_PERSON "${alertPersonId}" is not a person id` });
    }
  }).immediate();

  return summary;
}

export class CompletionError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409,
  ) {
    super(message);
  }
}

// Marks an occurrence done and records who did it, with a receipt in `runs`.
// Completing twice returns the first completion instead of writing a second one.
export function completeOccurrence(
  db: Database,
  occurrenceId: number,
  personId: string,
  completedOn: string,
  notes: string | null,
  now: Date,
): Completion {
  return db
    .transaction(() => {
      const occ = db.query<Occurrence, [number]>("SELECT * FROM occurrences WHERE id = ?").get(occurrenceId);
      if (!occ) throw new CompletionError(`no occurrence ${occurrenceId}`, 404);
      const existing = db
        .query<Completion, [number]>("SELECT * FROM completions WHERE occurrence_id = ?")
        .get(occurrenceId);
      if (existing) return existing;
      if (occ.status !== "open") throw new CompletionError("This task was replaced after its schedule changed.", 409);

      const s = db.query<Schedule, [string]>("SELECT * FROM schedules WHERE id = ?").get(occ.schedule_id)!;
      db.run(
        `INSERT INTO completions (occurrence_id, schedule_id, item_id, title, completed_on, completed_by, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [occ.id, s.id, s.item_id, s.title, completedOn, personId, notes, now.toISOString()],
      );
      db.run("UPDATE occurrences SET status = 'done' WHERE id = ?", [occ.id]);
      const cancelled = cancelReminders(db, occ.id, now);
      // Read back what was saved rather than trusting the write.
      const saved = db.query<Completion, [number]>("SELECT * FROM completions WHERE occurrence_id = ?").get(occ.id)!;
      db.run(
        "INSERT INTO runs (kind, started_at, finished_at, status, summary) VALUES ('completion', ?, ?, 'ok', ?)",
        [
          now.toISOString(),
          now.toISOString(),
          JSON.stringify({ occurrence: occ.id, completion: saved.id, by: personId, on: completedOn, cancelledReminders: cancelled }),
        ],
      );
      return saved;
    })
    .immediate();
}

export interface Health extends OutboxHealth {
  ok: boolean;
  lastOk: string | null;
  // Schedules (or config) the last nightly run couldn't plan.
  errors: number;
}

export function health(db: Database, now: Date): Health {
  const lastOk = lastNightlyOk(db);
  const last = db
    .query<{ summary: string | null }, []>(
      "SELECT summary FROM runs WHERE kind = 'nightly' AND status = 'ok' ORDER BY id DESC LIMIT 1",
    )
    .get();
  const errors = last?.summary ? ((JSON.parse(last.summary) as Partial<NightlySummary>).errors?.length ?? 0) : 0;
  const outbox = outboxHealth(db, now, STALE_RUN_HOURS);
  const fresh = lastOk !== null && hoursBetween(lastOk, now) <= STALE_RUN_HOURS;
  return { ok: fresh && errors === 0 && outbox.dead === 0 && outbox.stuck === 0, lastOk, errors, ...outbox };
}

function lastNightlyOk(db: Database): string | null {
  return (
    db
      .query<{ t: string | null }, []>("SELECT MAX(finished_at) AS t FROM runs WHERE kind = 'nightly' AND status = 'ok'")
      .get()?.t ?? null
  );
}

function hoursBetween(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / 3_600_000;
}
