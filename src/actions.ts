import type { Database } from "bun:sqlite";
import { completeOccurrence, type Occurrence, type Schedule } from "./maintenance";
import { cancelReminders } from "./notify";

// The changes Rosie can propose from what someone tells her. The model fills in a
// RawAction; `validate` checks it against the database and turns it into an Action,
// `describe` says in plain words what approving it will do, and `apply` does exactly that.

export type RawAction = {
  type: "complete" | "snooze" | "log" | "add_schedule" | "set_owner";
  task_id: number | null;
  schedule_id: string | null;
  item_id: string | null;
  new_item_name: string | null;
  title: string | null;
  date: string | null;
  interval_days: number | null;
  person_id: string | null;
  notes: string | null;
  checklist: string | null;
};

export type Action =
  // Mark an open task done. `by` defaults to whoever asked.
  | { type: "complete"; task_id: number; on: string; by: string; notes: string | null }
  // Move an open task's due date.
  | { type: "snooze"; task_id: number; until: string }
  // Record work that had no open task. With a schedule, it moves that schedule's next due date.
  | { type: "log"; item_id: string; schedule_id: string | null; title: string; on: string; by: string; notes: string | null }
  // A new recurring schedule, on an existing item or a new one.
  | {
      type: "add_schedule";
      item_id: string | null;
      new_item_name: string | null;
      title: string;
      interval_days: number;
      first_due: string;
      owner_id: string | null;
      checklist: string | null;
    }
  // Change who owns a schedule. The open task follows at the next nightly check.
  | { type: "set_owner"; schedule_id: string; owner_id: string | null };

