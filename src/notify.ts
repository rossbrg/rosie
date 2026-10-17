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
  // Throws on failure so the outbox can retry.
  send(to: Recipient, msg: Message): Promise<void>;
}

export const MAX_ATTEMPTS = 5;

// Queue one message per channel. The dedupe key makes re-queueing a no-op,
// so a re-run never sends the same reminder twice.
export function enqueue(db: Database, dedupeKey: string, personId: string, msg: Message, now: Date): void {
  for (const channel of ["email", "push"] as const) {
    db.run(
      `INSERT INTO outbox (dedupe_key, person_id, channel, subject, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (dedupe_key) DO NOTHING`,
      [`${dedupeKey}:${channel}`, personId, channel, msg.subject, msg.body, now.toISOString()],
    );
  }
}

interface OutboxRow {
  id: number;
  person_id: string;
  channel: ChannelName;
  subject: string;
  body: string;
}

export async function deliverOutbox(
  db: Database,
  channels: Channel[],
  now: Date,
): Promise<{ sent: number; failed: number }> {
  const byName = new Map(channels.map((c) => [c.name, c]));
  const rows = db
    .query<OutboxRow, [number]>(
      `SELECT id, person_id, channel, subject, body FROM outbox
       WHERE sent_at IS NULL AND attempts < ? ORDER BY id`,
    )
    .all(MAX_ATTEMPTS);
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const channel = byName.get(row.channel);
    if (!channel) continue;
    const to = db
      .query<Recipient, [string]>("SELECT id, name, email, ntfy_topic FROM people WHERE id = ?")
      .get(row.person_id);
    try {
      if (!to) throw new Error(`unknown person ${row.person_id}`);
      await channel.send(to, { subject: row.subject, body: row.body });
      db.run("UPDATE outbox SET sent_at = ?, attempts = attempts + 1, last_error = NULL WHERE id = ?", [
        now.toISOString(),
        row.id,
      ]);
      sent++;
    } catch (err) {
      db.run("UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?", [String(err), row.id]);
      failed++;
    }
  }
  return { sent, failed };
}

// Email through Resend's HTTP API.
export function resendEmail(apiKey: string, from: string): Channel {
  return {
    name: "email",
    async send(to, msg) {
      if (!to.email) return; // person has no email configured; nothing to send
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [to.email], subject: msg.subject, text: msg.body }),
      });
      if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
    },
  };
}

// Phone push through ntfy (ntfy.sh or self-hosted).
export function ntfyPush(baseUrl: string, token?: string): Channel {
  return {
    name: "push",
    async send(to, msg) {
      if (!to.ntfy_topic) return;
      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/${encodeURIComponent(to.ntfy_topic)}`, {
        method: "POST",
        headers: { Title: msg.subject, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: msg.body,
      });
      if (!res.ok) throw new Error(`ntfy ${res.status}: ${await res.text()}`);
    },
  };
}

export function consoleChannel(name: ChannelName): Channel {
  return {
    name,
    async send(to, msg) {
      console.log(`[${name} → ${to.name}] ${msg.subject}\n${msg.body}`);
    },
  };
}

export function channelsFromEnv(env: Record<string, string | undefined>): Channel[] {
  const email =
    env.RESEND_API_KEY && env.ROSIE_EMAIL_FROM
      ? resendEmail(env.RESEND_API_KEY, env.ROSIE_EMAIL_FROM)
      : consoleChannel("email");
  const push = env.NTFY_URL ? ntfyPush(env.NTFY_URL, env.NTFY_TOKEN) : consoleChannel("push");
  return [email, push];
}
