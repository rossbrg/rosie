# 03 — OpenClaw and pi: how they work, and what Rosie should take from them

Researched 2026-10-17. Legend: **[read]** = read directly in repo source, repo docs or a primary vendor page; **[reported]** = from a third-party write-up; **[inferred]** = my own conclusion.
Repo docs were read from `raw.githubusercontent.com/openclaw/openclaw/main/docs/...` (OpenClaw v2026.10.4). docs.openclaw.ai was blocked from this sandbox, so doc links below point to the GitHub source files.
Abbreviations: `OC` = `https://github.com/openclaw/openclaw/blob/main`; `PI` = `https://github.com/badlogic/pi-mono/blob/main` (now `earendil-works/pi`).

## 0. Identity and lineage
- OpenClaw is an MIT, self-hosted assistant that "meets you in the channels you already use" (Discord, iMessage, Slack, Teams, Telegram, WhatsApp, and 20+ more). It is now run by the OpenClaw Foundation, a 501(c)(3). OpenAI is listed as "a donor, not an owner." [read] `OC/README.md`
- Name history: Clawdbot, then Moltbot (renamed because it was too close to "Claude"), then OpenClaw. Peter Steinberger then joined OpenAI, with OpenClaw staying open source under a foundation. [reported] https://heise.de/-11177231 ; https://thenextweb.com/news/anthropic-openclaw-claude-subscription-ban-cost (says he joined in Feb 2026)
- **pi lineage, verified in package.json at each tag:**
  - v2026.2.1 through v2026.4.20 depended on `@mariozechner/pi-agent-core`, `pi-ai`, `pi-coding-agent` and `pi-tui`. [read] `https://raw.githubusercontent.com/openclaw/openclaw/v2026.4.20/package.json`
  - By v2026.6.1, only `@earendil-works/pi-tui` remains. The LLM layer is an in-repo `@openclaw/ai` workspace package. [read] `https://raw.githubusercontent.com/openclaw/openclaw/v2026.6.1/package.json`, `OC/package.json`
  - THIRD_PARTY_NOTICES says "Portions of OpenClaw were adapted from Pi / pi-mono." [read] `OC/THIRD_PARTY_NOTICES.md`
  - So OpenClaw *started* by embedding pi and has since forked and absorbed it. [inferred]

## 1. OpenClaw architecture
**Gateway.** One long-lived daemon per host owns every messaging surface: WhatsApp via Baileys, Telegram via grammY, Slack, Discord, Signal, iMessage and WebChat. [read] `OC/docs/concepts/architecture.md`
- It exposes a typed WebSocket API on `127.0.0.1:18789`. The first frame must be `connect`, followed by `{type:"req"|"res"|"event"}` frames.
- The protocol is defined in TypeBox, with JSON Schema and Swift models generated from it.
- "Idempotency keys are required for side-effecting methods (`send`, `agent`)" and are backed by a short-lived dedupe cache.
- Device identity is part of every connect. A new device needs pairing approval and must sign a challenge nonce. Loopback can be auto-approved; tailnet and LAN connections need explicit approval.
- Remote access: Tailscale or VPN preferred, SSH tunnel as the alternative.
- A single `GatewayScheduler` drives cron and maintenance wakes. Durable deadlines live in stores and are rebuilt at startup. Missed ticks are coalesced after sleep.

**Clients and nodes.** The CLI, macOS app, web Control UI and TUI connect as operators. Phones and Macs can connect as `role: node` and expose `camera.*`, `screen.record` and `location.get`. [read] same file

**Agent loop.** This is what pi provided originally. [read] `OC/docs/concepts/agent-loop.md`
- **Run sequence:** the `agent` RPC validates the request, resolves the session and returns a `runId`. `runEmbeddedAgent` then serializes the run on per-session and global queues, resolves the model and auth profile, streams `assistant`, `tool` and `lifecycle` events, and enforces timeouts.
- **Transcript write fencing:** a run records a durable `activeWriterRunId`. Every transcript append checks it inside a SQLite transaction, so "a superseded run therefore cannot commit stale transcript data."
- **Tool arguments** are validated against JSON schema before execution.
- **Plugin hooks:** `before_tool_call` (where `{block:true}` is terminal), `message_sending` (cancel), `tool_result_persist`, and others.
- **Audit:** the Gateway writes a "bounded, metadata-only audit ledger" that records provenance and result codes, not prompts or arguments.
- **Delivery receipt:** `terminalReceipt.sourceReplyDelivered` confirms that a reply actually reached the chat.

