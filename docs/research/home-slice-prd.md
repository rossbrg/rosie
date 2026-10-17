# PRD: Home Slice — household platform on Notion + self-hosted engine

## Problem Statement

Our household runs on Notion, but the home-management side is four generations of half-adopted templates: five shopping lists, seven contact stores, six task systems, real car-maintenance records living in a freeform note, and 71 active to-dos stranded in a duplicated database. Maintenance depends on hand-maintained date formulas; nothing reminds us until something breaks. Cataloging what we own — serial numbers, manuals, warranties — is so tedious it never happens, so every repair starts with "where's the manual?" Household work isn't visible where the family actually looks (the shared calendar), assignment between two adults is ad-hoc, and renovation projects are tracked with willpower. Commercial apps that solve slices of this (Homer, Skylight, Maple, Cozi) each demand another app, another subscription, and a data silo — and Centriq's shutdown deleted its users' data, which is exactly the risk we won't accept.

## Solution

Home Slice keeps Notion as the family's single surface — the frontend *and* the system of record — and adds a self-hosted engine (on the existing Proxmox home lab) that does what Notion can't. The family edits pages, presses buttons, and builds native automations exactly as they do today; the engine listens through Notion's webhooks and quietly handles recurrence, chore rotation, AI-assisted logging (photo of a nameplate → item + manual + maintenance schedule), email-forward ingest with human approval, a two-way Google Calendar bridge, Home Assistant integration, weekly digests, integrity sweeps, and nightly full backups. One consolidated set of databases replaces the template graveyard. The engine never overwrites a human edit and every AI action lands as a draft to approve — Notion stays trustworthy, the robots stay helpful.

## Phases and Feature Sets

| Phase | Feature set | What the user gets |
|---|---|---|
| P0 Consolidate | Workspace cleanup (no code) | One database per concept; dashboard reflects reality; old data archived, not deleted |
| P1 Schema v1 | Canonical data model + family layer (no code) | Items, Schedules, Quotes, Documents, Inbox, Events & Gifts, Subscriptions; Assignee + per-person views; native buttons/automations |
| P2 Engine v0 | Read-only safety net | Nightly backups, shadow mirror, webhook plumbing, Engine Report |
| P3 Recurrence brain | First engine writes | Auto-created maintenance tasks, dueness decay, chore rotation, gift/subscription lead-times, integrity sweeps |
| P3.5 Calendar bridge | Family calendar | Household work on shared Google Calendar, two-way; wall-display-ready feed |
| P4 AI ingest | Fast logging | Nameplate photo → item; manual auto-fetch; room sweep; receipt parsing; email-forward ingest — all approve-before-commit |
| P5 Home-lab + assistant | The uncontested ground | Home Assistant triggers, QR labels, "ask the house" Q&A over manuals, weekly digest |
| P6 Productize | Optional | Template + engine pairing for other households |

## User Stories

Tagged with the phase that delivers them.

### Inventory & items
1. As a homeowner, I want to photograph an appliance's nameplate and have the item created with make, model, and serial, so that cataloging takes seconds instead of minutes. [P4]
2. As a homeowner, I want the manual PDF automatically found and attached to each item, so that I never hunt for documentation again. [P4]
3. As a homeowner, I want every item to live in a nested location tree, so that I can find where anything is stored. [P1]
4. As a homeowner, I want purchase info (price, date, store, receipt) on items, so that warranty and insurance claims are easy. [P1]
5. As a homeowner, I want warranty expiries visible and alerted ahead of time, so that I use coverage before it lapses. [P3]
6. As a homeowner, I want QR labels for items, bins, and panels, so that scanning a sticker opens the item's page. [P5]
7. As a homeowner, I want a room-sweep mode where one wide photo yields draft items for approval, so that bulk cataloging is feasible. [P4]
8. As a homeowner, I want receipt photos parsed into purchase records, so that costs stay accurate without typing. [P4]

### Maintenance
9. As a homeowner, I want maintenance schedules kept separate from the log of what actually happened, so that plans and history don't blur. [P1]
10. As a homeowner, I want tasks created automatically when maintenance comes due, so that nothing depends on memory or formulas. [P3]
11. As a family member, I want a dueness meter that decays since last service, so that the dashboard shows what's most overdue at a glance. [P3]
12. As a homeowner, I want a "Mark serviced" button that writes the log entry and recomputes the next due date, so that closing the loop is one tap. [P3]
13. As a homeowner, I want manufacturer-recommended schedules seeded when an item is added, so that I don't research service intervals. [P4]
14. As a homeowner, I want a standard seasonal maintenance library preloaded, so that the obvious tasks are covered from day one. [P1]
15. As a homeowner, I want vehicle maintenance in the same system as house maintenance, so that the cars aren't a separate notebook. [P0]
16. As a homeowner, I want HVAC runtime hours to accelerate the filter-change schedule, so that maintenance reflects actual usage, not just the calendar. [P5]
17. As a homeowner, I want leak and battery sensors to file tasks instantly, so that the house reports its own problems. [P5]