export class ActionError extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isDate(value: string | null): value is string {
  if (!value || !DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function text(value: string | null): string | null {
  const t = value?.trim();
  return t ? t : null;
}

interface Ctx {
  db: Database;
  speaker: string;
  today: string;
}

function openTask(db: Database, id: number | null): Occurrence {
  const occ = id === null ? null : db.query<Occurrence, [number]>("SELECT * FROM occurrences WHERE id = ?").get(id);
  if (!occ) throw new ActionError(`there is no task ${id}`);
  if (occ.status !== "open") throw new ActionError(`task ${id} is already ${occ.status}`);
  return occ;
}

function person(db: Database, id: string | null): string | null {
  if (id === null) return null;
  if (!db.query("SELECT 1 FROM people WHERE id = ?").get(id)) throw new ActionError(`there is no person "${id}"`);
  return id;
}

function schedule(db: Database, id: string | null): Schedule {
  const s = id === null ? null : db.query<Schedule, [string]>("SELECT * FROM schedules WHERE id = ?").get(id);
  if (!s) throw new ActionError(`there is no schedule "${id}"`);
  return s;
}

function item(db: Database, id: string | null): string {
  if (id === null || !db.query("SELECT 1 FROM items WHERE id = ?").get(id)) throw new ActionError(`there is no item "${id}"`);
  return id;
}

function pastOrToday(date: string | null, today: string, what: string): string {
  if (!isDate(date)) throw new ActionError(`${what} "${date}" is not a YYYY-MM-DD date`);
  if (date > today) throw new ActionError(`${what} ${date} is in the future`);
  return date;
}

// Throws ActionError when the model referred to something that doesn't exist or
// asked for something the household's rules don't allow.
export function validate(ctx: Ctx, raw: RawAction): Action {
  const { db, speaker, today } = ctx;
  switch (raw.type) {
    case "complete": {
      const occ = openTask(db, raw.task_id);
      return {
        type: "complete",
        task_id: occ.id,
        on: raw.date === null ? today : pastOrToday(raw.date, today, "completion date"),
        by: person(db, raw.person_id) ?? speaker,
        notes: text(raw.notes),
      };
    }
    case "snooze": {
      const occ = openTask(db, raw.task_id);
      if (!isDate(raw.date)) throw new ActionError(`new due date "${raw.date}" is not a YYYY-MM-DD date`);
      if (raw.date <= today) throw new ActionError(`a snooze has to move the task past today`);
      if (raw.date === occ.due_on) throw new ActionError(`task ${occ.id} is already due ${occ.due_on}`);
      return { type: "snooze", task_id: occ.id, until: raw.date };
    }
    case "log": {
      const s = raw.schedule_id === null ? null : schedule(db, raw.schedule_id);
      const on = raw.date === null ? today : pastOrToday(raw.date, today, "completion date");
      const by = person(db, raw.person_id) ?? speaker;
      const notes = text(raw.notes);
      // Logging work on a schedule that has a task waiting is completing that task.
      const open = s && db.query<{ id: number }, [string]>("SELECT id FROM occurrences WHERE schedule_id = ? AND status = 'open'").get(s.id);
      if (open) return { type: "complete", task_id: open.id, on, by, notes };
      const title = text(raw.title) ?? s?.title;
      if (!title) throw new ActionError("a log entry needs a title");
      return { type: "log", item_id: s ? s.item_id : item(db, raw.item_id), schedule_id: s?.id ?? null, title, on, by, notes };
    }
    case "add_schedule": {
      const title = text(raw.title);
      if (!title) throw new ActionError("a schedule needs a title");
      const days = raw.interval_days;
      if (days === null || !Number.isInteger(days) || days < 1 || days > 3650) {
        throw new ActionError(`"every ${days} days" is not a usable interval`);
      }
      const newItem = text(raw.new_item_name);
      const itemId = raw.item_id === null ? null : item(db, raw.item_id);
      if (!itemId && !newItem) throw new ActionError("a schedule needs an item");
      const first = raw.date ?? today;
      if (!isDate(first)) throw new ActionError(`first due date "${first}" is not a YYYY-MM-DD date`);
      return {
        type: "add_schedule",
        item_id: itemId,
        new_item_name: itemId ? null : newItem,
        title,
        interval_days: days,
        first_due: first,
        owner_id: person(db, raw.person_id),
        checklist: text(raw.checklist),
      };
    }
    case "set_owner": {
      const s = schedule(db, raw.schedule_id);
      const owner = person(db, raw.person_id);
      if (owner === s.owner_id) throw new ActionError(`"${s.title}" already has that owner`);
      return { type: "set_owner", schedule_id: s.id, owner_id: owner };
    }
    default:
      throw new ActionError(`unknown action "${(raw as { type: string }).type}"`);
  }
}

const name = (db: Database, id: string | null) =>
  id === null ? "nobody" : (db.query<{ name: string }, [string]>("SELECT name FROM people WHERE id = ?").get(id)?.name ?? id);

const taskTitle = (db: Database, id: number) =>
  db
    .query<{ title: string }, [number]>("SELECT s.title FROM occurrences o JOIN schedules s ON s.id = o.schedule_id WHERE o.id = ?")
    .get(id)?.title ?? `task ${id}`;

// "Mon, Oct 19", with the year when it isn't this year.
function day(date: string, today: string): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" };
  if (date.slice(0, 4) !== today.slice(0, 4)) opts.year = "numeric";
  return new Intl.DateTimeFormat("en-US", opts).format(new Date(`${date}T00:00:00Z`));
}

function every(days: number): string {
  if (days % 365 === 0) return days === 365 ? "every year" : `every ${days / 365} years`;
  if (days % 7 === 0) return days === 7 ? "every week" : `every ${days / 7} weeks`;
  return `every ${days} days`;
}

// One sentence a person can approve. Written from the validated action, so what
// they read is what `apply` will do, whatever the model said in its reply.
export function describe(db: Database, a: Action, speaker: string, today: string): string {
  const who = (id: string) => (id === speaker ? "" : ` by ${name(db, id)}`);
  const note = (n: string | null) => (n ? ` with the note "${n}"` : "");
  switch (a.type) {
    case "complete":
      return `Mark "${taskTitle(db, a.task_id)}" done on ${day(a.on, today)}${who(a.by)}${note(a.notes)}.`;
    case "snooze":
      return `Move "${taskTitle(db, a.task_id)}" to ${day(a.until, today)}.`;
    case "log":
      return `Record "${a.title}" done on ${day(a.on, today)}${who(a.by)}${note(a.notes)}${a.schedule_id ? ", and plan the next one from that date" : ""}.`;
    case "add_schedule": {
      const itemName = a.item_id
        ? db.query<{ name: string }, [string]>("SELECT name FROM items WHERE id = ?").get(a.item_id)!.name
        : `a new item, "${a.new_item_name}"`;
      return `Add "${a.title}" ${every(a.interval_days)} for ${itemName}, first due ${day(a.first_due, today)}, owned by ${name(db, a.owner_id)}.`;
    }
    case "set_owner": {
      const title = db.query<{ title: string }, [string]>("SELECT title FROM schedules WHERE id = ?").get(a.schedule_id)!.title;
      return `Make ${name(db, a.owner_id)} the owner of "${title}".`;
    }
  }
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "x"
  );
}