**Queueing.** Each session is a FIFO lane (`session:<key>`) feeding a global `main` lane. [read] `OC/docs/concepts/queue.md`
- Default inbound mode is `steer`: a mid-run message is injected into the active run. There is a 500 ms debounce, a cap of 20, and `drop: "summarize"`.

**Sessions.** [read] `OC/docs/concepts/session.md`, `OC/docs/gateway/security/access-control.md`
- All DMs share one "main" session by default.
- Groups and rooms get one session per group or room. Cron jobs get a fresh session per run. Webhooks are isolated per hook.
- `session.dmScope: "per-channel-peer"` isolates each sender. `identityLinks` merges one person's identities across channels.
- Resets are opt-in: daily at hour N, after N idle minutes, or manually with `/new`.

**Runtimes.** "Provider" (how you authenticate), "model" and "agent runtime" (who owns the loop) are separate layers. [read] `OC/docs/concepts/agent-runtimes.md`
- The built-in runtime is `openclaw`, the pi-derived embedded loop.
- Plugin harnesses: `codex` (the Codex app-server, "the usual ChatGPT/Codex subscription setup") and `copilot`.
- CLI backends: `claude-cli` runs `anthropic/*` models through the Claude Code executable.
- External coding agents attach over ACP.

**Workspace files.** These are Markdown files in `~/.openclaw/workspace`, which is the "default cwd, not a hard sandbox." [read] `OC/docs/concepts/agent-workspace.md`
- `AGENTS.md`: operating rules, loaded every session.
- `SOUL.md`: persona and tone.
- `USER.md`: dated active or superseded "directives", with its own 4,000-character budget.
- `IDENTITY.md`, `BOOT.md` (startup checklist), `BOOTSTRAP.md` (first-run ritual, then deleted).
- `MEMORY.md`: curated long-term memory, loaded only in the private main session.
- `memory/YYYY-MM-DD.md`: daily logs.
- `skills/`.
- Injection caps: 20k characters per file and 60k total. Config, credentials and transcripts live separately in `~/.openclaw/` (SQLite). The docs recommend a private git repo for the workspace.

**Memory.** "The model only remembers what gets saved to disk; there is no hidden state." [read] `OC/docs/concepts/memory.md`
- Layers: `USER.md`/`MEMORY.md` are injected into the prompt. Daily notes are indexed (SQLite FTS plus vectors) and pulled on demand via `memory_search` and `memory_get`.
- A background "dreaming" sweep distills daily notes into `MEMORY.md`.
- The doc's own warning: "Memory can preserve approval context, but it does not enforce policy. Use OpenClaw approval settings, sandboxing, and scheduled tasks for hard operational controls."

**Heartbeat.** A periodic agent turn in the main session that surfaces anything needing attention. [read] `OC/docs/gateway/heartbeat.md`
- Default every 30 minutes, or 1 hour on Anthropic OAuth or Claude CLI auth.
- A quiet result is `NO_REPLY` (legacy `HEARTBEAT_OK`) and is dropped.
- `isolatedSession` plus `lightContext` "dramatically reduces per-heartbeat token cost."
- The old `HEARTBEAT.md` checklist has moved into the scheduler as "monitor scratch."
- Event wakes are rate-limited: at least 30 s apart, with a flood guard after 5 starts in 60 s.

**Cron ("Automations").** Persisted jobs with run history. [read] `OC/docs/automation/cron-jobs.md`, `OC/docs/automation/cron-jobs/payloads.md`
- Payload kinds: system-event, agent-turn, script, and **command payloads**. Command payloads "run scripts inside the Gateway scheduler without starting a model-backed turn."
- Isolated jobs pin their inference account and billing route.

