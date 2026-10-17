import type { Database } from "bun:sqlite";
import { todayIn } from "./dates";
import { completeOccurrence, CompletionError, health, nextDue, type Schedule } from "./maintenance";

export interface WebOptions {
  timeZone?: string;
  // Local development only: treat requests without a Tailscale header as this login.
  devLogin?: string;
  now?: () => Date;
}

interface Person {
  id: string;
  name: string;
}

// `tailscale serve` adds this header with the signed-in tailnet user.
const IDENTITY_HEADER = "Tailscale-User-Login";

export function createHandler(db: Database, opts: WebOptions = {}) {
  const now = opts.now ?? (() => new Date());

  function caller(req: Request): Person | null {
    const login = req.headers.get(IDENTITY_HEADER) ?? opts.devLogin;
    if (!login) return null;
    return db.query<Person, [string]>("SELECT id, name FROM people WHERE login = ?").get(login);
  }

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/healthz") {
      const h = health(db, now());
      return Response.json(h, { status: h.ok ? 200 : 503 });
    }

    const me = caller(req);
    if (!me) return new Response("Not signed in to the household tailnet.", { status: 401 });

    const done = url.pathname.match(/^\/occurrences\/(\d+)\/complete$/);
    if (done && req.method === "POST") {
      const form = await req.formData();
      const notes = String(form.get("notes") ?? "").trim() || null;
      try {
        completeOccurrence(db, Number(done[1]), me.id, todayIn(opts.timeZone, now()), notes, now());
      } catch (err) {
        if (err instanceof CompletionError) return new Response(err.message, { status: 404 });
        throw err;
      }
      return Response.redirect(new URL("/", url).toString(), 303);
    }

    if (url.pathname === "/" && req.method === "GET") {
      return new Response(renderHome(db, me, todayIn(opts.timeZone, now())), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  };
}

interface OpenRow {
  id: number;
  due_on: string;
  title: string;
  checklist: string | null;
  item: string;
  owner: string | null;
}

interface HistoryRow {
  title: string;
  item: string;
  completed_on: string;
  who: string | null;
  notes: string | null;
}

function renderHome(db: Database, me: Person, today: string): string {
  const open = db
    .query<OpenRow, []>(
      `SELECT o.id, o.due_on, s.title, s.checklist, i.name AS item, p.name AS owner
       FROM occurrences o JOIN schedules s ON s.id = o.schedule_id JOIN items i ON i.id = s.item_id
       LEFT JOIN people p ON p.id = o.owner_id
       WHERE o.status = 'open' ORDER BY o.due_on`,
    )
    .all();
  const schedules = db.query<Schedule & { item: string }, []>(
    "SELECT s.*, i.name AS item FROM schedules s JOIN items i ON i.id = s.item_id WHERE s.active = 1 ORDER BY s.title",
  ).all();
  const history = db
    .query<HistoryRow, []>(
      `SELECT c.title, i.name AS item, c.completed_on, p.name AS who, c.notes
       FROM completions c JOIN items i ON i.id = c.item_id LEFT JOIN people p ON p.id = c.completed_by
       ORDER BY c.completed_on DESC, c.id DESC LIMIT 20`,
    )
    .all();

  const openHtml = open.length
    ? open
        .map(
          (o) => `
      <li class="${o.due_on < today ? "late" : ""}">
        <div><strong>${esc(o.title)}</strong> <span class="muted">· ${esc(o.item)}</span></div>
        <div class="muted">Due ${esc(o.due_on)}${o.owner ? ` · ${esc(o.owner)}` : ""}</div>
        ${o.checklist ? `<pre>${esc(o.checklist)}</pre>` : ""}
        <form method="post" action="/occurrences/${o.id}/complete">
          <input name="notes" placeholder="Notes (optional)" aria-label="Notes">
          <button>Mark done</button>
        </form>
      </li>`,
        )
        .join("")
    : `<li class="muted">Nothing due.</li>`;

  const upcomingHtml = schedules
    .map((s) => `<li>${esc(s.title)} <span class="muted">· next ${esc(nextDue(db, s).due)}</span></li>`)
    .join("");

  const historyHtml = history.length
    ? history
        .map(
          (h) =>
            `<li>${esc(h.completed_on)} · ${esc(h.title)}${h.who ? ` · ${esc(h.who)}` : ""}${
              h.notes ? ` <span class="muted">(${esc(h.notes)})</span>` : ""
            }</li>`,
        )
        .join("")
    : `<li class="muted">No history yet.</li>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rosie</title>
<style>
  :root { color-scheme: light dark; --muted: #6b7280; --late: #b91c1c; }
  body { font: 16px/1.45 system-ui, sans-serif; max-width: 40rem; margin: 0 auto; padding: 1rem; }
  ul { list-style: none; padding: 0; } li { padding: .75rem 0; border-bottom: 1px solid #8883; }
  .muted { color: var(--muted); } .late strong { color: var(--late); }
  pre { white-space: pre-wrap; font: inherit; margin: .5rem 0; }
  form { display: flex; gap: .5rem; margin-top: .5rem; } input { flex: 1; padding: .4rem; } button { padding: .4rem .8rem; }
</style></head>
<body>
  <p class="muted">Signed in as ${esc(me.name)}</p>
  <h2>Due now</h2><ul>${openHtml}</ul>
  <h2>Schedules</h2><ul>${upcomingHtml}</ul>
  <h2>Recently done</h2><ul>${historyHtml}</ul>
</body></html>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
