import type { Database } from "bun:sqlite";

export type ChannelName = "email" | "push";

export interface Recipient {
  id: string;
  name: string;
  email: string | null;
  ntfy_topic: string | null;
}

export interface Message {
  subject: string;
  body: string;
}

export interface Channel {
  name: ChannelName;
  // Why this person can't be reached on this channel, or null if they can.
  unreachable(to: Recipient): string | null;
  // Throws on failure so the outbox can retry.
  send(to: Recipient, msg: Message): Promise<void>;
}

export const MAX_ATTEMPTS = 5;
// A claim older than this belongs to a process that died mid-send; take it over.
export const CLAIM_TIMEOUT_MINUTES = 15;

// Queue one message per channel. The dedupe key makes re-queueing a no-op,
// so a re-run never sends the same reminder twice.
export function enqueue(
  db: Database,
  dedupeKey: string,
  personId: string,
  msg: Message,
  now: Date,
  occurrenceId: number | null = null,
): void {
  for (const channel of ["email", "push"] as const) {
    db.run(
      `INSERT INTO outbox (dedupe_key, person_id, occurrence_id, channel, subject, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (dedupe_key) DO NOTHING`,
      [`${dedupeKey}:${channel}`, personId, occurrenceId, channel, msg.subject, msg.body, now.toISOString()],
    );
  }
}

// Reminders about a task that is done or replanned no longer apply.
export function cancelReminders(db: Database, occurrenceId: number, now: Date): number {
  return db.run(
    "UPDATE outbox SET cancelled_at = ? WHERE occurrence_id = ? AND sent_at IS NULL AND cancelled_at IS NULL",
    [now.toISOString(), occurrenceId],
  ).changes;
}

interface OutboxRow {
  id: number;
  person_id: string;
  channel: ChannelName;
  subject: string;
  body: string;
}

export interface DeliverySummary {
  sent: number;
  failed: number;
  // Left queued without using an attempt: channel not set up, or no address for the person.
  waiting: number;
}

export async function deliverOutbox(db: Database, channels: Channel[], now: Date): Promise<DeliverySummary> {
  const byName = new Map(channels.map((c) => [c.name, c]));
  const staleClaim = new Date(now.getTime() - CLAIM_TIMEOUT_MINUTES * 60_000).toISOString();
  const rows = db
    .query<OutboxRow, [number]>(
      `SELECT id, person_id, channel, subject, body FROM outbox
       WHERE sent_at IS NULL AND cancelled_at IS NULL AND attempts < ?
         AND (occurrence_id IS NULL OR occurrence_id IN (SELECT id FROM occurrences WHERE status = 'open'))
       ORDER BY id`,
    )
    .all(MAX_ATTEMPTS);
  const summary: DeliverySummary = { sent: 0, failed: 0, waiting: 0 };

  for (const row of rows) {
    const channel = byName.get(row.channel);
    const to = db
      .query<Recipient, [string]>("SELECT id, name, email, ntfy_topic FROM people WHERE id = ?")
      .get(row.person_id);
    const why = !channel ? `${row.channel} is not configured` : !to ? `unknown person ${row.person_id}` : channel.unreachable(to);
    if (why || !channel || !to) {
      db.run("UPDATE outbox SET last_error = ? WHERE id = ?", [why, row.id]);
      summary.waiting++;
      continue;
    }

    // Claim the row so an overlapping run can't send it too.
    const claimed = db.run(
      `UPDATE outbox SET claimed_at = ? WHERE id = ? AND sent_at IS NULL AND cancelled_at IS NULL
         AND (claimed_at IS NULL OR claimed_at < ?)`,
      [now.toISOString(), row.id, staleClaim],
    );
    if (claimed.changes !== 1) continue;

    try {
      await channel.send(to, { subject: row.subject, body: row.body });
      db.run(
        "UPDATE outbox SET sent_at = ?, claimed_at = NULL, attempts = attempts + 1, last_error = NULL WHERE id = ?",
        [now.toISOString(), row.id],
      );
      summary.sent++;
    } catch (err) {
      db.run("UPDATE outbox SET claimed_at = NULL, attempts = attempts + 1, last_error = ? WHERE id = ?", [
        String(err),
        row.id,
      ]);
      summary.failed++;
    }
  }
  return summary;
}

export interface OutboxHealth {
  // Gave up after MAX_ATTEMPTS.
  dead: number;
  // Still unsent a day and a half after it was queued.
  stuck: number;
}

export function outboxHealth(db: Database, now: Date, staleHours: number): OutboxHealth {
  const cutoff = new Date(now.getTime() - staleHours * 3_600_000).toISOString();
  return db
    .query<OutboxHealth, [number, number, string]>(
      `SELECT COUNT(CASE WHEN attempts >= ? THEN 1 END) AS dead,
              COUNT(CASE WHEN attempts < ? AND created_at < ? THEN 1 END) AS stuck
       FROM outbox WHERE sent_at IS NULL AND cancelled_at IS NULL`,
    )
    .get(MAX_ATTEMPTS, MAX_ATTEMPTS, cutoff)!;
}

// Email through Resend's HTTP API.
export function resendEmail(apiKey: string, from: string): Channel {
  return {
    name: "email",
    unreachable: (to) => (to.email ? null : `${to.name} has no email address`),
    async send(to, msg) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [to.email], subject: msg.subject, text: msg.body }),
      });
      if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
    },
  };
}

// Phone push through ntfy (ntfy.sh or self-hosted). Published as JSON rather than
// with a Title header, because header values can't carry an em dash or emoji.
export function ntfyPush(baseUrl: string, token?: string): Channel {
  return {
    name: "push",
    unreachable: (to) => (to.ntfy_topic ? null : `${to.name} has no ntfy topic`),
    async send(to, msg) {
      const res = await fetch(baseUrl.replace(/\/$/, ""), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ topic: to.ntfy_topic, title: msg.subject, message: msg.body }),
      });
      if (!res.ok) throw new Error(`ntfy ${res.status}: ${await res.text()}`);
    },
  };
}

export function consoleChannel(name: ChannelName): Channel {
  return {
    name,
    unreachable: () => null,
    async send(to, msg) {
      console.log(`[${name} → ${to.name}] ${msg.subject}\n${msg.body}`);
    },
  };
}

// Only channels that are fully set up. A half-configured channel is an error, and the
// console stand-in is opt-in, so a config mistake can't quietly use up reminders.
export function channelsFromEnv(env: Record<string, string | undefined>): Channel[] {
  if (env.ROSIE_CONSOLE_CHANNELS === "1") return [consoleChannel("email"), consoleChannel("push")];
  const channels: Channel[] = [];
  if (Boolean(env.RESEND_API_KEY) !== Boolean(env.ROSIE_EMAIL_FROM)) {
    throw new Error("Email needs both RESEND_API_KEY and ROSIE_EMAIL_FROM");
  }
  if (env.RESEND_API_KEY && env.ROSIE_EMAIL_FROM) channels.push(resendEmail(env.RESEND_API_KEY, env.ROSIE_EMAIL_FROM));
  if (env.NTFY_URL) channels.push(ntfyPush(env.NTFY_URL, env.NTFY_TOKEN));
  else if (env.NTFY_TOKEN) throw new Error("NTFY_TOKEN is set but NTFY_URL is not");
  return channels;
}