**Skills and ClawHub.** [read] `OC/docs/tools/skills.md`
- A skill is a directory with `SKILL.md` (YAML frontmatter plus body), gated at load time by `metadata.openclaw.requires` (binaries, env vars, OS).
- Precedence: workspace, then project, then personal, then managed, then bundled.
- ClawHub (clawhub.ai) is the public registry. It provides a `clawhub.skill.verify.v1` trust envelope, a lockfile at `.clawhub/lock.json`, VirusTotal/ClawScan/static-analysis status, and an operator `security.installPolicy` hook.
- The docs say: "Treat third-party skills as untrusted code."

**Tools, sandboxing and approvals.**
- Sandboxing is **off by default**. Backends: Docker, Podman, SSH, OpenShell. The docs call it "not a perfect security boundary." [read] `OC/docs/gateway/sandboxing.md`
- Exec approvals combine policy, allowlist and an optional human prompt. Effective policy is the stricter of config and approvals. The docs say approvals "are not a per-user auth boundary." [read] `OC/docs/tools/exec-approvals.md`
- The system prompt's "Execution Bias" section says: "A requested action with an available tool is authorized." [read] `OC/docs/concepts/system-prompt.md`

**Multi-user, pairing and allowlists.** [read] `OC/docs/channels/pairing.md`, `OC/docs/gateway/security/access-control.md`, `OC/docs/gateway/security/index.md`
- `dmPolicy` options are `pairing` (default), `allowlist`, `open` (requires `"*"`) and `disabled`.
- Pairing codes are 8 characters, expire after 1 hour, and are capped at 3 pending per channel.
- Group allowlists and mention gating are separate checks from DM access.
- `contextVisibility` decides whether quoted or thread text from non-allowlisted senders reaches the model.
- Command authorization uses `commands.allowFrom`.
- Trust model: "One trust boundary per gateway… not a hostile multi-tenant security boundary."

## 2. Model authentication: subscriptions, and the policy saga
**What OpenClaw does today.** [read] `OC/docs/concepts/oauth.md`, `OC/docs/providers/anthropic.md`, `OC/docs/providers/openai.md`, `OC/docs/gateway/cli-backends.md`
- **OpenAI.** ChatGPT/Codex OAuth via PKCE against `auth.openai.com`, with a loopback callback on `:1455` or a paste-the-code fallback. Tokens `{access, refresh, expires, accountId}` are stored in SQLite and run through the Codex app-server harness. OpenClaw's docs say "OpenAI explicitly supports subscription OAuth usage in external tools and workflows like OpenClaw."
- **Anthropic.** Two routes: an API key, or **Claude CLI reuse**. With Claude CLI reuse, OpenClaw runs the installed `claude` binary (`claude -p`), exposes its own tools to it through a **loopback MCP bridge** (`bundleMcp: true`), and "does not persist or refresh that login." A `claude setup-token` paste path also exists.
- **Token sink.** One credential store per agent. Once OpenClaw owns a refresh token it never falls back to CLI token files, because providers rotate refresh tokens and logging in from two tools "randomly" logs one of them out.

**Anthropic timeline.**
- **Feb 2026:** Anthropic updated its terms to prohibit subscription OAuth in third-party tools. [reported] https://alternativeto.net/news/2026/2/anthropic-officially-bans-using-subscription-authentication-for-third-party-claude-use ; https://gigazine.net/gsc_news/en/20260220-anthropic-third-party-block
- **2026-04-04:** Subscription limits were cut off for OpenClaw and other third-party harnesses. Users had to pay "extra usage" or bring an API key, and got a one-time credit. Boris Cherny: "subscriptions weren't built for the usage patterns of these third-party tools." [reported] https://thenextweb.com/news/anthropic-openclaw-claude-subscription-ban-cost
- **2026-05-13:** Anthropic reversed course with a planned "Agent SDK credit." [reported] https://www.betterclaw.io/blog/openclaw-anthropic-subscription-ban
- **2026-06-15:** That change was paused. Anthropic's primary page says: "Claude Agent SDK, `claude -p`, and third-party app usage still draw from your subscription limits."
- **2026-10-07:** Max and Team plans now include monthly API credits covering the Agent SDK, `claude -p`, the API and Managed Agents. [read] https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
- **Still in force:** "developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow." Advertised limits "assume ordinary, individual usage." [read] https://code.claude.com/docs/en/legal-and-compliance.md
- This is why OpenClaw now shells out to the unmodified `claude` binary instead of holding Anthropic OAuth tokens itself. [inferred]