### Projects & renovations
18. As a homeowner, I want a renovation pipeline from idea through quotes to done, so that projects progress visibly instead of stalling silently. [P1]
19. As a homeowner, I want budget vs actual tracked per project, so that overruns surface early. [P1]
20. As a homeowner, I want quotes compared side by side per project, so that vendor selection is informed. [P1]
21. As a homeowner, I want vendor service history (who did what, when, for how much), so that rehiring decisions are easy. [P1]
22. As a homeowner, I want permits, contracts, and drawings attached to their project, so that paperwork is findable years later. [P1]
23. As a homeowner, I want stale projects flagged after weeks of inactivity, so that stalled work resurfaces on its own. [P3]

### Shared to-dos & chores
24. As a family member, I want tasks assigned to me with a "My tasks" view, so that I always know what's mine. [P1]
25. As a family organizer, I want assigning a task to notify the assignee, so that delegation actually lands. [P1]
26. As a couple, we want recurring chores to rotate assignee automatically, so that the load stays fair without negotiation. [P3]
27. As a family member, I want a weekly board grouped by person, so that the week's split is visible to everyone. [P1]
28. As a family organizer, I want quick-add buttons that work well on mobile, so that capturing a task is one tap. [P1]

### Family calendar
29. As a family member, I want due household work on our shared Google Calendar, so that it appears next to soccer practice in the app I already check. [P3.5]
30. As a family member, I want moving or completing a calendar event to update the Notion row, so that I can manage from whichever surface I'm in. [P3.5]
31. As a family organizer, I want each member color-coded on the calendar, so that the week reads at a glance. [P3.5]
32. As a family organizer, I want school and team ICS calendars merged into the family view, so that all commitments live in one place. [P3.5]
33. As a family, we want a calendar feed any wall display can subscribe to, so that a kitchen screen works without another subscription. [P3.5]

### Events & gifts
34. As a family organizer, I want birthdays and anniversaries tracked with lead-time "order gift" tasks, so that gifts are never last-minute. [P3]
35. As a family organizer, I want gift idea lists per person captured year-round, so that December starts with a head start. [P1]

### Shopping
36. As a family member, I want shared shopping lists that work well on a phone in a store, so that one run covers everyone's needs. [P1]
37. As a family member, I want recurring staples re-added with one tap, so that the list mostly builds itself. [P1]

### Subscriptions & documents
38. As a homeowner, I want renewal dates with cancel-by reminders, so that unwanted subscriptions die before they charge. [P3]
39. As a homeowner, I want one Documents home for insurance, legal papers, manuals, and receipts, so that any paper is one search away. [P1]
40. As a homeowner, I want documents stored both in Notion and on my own server, so that no vendor shutdown can take them from me. [P4]

### AI assistant & ingest
41. As a family organizer, I want to forward an email to a household address and get draft events/tasks to approve, so that inbox-to-system is one forward. [P5]
42. As a family organizer, I want to snap a school flyer and get a draft event, so that paper never has to be typed. [P5]
43. As a family member, I want every AI-created record to arrive as a draft requiring approval, so that the system never invents commitments. [P4]
44. As a homeowner, I want to ask questions answered from my own manuals ("what size filter does the furnace take?"), so that the documentation works for me. [P5]
45. As a family, we want a weekly digest of the week ahead — calendar, due maintenance, assignments, gift deadlines — so that Sunday planning is read-only. [P5]

### Operations & trust
46. As a household admin, I want nightly full backups of every row, page, and file, so that the system survives any failure, including Notion itself. [P2]
47. As a household admin, I want an Engine Report page listing errors and integrity issues, so that engine health is visible inside Notion. [P2]
48. As a family member, I want the engine to never overwrite my manual edits, so that trust in editing anything by hand is absolute. [P2]
49. As a family organizer, I want my native Notion buttons and automations to keep working alongside the engine, so that I can automate my own way without code. [P1]
50. As a household admin, I want all sync keyed by stable engine-owned IDs, so that duplicating or restructuring the template never breaks anything. [P2]

## Implementation Decisions

**Architecture ground rules**
- Notion is the system of record for all human-facing data. The engine keeps a shadow mirror (SQLite) strictly for diffing, integrity sweeps, and backup — never a competing truth.
- Every property has exactly one writer: humans own status/names/notes; the engine owns computed fields (`Next Due`, `Dueness`, `Engine ID`, `Last Synced`, `Engine Note`). Neither side writes the other's columns.
- Change detection is webhook-primary (Notion integration webhooks, signature-verified, queued), with a reconciliation poll (~10 min) as backstop for at-most-once delivery, and a nightly full resync. Events authored by the engine's own bot are dropped to prevent echo loops.
- All rows carry an `Engine ID` (UUID in a rich-text property) as the canonical key; Notion page IDs are treated as unstable.
- All AI output lands as drafts in the Inbox data source with `Status: New → Approved/Rejected`; the engine only materializes approved drafts. No autonomous commits (the Milo lesson).
- Explicit user commands flow through Notion buttons → native automation "Send webhook" actions → engine HTTP endpoints (Plus plan confirmed). Passive sync flows through integration webhooks. These are deliberately separate channels: commands are immediate and intentional; sync is eventual.

