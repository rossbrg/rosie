import type { Database } from "bun:sqlite";
import { daysBetween } from "./dates";
import { nextDue, type Schedule } from "./maintenance";

// The household page: what's due, what's coming, what got done.
// Server-rendered with no client script beyond progressive niceties.

export interface Viewer {
  id: string;
  name: string;
}

interface OpenRow {
  id: number;
  due_on: string;
  snoozed_from: string | null;
  title: string;
  checklist: string | null;
  item: string;
  owner: string | null;
}

interface UpcomingRow extends Schedule {
  item: string;
  owner: string | null;
  has_open: number;
}

interface RequestRow {
  id: number;
  text: string;
  status: "pending" | "answered" | "error";
  reply: string | null;
  error: string | null;
}

interface ProposalRow {
  id: number;
  request_id: number;
  summary: string;
  status: "proposed" | "applied" | "dismissed" | "failed";
  error: string | null;
}

interface HistoryRow {
  title: string;
  item: string;
  completed_on: string;
  who: string | null;
  notes: string | null;
}

export function renderHome(
  db: Database,
  me: Viewer,
  today: string,
  csrf: string,
  // `now` is set when "Tell Rosie" is available.
  ask: { now: Date } | null = null,
): string {
  const open = db
    .query<OpenRow, []>(
      `SELECT o.id, o.due_on, o.snoozed_from, s.title, s.checklist, i.name AS item, p.name AS owner
       FROM occurrences o JOIN schedules s ON s.id = o.schedule_id JOIN items i ON i.id = s.item_id
       LEFT JOIN people p ON p.id = o.owner_id
       WHERE o.status = 'open' ORDER BY o.due_on`,
    )
    .all();
  const upcoming = db
    .query<UpcomingRow, []>(
      `SELECT s.*, i.name AS item, p.name AS owner,
         EXISTS (SELECT 1 FROM occurrences o WHERE o.schedule_id = s.id AND o.status = 'open') AS has_open
       FROM schedules s JOIN items i ON i.id = s.item_id LEFT JOIN people p ON p.id = s.owner_id
       WHERE s.active = 1`,
    )
    .all()
    .filter((s) => !s.has_open)
    .map((s) => ({ ...s, due: nextDue(db, s).due }))
    .sort((a, b) => a.due.localeCompare(b.due));
  const history = db
    .query<HistoryRow, []>(
      `SELECT c.title, i.name AS item, c.completed_on, p.name AS who, c.notes
       FROM completions c JOIN items i ON i.id = c.item_id LEFT JOIN people p ON p.id = c.completed_by
       ORDER BY c.completed_on DESC, c.id DESC LIMIT 10`,
    )
    .all();

  const late = open.filter((o) => o.due_on < today).length;
  const summary =
    open.length === 0
      ? "Nothing needs doing right now."
      : late > 0
        ? `${count(late, "thing is", "things are")} overdue${open.length > late ? `, ${open.length - late} more due soon` : ""}.`
        : `${count(open.length, "thing", "things")} due soon.`;

  const dueHtml = open.length
    ? open.map((o) => dueCard(o, today, csrf)).join("")
    : `<div class="empty"><div class="empty-mark" aria-hidden="true">${ICON.check}</div><p>All caught up.</p></div>`;

  const upcomingHtml = upcoming.length
    ? `<ul class="list">${upcoming
        .map(
          (s) => `
        <li class="row">
          <div class="row-main">
            <div class="row-title">${esc(s.title)}</div>
            <div class="row-sub">${esc(every(s.interval_days))}${s.owner ? ` · ${esc(s.owner)}` : ""}</div>
          </div>
          <time class="row-when" datetime="${esc(s.due)}">${esc(relative(s.due, today))}</time>
        </li>`,
        )
        .join("")}</ul>`
    : `<p class="muted pad">No schedules yet.</p>`;

  const historyHtml = history.length
    ? `<ul class="list">${history
        .map(
          (h) => `
        <li class="row">
          <span class="tick" aria-hidden="true">${ICON.check}</span>
          <div class="row-main">
            <div class="row-title">${esc(h.title)}</div>
            <div class="row-sub">${[h.who, h.notes].filter(Boolean).map((s) => esc(s!)).join(" · ") || esc(h.item)}</div>
          </div>
          <time class="row-when" datetime="${esc(h.completed_on)}">${esc(past(h.completed_on, today))}</time>
        </li>`,
        )
        .join("")}</ul>`
    : `<p class="muted pad">Nothing yet. Finished tasks show up here.</p>`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f6f3ee" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#151413" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Rosie">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(FAVICON)}">
<title>Rosie</title>
<style>${CSS}</style>
</head>
<body>
<main>
  <header class="top">
    <div class="brand"><span class="logo" aria-hidden="true">${ICON.home}</span>Rosie</div>
    <div class="who" title="Signed in as ${esc(me.name)}">${esc(initials(me.name))}</div>
  </header>

  <section class="hero">
    <p class="date">${esc(longDate(today))}</p>
    <h1>${esc(greeting(me.name))}</h1>
    <p class="summary">${esc(summary)}</p>
  </section>

  ${ask ? askSection(db, me, csrf, ask.now) : ""}

  <section aria-labelledby="due-h">
    <h2 id="due-h">Due now</h2>
    ${dueHtml}
  </section>

  <section aria-labelledby="next-h">
    <h2 id="next-h">Coming up</h2>
    <div class="group">${upcomingHtml}</div>
  </section>

  <section aria-labelledby="done-h">
    <h2 id="done-h">Recently done</h2>
    <div class="group">${historyHtml}</div>
  </section>
</main>
</body></html>`;
}

function dueCard(o: OpenRow, today: string, csrf: string): string {
  const days = daysBetween(today, o.due_on);
  const tone = days < 0 ? "late" : days <= 1 ? "soon" : "ok";
  const steps = (o.checklist ?? "")
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);
  return `
    <article class="card">
      <div class="card-head">
        <span class="pill ${tone}"><time datetime="${esc(o.due_on)}">${esc(dueLabel(o.due_on, today))}</time></span>
        ${o.owner ? `<span class="owner"><span class="avatar" aria-hidden="true">${esc(initials(o.owner))}</span>${esc(o.owner)}</span>` : ""}
      </div>
      <h3>${esc(o.title)}</h3>
      <p class="item">${esc(o.item)}${o.snoozed_from ? ` · moved from ${esc(shortDate(o.snoozed_from))}` : ""}</p>
      ${
        steps.length
          ? `<details class="steps"${steps.length <= 3 ? " open" : ""}>
        <summary>${count(steps.length, "step", "steps")}</summary>
        <ol>${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
      </details>`
          : ""
      }
      <form method="post" action="/occurrences/${o.id}/complete" class="done">
        <input type="hidden" name="csrf" value="${esc(csrf)}">
        <input name="notes" placeholder="Add a note" aria-label="Notes" autocomplete="off">
        <button type="submit">${ICON.check}<span>Mark done</span></button>
      </form>
    </article>`;
}

// The "Tell Rosie" box, with this person's latest messages and what Rosie suggested.
// Shows anything still waiting on a decision, plus the last day's conversation.
function askSection(db: Database, me: Viewer, csrf: string, now: Date): string {
  const requests = db
    .query<RequestRow, [string, string]>(
      `SELECT r.id, r.text, r.status, r.reply, r.error FROM requests r
       WHERE r.person_id = ? AND (r.created_at >= ?
         OR EXISTS (SELECT 1 FROM proposals p WHERE p.request_id = r.id AND p.status = 'proposed'))
       ORDER BY r.id DESC LIMIT 4`,
    )
    .all(me.id, new Date(now.getTime() - 86_400_000).toISOString());
  const proposals = requests.length
    ? db
        .query<ProposalRow, []>(
          `SELECT id, request_id, summary, status, error FROM proposals
           WHERE request_id IN (${requests.map((r) => r.id).join(",")}) ORDER BY id`,
        )
        .all()
    : [];
  const thread = requests
    .map((r) => {
      const mine = proposals.filter((p) => p.request_id === r.id);
      const answer =
        r.status === "error"
          ? `<p class="bubble rosie error">${esc(r.error ?? "Something went wrong.")}</p>`
          : r.reply
            ? `<p class="bubble rosie">${esc(r.reply)}</p>`
            : "";
      return `
      <div class="exchange">
        <p class="bubble me">${esc(r.text)}</p>
        ${answer}
        ${mine.map((p) => proposalRow(p, csrf)).join("")}
      </div>`;
    })
    .join("");
  return `
  <section id="ask" aria-labelledby="ask-h">
    <h2 id="ask-h">Tell Rosie</h2>
    <form method="post" action="/ask" class="ask" onsubmit="const b = this.querySelector('button'); b.disabled = true; b.textContent = 'Reading…';">
      <input type="hidden" name="csrf" value="${esc(csrf)}">
      <textarea name="message" rows="2" maxlength="2000" required aria-label="Message to Rosie"
        placeholder="“Vacuumed the inserts yesterday” or “move the tank to Sunday”"></textarea>
      <button type="submit">Send</button>
    </form>
    ${thread}
  </section>`;
}

function proposalRow(p: ProposalRow, csrf: string): string {
  if (p.status !== "proposed") {
    const label = p.status === "applied" ? "Done" : p.status === "dismissed" ? "Dismissed" : `Couldn't do it: ${p.error ?? "unknown error"}`;
    return `<div class="proposal ${p.status}"><p>${esc(p.summary)}</p><span class="state">${esc(label)}</span></div>`;
  }
  const button = (verb: "approve" | "dismiss", label: string) => `
        <form method="post" action="/proposals/${p.id}/${verb}">
          <input type="hidden" name="csrf" value="${esc(csrf)}">
          <button type="submit" class="${verb}">${label}</button>
        </form>`;
  return `
      <div class="proposal">
        <p>${esc(p.summary)}</p>
        <div class="choices">${button("approve", "Do it")}${button("dismiss", "No")}</div>
      </div>`;
}