**OpenAI.**
- "Sign in with ChatGPT" (SIWC): "ChatGPT plan usage is available to all open-source partners and selected private clients." [read] https://developers.openai.com/siwc/quickstart
- Codex app-server takes an `ACCESS_TOKEN` and sends it as a Bearer token to `/v1/responses`. "Only `completed` indicates success." [read] https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server

## 3. Security incidents and fixes
- **Exposed gateways (Jan 2026).** Jamieson O'Reilly found hundreds of "Clawdbot Control" panels on Shodan; others counted 900+ on port 18789, some leaking API keys, bot tokens and chat histories. The root cause was localhost auto-approval behind reverse proxies: proxied requests arrive from 127.0.0.1, and `trustedProxies` was empty. [reported] https://cybersecuritynews.com/clawdbot-chats-exposed/
  - Hunt.io later counted ~17,500 internet-facing instances. [reported] https://hunt.io/blog/cve-2026-25253-openclaw-ai-agent-exposure
  - **Fixes:** loopback bind by default; non-local connects need signed-nonce device pairing; `openclaw security audit`; an exposure runbook; trusted-proxy auth mode. Container images are still an "exposed bind" exception. [read] `OC/docs/gateway/security/index.md`, `OC/docs/concepts/architecture.md`
- **CVE-2026-25253 (CVSS 8.8).** The Control UI accepted a `gatewayUrl` query parameter and sent the stored gateway token to it. One click meant token theft, then operator access, then RCE, even against localhost-bound gateways. Fixed in 2026.1.29 with a confirmation before connecting to a new gateway URL. [reported] https://www.wiz.io/vulnerability-database/cve/cve-2026-25253 ; https://depthfirst.com/research/1-click-rce-to-steal-your-moltbot-data-and-keys
- **Malicious skills ("ClawHavoc").** Koi Security's 2026-02-01 audit of 2,857 ClawHub skills found 341 malicious. They used fake "prerequisite" curl-pipe-bash steps to drop the AMOS stealer and keyloggers, and some used cron for persistence. [reported] https://www.csoonline.com/article/4129393/ ; https://unit42.paloaltonetworks.com/openclaw-ai-supply-chain-risk/
  - **Fixes:** VirusTotal plus Code Insight scanning of every published skill with daily rescans (Feb 9); ClawScan; an NVIDIA screening partnership (Jun 1); account bans.
  - OpenClaw admitted it is "not a silver bullet" because natural-language payloads have no signature. Unit 42 still found 5 skills in Feb–May 2026 that passed every scanner. [reported] same
- **Moltbook** (an agent social network around OpenClaw) leaked 1.5M API tokens and 35k emails through a database misconfiguration. [reported] https://www.csoonline.com/article/4129393/
- **Prompt injection.** Docs fixes: wrapping with `<<<EXTERNAL_UNTRUSTED_CONTENT>>>` markers; stripping chat-template special tokens; sanitizing outbound `<tool_call>` markup; a read-only "reader agent" for untrusted mail and web content; `strictInlineEval` for allowlisted interpreters; heredocs always need approval. [read] `OC/docs/gateway/security/prompt-injection.md`
  - The docs cite adaptive attackers succeeding ">80%" against defenses, and call model choice only "your first and cheapest layer." [read] same

## 4. pi: the minimal harness
- **Packages:**
  - `pi-ai`: unified multi-provider LLM API.
  - `pi-agent-core`: "agent loop that handles tool execution, validation, and event streaming."
  - `pi-tui`.
  - `pi-coding-agent`: the CLI.
  - Newer packages: `pi-durable` and `chord`.
  [read] `PI/README.md`; https://www.mariozechner.at/posts/2025-11-30-pi-coding-agent/
