# Home Slice — Proposal

*A household management engine that powers your Notion Home Hub.*
*Drafted June 2026 from a full audit of the Dahl-Berger Home Hub workspace + research on the home-management tool landscape and the current Notion platform.*

---

## TL;DR

Keep Notion as the thing you and Carly touch — the frontend **and** the database. Build a small self-hosted service (**the Home Slice engine**) that runs on the Proxmox box, listens to Notion's native webhooks, and does everything Notion can't: recurring maintenance generation, AI photo-to-inventory logging, automatic manual (PDF) fetching, Home Assistant integration, integrity sweeps, and nightly backups so you never get Centriq'd.

Don't adopt HomeBox or Grocy as the system of record — that would make Notion a second-class mirror and fight your stated goal. Instead **steal their schemas** (HomeBox's item model, Micasa's schedule/log/vendor/quote ontology, Tody's decay-based dueness) and let Notion hold the data.

And Home Slice is more than maintenance: it's the family operating system — shared to-dos with assignees and chore rotation, renovation projects with budgets and quotes, shopping, events & gifts, documents, and subscriptions. The modules your installed templates promised but never delivered, built only where your family's actual usage history says they'll stick.

Seven phases, each independently useful, each shippable in an evening-to-a-weekend. Phase 0 requires zero code.

---

## 1. What you have today (the audit)

Four generations of systems are layered in the workspace:

| Generation | What | Status |
|---|---|---|
| 2022–2024 "moving era" | ~30 DBs: Chore lists, Stuff, Stuff Locations, Inventory, 2× Contacts, etc. | Dead |
| "HM" template (Feb 2025) | 12 DBs: HM Home Assets, Unified Storage, HM Documents, HM People Directory… | Demo data only, dead |
| "Home Hub" template by heyismail (Feb 2025) | M&R, To-Dos, Shopping, Finances, Meal Planning, Contacts + the Home Hub dashboard | Only **To-Dos** got real use (71 rows). Everything else is placeholder rows |
| **"Home Maintenance & Projects" template (Apr 2025)** | Home Inventory, Maintenance Log, Home Projects, Tasks, Vendors, Expenses, Categories, Locations | **The living system.** Real appliances, working next-due formulas, 119 Tasks, 40 Projects, 10 real Vendors, edits into 2026 |

Specific findings worth knowing:

- **The load-bearing core**: Home Inventory (12 real appliances — Miele Speed Oven, Fellow grinder, etc., with maintenance frequency + next-due formulas), Maintenance Log (6 entries, last 2026-04-15), Home Projects (40 real projects), Tasks (119 rows), Vendors (10 real contractors).
- **April 29, 2026 duplication event**: all 7 Home Hub template databases were re-duplicated wholesale. Every hub concept now exists twice; your 71 real To-Dos are stranded in the *old* copy while the new Shopping List copy got used exactly once.
- **Car Maintenance is a freeform note page** with real data (wiper blades, filters, odometer readings, receipt photos) that belongs in Maintenance Log.
- **Concept duplication count**: shopping lists ×5, contacts/people stores ×7, task systems ×6, maintenance trackers ×5, inventories ×6.
- **Schema hygiene**: trailing spaces in option names ("Completed ", "Dinner "), Finances' title property literally named `"name "`, typos ("Appartment", "Commertial"), 8 dead ghost columns on Home Projects, and the next-due formula logic duplicated in two places.

**Implication:** the foundation already exists — the Apr-2025 cluster is genuinely good and Carly clearly uses it. Home Slice should *consolidate onto it*, not start over.

## 2. What the market taught us

- **Micasa** (the TUI one) — terminal-only, no API, but the best maintenance ontology anywhere: `Schedule` (recurrence) separated from `JobHistory` (what actually happened, cost, who), plus `Vendors` and `Quotes` as first-class entities. Steal the model wholesale (Apache-2.0 Go structs).
- **HomeBox** — best open-source inventory: REST API, QR label printing, and the canonical item schema (`assetId, serialNumber, modelNumber, manufacturer, purchaseFrom, purchaseTime, purchasePrice, location-tree, labels, importRef`). The `importRef` idempotency-key pattern is exactly how the engine should upsert into Notion. Its companion app (**homebox-companion**) proves the AI photo-logging loop works with off-the-shelf vision models.
- **Centriq is dead** (Jan 2025, all user data deleted). Its killer feature — photograph the appliance nameplate → AI extracts make/model/serial → auto-fetches the manual PDF, parts lists, and recommended maintenance — is the single best idea to replicate, and **nobody open-source does the manual-fetch step yet**. Its death is also the argument for the nightly-backup phase.
- **Homer** (homer.co) — Centriq's SaaS successor and the closest commercial embodiment of Home Slice: AI interprets photos/receipts/documents, files them, sets reminders, and a bot answers questions from *your* saved manuals. No API, data locked in. Treat it as the UX benchmark.
- **Tody** — models chores as a *freshness value that decays since last completion* rather than calendar due dates. Far better mental model for "clean the gutters"-type upkeep; trivially expressible as a Notion formula or engine-computed property.
- **Grocy / ha-llmvision** — Grocy only if you later want consumables/grocery stock tracking; **ha-llmvision** (Home Assistant + any vision LLM, including local) is a ready-made photo→JSON ingest path that plugs into the home lab you already run.
- **Home Maint List** — free curated library of standard home maintenance tasks + seasonal schedules. Perfect seed data so you don't invent "flush the water heater annually" from scratch.