// "Due today", "Due in 6 days", "3 days overdue".
export function dueLabel(due: string, today: string): string {
  const d = daysBetween(today, due);
  if (d < 0) return `${count(-d, "day", "days")} overdue`;
  if (d === 0) return "Due today";
  if (d === 1) return "Due tomorrow";
  if (d < 14) return `Due in ${d} days`;
  return `Due ${shortDate(due)}`;
}

function relative(date: string, today: string): string {
  const d = daysBetween(today, date);
  if (d <= 0) return "Now";
  if (d === 1) return "Tomorrow";
  if (d < 14) return `In ${d} days`;
  return shortDate(date, date.slice(0, 4) !== today.slice(0, 4));
}

function past(date: string, today: string): string {
  const d = daysBetween(date, today);
  if (d <= 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d} days ago`;
  return shortDate(date, date.slice(0, 4) !== today.slice(0, 4));
}

function every(days: number): string {
  if (days % 365 === 0) return days === 365 ? "Every year" : `Every ${days / 365} years`;
  if (days === 91 || days === 92) return "Every 3 months";
  if (days === 182 || days === 183) return "Every 6 months";
  if (days === 30 || days === 31) return "Every month";
  if (days % 7 === 0) return days === 7 ? "Every week" : `Every ${days / 7} weeks`;
  return `Every ${days} days`;
}

const fmt = (opts: Intl.DateTimeFormatOptions) => (date: string) =>
  new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const shortDate = (date: string, withYear = false) =>
  fmt(withYear ? { month: "short", day: "numeric", year: "numeric" } : { weekday: "short", month: "short", day: "numeric" })(date);
const longDate = fmt({ weekday: "long", month: "long", day: "numeric" });

function greeting(name: string): string {
  return `Hi, ${name.split(" ")[0]}`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const ICON = {
  check: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
  home: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11l8-6.5 8 6.5"/><path d="M6 9.8V19a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9.8"/></svg>`,
};

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#c8553d"/><path d="M8 15.5l8-6.5 8 6.5M10.5 14v9h11v-9" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const CSS = `
:root {
  color-scheme: light dark;
  --bg: #f6f3ee; --surface: #ffffff; --surface-2: #f0ece5; --line: rgba(60, 45, 30, .10);
  --text: #23201c; --muted: #7a7268; --accent: #c8553d; --accent-ink: #ffffff;
  --late: #b4372a; --late-bg: #fbe5e1; --soon: #9a5b07; --soon-bg: #fbefd9; --ok: #3d6b4f; --ok-bg: #e3efe6;
  --shadow: 0 1px 2px rgba(40, 30, 20, .06), 0 6px 20px rgba(40, 30, 20, .06);
  --radius: 18px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #151413; --surface: #201e1c; --surface-2: #2a2725; --line: rgba(255, 245, 230, .08);
    --text: #f3eee8; --muted: #a39b91; --accent: #e07257; --accent-ink: #1a0f0b;
    --late: #ff8a78; --late-bg: #3a1f1a; --soon: #f2b75b; --soon-bg: #362a15; --ok: #8fc7a0; --ok-bg: #1d2e23;
    --shadow: none;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 16px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
main {
  max-width: 34rem; margin: 0 auto;
  padding: max(12px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) calc(32px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
}
.top { display: flex; align-items: center; justify-content: space-between; padding: 8px 0 4px; }
.brand { display: flex; align-items: center; gap: 8px; font-weight: 650; letter-spacing: -.01em; }
.logo { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; background: var(--accent); color: var(--accent-ink); }
.who, .avatar {
  display: grid; place-items: center; border-radius: 50%; background: var(--surface-2); color: var(--muted);
  font-weight: 600; letter-spacing: .02em;
}
.who { width: 34px; height: 34px; font-size: 13px; }
.hero { padding: 22px 2px 6px; }
.date { margin: 0; color: var(--muted); font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; }
h1 { margin: 4px 0 6px; font: 700 32px/1.1 ui-rounded, -apple-system, "SF Pro Rounded", system-ui, sans-serif; letter-spacing: -.02em; }
.summary { margin: 0; color: var(--muted); font-size: 17px; }
h2 { margin: 30px 4px 10px; font-size: 20px; font-weight: 700; letter-spacing: -.01em; }
.card {
  background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow);
  padding: 16px 16px 14px; margin-bottom: 12px; border: 1px solid var(--line);
}
.card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.pill { font-size: 13px; font-weight: 650; padding: 4px 10px; border-radius: 999px; }
.pill.late { color: var(--late); background: var(--late-bg); }
.pill.soon { color: var(--soon); background: var(--soon-bg); }
.pill.ok { color: var(--ok); background: var(--ok-bg); }
.owner { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 14px; }
.avatar { width: 24px; height: 24px; font-size: 11px; }
h3 { margin: 12px 0 2px; font-size: 19px; line-height: 1.25; font-weight: 650; letter-spacing: -.01em; }
.item { margin: 0; color: var(--muted); font-size: 14px; }
.steps { margin: 12px 0 0; border-top: 1px solid var(--line); padding-top: 10px; }
.steps summary { cursor: pointer; color: var(--muted); font-size: 14px; font-weight: 600; list-style: none; }
.steps summary::-webkit-details-marker { display: none; }
.steps summary::after { content: "›"; display: inline-block; margin-left: 6px; transition: transform .15s; }
.steps[open] summary::after { transform: rotate(90deg); }
.steps ol { margin: 8px 0 0; padding-left: 22px; }
.steps li { margin: 4px 0; padding-left: 2px; }
.steps li::marker { color: var(--muted); font-variant-numeric: tabular-nums; }
.done { display: flex; gap: 8px; margin-top: 14px; }
.done input {
  flex: 1; min-width: 0; font: inherit; font-size: 16px; color: var(--text);
  background: var(--surface-2); border: 1px solid transparent; border-radius: 12px; padding: 11px 12px;
}
.done input::placeholder { color: var(--muted); }
.done input:focus { outline: none; border-color: var(--accent); }
.done button {
  display: flex; align-items: center; gap: 6px; flex: none; cursor: pointer;
  font: inherit; font-weight: 650; color: var(--accent-ink); background: var(--accent);
  border: 0; border-radius: 12px; padding: 11px 16px; transition: transform .08s, filter .15s;
}
.done button:hover { filter: brightness(1.05); }
.done button:active { transform: scale(.97); }
.group { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); border: 1px solid var(--line); overflow: hidden; }
.list { list-style: none; margin: 0; padding: 0; }
.row { display: flex; align-items: center; gap: 12px; padding: 13px 16px; }
.row + .row { border-top: 1px solid var(--line); }
.row-main { flex: 1; min-width: 0; }
.row-title { font-weight: 550; line-height: 1.3; }
.row-sub { color: var(--muted); font-size: 14px; margin-top: 2px; }
.row-when { flex: none; color: var(--muted); font-size: 14px; font-variant-numeric: tabular-nums; }
.tick { display: grid; place-items: center; flex: none; width: 26px; height: 26px; border-radius: 50%; color: var(--ok); background: var(--ok-bg); }
.tick svg { width: 15px; height: 15px; }
.empty { text-align: center; padding: 26px 16px; background: var(--surface); border-radius: var(--radius); border: 1px solid var(--line); }
.empty p { margin: 8px 0 0; color: var(--muted); font-weight: 550; }
.empty-mark { display: inline-grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; color: var(--ok); background: var(--ok-bg); }
.muted { color: var(--muted); }
.pad { margin: 0; padding: 14px 16px; }
.ask { display: flex; gap: 8px; align-items: flex-end; }
.ask textarea {
  flex: 1; min-width: 0; font: inherit; font-size: 16px; color: var(--text); resize: vertical;
  background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 11px 12px; box-shadow: var(--shadow);
}
.ask textarea::placeholder { color: var(--muted); }
.ask textarea:focus { outline: none; border-color: var(--accent); }
.ask button, .proposal button.approve {
  flex: none; cursor: pointer; font: inherit; font-weight: 650; color: var(--accent-ink); background: var(--accent);
  border: 0; border-radius: 12px; padding: 11px 16px;
}
.exchange { margin-top: 14px; display: flex; flex-direction: column; gap: 6px; }
.bubble { margin: 0; padding: 9px 13px; border-radius: 16px; max-width: 88%; line-height: 1.35; }
.bubble.me { align-self: flex-end; background: var(--accent); color: var(--accent-ink); border-bottom-right-radius: 5px; }
.bubble.rosie { align-self: flex-start; background: var(--surface); border: 1px solid var(--line); border-bottom-left-radius: 5px; }
.bubble.error { color: var(--late); }
.proposal {
  display: flex; align-items: center; gap: 10px; justify-content: space-between;
  background: var(--surface-2); border-radius: 14px; padding: 10px 12px;
}
.proposal p { margin: 0; font-size: 15px; }
.proposal .choices { display: flex; gap: 6px; flex: none; }
.proposal form { margin: 0; }
.proposal button { padding: 8px 12px; font-size: 14px; }
.proposal button.dismiss {
  cursor: pointer; font: inherit; font-size: 14px; font-weight: 600; color: var(--muted);
  background: transparent; border: 1px solid var(--line); border-radius: 12px;
}
.proposal .state { flex: none; color: var(--muted); font-size: 13px; font-weight: 600; }
.proposal.applied .state { color: var(--ok); }
.proposal.failed .state { color: var(--late); flex: 0 1 auto; }
@media (min-width: 720px) { main { padding-top: 32px; } h1 { font-size: 38px; } }
`;