- **Small by design:**
  - Four default tools: `read`, `bash`, `edit`, `write` (`grep`/`find`/`ls` are off by default).
  - "System prompt and tool definitions together come in below 1000 tokens."
  - No MCP (Playwright MCP alone is ~13.7k tokens of tool descriptions), no sub-agents, no plan mode, no built-in todos (use `PLAN.md`/`TODO.md` files), no background bash (use tmux).
  - "Full YOLO mode": no permission system, "since we cannot solve this trifecta (read data, execute code, network access)."
  [read] https://www.mariozechner.at/posts/2025-11-30-pi-coding-agent/ ; `PI/README.md` ("does not include a built-in permission system… containerize or sandbox Pi")
- **Session format:**
  - Append-only JSONL at `~/.pi/agent/sessions/--<path>--/<ts>_<id>.jsonl`.
  - Entries carry `id`/`parentId`, forming a **tree** so branches live in one file.
  - Entry types: `message` (system/user/assistant/toolResult), `model_change`, `compaction` (summary plus `firstKeptEntryId`), `branch_summary`, `context_edit` (an append-only override of an earlier entry, for future context only), `custom` (extension state, *not* sent to the LLM) and `custom_message` (sent to the LLM).
  - Version 3 auto-migrates older files.
  [read] `PI/packages/coding-agent/docs/session-format.md`
- **Extensions:** TypeScript modules loaded via jiti that run with full process permissions. They provide `pi.on()` events (`tool_call` can mutate or block, `tool_result`, `before_agent_start`, `agent_before_settle`), `registerTool`, `registerCommand`, `registerProvider`, `appendEntry` and hot reload. Modes: interactive, print/JSON, RPC and SDK. [read] `PI/packages/coding-agent/docs/extensions.md`
- **Philosophy:** the agent writes its own extensions; with hot reload it can "write code, reload, and test in a loop." [reported] https://lucumr.pocoo.org/2026/1/31/pi/
- **Why OpenClaw chose pi.** No primary statement from Steinberger was found.
  - Ronacher describes OpenClaw as a messaging agent "whose core is Pi."
  - The fit is evident: an embeddable SDK/RPC loop, a provider-neutral `pi-ai` with cross-provider context handoff, a tiny prompt that leaves room for persona and memory files, and extension events that map onto OpenClaw's hooks. [inferred]
  - OpenClaw later absorbed the code, likely to control auth, runtimes and transcript fencing itself. [inferred]

## 5. Patterns mapped to Rosie
Rosie is narrow: maintenance schedules, occurrences, completions and reminders, with **code owning writes**. OpenClaw is broad and model-first: its system prompt says tool availability *is* authorization. Rosie should invert that. [inferred]

