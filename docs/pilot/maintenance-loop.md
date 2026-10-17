# Pilot 1: recurring home maintenance loop

*Drafted 2026-10-17. First pilot workflow chosen by Ross (no school logistics in this household). Rosie is its own system: Notion is only an import source.*

Goal, from the [synthesis](../research/home-slice-family-harness-synthesis.md#a-focused-30-day-pilot): a real maintenance schedule creates one task, completing it writes a history record, the next due date comes from that completion, and a missed run raises an alert.

## What Notion has today (read 2026-10-17, read-only)

The April 2025 "Home maintenance & projects" cluster is still the living system:

- **Home Inventory** has grown past the June audit's 12 appliances and now includes the Mitsubishi mini-split system (3 heads), Bosch dishwasher, Samsung refrigerator, condensate pump, coffee brewer, deck, projector and tools. Each item has one `Maintenance frequency` select and formulas for `Last maintenance` / `Next due`.
- **Maintenance Log** holds real history, most recently "Replace dishwasher skirt" (2026-09-22), "Descale Coffee Brewer" (2026-04-15) and two dehumidifier cleanings (2026-01-14).
- **Tasks** holds recurring work as static pages. "Mini-Split Maintenance" is a checklist task with status Not started, no due date and no recurrence.

Why the current setup doesn't recur (and what Rosie's model fixes):

1. **One frequency per item.** The mini-split needs "vacuum allergy inserts every 3 months" *and* "replace inserts yearly", but it can only hold one value, so it's set to "As needed" and nothing ever comes due.
2. **Tasks don't recur.** Finishing "Mini-Split Maintenance" leaves nothing behind to create the next one.
3. **A completed task doesn't write the log.** Logging is a separate manual step, so `Next due` formulas fall behind reality.
4. **No owner.** Tasks have no assignee, so nobody is on the hook.
5. **Nothing notices silence.** If no one looks, nothing happens.

The connected Notion plan can't run SQL queries over databases through the MCP (Business plan only). Not a blocker: Rosie only needs a one-time read import, which page fetches handle.

## The first schedule

**Mini-split allergy inserts (MAC-408FT-E): vacuum every 3 months, replace yearly.** It's real, documented on the inventory page with part numbers and prices, currently has no due date, and it's low-risk to get wrong. A second schedule (dehumidifier tank cleaning, which already has history) can follow to test the "next due from last completion" path against existing log rows.

## Loop design

```
Schedule (item, what, every N, owner, checklist)          ← all records live in Rosie
   │  nightly check: last completion + interval ≤ today + lead time
   ▼
Occurrence created once (owner, due date, item, checklist)   ← idempotency key = schedule id + due date
   │  owner marks it done in Rosie
   ▼
Completion recorded (who, when, notes)                        ← read back, receipt in run log
   │
   ▼
Next due = completion date + interval   (not original due date + interval)

Heartbeat: if the nightly check doesn't run, or a task is overdue by > 14 days, send an alert.
```

Rosie owns every record in this loop in its own store (SQLite to start). Notion is a **read-only import source**: the items and history below are copied in once, with their Notion page URL kept as a source reference, and Rosie never writes back.

| Contract record | Lives in Rosie | Seeded from |
|---|---|---|
| Item | `items` | Home Inventory pages (name, brand, model, manual links) |
| Schedule | `schedules`: item, what, interval days, lead days, owner, checklist | written by hand for the pilot |
| WorkOccurrence | `occurrences`: schedule, due date, owner, status, idempotency key | created by the nightly job |
| Completion | `completions`: occurrence, completed by, completed at, notes | Maintenance Log rows for history |
| ActionRun / Receipt | `runs`: every job run, what it created or changed, errors | new |
| Person / Principal | `people`: Ross, Carly; one login each | new |

Approval: creating an occurrence and recording a completion are low-risk, reversible writes, so per the [agent-setup research](../research/home-family-agent-setup-research.md#4-put-a-real-approval-boundary-around-side-effects) they run automatically with a receipt. Nothing in this loop sends messages, buys parts or touches devices.

## Build steps

1. **Repo skeleton:** the Rosie service (data model, migrations, nightly job, run log) in this repo.
2. **Import:** one-time read of the mini-split, dehumidifier and their Maintenance Log rows from Notion into Rosie.
3. **Seed:** one schedule for the mini-split inserts (every 3 months), one for yearly replacement, and the dehumidifier tank.
4. **Minimal surface:** a small web page served over Tailscale where each person sees what's due, marks it done and sees history; reminders by email or push. This is a stand-in until the iOS app exists, not the product UI.
5. **Acceptance tests** (from the synthesis fixtures): a duplicate nightly run creates no second occurrence; a late completion moves the next due date from the completion; a failed write retries without duplicating; a skipped night raises the alert.
6. **Live for 30 days**, then review: did the work get done, by whom, any duplicates or misses, and was the web page enough or does the iOS app need to come sooner.

## Open questions

- Who owns the mini-split schedule, Ross or Carly?
- Where should the alert go (email, phone push, Home Assistant notification)?