## 3. What Notion can do now (June 2026)

The cutting-edge tools you asked about, and they matter a lot for this design:

- **Native integration webhooks (GA)** — `page.created`, `page.properties_updated`, `data_source.content_updated`, comments, etc. Sparse payloads (you re-fetch values), at-most-once delivery, events within ~1–5 min, **author field tells you human vs. bot** (kills echo loops). This is the backbone of "edit in Notion → things happen."
- **Data sources API (2025-09-03)** — databases are now containers of data sources; the engine keys everything off `data_source_id`s.
- **File Upload API (GA)** — PDFs up to 5 GiB on paid plans, multipart for >20 MiB. Manuals can live *in* Notion with inline preview.
- **Database automations + buttons (Plus plan)** — "property edited / page added / every Monday" triggers with a **Send webhook** action. Buttons Carly can press that POST straight to the engine. This is her automation playground, kept fully native.
- **Formulas 2.0, charts, forms, custom page layouts** — dashboard polish; forms are a zero-login intake surface.
- **Notion AI / custom agents are Business-plan only** (credit-billed since May 2026) — for a family workspace, your own engine calling the Claude API is the AI layer. The 3.5 release's Database Sync (Beta) and Notion Workers are worth watching but are beta/credit-metered; the proposal doesn't depend on them.
- **Plan note:** Plus now has unlimited guests (Mar 2026). One paid member + family-as-guests is the cheap sweet spot, and Plus unlocks the automations + big file uploads the design uses.
- **Rate limit** is ~3 req/s — fine for a household, but it's why the engine keeps a shadow mirror instead of re-reading everything constantly.

## 4. Architecture