function freeId(db: Database, table: "items" | "schedules", base: string): string {
  for (let n = 1; ; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (!db.query(`SELECT 1 FROM ${table} WHERE id = ?`).get(id)) return id;
  }
}

function receipt(db: Database, kind: string, summary: object, now: Date): void {
  db.run("INSERT INTO runs (kind, started_at, finished_at, status, summary) VALUES (?, ?, ?, 'ok', ?)", [
    kind,
    now.toISOString(),
    now.toISOString(),
    JSON.stringify(summary),
  ]);
}

// Re-checks the action against the database as it is now (the person may approve
// long after Rosie proposed it), then writes it with a receipt in `runs`.
export function apply(db: Database, a: Action, approvedBy: string, today: string, now: Date): void {
  db.transaction(() => {
    switch (a.type) {
      case "complete":
        openTask(db, a.task_id);
        completeOccurrence(db, a.task_id, a.by, a.on, a.notes, now);
        return;
      case "snooze": {
        const occ = openTask(db, a.task_id);
        if (a.until <= today) throw new ActionError(`${a.until} has already passed`);
        db.run(
          "UPDATE occurrences SET due_on = ?, snoozed_from = COALESCE(snoozed_from, due_on), overdue_alerted_at = NULL WHERE id = ?",
          [a.until, occ.id],
        );
        // A queued "due" reminder would now arrive with the wrong date.
        cancelReminders(db, occ.id, now);
        receipt(db, "snooze", { occurrence: occ.id, from: occ.due_on, to: a.until, by: approvedBy }, now);
        return;
      }
      case "log": {
        const id = db.run(
          `INSERT INTO completions (schedule_id, item_id, title, completed_on, completed_by, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [a.schedule_id, a.item_id, a.title, a.on, a.by, a.notes, now.toISOString()],
        ).lastInsertRowid;
        receipt(db, "log", { completion: Number(id), schedule: a.schedule_id, by: a.by, on: a.on, approvedBy }, now);
        return;
      }
      case "add_schedule": {
        let itemId = a.item_id;
        if (!itemId) {
          itemId = freeId(db, "items", slug(a.new_item_name!));
          db.run("INSERT INTO items (id, name) VALUES (?, ?)", [itemId, a.new_item_name]);
        }
        const id = freeId(db, "schedules", slug(a.title));
        db.run(
          `INSERT INTO schedules (id, item_id, title, interval_days, lead_days, owner_id, checklist, starts_on)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, itemId, a.title, a.interval_days, Math.min(7, Math.floor(a.interval_days / 4)), a.owner_id, a.checklist, a.first_due],
        );
        receipt(db, "add_schedule", { schedule: id, item: itemId, approvedBy }, now);
        return;
      }
      case "set_owner": {
        const s = schedule(db, a.schedule_id);
        db.run("UPDATE schedules SET owner_id = ? WHERE id = ?", [a.owner_id, s.id]);
        receipt(db, "set_owner", { schedule: s.id, from: s.owner_id, to: a.owner_id, approvedBy }, now);
        return;
      }
    }
  }).immediate();
}
