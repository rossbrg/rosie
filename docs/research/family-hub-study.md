# Family hub foundation study

September 22, 2026. Preliminary source review for a household system with an excellent native iOS app and shared family agents.

## Recommendation

Study Waffled as the primary product. Use Family Home Hub to compare native iOS implementation choices and Yuvomi to compare household records, permissions, and agent integration. Do not choose a permanent fork yet. A short hands-on evaluation should establish whether Waffled's gaps are extensions to a foundation we like or changes to its central design.

Waffled is the closest existing combination of a native family app, household backend, and broad everyday workflows. It is a credible candidate to fork. It is not yet evidence that we can obtain the desired experience merely by restyling an existing app.

## Scope and evidence

Read three shallow source checkouts, their architecture documents, selected implementation paths, and CI definitions. Earlier in this conversation, inspected the published iPhone screenshots and App Store listings for the two native apps. Did not run the apps, execute their test suites, connect household accounts, or change the homelab.

Source snapshots:

| Project | Commit | Role in study | Declared license |
|---|---|---|---|
| Waffled | `b157b0d2f493b73f63dca44f2a3ed738b8775015` | Primary product and fork candidate | AGPL-3.0 |
| Family Home Hub | `99a115c38127eaed2de0f19f3d0b0feee544c584` | Smaller native implementation reference | MIT |
| Yuvomi | `036f4886012081da65b05de4d2e4e901d6377ad6` | Household data and agent interface reference | MIT |

Checkouts are under `/tmp/family-hub-study.bYuPl2/`; they are research copies, not forks or deployments. The local Apple developer tools reported an unaccepted Xcode license. A bundled Git binary was used to obtain source without changing that setting. Native build validation remains outstanding.

## Waffled: what is worth studying

The app has a coherent family-oriented visual language and separate iPhone and iPad experiences. Source includes design tokens, feature folders, calendar handling, recipes, meals, groceries, goals, recurring household rhythms, and weekly planning. Those workflows constitute real work that a fresh implementation would have to recreate.

The backend uses Postgres as the authoritative record. PowerSync supplies an on-device SQLite mirror, and writes upload through the application's API. Server-generated recurring-event occurrences avoid making every client independently interpret recurrence rules. Calendar-provider integration stays behind the backend rather than involving each phone in a second direct sync relationship.

Useful sources:

