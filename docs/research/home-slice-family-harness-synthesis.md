# Home Slice — a family harness

Research and design synthesis, September 27, 2026. **Status: proposed direction, not an implemented system or a decision to fork an app.** This combines the June Home Slice research and PRD, the August family-agent safety research in Notion, the September family-hub/iOS/backend studies, and firsthand parent reports about family displays. Product features, pricing, project maturity, and vendor policies need refreshing before implementation or purchase. The June Notion inventory counts are historical audit observations, not a claim about today's workspace state.

## The product thesis

**Home Slice helps a family notice what matters, decide who owns it, and see that it actually got done.** Its technical core is an *agentic harness for a family*, in the sense of the harnesses around Claude Code and Codex: a persistent agent loop with context, instructions, tools, skills, an execution environment, permissions, sessions, and feedback on results. Mac, iOS, chat, and an optional shared display are ways to direct and supervise its work. “Harness” is the builder's architecture term, not the label a child or caregiver must learn.

The primary analogy is [Claude Code](https://code.claude.com/docs/en/overview) or the [Codex harness](https://developers.openai.com/api/docs/guides/agents-api/architecture) applied to household work. [Meta Muse](https://ai.meta.com/muse/) is a consumer-facing example of an agent directed across apps and devices, but public product pages do not describe its private harness design. Home Slice's distinct question is how an agent harness works for **several people sharing one household**, including children and caregivers with different access.

The June proposal treated Notion as the permanent frontend and system of record for all human-facing household data. That was a sensible way to improve the existing Home Hub without rebuilding it. The newer work suggests a broader design: **give each kind of record an explicit authority, and let Home Slice own the workflow that connects them.** Notion can remain the current home for inventory, maintenance, projects, documents, and the human-readable household manual. Calendar events remain owned by the shared calendar; Home Assistant owns device state and deterministic home control. The harness owns identity and authorization, incoming requests, proposals, approval state, jobs, action receipts, and the small amount of memory it is explicitly allowed to retain. A future native hub can replace a Notion surface without changing what a completed maintenance action means.

This is a change in product boundary, not a recommendation to migrate the household now. The first version should serve one real household and use stable IDs, exports, and household-scoped authorization so it could later support others. Multi-household operations, billing, and public hosting remain separate decisions.

## What “agentic harness” means here

Home Slice would provide an agent loop and task environment for household work. A person could say, “Sort out next week's school logistics,” and the agent could inspect permitted emails and calendar entries, identify missing details, propose events and tasks, wait for approval where needed, make authorized changes, read them back, and follow up on unresolved items. It should be possible to inspect and interrupt that work from another device.

The coding-agent analogy is concrete: the household's connected records and tools are the equivalent of a codebase and development tools; family rules and preferences are project instructions; reusable procedures are skills; a proposed calendar change is like a diff; approval precedes consequential writes; and a saved event, read-back, or completed maintenance record is the test result. The harness gives the model a repeatable **observe → plan → use tools → check outcome → repair or report** loop. A friendly chat screen alone would not supply that loop.

The harness therefore needs durable **tasks and sessions**, a **tool/skill registry** for household systems, **context and memory rules**, an **identity and policy broker**, **approval checkpoints**, **scheduling and background execution**, **receipts and an activity log**, and **verification/retry behavior**. These are runtime responsibilities. Notion, a calendar, and Home Assistant are connected tools or records. The native apps are clients for issuing goals, seeing progress, and intervening. The initial build can evaluate an existing agent runtime rather than inventing its model loop from scratch; Home Slice's own work would be the household context, tools, policy, and product experience.

Shared-family agency is the hard part. A task must have a requesting principal and an explicit household scope. The agent cannot turn one adult's private email or health data into another person's answer just because both belong to the same family. A shared display has much less authority than an authenticated phone. A caregiver's access can expire. Children can be household members without being autonomous agent operators. Family-wide actions need a policy for who can approve and who can see the result.

## What the prior work contributes

| Source | Durable finding | Implication |
|---|---|---|
| [Home Slice engine proposal](https://app.notion.com/p/Home-Slice-Engine-Proposal-37c3845658d7810b8908d7dfc47437ad) and [PRD](https://app.notion.com/p/Home-Slice-PRD-37c3845658d78197bb09cf95f64db3ce), June | The household had real inventory, maintenance, tasks, projects, and vendors amid duplicated templates. The proposal connected recurring upkeep, documents, AI intake, and the shared calendar. | Preserve and improve the living data. Re-audit live state before any consolidation; do not turn historical row counts into current facts. |
| [Family-management market scan](https://app.notion.com/p/Family-Management-Market-Research-June-2026-37c3845658d781cbbaa8d6d72f7f87de), June | Calendar, tasks, lists, meals, and flyer/email intake recur across products. Homer and inventory tools address a different slice: appliances, manuals, warranties, and upkeep. | The distinctive job is connecting family logistics with physical-home operations and closing the loop, not reproducing every app feature. |
| [Home & Family Agent Setup research](https://app.notion.com/p/Home-Family-Agent-Setup-Research-Notes-August-2026-3bf3845658d7818a9a38f36be5e97af2), August | One visible assistant can serve separately authorized zones. Use real identity, narrow tools, durable approvals, an action ledger, scoped memory, deterministic triggers, and independent failure alerts. | Build the harness around authority and receipts. A chat persona or room microphone cannot substitute for authentication. |
| September [family-hub foundation](https://app.notion.com/p/Family-hub-foundation-study-3e93845658d78192baa4e6a94188b814) and [backend studies](https://app.notion.com/p/Family-and-home-backend-study-3e93845658d781d5853effeb091537e0) | Waffled is a plausible native SwiftUI product/fork candidate; Yuvomi is useful for agent/API and permissions; Tribu, Donetick, Homi, and Homebox offer useful family, recurrence, sync, and asset models. Waffled's offline writes and remote notifications were narrower than its introductory claims in the inspected snapshot. | Test a real app with synthetic household scenarios before choosing a fork. Study models and interaction patterns without assuming production maturity. |
| September [Apple app references](https://app.notion.com/p/Apple-centric-commercial-app-references-3e93845658d781f48a37db15d6af720d) | Crouton and Mela show careful native capture-to-use flows; Things and Structured show daily attention; Under My Roof shows durable home records; Hearth shows child-facing routines. | “Extremely nice iOS app” is a first-class requirement, not a wrapper around a database. Public UI and exports do not prove private schemas. |
| [Firsthand parent reports](https://app.notion.com/p/Family-display-owner-reports-Hearth-Skylight-and-alternatives-3e93845658d7810cbb9edd3c73bf1f72), September | Hearth owners describe young children following sequential routines; Skylight owners value a kitchen-visible schedule. Across products, a parent often still does the entering and reconciliation. Cozyla owners report flexibility and setup friction; DAKboard/FamilyWall work for families already maintaining calendars. | A display improves awareness; the harness earns its place by turning incoming material into accountable, low-friction work. Parent posts are self-selected anecdotes, not failure-rate or adoption data. |

## The core loop

1. **Capture:** A person, calendar, school email, photo, Home Assistant event, or recurring schedule creates an intake item with a source reference.
2. **Interpret:** A deterministic parser or bounded model extracts a proposed event, task, record update, or answer. It shows source, confidence, conflicts, and intended recipients.
3. **Route:** Home Slice chooses a human owner and an approval rule using the caller's identity, the data's visibility, the requested action, and the destination system.
4. **Commit:** An authorized person accepts or edits the proposal. A narrow adapter writes once, reads back the result, and handles retries with an idempotency key.
5. **Follow through:** The system watches for completion, exceptions, and missing runs. It records a receipt and changes the next due date only when the underlying event actually occurred.
6. **Surface:** Each person sees their work in the iOS app; shared material can appear on a wall display or daily brief. Private material stays in its person's view.

The outcome is inspectable: *what came in, who decided, where it was saved, who owns the next action, and whether it happened*. This is the gap between a family calendar and a family harness.

### Three representative workflows

- **School flyer or forwarded message → proposed event.** Extract date, location, people affected, and source; check the shared calendar for conflicts; let an adult approve; create the event and show the saved link. A follow-up can propose a packing or RSVP task. No event should appear silently from uncertain OCR.
- **Appliance maintenance → completed history.** A schedule says a filter is due; Home Slice creates one occurrence with owner, manual, and last-service context. Completion records who did it and when, then computes the next occurrence. A reminder is not the same as evidence that work was done.
- **Daily family brief → shared attention.** Combine the shared calendar, assigned tasks, and explicitly exposed home exceptions. Show only actionable changes and missing owners. The brief remains useful if an AI provider is down because canonical events and basic scheduling are deterministic.

Meal planning, rewards, and kid-facing routine screens can follow evidence of actual household use. The earlier audit found real use for groceries, recipes, gifts, trips, and chores but little use for installed meal-planning and finance templates. Recheck that before promoting those to core modules.

## Proposed system boundary

| Component | Owns | Does not silently own |
|---|---|---|
| Household identity and policy | Household membership, person versus login account, caregiver/guest/child roles, per-person private space, agent principal, permissions and approval rules | Identity inferred from room voice or a shared device |
| Agent runtime and workflow engine | Goals, sessions, plans, bounded tool calls, intake, proposals, approvals, jobs, retries, schedules, receipts, activity/run ledger, expected-run monitoring | The factual content of every connected system |
| Existing records | Notion Home Hub for current home documents and records; shared calendar for events; Home Assistant for device state and scripts | A second, contradictory copy inside the harness |
| Family knowledge | Curated shared procedures and preferences with owner, source, visibility, review date, and deletion controls | Raw transcripts automatically promoted to permanent memory |
| iOS app and optional wall view | Fast capture, Today, approvals, assigned work, shared glanceable information, age-appropriate routines | An independent workflow engine or unscoped credentials |
| Agent/research workers | Extraction, summarization, lookup, drafting, and exception triage behind narrow tools | Root homelab access, unrestricted mail, or unioned family/private secrets |

The initial record contract should distinguish **Person** (including a baby or caregiver without a login), **Principal** (an authenticated human, agent, or shared display), **HouseholdMembership**, **VisibilityScope**, **SourceReference**, **Intake**, **Proposal**, **Approval**, **Schedule**, **WorkOccurrence**, **Completion**, **ActionRun**, and **Receipt**. Schedules and actual completions need separate records; imported events need external IDs and provenance; phones need a way to learn when a record was deleted or access was revoked. These are design requirements, not claims that the current Notion databases already implement them.

Use Home Assistant's native intents and local automations for known home commands. The model handles ambiguous interpretation and research. A shared voice device has household/guest-level access and moves private questions or sensitive actions to an authenticated phone. Conversation spaces such as Buzz may later provide an excellent coordination surface; their approval UI should not be the only enforcement mechanism.

## Build or adopt

**Start by proving the loop on the existing household data.** The June Notion proposal remains a useful low-migration route for recurring maintenance, shared tasks, documents, and calendar linking. Its assumption that Notion must forever be the frontend should be treated as provisional because the desired iOS experience is now central.

**Run a short Waffled evaluation in parallel as a possible client and family data model.** Use synthetic two-adult, child-without-login, caregiver, appliance, recurring service, school event, meal, and shopping-list data. Test actual iOS navigation, offline add/edit, access revocation, notifications, calendar conflicts, export, and agent API coverage. Compare the cost of extending Waffled with a small fresh SwiftUI client against the same harness API. Waffled does not by itself answer how to run durable agents. The September source review makes it a candidate, not a selected foundation or a verified production app.

**Borrow domain models deliberately.** Tribu contributes source-aware calendars and memberships; Donetick contributes recurrence history and sync revocation; Homi/Homebox contribute physical-home records; Yuvomi contributes explicit agent/API considerations. Licenses and upstream maintenance matter if copying code. A design can use the ideas without adopting every service.

## A focused 30-day pilot

The first pilot serves one household privately. It does not migrate or delete Notion data, publish a SaaS, purchase hardware, or give an agent broad write access. Its proof point is a real agent task that survives an app closing, requests the right approval, acts through a scoped tool, and reports a verified outcome.

1. **Map truth and permissions.** Re-read live Notion and calendar state. Choose the canonical task/calendar/home-record destinations. Define two adult accounts and one synthetic caregiver or child profile; write the private/shared visibility rules and export path.
2. **Run one durable agent task.** From an authenticated client, ask Home Slice to prepare the family's next-week plan from permitted sources. Let the app close while the task runs; resume and inspect the same session from another device. Start with read-only proposals and measure whether both adults find them useful.
3. **Complete one approved write loop.** Forward a sample school message or capture a flyer. Have the agent propose an event, pause for the right adult's approval, save it once, read it back, and show a receipt in the original session. Test duplicate/retry, interruption, and rejection paths.
4. **Complete one recurring home loop.** A real maintenance schedule creates one task, completion writes a history record, and the next due date derives from the completion. Test that an outage produces a missing-run alert.
5. **Review evidence.** Compare organizer time spent before/after, participation by the second adult, failed or duplicate actions, approval friction, app use, and monthly running cost. Decide whether to continue, change the surface, or stop.

Acceptance fixtures should include wrong-person access, stale source data, malicious text in an email or web page, duplicate webhook delivery, failed write followed by retry, calendar conflicts, offline phone state, and revoked caregiver access. No private answer should leak to the shared display. Core home safety automations must work during a harness/model/internet outage.

## Naming

**Recommendation: keep Home Slice as the working product name; describe it as “the family harness” in architecture and “your family's shared plan and follow-through” to a household.** Home Slice is warm and expandable across home, people, schedules, and care. Its weakness is that it does not explain the product on first hearing and has pizza/food associations. A descriptor can carry the meaning while the product is being defined.

“Family Harness” is precise for builders but sounds like infrastructure to a parent. “Household OS” and “Family Home Base” are useful category descriptions, but are generic as brands. A brief web scan found existing family products using several seemingly apt alternatives (Kinframe, Kinloom, Kinstead, Daywell, Kinward), and an unrelated Home Slice food app and restaurant marks. That scan is **not** a trademark or domain clearance. Do a dedicated availability review only if this becomes a public product.

Possible lines to test with families:

- **Home Slice — the shared plan for family life.** Most understandable today.
- **Home Slice — the family home base that follows through.** Best expresses the harness's distinctive job.
- **Home Slice — less remembering, more living.** Emotional promise; needs a concrete product explanation nearby.

## Decisions still open

1. Does the first release stay a private household system with product-shaped boundaries, or do we explicitly plan for other families from the start? The pilot can support either without operating a public service.
2. Where should canonical shared tasks live during the pilot: the existing Notion Tasks source, a native family hub, or a new harness-owned store? Pick one before any write integration.
3. Is a truly native iOS app required for the first useful pilot, or can a short-lived prototype prove the loop while Waffled/fresh-client work runs alongside it?
4. What household data classes are permitted to reach external model providers? Set the routing policy before adding mail, children's records, health information, or private documents.
5. Which one daily pain is worth solving first: schedule intake, recurring home work, or shared attention? The first user test should target one and measure its effect.

## Source ledger and provenance

- Notion: [Home Slice](https://app.notion.com/p/Home-Slice-2bd3845658d78074b874f3b9f40e705f), [Engine Proposal](https://app.notion.com/p/Home-Slice-Engine-Proposal-37c3845658d7810b8908d7dfc47437ad), [PRD](https://app.notion.com/p/Home-Slice-PRD-37c3845658d78197bb09cf95f64db3ce), [Family Management Market Research](https://app.notion.com/p/Family-Management-Market-Research-June-2026-37c3845658d781cbbaa8d6d72f7f87de), [Home & Family Agent Setup](https://app.notion.com/p/Home-Family-Agent-Setup-Research-Notes-August-2026-3bf3845658d7818a9a38f36be5e97af2). Read live from the Dahl-Berger Home Hub workspace on September 27, 2026.
- Agent-harness references checked September 27, 2026: [Claude Code overview](https://code.claude.com/docs/en/overview), [OpenAI Codex harness architecture](https://developers.openai.com/api/docs/guides/agents-api/architecture), and [Meta Muse](https://ai.meta.com/muse/) as a consumer product-pattern reference. No inspection of Muse's private implementation.
- September studies imported into Notion: [Family hub foundation](https://app.notion.com/p/Family-hub-foundation-study-3e93845658d78192baa4e6a94188b814), [Family and home backend](https://app.notion.com/p/Family-and-home-backend-study-3e93845658d781d5853effeb091537e0), [Apple-centric commercial app references](https://app.notion.com/p/Apple-centric-commercial-app-references-3e93845658d781f48a37db15d6af720d). Local originals: `/Users/ross/.codex/visualizations/2026/09/22/01a0c986-7a9f-7a22-ac35-9ad8436dedd4/`.
- [Family display owner reports](https://app.notion.com/p/Family-display-owner-reports-Hearth-Skylight-and-alternatives-3e93845658d7810cbb9edd3c73bf1f72), imported from `/Users/ross/Repos/personal/homelab/docs/research/family-display-parent-voices.md`; firsthand Reddit posts with vendor and promotional material flagged separately.
- Naming collision spot checks: [Kinframe App Store listing](https://apps.apple.com/us/app/kinframe-shared-photo-album/id6772918750), [Kinloom](https://kinloom.app/), [Kinstead](https://kinstead.family/), [Daywell](https://www.daywell.co.uk/), [Kinward](https://kinward.ai/), [Home Slice food app](https://apps.apple.com/au/app/home-slice/id6745493364). These establish uses of names, not trademark conclusions.