**Modules** (deep modules, simple stable interfaces; confirmed with user)
- `engine-core` — queue, cron, config, logging, Engine Report writer.
- `notion-mirror` — encapsulates all Notion API concerns (webhook intake, polling, shadow store, rate budget ~3 rps with token bucket, diff-gated writes, echo suppression, data-source registry pinned to API version 2025-09-03+). Interface: emits `onChange(entity)`; accepts `upsert(draft)`.
- `scheduler` — pure recurrence logic: `(schedules, history, now) → actions` covering next-due computation, dueness decay (0–100%), chore rotation, and lead-time tasks (gifts, subscription cancel-by). No I/O.
- `calendar-bridge` — two-way sync against a dedicated "Home Slice" Google Calendar via the GCal API. Event↔row identity via GCal event ID stored in an engine-owned property. Conflict rule: most recent human edit wins regardless of surface; engine yields to humans on both sides.
- `ingest` — extraction adapters (nameplate photo, room sweep, receipt, forwarded email) → structured `Draft[]` via Claude vision/text. One interface regardless of source type.
- `manual-fetcher` — `(manufacturer, model) → Document` via web search + PDF retrieval.
- `document-store` — dual-write: Notion File Upload API + self-hosted store (MinIO or Paperless-ngx); maintains the searchable PDF index that powers Q&A.
- `ha-bridge` — Home Assistant webhook/event intake → scheduler inputs (runtime counters) or instant tasks (leak/battery).
- `digest` — renders the week-ahead digest to email and a Notion page on cron.
- `backup` — nightly versioned export of all data sources, page content, and files.

**Stack & deployment**
- TypeScript on Bun with the official Notion SDK (v5+, data sources API); single service in an LXC container on the existing Proxmox host; webhook exposure via Cloudflare Tunnel or Tailscale Funnel — no open ports.
- Claude API for vision/extraction/Q&A (family workspace is Plus; native Notion AI is Business-only and not depended on).

**Schema (ten data sources)**
- Items (HomeBox-style fields: serial, model, manufacturer, purchase provenance, asset tag), Locations (self-relation tree), Schedules (recurrence + source: manufacturer/seasonal/custom), Maintenance Log (history: what, when, cost, vendor), Projects (renovation pipeline: Idea → Scoping → Getting quotes → Scheduled → In progress → Done; budget vs actual), Tasks (single task store: Assignee, Source: chore/maintenance/project/ad-hoc), Vendors, Quotes, Documents, Inbox, Events & Gifts, Subscriptions. Existing live data (Home Inventory, Maintenance Log, Projects, Tasks, Vendors) is migrated in place, not rebuilt.
- Consolidation (P0) archives all superseded databases under one Archive page; nothing is deleted.

## Testing Decisions

- Tests assert external behavior only — given inputs/events, what records/actions result — never internal structure. A good test here reads like a household scenario ("descale logged today + bi-monthly frequency → next task due in two months, assigned to the other adult").
- Per user decision, **all custom modules get tests**: `scheduler` (pure-function unit tests — the cheapest, highest-value suite), `notion-mirror` (sync semantics against a fake Notion API server: idempotency, echo suppression, diff-gating, never-clobber-human rules, out-of-order webhook delivery), `ingest` (golden-fixture tests: sample nameplate/receipt/email fixtures → expected draft JSON), `calendar-bridge` (two-way idempotency and conflict rules against a fake GCal), plus `manual-fetcher`, `document-store`, `digest`, and `backup` (round-trip restore test — a backup that can't restore is not a backup).
- External services (Notion, Google Calendar, Claude, Home Assistant) are always faked at the HTTP boundary; no test may call a real API. Greenfield project — no prior art in-repo; fake-server + golden-fixture patterns are the established conventions to follow.

## Out of Scope

- Meal planning and full finance tracking (two template installs with zero real rows; the schema can host them later when someone owns them).
- Kid gamification (stars/points/rewards) — requires an always-on kid-facing touchscreen; Notion isn't that surface.
- Building or buying display hardware — instead, document a DAKboard/Home Assistant dashboard recipe that subscribes to the Home Slice calendar.
- Autonomous AI actions of any kind (auto-committing events, auto-replying, auto-purchasing).
- Location sharing / safety features.
- Adopting HomeBox/Grocy as runtime components (schema inspiration only).
- Dependence on Notion Workers / Database Sync / custom agents (beta, credit-metered, Business-gated).
- Multi-household SaaS operation — v1 serves one household; P6 productization is a separate future PRD.

## Further Notes

- Source artifacts: the phased proposal ("Home Slice — Engine Proposal"), the inventory-tools research, and the family-management market research all live as children of the Home Slice page in the Dahl-Berger Home Hub Notion workspace; local copies in the rosie working folder.
- Key market context: nobody in the family-app market does inventory/maintenance/renovations; nobody in the maintenance-tool market reaches the family calendar. The bridge between those worlds is the product.
- Pre-P1 verification: confirm Carly's access level (member or edit-guest) so Assignee properties and notifications reach her.
- Next step after this PRD: architecture/layout/system-setup plan (Notion workspace layout, engine service design, deployment topology).
