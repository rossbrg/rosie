import type { Database } from "bun:sqlite";
import { todayIn } from "./dates";
import { planMaintenance } from "./maintenance";
import { deliverOutbox, type Channel } from "./notify";

export interface NightlyOptions {
  timeZone?: string;
  alertPersonId?: string;
}

// One nightly pass: plan, then deliver. Every pass is recorded in `runs`,
// which is what /healthz and the missed-run alert read.
export async function runNightly(db: Database, channels: Channel[], now: Date, opts: NightlyOptions = {}) {
  const runId = Number(
    db.run("INSERT INTO runs (kind, started_at, status) VALUES ('nightly', ?, 'running')", [now.toISOString()])
      .lastInsertRowid,
  );
  try {
    const plan = planMaintenance(db, todayIn(opts.timeZone, now), now, opts.alertPersonId);
    const delivery = await deliverOutbox(db, channels, now);
    const summary = { ...plan, delivery };
    // A delivery failure is retried next run; it doesn't make the run itself fail.
    db.run("UPDATE runs SET finished_at = ?, status = 'ok', summary = ? WHERE id = ?", [
      now.toISOString(),
      JSON.stringify(summary),
      runId,
    ]);
    return summary;
  } catch (err) {
    db.run("UPDATE runs SET finished_at = ?, status = 'error', error = ? WHERE id = ?", [
      now.toISOString(),
      String(err),
      runId,
    ]);
    throw err;
  }
}