- [Architecture](https://github.com/kevinpsites/waffled/blob/b157b0d2f493b73f63dca44f2a3ed738b8775015/docs/ARCHITECTURE.md)
- [Native iOS source](https://github.com/kevinpsites/waffled/tree/b157b0d2f493b73f63dca44f2a3ed738b8775015/apps/ios/Sources/Waffled)
- [Design system](https://github.com/kevinpsites/waffled/tree/b157b0d2f493b73f63dca44f2a3ed738b8775015/apps/ios/Sources/Waffled/DesignSystem)

### Constraints a fork would inherit

**Offline behavior is narrower than the introductory copy suggests.** The actual iOS sync schema contains households, persons, events, event participants, and event occurrences. The upload endpoint handles event and participant writes. Grocery additions, chore creation, rewards, and other operations inspected use REST calls; recurring-event creation also uses REST. Do not assume every household operation queues safely offline.

**Remote notifications are unfinished in the reviewed architecture.** Local reminders are implemented, but APNs/web push is documented as deferred. This is materially different from an agent reliably notifying a family member of a new assignment while the app is closed.

**API access is a good start but does not cover every workflow.** Per-user keys have resource read/write scopes and remain bounded by the owner's capabilities. In this snapshot, rhythms and weekly planning are explicitly unavailable through keys, and list-item coverage is marked as pending work. A proposed agent integration needs a workflow-by-workflow contract review.

**Some complexity is concentrated in large shared types.** `WaffledAPI.swift` is 4,338 lines and `SyncManager.swift` is 1,295 lines at this snapshot. File size alone does not establish poor quality, but substantial changes to sync and household workflows would touch central code. The iOS build configuration also vendors a patched PowerSync SDK and uses Swift 5 language mode with minimal strict-concurrency checking. These are maintenance considerations, not demonstrated runtime defects.

**Documentation has drifted.** The iOS README still describes a future Auth0 transition, while the root architecture describes shipped built-in authentication and optional OIDC. Source and runtime behavior should settle integration decisions.

Evidence:

- [Actual sync schema](https://github.com/kevinpsites/waffled/blob/b157b0d2f493b73f63dca44f2a3ed738b8775015/apps/ios/Sources/Waffled/Sync/SyncSchema.swift)
- [Queue upload connector](https://github.com/kevinpsites/waffled/blob/b157b0d2f493b73f63dca44f2a3ed738b8775015/apps/ios/Sources/Waffled/Sync/WaffledConnector.swift)
- [Sync and REST operations](https://github.com/kevinpsites/waffled/blob/b157b0d2f493b73f63dca44f2a3ed738b8775015/apps/ios/Sources/Waffled/Sync/SyncManager.swift)
- [Offline upload endpoint](https://github.com/kevinpsites/waffled/blob/b157b0d2f493b73f63dca44f2a3ed738b8775015/apps/api/src/modules/powersync/powersync-crud.ts)
- [API scope coverage and exclusions](https://github.com/kevinpsites/waffled/blob/b157b0d2f493b73f63dca44f2a3ed738b8775015/apps/api/src/modules/api-keys/api-keys.ts)
- [iOS build configuration](https://github.com/kevinpsites/waffled/blob/b157b0d2f493b73f63dca44f2a3ed738b8775015/apps/ios/project.yml)

## Family Home Hub: smaller native reference

Its Go server and SQLite database are operationally simpler. The Foundation-only `FamilyHubKit` package separates models and networking from SwiftUI. An API protocol allows fake clients in tests. The current source also includes an interactive Today widget, recipe sharing, and a watch cooking interface; these source capabilities have not been verified in the released App Store binary.

The architecture explicitly chooses cached reads with no offline write path. That simplicity could be useful for a focused household app, but robust offline edits would be architectural work. OIDC is a deployment prerequisite. The app covers a narrower domain than the desired broader household record system.

The widget completion intent calls the server before updating the cached widget. Its comments explicitly say it is not a discoverable Shortcuts interface. An AppIntent in source should not be interpreted as full Siri/Shortcuts support.

The CI definitions include Linux tests for the shared Swift package and an iOS simulator test job; the latter skips the UI-test target. No CI results or test passes were independently verified in this study.

Sources:

- [Architecture](https://github.com/BenSuskins/family-hub/blob/99a115c38127eaed2de0f19f3d0b0feee544c584/docs/ARCHITECTURE.md)
- [Shared Swift package](https://github.com/BenSuskins/family-hub/blob/99a115c38127eaed2de0f19f3d0b0feee544c584/ios/FamilyHubKit/Package.swift)
- [API contract](https://github.com/BenSuskins/family-hub/blob/99a115c38127eaed2de0f19f3d0b0feee544c584/ios/FamilyHubKit/Sources/FamilyHubKit/APIClientProtocol.swift)
- [Widget completion](https://github.com/BenSuskins/family-hub/blob/99a115c38127eaed2de0f19f3d0b0feee544c584/ios/FamilyHub/FamilyHubWidgets/CompleteChoreIntent.swift)
- [iOS CI](https://github.com/BenSuskins/family-hub/blob/99a115c38127eaed2de0f19f3d0b0feee544c584/.github/workflows/ios.yml)

## Yuvomi: records and agents reference

Yuvomi already has an MCP endpoint, scoped tokens, an OpenAPI interface, and optional POST idempotency keys. Its records cover documents, inventory, maintenance-related information, household responsibilities, and calendars. It deserves more attention than its lack of a native app initially suggests.

The design decisions explain real household distinctions: people who do not sign in, staff and guests, display devices, and private versus shared records. These are valuable cases to evaluate before creating our own model. They are not all decisions to copy: for example, Yuvomi represents people using its users table, a deliberate tradeoff tied to its existing schema.

One important architectural lesson: MCP core tools access SQLite in-process while the general API bridge uses HTTP. The MCP layer therefore has to carry and enforce permissions that normally live in API middleware. A new implementation should aim to share domain authorization and mutation logic across the iOS app and agents, so the same action cannot acquire different rules through a different entry point.

Yuvomi's backend is also broad and established in its own choices. Building a native frontend would still require a client data layer, offline behavior, native notifications, and an excellent mobile interaction design. It is not automatically a cheaper starting point merely because the API exists.

Sources:

- [Recorded design decisions](https://github.com/ulsklyc/yuvomi/blob/036f4886012081da65b05de4d2e4e901d6377ad6/docs/DECISIONS.md)
- [MCP request handling](https://github.com/ulsklyc/yuvomi/blob/036f4886012081da65b05de4d2e4e901d6377ad6/server/mcp/server.js)
- [MCP tools and API bridge](https://github.com/ulsklyc/yuvomi/blob/036f4886012081da65b05de4d2e4e901d6377ad6/server/mcp/tools.js)
- [POST idempotency](https://github.com/ulsklyc/yuvomi/blob/036f4886012081da65b05de4d2e4e901d6377ad6/server/middleware/idempotency.js)

## What should decide fork versus fresh

Use synthetic household data for a hands-on trial. Evaluate six end-to-end experiences, not the total number of features:

1. Open the phone and understand today immediately. Check launch behavior, hierarchy, text sizing, and accessibility.
2. Add and complete grocery items with connectivity lost, then reconnect two phones. No lost changes or misleading saved status.
3. Assign a task to another adult and deliver a useful notification while their app is closed. Open the exact record from the notification.
4. Ask an agent to make a bounded change. Record who requested it and what changed; retry the request without creating duplicates.
5. Keep a personal item private while exposing the appropriate household summary. Test through both the UI and agent interface.
6. Record a home-maintenance action with an attachment and next due date. Find its history later without searching chat transcripts.

**Favor a Waffled fork** if its navigation, household concepts, and core workflows feel right and the work is mostly adding missing behavior and refining presentation.

**Favor a fresh native app** if the desired home experience, shared/private model, agent permissions, and offline mutation flow all require replacing central parts. A fresh project can be deliberately narrower: Today, Tasks, Lists, Home Records, and an assistant entry point, with calendars integrated rather than every possible family module implemented immediately.

A third possibility is a new native client over an existing backend. Yuvomi makes this plausible, but offline and authorization contracts need evaluation before accepting that boundary.

Proposed direction, not a committed specification: the household app owns durable records and normal daily workflows; agents use the same permission-checked operations; Buzz provides optional group discussion and coordination. Choose the app on family usability before making Buzz a prerequisite.