## What Rosie should borrow
1. **Gateway shape, at Rosie scale.** One Bun process owns channels, scheduler and DB. Channels are adapters that normalize inbound messages into one `{sender, channel, text}` envelope. Use idempotency keys on every side-effecting call, and a dedupe table. (Arch doc §1.)
2. **Lane-per-conversation serialization** plus a writer claim. Serialize agent runs per household thread, and have a write commit check `proposal.version`/`expectedWriterRunId` inside the SQLite transaction so a stale proposal cannot apply. (Agent-loop doc.)
3. **Pairing and allowlists, deny by default.** Accept only Ross's and Carly's channel IDs. Unknown senders get nothing, or a pairing code that Ross approves in the web UI. Keep "who can trigger" separate from "what context the model sees."
4. **Command payloads for deterministic jobs.** Reminders and recurrence math run as plain scheduled code with no model turn. Use a model only to *phrase* or *triage*, never to decide that something is due. Use OpenClaw's coalesce-after-sleep and rebuild-schedules-from-store-at-startup rules.
5. **An optional heartbeat digest** with the `NO_REPLY` convention: an isolated, light-context turn reading only a computed "what's due/overdue" summary. Quiet runs send nothing.
6. **Subscription auth the compliant way.** Drive the *unmodified* `claude -p` / Agent SDK logged in as Ross, and the Codex app-server/CLI logged in as Ross. Never copy, store or refresh their tokens yourself (Anthropic's legal page; OpenClaw's "token sink" lesson). Expose Rosie's **propose-only tools via a loopback MCP server**, as OpenClaw does for `claude-cli`. Disable the CLIs' native Bash/Write/Edit.
7. **pi's session-tree JSONL ideas for the agent log:** append-only entries with `parentId`; `custom` entries for non-LLM state such as proposal IDs and receipts; `context_edit` instead of rewriting history. Store it in SQLite tables rather than files. [inferred]
8. **Tiny prompt and small tool surface** (pi: under 1k tokens, 4 tools). Rosie needs something like `list_items`, `get_item`, `propose_completion`, `propose_schedule_change`, `propose_note`. Every `propose_*` returns a proposal ID, never a mutation.
9. **Memory as plain, human-editable files or rows** (`USER.md`-style dated directives, curated `MEMORY.md`), with the explicit rule that memory never authorizes an action.
10. **Delivery receipts and a metadata-only audit ledger.** Record `{run, proposal, approver, applied_at, rows_changed, delivered:true}` without copying prompts into the audit table.
11. **Untrusted-content wrapping.** If Rosie ever reads email, manuals or web pages, wrap them in boundary markers and summarize them in a tool-less "reader" pass first.

## What to avoid
- **Model-held write authority.** No shell or file tools, and no "a requested action with an available tool is authorized." Approval must be a code-checked state transition (proposal, then person approves on an authenticated surface, then code applies), never a model judgement or a memory note.
- **Third-party skill or plugin marketplaces** and auto-installing anything (ClawHavoc). Ship only code-reviewed tools.
- **Trusting loopback or proxy headers as identity** (the Jan 2026 exposure). The web UI behind Tailscale should still authenticate the user, for example with Tailscale identity headers *only* when bound to the tailnet interface, plus CSRF protection on approve buttons.
- **URL parameters that redirect credentials** (CVE-2026-25253). Never accept a target host or token destination from a query string.
- **One shared "main" session across people.** Use per-person threads with explicit household-shared state in the DB.
- **Holding Anthropic or OpenAI OAuth tokens in Rosie's DB**, or sharing one login across agents (refresh-token rotation logs one of them out).
- **pi's YOLO default** and OpenClaw's sandbox-off default. Rosie's model process should have no host access at all.
- **Feature creep:** multi-agent, nodes, canvas, 20+ channels. OpenClaw's docs sprawl (the agent-loop page alone covers dozens of retry and timeout edge cases) shows what a general agent costs. [inferred]

## Open risks
- **Subscription policy is volatile.** Anthropic banned, then restored, then paused, then added credits within 8 months, and "may enforce… without prior notice." Keep a provider switch (Claude to Codex) and a no-model degraded mode where reminders still work. [read/inferred]
- **"Ordinary, individual usage."** A 24/7 heartbeat on Ross's plan could be read as non-ordinary. Keep agent turns user-initiated or infrequent.
- **CLI-as-runtime fragility.** `claude -p` and the Codex app-server change flags and output formats. Pin versions, parse defensively, and treat only an explicit success status as success (OpenAI: "only `completed` indicates success").
- **Prompt injection through household content** (pasted receipts, contractor emails) can still produce misleading *proposals*. Human approval must show a code-rendered diff of the change, not the model's prose summary.
- **Channel bridges** (WhatsApp via Baileys, iMessage) are unofficial and break or ban accounts. Prefer Telegram, email or web push for v1. [inferred]
- **Approval spoofing.** Approving from a chat message relies on channel sender IDs. Bind approvals to a signed, single-use token or the authenticated web UI.
- **Coverage gap in this research:** docs.openclaw.ai and the GitHub API were blocked here. Doc paths were read via raw GitHub, but OpenClaw's source code (e.g. `src/`) was not inspected beyond package manifests.
