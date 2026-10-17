# Family and home backend study
Source review: September 22, 2026.

## Recommendation
Study Tribu for the broad family domain, Donetick for recurring work and incremental sync, and Homi/Homebox for the physical home. Add Mealie/Grocy for meal and inventory semantics and Baby Buddy for caregiver records. Keep Waffled as the native iOS/offline reference and Yuvomi as the agent/API reference.

These are study priorities, not endorsements of production readiness or a decision to fork. I inspected source models, selected services, deployment files, and licenses at the commits below. I did not deploy these applications, run their tests, audit security, or verify native client quality.

## Expanded shortlist

| Project | Infrastructure inspected | License file | Most useful study area |
|---|---|---|---|
| Tribu | Python FastAPI, SQLAlchemy/Alembic, PostgreSQL, Valkey, embedded Radicale integration | MIT | Family membership, calendars/contacts, scoped integrations, shared lists |
| Donetick | Go/Gin/GORM, SQLite or PostgreSQL | AGPL-3.0 | Recurring chores, assignment policies, history, incremental sync |
| Homi | TypeScript/Next.js, Drizzle, PostgreSQL; Compose includes object storage, Redis, mail/testing and scanning services | AGPL-3.0-only | Home/room/asset relationships, maintenance, documents, providers |
| Homebox, sysadminsmedia continuation | Go/Ent; SQLite and PostgreSQL migration paths | AGPL-3.0 | Typed entity hierarchy, possessions, custom fields, attachments |
| Mealie | Python FastAPI, SQLAlchemy/Alembic; SQLite or PostgreSQL | AGPL-3.0 | Recipes, household/group boundaries, meal plans, shopping provenance |
| Grocy | PHP/SQLite, REST API used by web frontend | MIT | Stock lots, transactions, units, consumption and expiry |
| Baby Buddy | Django/Django REST Framework; configurable SQL database, SQLite default | BSD-2-Clause | Child-specific observations, timers, interval validation |
| HomeLogger | Go/Fiber/GORM, SQLite or PostgreSQL, embedded React SPA | MIT | Small, readable appliance/repair backend; contrast with richer models |

Licenses describe the inspected main project files, not every dependency or asset. Copying code and studying domain ideas are different decisions; resolve distribution requirements before selecting a fork.