```
┌─────────────────────────── Notion (frontend + database) ───────────────────────────┐
│  Home Hub dashboard · Items · Locations · Schedules · Maintenance Log · Projects   │
│  Tasks · Vendors · Quotes · Documents · Inbox (photo drops / forms)                 │
│  Native: buttons, automations (Carly's domain), formulas, charts, layouts          │
└───────────────┬─────────────────────────────────────────────▲──────────────────────┘
                │ webhooks (changes, button POSTs)             │ writes (3 req/s budget)
                ▼                                              │
┌────────────────────────── Home Slice engine (Proxmox LXC) ──────────────────────────┐
│  webhook receiver (Cloudflare Tunnel / Tailscale Funnel) → queue → workers          │
│  shadow mirror (SQLite) · reconciliation poller · nightly backup (the anti-Centriq) │
│  recurrence scheduler (Micasa model) · dueness decay (Tody model)                   │
│  AI ingest: nameplate/room photos → Claude vision → Items   (Centriq model)         │
│  manual fetcher: make+model → web search → PDF → Notion upload + MinIO/Paperless    │
│  integrations: Home Assistant (runtime-hours → filter tasks), QR labels, email-in   │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

**Ground rules** (these prevent every classic two-way-sync disaster):

1. **Notion is the system of record** for everything human-facing. The engine's SQLite is a *shadow mirror* for diffing, integrity sweeps, and backup — never a competing truth.
2. **Every property has exactly one writer.** Humans own `Status`, names, notes; the engine owns `Next Due`, `Dueness`, `Engine ID`, `Last Synced`, `Engine Note`. Neither writes the other's columns.
3. **Webhook-primary, poll-backstop.** React to webhooks; reconcile with a `last_edited_time` poll every 10 min; full resync nightly. Filter events authored by the engine's own bot ID.
4. **`Engine ID` (a UUID in a rich-text property) is the canonical key**, not the Notion page ID — so the whole thing survives being duplicated as a template.
5. **Carly's native automations stay native.** The engine never replaces a button or automation she builds; it subscribes underneath them.

## 5. Target data model (Home Slice template v1)

Consolidate onto the living Apr-2025 cluster, renamed and extended:

| Data source | Origin | Key additions |
|---|---|---|
| **Items** | existing Home Inventory | HomeBox fields: Serial #, Model #, Manufacturer, Purchased From/Date/Price, Asset Tag, Photo, `Engine ID` |
| **Locations** | existing (8 rows) | self-relation for nesting (House → Kitchen → Under-sink) |
| **Schedules** | *new* — split out of the inventory formulas | recurrence rule, source (manufacturer/seasonal/custom), per-item or per-location, Dueness (engine-computed decay) |
| **Maintenance Log** | existing | Vendor relation, Cost, link to Schedule; absorbs the Car Maintenance page (cars become Items) |
| **Projects** | existing (40 rows) | ghost columns dropped |
| **Tasks** | existing (119 rows) | absorbs the stranded 71 To-Dos; gains **Assignee** (person), Source (chore / maintenance / project / ad-hoc), Recurrence; per-person "My tasks" views |
| **Vendors** | existing (10 rows) | absorbs Service Providers + real contacts |
| **Quotes** | *new* (Micasa) | Vendor + Project relations, amount, status — quote comparison |
| **Documents** | *new* | manuals, receipts, warranties; file property + external URL to self-hosted copy; relations to Items |
| **Inbox** | *new* | photo/note drops from phones + form submissions; `Status: New → Processed` drives the AI ingest |
| **Events & Gifts** | *new* — absorbs legacy Xmas/Presents lists + HM Presents planners | birthdays, celebrations, gift ideas per person, lead-time for "buy by" tasks |
| **Subscriptions** | *new* — absorbs HM Recurring Payments + legacy Subscription tracker | renewal date, cost, payment method, cancel-by reminders |

### 5b. The family layer

Maintenance is half the platform; the other half is what the family-management apps (Maple, Jam, HomeChart, Skylight) sell — and your own history shows which parts your household genuinely uses. The 2023 Home Wiki, built under the pressure of an actual move, had real activity in: Chore Tracker, Groceries, Recipes, gift lists, trip planning, and pet care (Rocky). Meanwhile Meal Planning and full Finances databases were installed twice via templates and never got a single real row. Build accordingly:

- **Shared to-dos (core, Phase 1):** one Tasks database for everything, with Assignee person properties. Views: "My tasks" (filtered to @Me), a weekly board grouped by person, "Today" sorted by dueness. Native Plus automations notify the assignee on assignment and on due date — no engine needed for that part.
- **Chore rotation (engine, Phase 3):** recurring chores alternate assignee automatically (Tody-style dueness decay + Micasa-style history). Completing "Take out compost" spawns the next occurrence, assigned to the other adult.
- **Projects & renovations (Phase 1 polish, engine in Phase 3):** Home Projects already holds 40 real projects (Deck Replacement, Historical Renovations…). Elevate it to a renovation pipeline: `Idea → Scoping → Getting quotes → Scheduled → In progress → Done`, Budget vs Actual rollups, Quotes + Vendors relations, Documents (permits, contracts, drawings), before/after photos, task breakdowns. Engine adds: quote-comparison summaries, budget-overrun flags, "stale project" nudges after 60 quiet days.
- **Events & gifts (Phase 1 schema, engine in Phase 3):** birthdays/anniversaries with lead-time logic — the engine files "order gift" tasks 2–3 weeks ahead and pushes the date to the family calendar.
- **Subscriptions (Phase 1 schema, engine in Phase 3):** renewal-date tracking with cancel-by reminders; later, receipt parsing (Phase 4) can update costs automatically.
- **Shopping list (keep native):** the one hub database with recent real use. Quick-add buttons + a phone-friendly view; optional later trick — two-way sync with Home Assistant's shopping list so it's voice-addable.
- **Pets, documents, contacts:** Pets get care Schedules like any other "asset you love" (Rocky's grooming = the furnace filter's cousin); Documents becomes the single home for insurance/legal/manuals; Vendors+Contacts consolidate the seven scattered people stores.
- **Parked until someone owns them:** Meal planning and full finance tracking. Two template installs, zero real rows — the spine supports adding them later, but building them now would just recreate the mess.

## 6. The phases

Sized honestly for a household that moves slowly: each phase is useful on its own, and nothing breaks if you stop after any of them.

### Phase 0 — Consolidate (no code, ~one afternoon with Claude driving the official `ntn` CLI)
Archive the dead weight; make the hub trustworthy again.
- Archive: both Finances, both Meal Plannings, both Family & Contacts, both Maintenance & Repairs, the Apr-2026 duplicate generation, the entire HM cluster, ~30 legacy 2022–24 DBs (archive = move under one "🗄 Archive" page; nothing deleted).
- Migrate: 71 To-Dos → Tasks; Car Maintenance page → Maintenance Log entries (cars added as Items); Service Providers → Vendors.
- Fix hygiene: trailing-space options, `"name "`, typos, ghost columns.
- Rebuild the Home Hub dashboard so every linked view points at the one living cluster.
- **Done when:** there is exactly one database per concept and the dashboard reflects reality.

### Phase 1 — Schema v1 + seed data (a weekend, still ~no code)
Build the target model above in Notion.
- Add HomeBox-style fields to Items; create Schedules, Quotes, Documents, Inbox, Events & Gifts, Subscriptions; add `Engine ID` / `Sync State` / `Last Synced` columns (engine-owned, hidden in default views).
- Family layer: Assignee on Tasks, "My tasks" / weekly-board views, renovation pipeline statuses + budget fields on Projects.
- Seed Schedules from a standard home-maintenance library (Home Maint List-style seasonal tasks) + your real appliances' frequencies.
- Set up Carly-facing native automations and buttons ("Log maintenance" button that stamps a log row, notify-assignee automations, etc.) on the Plus plan.
- **Done when:** the family can run the whole system manually — including assigning each other tasks — and it's already better than today.

### Phase 2 — Engine v0: read-only safety net (a weekend of code)
Stand up the service skeleton; earn trust before it writes anything.
- LXC/container on Proxmox; TypeScript/Bun or Go service; internal Notion integration scoped to the Home Hub page; pinned API version; `data_source_id` registry.
- Webhook endpoint via Cloudflare Tunnel or Tailscale Funnel, signature verification, event queue; 10-min reconciliation poller; SQLite shadow mirror.
- **Nightly backup**: full export of every data source (rows + page content + files) to versioned local storage. This is the anti-Centriq insurance and is valuable forever, even if the project stops here.
- **Done when:** you can `sqlite3` your whole house, and a deleted-by-accident page is recoverable from last night's snapshot.

### Phase 3 — Engine v1: the recurrence brain (1–2 weekends)
First writes — replace the fragile formula logic with real scheduling.
- Scheduler walks Schedules + Maintenance Log nightly: computes next-due, creates Task rows when due, updates `Dueness` (Tody-style decay 0–100%) so the dashboard sorts by "what's most overdue".
- Chore rotation: recurring chores alternate Assignee automatically on completion.
- Lead-time logic: gift "buy by" tasks 2–3 weeks before Events & Gifts dates; cancel-by reminders from Subscriptions; stale-project and budget-overrun nudges on the renovation pipeline.
- "Mark serviced" button → Notion automation Send-webhook → engine writes the log entry, recomputes, closes the task.
- Integrity sweeps: orphaned relations, duplicate Engine IDs, dangling docs → flagged in an "Engine Report" page, never auto-deleted.
- **Done when:** maintenance tasks appear on their own and nobody maintains date formulas by hand.

### Phase 3.5 — Family calendar bridge (a weekend)
Put household work where the family already looks: the calendar.
- Engine creates a dedicated "Home Slice" Google Calendar and two-way syncs it via the GCal API (free, push notifications, generous limits): dated Tasks, renovation milestones, Events & Gifts → events; moving/completing an event in GCal updates the Notion row. GCal event IDs live in an engine-owned property (same idempotency pattern as everything else).
- Why the engine must do it: Notion Calendar is a real GCal client and can overlay Notion database rows, but no data flows between GCal events and database rows, Notion Calendar has no API, and Plus-plan automations can't touch Google Calendar.
- Payoff: maintenance shows up next to soccer practice on Carly's phone, in Notion Calendar's unified view, and on any wall display that subscribes to a Google Calendar (DAKboard, Skylight) — the Hearth/Skylight headline feature, fed by your own data, no subscription.
- **Done when:** "Furnace filter due" appears on the family Google Calendar without anyone typing it.

### Phase 4 — AI ingest: the Centriq trick (1–2 weekends, the fun one)
Make logging the house fast enough that it actually happens.
- Drop a photo into **Inbox** from the Notion mobile share sheet (or a form): nameplate close-up → Claude vision extracts `{manufacturer, model, serial}` → engine upserts the Item.
- Manual fetcher: make+model → web search → manual PDF → uploaded to Notion (File Upload API) **and** archived in MinIO/Paperless-ngx → Documents row related to the Item → manufacturer-recommended maintenance seeded into Schedules.
- Room-sweep mode: wide photo → bulk item candidates land in Inbox as drafts for approval (never silently into Items).
- Receipt photos → purchase info onto Items / log entries.
- **Done when:** new appliance → one photo → item + manual + schedule exist in under a minute.

### Phase 5 — Home-lab integrations (ongoing, pick-and-choose)
The tricks no consumer app can do, because you own the backend.
- **Home Assistant ↔ engine**: HVAC runtime hours → filter-change schedule acceleration; leak/battery sensors → instant Tasks; ha-llmvision as an alternative photo-ingest path.
- **QR labels** (HomeBox-style): printed sheets for breaker panel, appliances, storage bins — QR deep-links to the Notion item page.
- **"Ask the house"**: engine indexes the manual PDFs; a Claude agent (via Notion MCP or chat) answers "what size filter does the furnace take" from *your* documents — the Homer Helper Bot, self-hosted.
- **Email-forwarding ingest**: a unique inbound address for the household — forward a school email, contractor quote, or warranty confirmation and the engine parses it into Inbox drafts (events, tasks, documents) for one-tap approval. The fastest-converging feature in the family-app market (Jam, Cozi Max, Skylight, Maple, Ohai all ship it), and the Milo post-mortem says: extract + confirm, never auto-commit.
- **Weekly family digest**: cron job renders "the week ahead" (calendar, due maintenance, assigned tasks, gift deadlines) to email and a Notion page. Cozi has proven demand for 20 years.

### Phase 6 — Productize the template (optional)
If Home Slice works for your house, it works for others': layouts, charts, onboarding page, template duplication + engine pairing flow (the `Engine ID` convention already makes the template portable). Decide then whether it's a gift to the internet or a product.

## 7. Risks & open decisions

| Decision | Recommendation |
|---|---|
| Workspace plan | **Confirmed Plus** — custom automations, webhook actions, and big file uploads are available. One member + unlimited guests is enough |
| Carly's access level | Person properties (Assignee) and notify-assignee automations need her as a member or guest with edit access to the hub — verify her current role before Phase 1 |
| Webhook exposure | Cloudflare Tunnel (you likely have CF already) or Tailscale Funnel; never a raw open port |
| Engine language | Whatever you'll actually maintain. TypeScript/Bun with the official `@notionhq/client` v5 is the path of least resistance; Go if you want a single binary like Micasa/HomeBox |
| HomeBox as a component? | No for v1 — schema-steal only. Revisit if you ever want its QR/label printing UI instead of building Phase 5's |
| Notion 3.5 Workers / Database Sync | Watch, don't depend — beta + credit-metered. The self-hosted engine does the same job without metering |
| Family buy-in risk | Phases 0–1 deliver a cleaner manual system first; automation arrives only after the humans already like the structure |
| Rate limits | 3 req/s is plenty if writes are diff-gated through the shadow mirror; bulk operations queue with backoff |

## 8. Appendix: Notion CLI cheat sheet

The official `ntn` CLI stores multiple workspace-scoped credentials. Always target the Home Hub explicitly instead of relying on the current default:

```bash
ntn debug
alias home-notion='env -u NOTION_API_TOKEN NOTION_WORKSPACE_ID=affa2fca-5d34-4abf-8105-7405cf46fab9 ntn'

