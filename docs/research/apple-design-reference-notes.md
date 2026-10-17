# Apple-centric commercial app references

Research date: 2026-09-22. Public developer documentation and Apple recognition only. No apps installed; no private data, traffic, or internal schemas inspected. Proposed models below are deductions for our design, not claims about their private database implementations.

## Recommended study order

1. Crouton: strongest directly household-relevant, verified Apple Design Award winner.
2. Mela: restrained native design and unusually transparent export/integration choices.
3. Things: interaction and recurrence reference; personal tasks, not household collaboration.
4. Structured: accessible daily timeline and documented JSON export.
5. AnyList: mature shared household workflow reference; utility over visual spectacle.
6. Under My Roof: deep household asset model, documented CloudKit, and verified App Store Editors' Choice.
7. Hearth: family coordination and shared display reference; not Apple-exclusive or a verified Apple Design Award winner.

## Crouton

**Recognition:** 2024 Apple Design Award, Interaction winner, verified by [Apple](https://developer.apple.com/design/awards/2024/). Apple lists iPhone, iPad, Mac, Watch, Vision Pro. [Apple's developer interview](https://developer.apple.com/news/?id=9x75y43e) identifies it as Swift-built and describes how the developer prioritized navigation and careful feature selection.

**Public behavior:** Recipe capture from sites and scanning, meal planning, scaling, multiple timers, household iCloud sync. [Developer site](https://crouton.app/).

**Study:** A single household activity crosses capture → preparation → execution without making the user manage the software. Observe how recipe identity survives different entry paths; how timed steps appear during cooking; how typography and controls work when users' hands are occupied. Apple documents facial gestures for hands-free progression in its [award story](https://apps.apple.com/ca/iphone/story/id1745165692).

**Model hypothesis:** Recipe → ordered step → timer instance; meal-plan placement references a recipe. Recipe source is separate from rendered instructions. These are inferred domain boundaries, not verified tables. No documented public database schema or API located in this pass.

## Mela

**Fit:** iPhone/iPad/Mac recipe app; native design reference. This pass does not establish an Apple Design Award. Do not conflate MacStories recognition with Apple's awards.

**Public behavior:** iCloud shared recipe libraries; sharing is at library level and participants can create, edit, and delete. Personal feeds/bookmarks remain outside sharing. Joining a shared library does not silently import existing private recipes. Groceries use an Apple Reminders list. [Official help](https://mela.recipes/help/).

**Actual public data contract:** [Export format](https://mela.recipes/fileformat/index.html) documents `.melarecipe` JSON and `.melarecipes` ZIP. Fields include ID, title, source/link, categories, base64 images, yield, preparation/cooking time, ingredients and instructions as text, notes and nutrition. Imported web recipes use a URL-derived identifier; otherwise UUID. This is an export schema, not proof of internal storage.

**Study:** Provenance, portable records, intentional sharing scope, native system integration. The export keeps ingredients human-editable as text; this tradeoff differs from a fully normalized food/quantity/unit model. A source-preserving input representation plus parsed structured values may be useful for our app. Household defaults and private collections should be deliberate.

## Things

**Recognition:** Apple Design Award 2017 verified by [Apple's award announcement](https://www.apple.com/sg/newsroom/2017/06/apple-design-awards-celebrate-the-best-in-innovation-and-creativity/). Apple-only platform family includes Mac, iPhone, iPad, Watch, Vision.

**Public data contract:** [URL scheme](https://culturedcode.com/things/help/url-scheme/) documents task/project IDs, areas, headings, checklists, tags, start dates, deadlines, completion states and JSON creation. Editing existing records requires an authorization token. This is a client automation interface, not a server API or internal database dump.

**Crucial boundary:** It does [not support real-time task/list collaboration](https://culturedcode.com/things/support/articles/2803566/). Use as a design reference, not a family permissions reference.

**Study:** Fast capture, progressive disclosure, start date versus deadline, calm Today view. Its [August 2026 recurrence update](https://culturedcode.com/things/blog/2026/08/repeating-to-dos-refined/) is particularly relevant: completing early; moving one occurrence versus updating the series; fixed schedules versus recurrence after completion; visible lineage from generated copy to rule. For our model this argues for separate schedule templates and task occurrences, with explicit exceptions. The developer also states that task display/editing now shares code between Mac and iOS; this does not identify its entire UI stack.

## Structured

**Recognition:** **2026 Apple Design Awards Inclusivity finalist**, not winner. [Apple primary announcement](https://www.apple.com/newsroom/2026/06/apple-reveals-winners-of-the-2026-apple-design-awards/).

**Public behavior:** Visual day timeline, calendar import, routines, multiple device surfaces. [Developer site](https://structured.app/). It is a personal-planning reference rather than a verified household permissions model.

**Data access:** Official help documents [JSON export on Apple devices](https://help.structured.app/en/articles/333506). The same page states calendar import is one-way: Structured tasks/events cannot currently be exported back to another calendar. [Shortcuts documentation](https://help.structured.app/en/articles/929922) describes task creation and operations on today's tasks.

**Study:** Time and duration made visual, remaining capacity, uncluttered next action. Export a synthetic schedule to understand the public record shape before proposing backend design. An integrated timeline can display imported events and owned tasks while keeping write authority distinct. The export schema itself has not been obtained in this research.

## AnyList

**Fit:** Strong shared shopping/recipes workflow, iPhone/iPad/Watch plus non-Apple access; not an Apple-exclusive application. No Apple Design Award established here.

**Public behavior:** Shared lists synchronize, items have quantities, notes, photos, categories, store assignments and per-store prices; categories reorder to match the trip. [Lists feature documentation](https://www.anylist.com/lists). [Siri and Watch guidance](https://help.anylist.com/articles/siri/) describes device behavior, including Watch-to-phone syncing.

**Study:** Eliminate ambiguity between household members: a photo or precise brand note avoids a second errand. Inferred model: list membership, list item, item-to-store relation, per-store price, category order. A shopping need should not be duplicated just because two stores can satisfy it. No official public schema/API found here; community APIs would not establish a supported product contract.

## Under My Roof

**Fit:** Purpose-built household records on Apple platforms. [Apple's listing](https://apps.apple.com/us/app/under-my-roof-home-inventory/id1524335878) confirms Editors' Choice. Its published maintenance screens use conventional lists with dense supply/location detail. My judgment: stronger for domain depth than as the primary Acme-like visual benchmark.

**Confirmed architecture:** [Developer FAQ](https://binaryformations.com/support/under-my-roof-faq/) explicitly says local app-private storage plus **CloudKit** for iCloud storage/sync, with inventory sharing. Supports CSV field mapping and custom fields. These are documented choices, unlike guessed private internals.

**Export:** [User guide](https://binaryformations.com/umr/userguides/latest/UMRUserGuide.pdf) documents archives and binary export for photos, receipts and attachments, optionally preserving a folder hierarchy.

**Study:** Inventory → homes → locations/items; attachments with independent identity; human-readable complete export; ownership and share boundaries. CloudKit is an instructive Apple-first choice, but a server-based agent acting independently of the signed-in phone would require a separate architecture evaluation.

## Hearth: the whole-family coordination reference

[Profile documentation](https://hearth.zendesk.com/hc/en-us/articles/34857462677267-Hearth-Profiles-How-they-Work) distinguishes profiles with accounts from children without email who interact only on the display. This is direct evidence of product semantics, not a database schema.

Its [Family Rhythm Dashboard](https://hearth.zendesk.com/hc/en-us/articles/50620547324435-Family-Rhythm-Dashboard) combines events, routines, meals, notes, and due work, with a person-focused view. The published screenshot uses warm backgrounds, large profile photos, and a clear daily view. It also adds a household wellness score; I would study whether such scoring is helpful before adopting it.

[Hearth Helper](https://hearthdisplay.com/pages/features) turns submitted schedules and meal plans into changes for approval. For our agents, that suggests a proposed-change object that remains distinct from a committed calendar event. This is our inference, not evidence of Hearth's internal implementation.

Hearth is a hardware-centered ecosystem with iOS and Android companion apps. Study its family workflows without assuming it meets the same native Apple craft benchmark as Crouton or Mela. No Apple design award was established in this pass.

## What we can actually learn about closed-source backends

Three evidence levels matter:

1. Published implementation: Under My Roof explicitly names CloudKit. Things publishes a service architecture.
2. Public data contracts: Mela documents its import/export JSON; Things exposes URL/JSON automation; Structured documents export availability.
3. Inferred domain model: screenshots and workflows suggest objects and relationships, but do not reveal actual tables, indexes, conflict algorithms, or service topology.

The Things engineers' [February 2025 architecture article](https://www.swift.org/blog/how-swifts-server-support-powers-things-cloud/) describes Swift/Vapor services built from one configurable binary, Aurora MySQL, S3, Redis, and APNs integration. Its sync foundation draws on operational transformations and Git concepts. This is a dated first-party architecture account, not a current source audit or complete sync specification. The value is understanding how native client behavior depends on reliable synchronization; it is not a reason for a small household app to inherit their deployment scale.

Mela's [product documentation](https://mela.recipes/) also states meal plans live in Apple Calendar and groceries in Apple Reminders. That offers a concrete alternative to owning every data store ourselves. For a family-agent product, we would separately evaluate reliable server access, authorization, and source-of-truth boundaries.

## Secondary workflow references and exclusions

[Tody](https://todyapp.com/method) is useful for cleaning urgency based on time since completion and interval. [Sweepy](https://sweepy.com/) offers effort-based scheduling and parent approval of children's completion. These are useful household workflow examples; neither was established as an Apple design-award benchmark here.

[FamilyWall](https://apps.apple.com/us/app/familywall-family-organizer/id496889629) is a breadth comparison for documents, calendars, private/shared lists, and household coordination. It is not my first visual reference for the requested design standard.

[Maple's current official site](https://www.growmaple.com/) announces acquisition by Wander and a December 31, 2026 shutdown. Treat it as a historical study candidate, not an ongoing recommendation.

## Visual references inspected

These are published product screenshots, not a hands-on evaluation of installed applications:

- [Mela recipe layout](https://mela.recipes/): generous spacing, editorial title, restrained actions, and adjacent ingredients/instructions.
- [Crouton via Apple](https://developer.apple.com/news/?id=9x75y43e): native sidebar navigation, prominent start action, grouped recipe information, clear scaling controls.
- [Under My Roof maintenance](https://undermyroof.app/): upcoming work and completed history are distinct screens; supplies link back to quantities and locations.
- Hearth dashboard linked above: household identity and individual people sit alongside a daily summary.

My recommended synthesis: Mela/Crouton for interaction and visual craft; Things/Structured for the personal daily view; Hearth for family coordination; Under My Roof for durable home records; AnyList for shared errands.

## Suggested hands-on research protocol

Use synthetic data: two adults, a caregiver, one baby, an appliance, a repeating service task, a dinner plan and a shared shopping list. For each relevant app, capture the smallest complete workflow, then test edits, cancellation, recurrence exceptions, sharing, offline behavior and export. Record visible object names/relationships, stated semantics, observed behavior, and hypotheses separately. Public exports expose interoperable record shapes; they do not establish internal tables or server topology.