## 1. Tribu: broad family backend worth reading first
[Repository](https://github.com/itsDNNS/tribu) · [models](https://github.com/itsDNNS/tribu/blob/02c07f3c1114325676d1a08ed0fc6df3709696b0/backend/app/models.py) · [deployment](https://github.com/itsDNNS/tribu/blob/02c07f3c1114325676d1a08ed0fc6df3709696b0/docker/docker-compose.yml)

User and Family connect through Membership, with a unique user/family pair and a per-membership role. Calendar events, tasks, contacts, shopping lists, recipes, display devices, and notification destinations are family-scoped.

The unusually useful detail is calendar provenance: events retain iCalendar UID, DAV path, source type, subscription, last sync time, and sync status. UID and DAV path are unique within a family. That addresses duplicate imports and gives an interface enough information to explain which system owns an event.

Its [Radicale rights adapter](https://github.com/itsDNNS/tribu/blob/02c07f3c1114325676d1a08ed0fc6df3709696b0/backend/app/dav/rights_plugin.py) propagates token scopes and family memberships into DAV authorization. Read-only tokens must remain read-only through every protocol, not merely the main REST endpoint.

**Lesson:** use membership-scoped authority and explicit external-record identity. Treat an imported calendar entry differently from one the household owns.

**Caution:** Membership references a User, and tasks assign to users. Our design should explicitly represent babies, non-login household members, and caregivers independently of login credentials. Source presence does not establish production reliability or a polished iOS experience.

## 2. Donetick: recurrence and synchronization
[Chore/history models](https://github.com/donetick/donetick/blob/15bbf141eb2e17b577fa802ed0d12157f97fcf44/internal/chore/model/model.go) · [scheduler](https://github.com/donetick/donetick/blob/15bbf141eb2e17b577fa802ed0d12157f97fcf44/internal/chore/scheduler.go) · [sync models](https://github.com/donetick/donetick/blob/15bbf141eb2e17b577fa802ed0d12157f97fcf44/internal/sync/model/model.go)

A Chore stores recurrence, next due date, assignee strategy, possible assignees, privacy, approval requirements, and notifications. ChoreHistory stores what happened, when it happened, who did it, who had been assigned, the original due date, and status. TimeSession handles work intervals separately.

Frequency metadata includes timezone and calendar patterns; the scheduler distinguishes schedules based on the prior due date from schedules based on completion. Assignment strategies include round robin and least completed.

SyncVersion appears on chores and histories. SyncCursor is scoped by circle and entity type. Tombstones preserve deletions and user-scoped visibility revocations. The [handler tests](https://github.com/donetick/donetick/blob/15bbf141eb2e17b577fa802ed0d12157f97fcf44/internal/sync/handler_test.go) include pagination boundaries and revocation followed by regrant; these tests were read, not run.

**Lesson:** “Replace filter every 90 days” and “filter replaced today” are separate records. A sync feed must convey removal of access as well as record updates.

**Caution:** the inspected sync entity types cover chores and chore histories. This is not evidence that every module supports full offline editing or that arbitrary conflicts merge automatically.

## 3. Homi: physical-home domain with explicit operational records
[Core schema](https://github.com/Yuss9/homi/blob/5e3ce86ca6ebfb1d6e4cbe7d4e818ebd1d569575/db/schema.ts) · [maintenance operations schema](https://github.com/Yuss9/homi/blob/5e3ce86ca6ebfb1d6e4cbe7d4e818ebd1d569575/db/maintenance-operations-schema.ts) · [README limitations](https://github.com/Yuss9/homi/blob/5e3ce86ca6ebfb1d6e4cbe7d4e818ebd1d569575/README.md)

Homes have memberships and rooms; assets belong to homes and can belong to rooms. MaintenanceTasks hold scheduling, while MaintenanceRecords hold completed work, actor, time, cost/currency, notes, and a unique idempotency key. Repair records have their own status and warranty-claim fields.

The expanded schema connects service providers, interventions, maintenance/repair documents, inventory movements, asset replacements, renovations, and insurance records. ReminderDeliveries have status, scheduled time, errors, and a unique idempotency key. AuditLogs record actor, action, target, home, and request ID.

**Lesson:** model the causal chain: asset → maintenance schedule → completed service → provider → receipt. Retain completion history when its task is deleted; the inspected completion relationship uses SET NULL.

**Caution:** this is a broad, comparatively heavy starting point. The README explicitly says warranty and document-expiry reminder job handlers are incomplete. Tables are not proof that all associated workflows work end to end. Review the deployed service set rather than copying its Compose stack wholesale.

## 4. Homebox: flexible inventory and membership evolution
Use the [sysadminsmedia continuation](https://github.com/sysadminsmedia/homebox).
[Entity](https://github.com/sysadminsmedia/homebox/blob/a962eb3b464b42ad19bc39751fbcc9bc00d74ac9/backend/internal/data/ent/schema/entity.go) · [EntityType](https://github.com/sysadminsmedia/homebox/blob/a962eb3b464b42ad19bc39751fbcc9bc00d74ac9/backend/internal/data/ent/schema/entity_type.go) · [membership](https://github.com/sysadminsmedia/homebox/blob/a962eb3b464b42ad19bc39751fbcc9bc00d74ac9/backend/internal/data/ent/schema/user_group.go)

Current source uses an Entity hierarchy with parent/children, a required EntityType, tags, custom fields, maintenance entries, and attachments. EntityType marks whether a type is a location. This is more generalized than an older mental model of separate item and location tables.

Entities carry manufacturer/model/serial, warranty, purchase, sale, quantity, and archival fields. MaintenanceEntry separates scheduled date from actual date. UserGroup puts owner/user authority on the membership, rather than globally on the user.

**Lesson:** hierarchy, attachments, and typed extension fields can support varied household objects without a separate table for every appliance category.

**Caution:** we should not force people, calendars, care observations, and tasks into this one generalized entity model. Its API-key model authenticates as the owning user and does not itself define granular scopes. That is a different authorization model from constrained household agents.

## 5. Mealie: relationships and provenance across workflows
[Household](https://github.com/mealie-recipes/mealie/blob/6f74625f052752138b4a81b42cb7a386d62ee951/mealie/db/models/household/household.py) · [shopping models](https://github.com/mealie-recipes/mealie/blob/6f74625f052752138b4a81b42cb7a386d62ee951/mealie/db/models/household/shopping_list.py) · [meal plans](https://github.com/mealie-recipes/mealie/blob/6f74625f052752138b4a81b42cb7a386d62ee951/mealie/db/models/household/mealplan.py)

Groups contain households; households contain users and preferences. Shopping-list items refer to normalized foods and units. Separate recipe references preserve recipe quantity, scale, and notes, including when an item is derived from a recipe.

**Lesson:** “two onions” is not just text. Retaining the recipe contribution makes it possible to explain why an item is needed and reason about changing meal plans.

**Caution:** in the inspected version, shopping lists and meal-plan entries derive household through their owning user. That ownership choice deserves review before copying it into a family system where membership can change. Its event bus dispatches through FastAPI background tasks; an event bus name alone does not establish a durable queue or guaranteed delivery.

## 6. Grocy: consumable inventory, not just a possession list
[Stock service](https://github.com/grocy/grocy/blob/41206cb90154e0d17d3e108cc1f182b94fdb465d/services/StockService.php) · [initial product model](https://github.com/grocy/grocy/blob/41206cb90154e0d17d3e108cc1f182b94fdb465d/migrations/0001.sql) · [stock-log origin](https://github.com/grocy/grocy/blob/41206cb90154e0d17d3e108cc1f182b94fdb465d/migrations/0005.sql)

Products, stock entries, units, and stock-log transactions are separate concepts. The current stock service carries stock IDs, transaction IDs, purchase dates, expiry dates, and conversions. Initial migrations illustrate origins; they are not the entire current schema.

**Lesson:** distinguish a product, a purchased batch, and a consumption event. Two cartons of the same milk can have different expiry dates. Buying a box and consuming an individual unit requires conversion semantics.

**Caution:** copy only the depth the household will actually maintain. Full pantry accounting creates much more user input than a shared shopping list.

## 7. Baby Buddy: caregiver observations and time
[Models and validation](https://github.com/babybuddy/babybuddy/blob/573f008950ff02614c40fdf0c6c822ef50d90207/core/models.py) · [API permissions](https://github.com/babybuddy/babybuddy/blob/573f008950ff02614c40fdf0c6c822ef50d90207/api/permissions.py)

Child is separate from auth.User. Feedings, sleep, diapers, measurements, medications, and other observations link to a child. Timers reference both user and optional child. Duration validation compares in UTC to handle daylight-saving transitions; interval validation detects overlapping entries where invoked.

**Lesson:** twins need separate subjects, with time-based events that remain meaningful across caregivers and devices. Store start/end instants rather than a counter that depends on one phone staying alive.

**Caution:** the inspected API permission class uses Django model permissions. Do not assume this alone provides household isolation or per-child caregiver access. Those need an explicit design and audit.

## 8. HomeLogger: compact teaching example, lower fork priority
[Appliance model](https://github.com/FrancisLaboratories/homelogger/blob/795092638dbc9e932449e450583b66bde9de97a0/server/internal/models/appliance.go) · [maintenance](https://github.com/FrancisLaboratories/homelogger/blob/795092638dbc9e932449e450583b66bde9de97a0/server/internal/models/maintenance.go) · [README](https://github.com/FrancisLaboratories/homelogger/blob/795092638dbc9e932449e450583b66bde9de97a0/README.md)

Small appliance, maintenance, repair, and file models make the code easy to trace. Maintenance and repair link to appliances and attachments.

**Lesson:** a basic home journal can be implemented with a small relational model and a single service.

**Caution:** dates and several appliance attributes are strings; costs use floating point in maintenance/repair. The README calls the project early 0.x and explicitly says import/export endpoints are unauthenticated in this version. Useful for comparison, not my preferred shared-family foundation.

## Implications for our own design
The following are recommendations inferred from this study, not claims that any one project already implements them:

1. **Separate people, logins, and delegated actors.** HouseholdMember represents belonging; Person can exist without credentials; Account authenticates; an agent credential records its owner and allowed actions.
2. **Separate definitions, occurrences, and recorded actions.** TaskTemplate/RecurrenceRule describes future work; TaskOccurrence captures a particular due item; Completion records what happened, by whom, and when.
3. **Give durable household records explicit relationships.** Home → Room → Asset; Asset → MaintenanceRecord; Document links to an asset, service record, or other supported subject. Keep consumable stock distinct from owned assets.
4. **Keep provenance.** Imported calendar events need source IDs and sync status; generated shopping items need recipe references; agent actions need initiating person, actor, and request identity.
5. **Make mobile retry and sync semantics part of the API.** Client-generated IDs, idempotent commands, versions, pagination, deletions, access revocations, and deliberate conflict behavior. Avoid treating updated_at alone as a complete sync protocol.
6. **Keep notification delivery separate from the record mutation.** A durable outbox/worker can retry without repeating the action or creating duplicate reminders.
7. **Use shared authorization for iOS, web, agents, and integrations.** MCP should wrap the same commands and permission checks, with constrained scopes; it should not gain unrestricted database access.

My provisional infrastructure preference is a modular monolith with PostgreSQL, attachment storage, and a worker/outbox. Add a mobile sync layer based on actual offline requirements. That keeps the backend manageable while leaving room for a first-class SwiftUI application; eight domain references do not imply eight deployed services.

## Reading order and retained references
Start with Tribu's models and protocol authorization, Donetick's history/scheduler/sync, and Homi's maintenance schema. Then compare Homebox's generalized hierarchy with Homi's explicit tables. Bring in Mealie/Grocy and Baby Buddy for the corresponding household workflows.

Retain [Waffled](https://github.com/kevinpsites/waffled) for SwiftUI and its selective PowerSync integration, [Yuvomi](https://github.com/ulsklyc/yuvomi) for scoped API/MCP and idempotency patterns, and [Family Home Hub](https://github.com/BenSuskins/family-hub) for the smaller Go/native-client architecture. Detailed limitations of those three are in the earlier family-hub study.

## Source snapshots
| Repository | Inspected commit |
|---|---|
| itsDNNS/tribu | 02c07f3c1114325676d1a08ed0fc6df3709696b0 |
| donetick/donetick | 15bbf141eb2e17b577fa802ed0d12157f97fcf44 |
| Yuss9/homi | 5e3ce86ca6ebfb1d6e4cbe7d4e818ebd1d569575 |
| sysadminsmedia/homebox | a962eb3b464b42ad19bc39751fbcc9bc00d74ac9 |
| mealie-recipes/mealie | 6f74625f052752138b4a81b42cb7a386d62ee951 |
| grocy/grocy | 41206cb90154e0d17d3e108cc1f182b94fdb465d |
| babybuddy/babybuddy | 573f008950ff02614c40fdf0c6c822ef50d90207 |
| FrancisLaboratories/homelogger | 795092638dbc9e932449e450583b66bde9de97a0 |