home-notion api v1/search -X POST --data '{"query":"Home Slice","page_size":50}'
home-notion pages get <page-id>                        # read Markdown + frontmatter
home-notion pages edit <page-id> < doc.md              # replace page Markdown
home-notion datasources query <data-source-id> --limit 100 --json
home-notion datasources resolve <database-id> --json
home-notion api v1/data_sources/<id> -X GET             # raw API escape hatch
home-notion api ls                                     # live endpoint inventory
```

Key IDs discovered (the living cluster):

| Thing | ID |
|---|---|
| Home Slice page | `2bd38456-58d7-8074-b874-f3b9f40e705f` |
| Home Hub dashboard | `19e38456-58d7-8073-98e0-eda9f25ebc6a` |
| Home maintenance & projects dashboard | `1d538456-58d7-8024-b3bd-f79c6b0b0dca` |
| Home Inventory data source | `1d538456-58d7-8138-8524-000b0a066510` |
| Maintenance Log data source | `1d538456-58d7-81e5-be61-000b6fc80578` |
| Home Projects data source | `1d538456-58d7-8196-80d4-000bdbb2f9a9` |
| Tasks data source | `1d538456-58d7-81fe-af5c-000bfc7fc531` |
| To-Dos (original, 71 real rows) | `19e38456-58d7-817a-b739-000b33d7bfea` |
