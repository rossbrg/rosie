# Home & Family Agent Setup — Research Notes (August 2026)

*Exported from Notion (Home Lab › Home & Family Agent Setup — Research Notes), last edited 2026-08-17.*

> **Status / freshness:** Research snapshot completed **2026-08-17**. The source post was published 2026-08-11; the HN discussion ran primarily 2026-08-12 through 2026-08-14. I read the story plus all **64 current comment descendants** (65 HN item objects including the story), every branch, and the substantive outbound links. This space is moving weekly: re-check releases, protocol compatibility, pricing, and data policies before implementation.
>
> **Source anchors:** [Chad Arimura, "My agent setup"](https://chad.cm/posts/2026-8-11-my-agent-setup) · [full Hacker News discussion](https://news.ycombinator.com/item?id=49272484)
>
> **Tracking:** [Linear ROS-776 — Research a safe personal home & family agent setup](https://linear.app/rossbrg/issue/ROS-776/research-a-safe-personal-home-and-family-agent-setup)
>
> **Related household context:** [Family Management Market Research — June 2026](family-management-research.md) covers narrow, verifiable family-workflow AI and earlier failures of full autonomy. It is related planning context only, not evidence for the web claims in this note.

## Bottom line

The useful idea in the post is not "six agents." It is a small set of enduring system patterns:

1. give capabilities to narrowly scoped principals;
2. keep a human-readable operating manual separate from learned memory;
3. wake agents from deterministic events and schedules;
4. make work visible in one conversational surface; and
5. summarize outstanding work and failures back to the operator.

The post is also a useful warning. Its five nominally "sandboxed" agents actually share one Unix account and its user-space data; only the root agent is separate. The author also reports roughly **$150/month** before his separate Claude coding plan and says the setup has taken about **10× longer** than doing the tasks himself. This is an early, one-month experiment, not evidence that a six-agent staff produces positive ROI.

For a home or family system, start with **one visible assistant experience over several real authority zones**, not several personalities over one shared authority zone. A practical first architecture is:

```plain text
Personal app / family web UI / shared-room voice endpoint
                         |
                         v
              Identity + policy broker
          (risk class, consent, approval, budget)
                         |
       +-----------------+------------------+
       |                 |                  |
       v                 v                  v
 Native Home       Shared household    Sandboxed research
 Assistant intents knowledge retrieval worker (untrusted web)
       |                 |                  |
       +-----------------+------------------+
                         |
                  proposal / approval
                         |
                         v
            narrow service-account adapters
          (HA scripts, tasks, calendar, messages)
                         |
                         v
             append-only run and audit ledger
```

The key separation should be **Ross-private**, **household-shared**, **home-control**, and **untrusted-research**. A shared room microphone should be treated as a low-trust household/guest principal, not proof of who spoke. No conversational agent should hold root access.

## Evidence legend

- **Primary:** official documentation, source repository, or protocol specification.
- **Author report:** the original post or a clarification by its author. Useful first-party experience, but not independently measured.
- **HN anecdote:** another commenter's experience or opinion. A lead to investigate, not proof.
- **Inference / recommendation:** synthesis for a Ross home/family experiment.

## What the original setup actually looks like

### Layout

The post's architecture diagram and text describe three layers:

| Layer | Components | Purpose |
|---|---|---|
| DigitalOcean VPS | Five role agents, a separately placed root `vps-agent`, and a shared Obsidian vault | Always-on agent execution and shared operating knowledge |
| Shared services | Buzz relay, MCP servers for Linear/Sentry/etc., Obsidian Sync | Messaging/event bus, tool access, and knowledge synchronization |
| MacBook | Buzz client, local Claude Code/Codex, synchronized Obsidian vault | Human interaction, primary interactive coding, and review |

The six named profiles are:

- `ea-agent`: reminders, calendar, Linear/program management;
- `ops-agent`: Sentry and performance triage, diagnosis, escalation, or repair;
- `dev-agent`: selected GitHub projects;
- `gtm-agent`: analytics, content calendar, marketing and writing;
- `research-agent`: web research and asynchronous reports; and
- `vps-agent`: root-level server maintenance, agent creation, skills, and MCP installation.

Each profile is defined with persona/instruction files, skills, tools, MCP servers, and its own [Mnemosyne](https://github.com/mnemosyne-oss/mnemosyne) memory bank. All share an [Obsidian](https://obsidian.md/) wiki, described as the "business operating manual." The vault is synchronized between VPS and laptop. In an [HN clarification](https://news.ycombinator.com/item?id=49293274), the author says it contains architecture, project information, go-to-market notes, writing, and how-to procedures such as agent setup and DNS backups; he also occasionally copies it to GitHub as backup.

### Communication and orchestration

The agents appear as members of [Buzz](https://github.com/block/buzz), an open-source Nostr-based workspace. A direct message triggers an agent without a mention; a room message requires a mention. Agents can mention each other, while the root agent is intended to respond only to the author. Webhooks and schedules post events into rooms and can summon an agent—for example, a Sentry webhook mentions `ops-agent` with the issue payload.

This is less exotic than the org chart suggests. The author later summarizes the pattern as **input + model + memory + tools + cron jobs** ([HN](https://news.ycombinator.com/item?id=49276523)). That is the right abstraction to retain.

### Current use cases and autonomy level

- Sentry alert → Buzz → ops diagnosis → proposed fix, still "100% human-in-the-loop."
- Small development request from a phone → agent change; most coding still happens interactively on the laptop.
- Morning briefing from Linear, calendar, and recent conversations.
- Daily content-calendar review and recommendations.
- Persistent reminders and asynchronous research.
- A daily supervisor report that reads the prior day's Buzz conversations, including DMs, and lists completed, active, and attention-needed work.

The daily report is a good operating pattern, but an agent reading every private DM would be inappropriate for a family deployment without explicit consent and visibility rules. It is also a digest, not independent observability: the same system that failed may fail to report the failure.

## Corrections and caveats from the HN discussion

### 1. The "sandbox" in the diagram is not a security boundary

The author clarifies that the five agents run as the same `hermes` Unix user and share everything in that user space; he says separate Unix users would be an improvement. Only the root-access agent is separated ([author clarification](https://news.ycombinator.com/item?id=49293301)). This means the role split reduces accidental tool availability only if credentials and adapters are separately scoped; it does not contain a compromised agent or prompt injection.

Hermes' own current [security policy](https://github.com/NousResearch/hermes-agent/blob/main/SECURITY.md) is unusually explicit: the operating system is the real boundary; approval prompts, redaction, scanners, and in-process tool allowlists are heuristics. It recommends whole-process isolation for agents that ingest the web, email, multi-user channels, or untrusted MCP output. Plugins and skills run with the agent's privileges. Hermes also describes itself as a **single-tenant personal agent**; all allowed callers to one instance are equally trusted, and operators who need capability separation should run separate instances.

**Implication:** Personas are not principals. Separate containers/VMs or at least separate Unix users, mounts, network policies, service accounts, memory stores, and allowlists by authority zone. A family member's account must not merely select a different prompt over the same credentials.

### 2. The strongest privacy choice in the setup is what the agents do not receive

In response to a concern about family and personal data flowing through Codex/Claude, the author says the agents do **not** access his primary mailboxes; they use a separate business Google Workspace. Duties and privileges are split, and most coding remains local and interactive ([author clarification](https://news.ycombinator.com/item?id=49293236)).

Another commenter's central concern is that a personal Hermes instance can mix memory, tool results, personal context, and a subscription-backed Codex/Claude route without a clean privacy boundary ([HN](https://news.ycombinator.com/item?id=49286884)). A reply proposes pinning a zero-data-retention provider ([HN](https://news.ycombinator.com/item?id=49287626)), but it comes from that routing vendor and should be treated as a vendor claim.

The underlying distinction is real:

- OpenAI's current [API data-control documentation](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint) says API data is not used for training by default, but default abuse-monitoring logs may retain customer content for up to 30 days; approved ZDR has feature limitations, and remote MCP servers have their own policies.
- Consumer ChatGPT conversations follow separate [ChatGPT retention controls](https://help.openai.com/en/articles/8983778-chat-and-file-retention-policies-in-chatgpt/); turning off training is not the same as zero retention.
- [OpenRouter](https://openrouter.ai/docs/guides/features/zdr) documents per-request/account ZDR routing and conservative provider classification; [Fireworks](https://docs.fireworks.ai/guides/security_compliance/data_handling) documents default ZDR for ordinary inference but separate storage behavior for its Responses API when `store=True`.

**Implication:** Never infer a household data policy from "the subscription works." Declare a model-routing policy per data class, verify the exact endpoint and settings, and assume prompts, retrieved documents, tool results, traces, and third-party MCP calls may each have different retention.

### 3. Real family deployments need separate identities and memories

One commenter reports running 16 Nanobot Docker instances—four for parents and twelve split between the commenter and spouse—plus Matrix, Gitea, OpenWebUI, VM snapshots, and off-site backups ([HN anecdote](https://news.ycombinator.com/item?id=49290702)). This is evidence that people are experimenting with multi-instance family isolation, not evidence that 16 processes are necessary or maintainable.

Another commenter describes a shared agent with approval-gated turns: two people can see each other's prompts and jointly approve progress, while private branches remain possible ([HN anecdote](https://news.ycombinator.com/item?id=49274327)). This is a more useful family interaction pattern than pretending one agent can silently infer whose privacy and authority apply.

**Implication:** Give each person a real login and private session/memory scope; make shared sessions visibly shared. Require a personal-device confirmation for any action that depends on identity. Never use voice recognition or room location as the sole authorization factor unless the platform explicitly provides and guarantees that control.

### 4. Draft-first beats autonomous sending

A commenter who built a messaging agent concluded that users want fast drafts rather than autonomous sending; wrong tone and invented facts become much more costly once the human send button disappears ([HN anecdote](https://news.ycombinator.com/item?id=49275314)). Other commenters make the same ROI point for coding: planning and decisions still require the human, so a direct Codex/Claude session may beat a persistent personal agent ([HN](https://news.ycombinator.com/item?id=49272873)).

**Implication:** For email, texts, invitations, purchases, posts, and other social commitments, v1 should produce a proposal or draft with sources and recipients visible. The user performs the final commit.

### 5. Tool and context growth is an operating problem

The HN thread contains a useful cluster of advice:

- load only the MCPs needed for the current session and consolidate a sprawl of related MCPs behind one domain API ([HN](https://news.ycombinator.com/item?id=49274749));
- prefer progressively disclosed skills and human-usable CLIs when they offer a smaller initial context surface ([HN](https://news.ycombinator.com/item?id=49274492)); and
- do not assume a large context window removes the need for pruning ([HN question](https://news.ycombinator.com/item?id=49279680)).

These are anecdotes, but current platforms now support the same direction. OpenAI's current [Agents SDK tool documentation](https://openai.github.io/openai-agents-js/guides/tools/) supports deferred tool loading/tool search on compatible models. The current [MCP 2026-07-28 tool specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) supports authorization-dependent tool lists and requires deterministic listing, schemas, validation, timeouts, auditing, and confirmation for sensitive calls.

**Implication:** A home assistant should see the smallest tool catalog appropriate to the current caller and task. Do not attach calendar, mail, Home Assistant, filesystem, browser, secrets, and admin tools to every turn.

### 6. The cost and maintenance burden are material

The author reports **$48/month for the 8 GB DigitalOcean droplet + $100/month for the OpenAI plan**, approximately $150/month, excluding a separate Claude Max plan used for coding ([HN](https://news.ycombinator.com/item?id=49274286)). The VPS was upgraded from 4 GB because six processes swapped. A commenter points to cheaper on-demand compute ([HN](https://news.ycombinator.com/item?id=49274638)), but that is a vendor-price anecdote and the suggested 4 GB shape is smaller than the author found workable.

The more important cost is operator time. Both the author and other builders report negative personal ROI or difficulty making these systems reliable ([post](https://chad.cm/posts/2026-8-11-my-agent-setup), [HN](https://news.ycombinator.com/item?id=49273743)).

**Implication:** Track hours saved, hours maintained, inference spend, failed runs, and family satisfaction. Set a pilot budget and a sunset criterion. Running six always-on profiles is not a success metric.

## What is worth copying—and what is not

### Copy these patterns

- **Least-authority decomposition:** split only where data or actions require a different principal.
- **Human-readable shared manual:** procedures and policies should be reviewable without an embedding database or chat replay.
- **Per-profile/private memory plus explicitly shared knowledge:** useful once identity and deletion rules are real.
- **Events and schedules wake the agent:** Sentry/HA/calendar/task changes should be deterministic triggers.
- **Mobile-friendly conversational intake:** a quick request from anywhere is genuinely valuable.
- **Daily attention rollup:** completed, active, blocked, failed, and approval-needed work in one ordered view.
- **Portable text/configuration:** instructions, tools, policies, workflows, and knowledge should be exportable.
- **Human in the loop:** the author's current valuable use cases are already supervised.

### Do not copy these parts into a family v1

- a chat-accessible root agent;
- multiple agents that share one Unix user, filesystem, secrets, and memory access;
- one supervisor that silently reads everybody's private conversations;
- a broad "family memory" populated automatically from raw transcripts;
- model routing based on subscription economics rather than explicit privacy policy;
- GitHub backup of an unclassified household vault;
- six long-lived processes before one workflow proves useful; or
- Buzz approval gates as a hard control. Buzz's current [README](https://github.com/block/buzz/blob/main/README.md) says workflow approval-gate infrastructure is still being wired, so a "human loop" is presently an operating convention unless enforced elsewhere.

## Recommended Ross architecture

### 1. Keep deterministic systems in charge

Use Home Assistant as the home state/action and event plane. Let native intents and deterministic automations handle known commands. Invoke a model only for interpretation, summarization, drafting, research, or exception handling.

Home Assistant's current guidance matches this pattern:

- Assist can run fully locally, and its modular voice pipeline can use local speech and text-to-speech ([local voice guide](https://www.home-assistant.io/voice_control/voice_remote_local_assistant/), [pipeline architecture](https://developers.home-assistant.io/docs/voice/pipelines/)).
- Home Assistant recommends trying native handling first and sending only unmatched requests to an LLM; it also recommends exposing the minimum entities ([Assist best practices](https://www.home-assistant.io/voice_control/best_practices/)).
- The built-in LLM Assist API sees only Assist capabilities and exposed entities and cannot perform administrative tasks ([LLM API](https://developers.home-assistant.io/docs/core/llm/)).
- The MCP server can expose that bounded Assist API to an agent, with authentication and an option to disable control ([MCP server](https://www.home-assistant.io/integrations/mcp_server/)).

Home safety, HVAC protection, leak detection, alarms, and core automations must continue if the agent, model, MCP client, or internet is unavailable.

### 2. Make authority zones deployment boundaries

| Zone | Data | Tools | Default autonomy |
|---|---|---|---|
| Ross-private | private calendar/tasks/notes and explicitly approved sources | read, draft, propose | read/draft automatic; writes approved |
| Household-shared | shared calendar, household manual, shared lists and tasks | read, add reversible item, propose update | low-risk reversible writes with receipt |
| Home control | exposed HA state and named scripts | read state; call explicitly allowed scripts | ordinary reversible actions only; sensitive actions confirmed |
| Untrusted research | public web, attachments, inbound content | browser/search, no household secrets | whole-process sandbox; output-only |
| Operator/admin | deployment, credentials, host/root changes | narrow admin automation | never directly available to conversation; explicit operator workflow |

Run these as separate OS principals/containers or VMs with separate mounts, network egress, credentials, memory databases, and caller allowlists. If two zones must cooperate, pass a bounded request and result through the broker; do not give a manager the union of all worker credentials.

### 3. Use three memory classes, not one giant brain

1. **Per-person session context:** short-lived conversation history, private by default.
2. **Curated household knowledge:** stable facts, preferences, procedures, and decisions with source, owner, visibility, last-verified date, and expiry/review date.
3. **Append-only action ledger:** who requested what, authorization used, proposed arguments, approval, execution result, latency, cost, and rollback/compensation.

Canonical facts should be retrieved from their owning systems—Home Assistant, calendars, Notion, task systems—rather than copied into free-form memory. Raw transcripts should not become durable household memory by default. Every durable memory needs review, correction, export, deletion, and private/shared controls.

The post's Mnemosyne + Obsidian split is directionally good. Mnemosyne's current [documentation](https://github.com/mnemosyne-oss/mnemosyne) describes local SQLite memory with provenance-like fields, expiry, private/shared surfaces, and memory hygiene. Treat those as product capabilities to test, not a substitute for deployment isolation or a security review. Obsidian Sync documents [end-to-end encryption](https://help.obsidian.md/Obsidian%20Sync/Security%20and%20privacy), but decrypted vaults still exist on authorized devices; backup and device compromise remain separate concerns.

For Ross, the household Notion workspace is the natural curated, human-readable operating manual. Agent-learned memory should link back to it, not silently overwrite it. Personal Linear should track the build/research work, not serve as the family's hidden memory store.

### 4. Put a real approval boundary around side effects

| Risk class | Examples | Policy |
|---|---|---|
| Read-only | sensor status, shared calendar summary, cited research | may run automatically within caller scope |
| Low-risk reversible | add a household task, create a reminder, toggle an ordinary light | may run with immediate receipt and undo path after pilot acceptance |
| Social/external | send message/email, invite someone, publish, submit a form | draft/proposal; human performs or explicitly approves final send |
| Sensitive home | locks, garage doors, alarm, security cameras, safety/HVAC overrides | confirmation on an authenticated personal device; never voice-only |
| Destructive/financial/admin | delete data, purchase, transfer money, change credentials, deploy, root shell | separate operator workflow; not a conversational tool |

Current agent runtimes can implement durable pauses instead of a vague "ask first." The OpenAI Agents SDK, for example, has [serializable human-in-the-loop interruptions](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/), per-tool guardrails, max-turn limits, and traces. The current MCP tool spec recommends visible tool inputs, confirmation for sensitive operations, input/output validation, rate limits, timeouts, and audit logs. These are useful design requirements regardless of runtime.

### 5. Treat shared voice as convenience, not identity

Home Assistant provides caller/user context and entity exposure controls, but its public family-facing voice guidance does not document speaker recognition as a reliable authorization boundary. Therefore:

- a room satellite may answer household-shared questions and perform ordinary room actions;
- private questions should move to that person's authenticated phone/session;
- sensitive actions should generate a confirmation on an authenticated device;
- do not retain raw audio by default; and
- do not build children's or guests' persistent profiles without an explicit household policy and consent.

This is an inference from the documented platform surface, not a claim that speaker-aware authorization is impossible.

### 6. Make orchestration boring and durable

- Home Assistant events, calendars, webhooks, or a scheduler create jobs.
- The broker records an immutable job ID and caller before the model sees it.
- The model returns structured output.
- Deterministic code validates authorization, schemas, freshness, and idempotency.
- Side effects use idempotency keys and bounded retries.
- Long waits and approvals persist outside the model process.
- Every run has a timeout, maximum turns/tool calls, cost ceiling, and cancellation path.

The 2026-07-28 MCP revision added stateless operation, in-band requests for more input, cacheable tool catalogs, stronger authorization guidance, and a Tasks extension for long-running work ([release](https://blog.modelcontextprotocol.io/posts/2026-07-28/), [specification](https://modelcontextprotocol.io/specification/2026-07-28)). It is cutting-edge and promising, but Home Assistant itself warns that MCP client support is still evolving. Do not make the brand-new Tasks extension the only durability mechanism until the exact clients pass compatibility and restart tests.

### 7. Observe the system independently

The post's daily work report is valuable, but add independent evidence:

- correlation ID across trigger, agent run, model request, approval, and tool call;
- actor and authorization principal;
- tool name and redacted arguments;
- result, latency, retries, model/provider, tokens, and cost;
- heartbeats for scheduled workflows;
- alerts on missing expected runs, not merely reported errors;
- an append-only audit/receipt visible to the requesting family member;
- canary tasks that test read, blocked write, approval, timeout, and recovery; and
- a periodic restore test for memory/config/run-ledger backups.

Trace content itself can leak family data. OpenAI's SDK enables tracing by default and offers `traceIncludeSensitiveData`/`trace_include_sensitive_data` controls ([runtime options](https://openai.github.io/openai-agents-js/guides/running-agents/)); household traces should exclude sensitive payloads by default. Log metadata and hashes where full content is unnecessary.

## Failure modes to design and test before broadening autonomy

| Failure | Likely consequence | Required control/test |
|---|---|---|
| Prompt injection in web/email/document | secret disclosure or unsafe tool call | whole-process research sandbox; no secrets; malicious-page exfiltration test |
| Shared-user credential bleed | one agent reaches another zone | separate OS principal, mounts, credentials, and network; cross-zone denial test |
| Wrong family identity | private disclosure or unauthorized action | separate logins; shared voice low-trust; personal-device confirmation |
| Memory poisoning or stale fact | repeated incorrect decisions | provenance, owner, review date, TTL, correction/delete test |
| Context/tool bloat | wrong tool, high cost, lost instructions | scoped catalogs, deferred loading, compaction regression test |
| Duplicate/retried action | duplicate task, message, or purchase | idempotency key and compensating action test |
| Silent schedule failure | missed reminder/briefing | independent expected-run heartbeat and alert |
| Model or prompt drift | behavior changes after upgrade | pinned versions where possible; household acceptance suite before rollout |
| Provider/internet outage | home automation unavailable | deterministic HA fast path and safety automation operate without model |
| Approval UI failure | unsafe action proceeds or work disappears | fail closed; durable pending state; expiry; reject/resume tests |
| Root/admin agent compromise | total homelab compromise | no conversational root principal; separately authenticated operator workflow |
| Backup without restore | false confidence and lost memory | encrypted backup plus scheduled restore drill |
| Negative ROI | permanent maintenance hobby | time/cost/value dashboard and explicit stop criterion |

## Practical first experiments for Ross

### Phase 0 — policy and acceptance harness

Before deploying another always-on service:

- choose three workflows with a real recurring pain;
- define the caller, canonical source, allowed tools, risk class, data route, approval rule, receipt, and rollback for each;
- create adversarial fixtures for prompt injection, wrong identity, stale memory, duplicate execution, timeout, and provider outage; and
- decide a monthly cash and maintenance-time budget plus a 30-day stop/continue review.

Good initial candidates:

1. **Morning household briefing:** shared calendar, shared tasks, weather, and Home Assistant exceptions; no primary mailbox access.
2. **Home-operations triage:** summarize HA/homelab alerts and propose a cited task or runbook step; read-only in v1.
3. **Research capture:** sandboxed web research with citations, then a human-approved Notion update and/or Linear task.

### Phase 1 — one broker, read-only tools

- one small broker service, private over Tailscale;
- separate accounts/sessions for each person;
- native Home Assistant intent fast path;
- read-only access to explicitly shared calendars/tasks/Notion pages and a minimal HA entity set;
- sandboxed research worker with no household credentials; and
- run ledger, cost meter, expected-run monitor, and daily attention report.

Do not begin with email, messaging sends, browser sessions logged into personal services, broad filesystem access, or a root maintenance agent.

### Phase 2 — reversible writes and approval

- narrow tools such as `add_shared_task`, `create_reminder`, or named Home Assistant scripts;
- schema validation and idempotency;
- receipt with undo/compensation;
- human approval for any external or identity-sensitive action; and
- acceptance tests run after every model, prompt, MCP, Home Assistant, or runtime upgrade.

### Phase 3 — split workers only where permissions justify it

If the first workflows save more time than they consume, split the broker's workers into separate deployments for household, home operations, and untrusted research. Consider a multi-user UI such as OpenWebUI or an experimental agent workspace such as Buzz only after the identity, approval, and audit boundaries work independently of the UI.

### Success criteria

- zero unapproved sensitive/external actions;
- every write has an attributable request, visible arguments, result, and rollback/compensation;
- no cross-person private-memory retrieval in the test suite;
- scheduled jobs either complete or produce an independent missing-run alert;
- core home automations still work during a broker/model/internet outage;
- family members can inspect and delete what is remembered about them; and
- measured time saved exceeds maintenance time over the pilot window.

## Current tool and implementation landscape

This is a discovery list, not a recommendation to install everything.

| Tool / approach | What it contributes | Current caveat |
|---|---|---|
| [Home Assistant Assist + MCP](https://www.home-assistant.io/integrations/mcp_server/) | Local deterministic home control, entity exposure, event triggers, voice, bounded LLM API | Treat shared voice as low-trust; test current MCP-client compatibility |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | Persistent personal agent, tools/skills, messaging gateways, local or remote models | Official trust model is single-tenant; whole-process isolation needed for untrusted input |
| [Buzz](https://github.com/block/buzz) | Human/agent rooms, signed identities/events, workflows, audit-oriented chat surface | Early; approval gates are not yet fully wired according to current README |
| [Mnemosyne](https://github.com/mnemosyne-oss/mnemosyne) | Local SQLite agent memory, recall, expiry/provenance-like metadata, profile/shared surfaces | Memory hygiene and authorization still require testing and backups |
| [OpenWebUI](https://docs.openwebui.com/features/authentication-access/) | Mature multi-user UI, private resources, RBAC, knowledge, per-user memory | Permissions are additive; RBAC does not replace least-privilege provider credentials |
| [Nanobot](https://github.com/HKUDS/nanobot) | Lightweight self-hosted personal-agent loop, channels, memory, MCP, Docker | HN's 16-instance family setup is anecdotal; evaluate security/operations directly |
| [Ollama](https://www.home-assistant.io/integrations/ollama/) / [llama.cpp](https://github.com/ggml-org/llama.cpp) | Local inference tier for private/routine work | HA calls Ollama home control experimental and recommends a very small entity set |
| [OpenAI Agents SDK](https://openai.github.io/openai-agents-js/) | Sessions, approvals, guardrails, tracing, MCP, tool search, sandbox/durable integrations | Cloud data/trace policy must be configured; platform-specific rather than portable core |
| [Paseo](https://github.com/getpaseo/paseo) | Mobile/web/desktop control of coding agents on local/remote machines | Remote coding interface, not a family/home policy plane |
| [Browserbase](https://www.browserbase.com/) or self-hosted browser worker | Remote browser automation, mentioned as the post author's next step | Browser content is an untrusted injection surface; isolate and keep credentials narrow |
| [Matrix](https://matrix.org/docs/matrix-concepts/elements-of-matrix/) | Open federated chat alternative; used by the family Nanobot commenter | Chat identity does not automatically enforce tool/data authorization |

### HN outbound/vendor leads worth bookmarking, not treating as proof

- [TrustedRouter privacy post](https://trustedrouter.com/blog/one-api-all-llms-provably-private) — linked by its operator; evaluate against actual contracts, routes, and tests.
- [Shellbox](https://shellbox.dev/) — pay-per-use compute proposed as a cheaper VPS alternative; re-check price and capacity.
- [Poly](https://usepoly.co/) — product mentioned by a commenter exploring shared/approval-gated agents.
- [An anonymized custom HTML wrapper screenshot](https://i.imgur.com/lj9Fgco.png) — illustrates a project/session-oriented UI with schedules, but the author calls the implementation a prototype rather than maintained software ([thread](https://news.ycombinator.com/item?id=49274866)).
- [OpenRouter ZDR](https://openrouter.ai/docs/guides/features/zdr) and [Fireworks data handling](https://docs.fireworks.ai/guides/security_compliance/data_handling) — useful provider-policy references; re-check the exact model endpoint and request settings at deployment time.

## Research judgment

The cutting edge in August 2026 is converging on useful primitives—scoped tools, deferred discovery, resumable approvals, local voice/model tiers, per-user memory, traces, and standardized MCP authorization—but not on a turnkey, trustworthy "family agent." The mature pieces are still the boring ones: identity, deterministic automation, service accounts, schemas, queues, backups, and human confirmation.

The right Ross experiment is therefore a **family-facing assistant with explicit policy and receipts**, built on the existing private/Tailscale/Home Assistant/compose approach, with Notion as the curated household manual and Linear as the build/research tracker. Add personalities or manager/worker hierarchies only after a permission boundary or proven workload requires them.

## Primary references

- [Original post and architecture](https://chad.cm/posts/2026-8-11-my-agent-setup)
- [Full HN discussion](https://news.ycombinator.com/item?id=49272484)
- [Hermes Agent security policy](https://github.com/NousResearch/hermes-agent/blob/main/SECURITY.md)
- [Buzz README and implementation-status table](https://github.com/block/buzz/blob/main/README.md)
- [Mnemosyne source and documentation](https://github.com/mnemosyne-oss/mnemosyne)
- [Home Assistant Assist best practices](https://www.home-assistant.io/voice_control/best_practices/)
- [Home Assistant LLM API](https://developers.home-assistant.io/docs/core/llm/)
- [Home Assistant MCP server](https://www.home-assistant.io/integrations/mcp_server/)
- [Home Assistant automation triggers](https://www.home-assistant.io/docs/automation/trigger/)
- [MCP 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [MCP 2026-07-28 tools specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [MCP 2026-07-28 authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [OpenAI Agents SDK](https://openai.github.io/openai-agents-js/)
- [OpenAI API data controls](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint)
- [OpenWebUI authentication and access](https://docs.openwebui.com/features/authentication-access/)
