# Pilot 1: recurring home maintenance loop

*Drafted 2026-10-17. First pilot workflow chosen by Ross (no school logistics in this household).*

Goal, from the [synthesis](../research/home-slice-family-harness-synthesis.md#a-focused-30-day-pilot): a real maintenance schedule creates one task, completing it writes a history record, the next due date comes from that completion, and a missed run raises an alert.

## What Notion has today (read 2026-10-17, read-only)

The April 2025 "Home maintenance & projects" cluster is still the living system:

- **Home Inventory** has grown past the June audit's 12 appliances and now includes the Mitsubishi mini-split system (3 heads), Bosch dishwasher, Samsung refrigerator, condensate pump, coffee brewer, deck, projector and tools. Each item has one `Maintenance frequency` select and formulas for `Last maintenance` / `Next due`.
- **Maintenance Log** holds real history, most recently "Replace dishwasher skirt" (2026-09-22), "Descale Coffee Brewer" (2026-04-15) and two dehumidifier cleanings (2026-01-14).
- **Tasks** holds recurring work as static pages. "Mini-Split Maintenance" is a checklist task with status Not started, no due date and no recurrence.

Gaps that the loop has to close:

1. **One frequency per item.** The mini-split needs "vacuum allergy inserts every 3 months" *and* "replace inserts yearly", but it can only hold one value, so it's set to "As needed" and nothing ever comes due.
2. **Tasks don't recur.** Finishing "Mini-Split Maintenance" leaves nothing behind to create the next one.
3. **A completed task doesn't write the log.** Logging is a separate manual step, so `Next due` formulas fall behind reality.
4. **No owner.** Tasks have no assignee, so nobody is on the hook.
5. **Nothing notices silence.** If no one looks, nothing happens.

The connected Notion plan can't run SQL queries over databases through the MCP (Business plan only). That doesn't block the engine, which would use the Notion API with its own integration token.

## The first schedule

**Mini-split allergy inserts (MAC-408FT-E): vacuum every 3 months, replace yearly.** It's real, documented on the inventory page with part numbers and prices, currently has no due date, and it's low-risk to get wrong. A second schedule (dehumidifier tank cleaning, which already has history) can follow to test the "next due from last completion" path against existing log rows.

## Loop design

```
Schedule (item, what, every N, owner, checklist)
   │  nightly check: last completion + interval ≤ today + lead time
   ▼
Task created once (owner, due date, links to item + checklist)   ← idempotency key = schedule id + due date
   │  owner marks Done in Notion
   ▼
Completion → Maintenance Log row (who, when, schedule, item)      ← written by the engine, read back
   │
   ▼
Next due = completion date + interval   (not original due date + interval)

Heartbeat: if the nightly check doesn't run, or a task is overdue by > 14 days, send an alert.
```

Records, mapped to the synthesis's record contract:

| Contract record | Lives in | Change needed |
|---|---|---|
| Schedule | **new** Notion database `Schedules` | create: Name, Item (→ Home Inventory), Interval days, Lead days, Owner (person), Checklist (→ Tasks template page), Active |
| WorkOccurrence | existing **Tasks** | add `Schedule` relation, `Assignee` person, `Occurrence key` text |
| Completion | existing **Maintenance Log** | add `Schedule` relation, `Completed by` person, `Task` relation |
| ActionRun / Receipt | engine's own run log (SQLite) + a comment on the Task | new, outside Notion |

Approval: creating a task and writing a log row are low-risk, reversible writes, so per the [agent-setup research](../research/home-family-agent-setup-research.md#4-put-a-real-approval-boundary-around-side-effects) they can run automatically with a receipt. Nothing in this loop sends messages, buys parts or touches devices.

## Build steps

1. **Notion schema (you approve once):** add the `Schedules` database and the three new properties above. Nothing is deleted or moved.
2. **Seed:** one schedule for the mini-split inserts (3 months) and one for yearly replacement; optionally the dehumidifier.
3. **Engine v0:** a small service (Proxmox box, per the June proposal) with a nightly job that does the create → complete → log → next-due cycle against the Notion API, plus a run log and a heartbeat alert.
4. **Acceptance tests** (from the synthesis fixtures): duplicate nightly run creates no second task; a task completed late moves the next due date from the completion; a failed Notion write retries without duplicating; a skipped night raises the alert.
5. **Live for 30 days**, then review: did the tasks get done, by whom, how often did anyone touch a formula by hand, any duplicates or misses.

## Open questions

- Who owns the mini-split schedule, Ross or Carly?
- Where should the alert go (email, phone push, Home Assistant notification)?
