# 01 — Claude Code / Claude Agent SDK as Rosie's model harness (subscription, no API key)

> **Decision, 2026-10-17:** Ross confirmed the Claude and Codex subscriptions power Rosie, and that either the command-line tools or direct use of the subscription sign-in is fine. The terms and policy material below is background from the research round; it does not constrain the design. See [the plan](../../pilot/harness-plan.md).

Researched 2026-10-17. Labels: **[read]** = stated in the cited source; **[reported]** = secondary/press
reporting of Anthropic statements; **[inferred]** = my reading, not stated anywhere.

## TL;DR

- Run Claude headlessly with `claude -p ... --output-format json --json-schema ...` or the TS Agent SDK
  (`@anthropic-ai/claude-agent-sdk`, which spawns the same Claude Code binary). Both can authenticate with a
  subscription via `claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN` (1-year token), **but not in `--bare` mode**.
- Policy is in tension: the Agent SDK docs and legal page tell *developers building products* to use API keys,
  but Anthropic's own support article (updated 2026-06-15 and 2026-10-07) says **"You can still use the Claude
  Agent SDK, `claude -p`, and third-party apps with your subscription limits."** A personal, single-household
  tool run by the subscriber on his own machine sits on the permitted side of the line as of today [inferred],
  with real risk of future change.

## 1. Headless use (`claude -p`)

Source: https://code.claude.com/docs/en/headless and https://code.claude.com/docs/en/cli-reference

- `-p`/`--print` runs non-interactively; exit code 0 on success, non-zero on failure; "When a failure happens
  inside the run, such as missing authentication, Claude Code prints the failure as the result on stdout." [read]
- `--output-format text|json|stream-json`. `json` = "structured JSON with result, session ID, and metadata";
  `stream-json` = NDJSON events, last line is a `result` message. [read]
- `--json-schema '<schema>'` with `--output-format json` → validated object in `structured_output`. Invalid schema
  → `Error: --json-schema is not a valid JSON Schema`. `format` keyword is not enforced. [read]
  SDK equivalent `outputFormat: {type:'json_schema', schema}`; SDK "validates the output against it, re-prompting
  on mismatch"; failure → result subtype `error_max_structured_output_retries`; schemas are JSON Schema draft-07
  (Zod: `z.toJSONSchema(s, {target:"draft-7"})`). https://code.claude.com/docs/en/agent-sdk/structured-outputs [read]
- Tool control: `--allowedTools` (auto-approve, permission-rule syntax e.g. `Bash(git diff *)`), `--disallowedTools`
  (bare name removes the tool; `"*"` removes all), `--tools ""` disables all built-ins. [read, cli-reference]
- `--permission-mode default|acceptEdits|plan|auto|dontAsk|bypassPermissions`. `dontAsk` "denies every call that
  would otherwise prompt" — recommended for locked-down headless runs. `--permission-prompts none` (v2.1.259+)
  for unattended runs; denials listed in `permission_denials`. [read, headless]
- `--mcp-config <file|json>` + `--strict-mcp-config` (ignore all other MCP configs). With `-p`, startup waits for
  pending MCP servers up to `MCP_TIMEOUT` (30 s default). `system/init` event lists `mcp_servers` and
  `mcp_server_errors`. [read]
- `--max-turns N` (errors when reached), `--max-budget-usd X` (client-side estimate, can overshoot). [read]
- Sessions: `--continue`, `--resume <session_id>`, `--session-id <uuid>`, `--no-session-persistence`. [read]
- `--setting-sources user,project,local` controls which settings/CLAUDE.md load; `--system-prompt(-file)` replaces,
  `--append-system-prompt` adds. [read, cli-reference]
- `--bare` skips hooks/skills/plugins/MCP/CLAUDE.md discovery for speed and reproducibility and "will become the
  default for `-p` in a future release" — **but "bare mode doesn't use your subscription login"** and "does not read
  `CLAUDE_CODE_OAUTH_TOKEN`". [read, headless + https://code.claude.com/docs/en/authentication]
- SIGTERM → exit 143, in-progress turn left unfinished; send SIGINT / SDK `interrupt()` to end a turn cleanly. [read]

**What the JSON result contains** (TS type `SDKResultMessage`, https://code.claude.com/docs/en/agent-sdk/typescript) [read]:
`type:"result"`, `subtype` (`success` | `error_max_turns` | `error_during_execution` | `error_max_budget_usd` |
`error_max_structured_output_retries`), `session_id`, `uuid`, `is_error`, `api_error_status`, `duration_ms`,
`duration_api_ms`, `num_turns`, `result` (text), `stop_reason`, `total_cost_usd`, `usage`, `modelUsage` (per-model),
`permission_denials`, `structured_output`, `deferred_tool_use`, `terminal_reason`; error variants carry `errors[]`
and `startup_failure_reason`. `total_cost_usd` is a "client-side estimate, not authoritative billing data"
(https://code.claude.com/docs/en/agent-sdk/cost-tracking) — on a subscription it is notional [inferred].

## 2. Agent SDK + subscription authentication

- The SDK is "a library that runs the Claude Code binary" (https://code.claude.com/docs/en/agent-sdk/overview), so it
  uses Claude Code's credential precedence [read]. Precedence (https://code.claude.com/docs/en/authentication) [read]:
  cloud provider → `ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_API_KEY` → `apiKeyHelper` → **`CLAUDE_CODE_OAUTH_TOKEN`** →
  Anthropic profile → subscription OAuth from `/login`. "`apiKeyHelper`, `ANTHROPIC_API_KEY`, and
  `ANTHROPIC_AUTH_TOKEN` apply to the CLI and the surfaces that wrap it, including … the Agent SDK".
- `claude setup-token`: "generate a one-year OAuth token … It does not save the token anywhere; copy it and set it as
  the `CLAUDE_CODE_OAUTH_TOKEN` environment variable … This token authenticates with your Claude subscription and
  requires a Pro, Max, Team, or Enterprise plan. It can only make model requests" (no Remote Control, no claude.ai
  connectors; local MCP servers still work). [read, authentication]
- The token "carries only the `user:inference` scope", so `/usage` structured `rate_limits` aren't returned for it.
  [read, typescript reference]
- What the SDK docs say about subscriptions: "Unless previously approved, Anthropic does not allow third party
  developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent
  SDK. Use the API key authentication methods described in the Quickstart instead."
  (https://code.claude.com/docs/en/agent-sdk/overview and /agent-sdk/quickstart) [read]. The Quickstart only documents
  `ANTHROPIC_API_KEY` and cloud providers. [read]
- Gotcha: if `ANTHROPIC_API_KEY` is set, `-p` always uses it ("In non-interactive mode (-p), the key is always used
  when present"). Rosie must ensure it is unset. [read, authentication]
- SDK `env` option "**replaces** the subprocess environment. Spread `process.env` to keep inherited variables." [read]

## 3. Anthropic's rules for subscription use (quotes, URLs, dates)

**Consumer Terms** (Free/Pro/Max), "Effective October 8, 2025", https://www.anthropic.com/legal/consumer-terms [read]:
- §3(7) prohibits: "Except when you are accessing our Services via an Anthropic API Key or where we otherwise
  explicitly permit it, to access the Services through automated or non-human means, whether through a bot, script,
  or otherwise."
- §2: "You may not share your Account login information … with anyone else. You also may not make your Account
  available to anyone else."

**Claude Code Legal & compliance** (current text), https://code.claude.com/docs/en/legal-and-compliance [read]:
- "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK."
- "OAuth authentication is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise
  subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications."
- "Developers building products or services that interact with Claude's capabilities, including those using the
  Agent SDK, should use API key authentication … Anthropic does not permit third-party developers to offer Claude.ai
  login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of
  their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens".
- "Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice."

**Support article "Use the Claude Agent SDK with your Claude plan"**,
https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan [read]:
- "Update October 7, 2026: Claude Max and Team plans now include monthly API credits, which cover the Claude Agent
  SDK, claude -p, the Claude API, and Claude Managed Agents. You can still use the Claude Agent SDK, claude -p, and
  third-party apps with your subscription limits."
- "Update June 15, 2026: We've paused the previously-announced changes to Claude Agent SDK usage. For now, nothing has
  changed: Claude Agent SDK, claude -p, and third-party app usage still draw from your subscription limits."

**Timeline** (press, [reported]):
- Jan 2026: Anthropic engineer Thariq Shihipar: "Third-party harnesses using Claude subscriptions create problems for
  users and are prohibited by our Terms of Service" (https://www.theregister.com/software/2026/02/20/anthropic-clarifies-ban-on-third-party-tool-access-to-claude/5014546).
- ~Feb 19 2026: legal page briefly said "Using OAuth tokens obtained through Claude Free, Pro, or Max accounts in any
  other product, tool, or service — including the Agent SDK — is not permitted" (same Register article;
  https://gigazine.net/gsc_news/en/20260220-anthropic-third-party-block/). Feb 18 Shihipar: "We want to encourage
  local development and experimentation with the Agent SDK and claude -p." / "If you're building a business on top of
  the Agent SDK, you should use an API key instead." (GIGAZINE). That wording is no longer on the page [read: current page].
- Apr 4 2026: subscription limits "can no longer be used with third-party harnesses including OpenClaw"; pay-as-you-go
  "extra usage" instead (https://www.techradar.com/pro/bad-news-claude-users-anthropic-says-youll-need-to-pay-to-use-openclaw-now,
  https://lilting.ch/en/articles/anthropic-claude-code-openclaw-third-party-paygo).
- May 14 2026: announced that from Jun 15 Agent SDK + `claude -p` usage would move to a separate monthly credit
  (Pro $20, Max5x $100, Max20x $200); paused on Jun 15 (https://www.digitalapplied.com/blog/anthropic-claude-credit-overhaul-june-15-2026;
  pause confirmed by the support article above [read]).
- Oct 2026: Max/Team get monthly API credits ($100 Max5x, $200 Max20x; Pro not eligible; expire each cycle). "Agent
  SDK and claude -p: Covered only when you run them yourself with an API key from the linked organization. If you're
  signed in with your Claude plan, they use your plan limits instead."
  (https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans) [read via summary].

**Limits**: "Both Pro and Max plans have a five-hour session limit and a weekly limit … shared across Claude and
Claude Code" (https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan) [read].
SDK emits `rate_limit_event` with `status: allowed|allowed_warning|rejected`, `resetsAt`, `utilization`;
`errorCode:"credits_required"` = subscription usage exhausted. [read, typescript reference]

**Distinguishing the two cases** [inferred from the above]:
- *Claude Code itself running unattended for me* (Ross runs the unmodified `claude` binary via `claude -p` or the SDK,
  on his machine, with his own token, for his own household): the support article explicitly says SDK/`claude -p`
  draw from subscription limits; the legal page's prohibitions target *third-party developers* offering login or
  routing *their users'* requests. Fits "ordinary, individual usage". Best-supported reading: **permitted today.**
- *My own app calling the model through a subscription token* (extracting the OAuth token and hitting the API
  directly, or a third-party harness like OpenClaw/OpenCode spoofing Claude Code): this is what was blocked in
  Jan–Apr 2026. **Not permitted / not technically supported.** Rosie must never call the Messages API with the OAuth
  token itself — always go through the `claude` binary.
- Grey zone: Carly using Rosie means a second person's requests run on Ross's account. Consumer Terms §2 forbids
  making the account "available to anyone else"; the legal page forbids routing requests "on behalf of their users".
  A household assistant where Ross is the operator is arguably personal use, but it is not explicitly addressed.
  Mitigation: keep Claude in the *proposal* step only, low volume; or give Carly her own token if she subscribes.

## 4. Harness patterns worth borrowing

- **Permission pipeline** (https://code.claude.com/docs/en/agent-sdk/permissions) [read]: hooks → deny rules → ask
  rules → permission mode → allow rules → `canUseTool`. "Auto-approved tools never reach `canUseTool`." `dontAsk`
  turns every unresolved prompt into a denial — good default for Rosie.
- **Hooks** (https://code.claude.com/docs/en/agent-sdk/hooks, https://code.claude.com/docs/en/hooks) [read]: `PreToolUse`
  returns `permissionDecision: "allow"|"deny"|"ask"|"defer"` plus `updatedInput`; also `PostToolUse` (audit log),
  `UserPromptSubmit`, `Stop`, `SessionStart`/`SessionEnd`. **`"defer"`** (only in `-p`, single tool call per turn)
  ends the run with `stop_reason:"tool_deferred"` and `deferred_tool_use {id,name,input}`; the caller later runs
  `--resume <session>` and the hook returns allow/deny. No timeout; sessions swept after 30 days by default. This is
  literally Rosie's propose → human approve → execute loop, though Rosie can simply do it outside the model [inferred].
- **In-process custom tools**: `tool(name, desc, zodShape, handler)` + `createSdkMcpServer({name, tools})`, passed as
  `mcpServers` (https://code.claude.com/docs/en/agent-sdk/custom-tools). Tool search defers schemas by default;
  `alwaysLoad: true` keeps them in prompt. [read] Rosie can expose read-only `list_tasks`, `find_task`, and a
  `propose_action` tool whose handler only records a proposal — never writes. [inferred]
- **Structured output** as the main contract (`--json-schema` / `outputFormat`) — model returns
  `{proposals:[...]}`, Rosie validates with its own code. [read + inferred]
- **Skills / CLAUDE.md / subagents**: SDK loads `.claude/skills`, commands, CLAUDE.md from project/user unless
  `settingSources: []` (https://code.claude.com/docs/en/agent-sdk/overview, typescript reference) [read]. For Rosie,
  prefer an explicit `systemPrompt` string and `settingSources: []` for determinism; borrow the *idea* of SKILL.md
  (per-domain instruction files loaded on demand) and CLAUDE.md (household facts file) rather than the mechanism. [inferred]
- **Budgets/timeouts**: `maxTurns`, `maxBudgetUsd`, `abortController`, `API_TIMEOUT_MS` env; result `subtype` tells
  you which limit hit. [read]
- **Usage reporting**: `usage`, `modelUsage`, `total_cost_usd` per call; `rate_limit_event`; `system/api_retry`
  events with `error` category (`rate_limit`, `authentication_failed`, `overloaded` …). [read, headless]
- **Pre-warming**: TS `startup()` / `prewarm()` spawn and initialize the subprocess ahead of the prompt; a spare
  holds "roughly 230 to 260 MB of memory". [read, typescript reference]

## 5. Running as a background service on a Linux VM — gotchas

- **Auth**: use `claude setup-token` once (browser on any machine), store token in a root-only env file read by the
  systemd unit; it lasts one year and does not rotate [read, authentication]. Calendar a renewal; Rosie should alert
  on `authentication_failed` [inferred]. Avoid relying on `/login` credentials in `~/.claude/.credentials.json`:
  multiple concurrent processes "race on ~/.claude/.credentials.json token refresh" with "no file-level locking"
  (issue #56339, May 2026, https://claudeissues.com/issue/56339-multiple-cli-sessions-race-on-claude-credentials-json-token-refresh)
  [reported]. The static env token sidesteps refresh races [inferred].
- **No `--bare`** with a subscription → emulate it: `--setting-sources ""`/`settingSources: []`, `--strict-mcp-config`,
  explicit `--tools`, `--system-prompt`, `--no-session-persistence`, and a dedicated `CLAUDE_CONFIG_DIR` + empty cwd
  so nothing in `~/.claude` or a repo leaks in. Without bare, `-p` "runs the hooks in a project's .claude/settings.json
  and connects the servers in its .mcp.json, even in a folder you've never trusted". [read, headless]
- **Latency**: one report measured `claude -p "hi" --bare` ≈ 2.05 s on macOS, v2.1.205 (July 2026)
  (https://claudeissues.com/issue/76393-claude-code-interactive-hi-12s-vs-grok-2-8s-bare-p-is-not-the-real-path)
  [reported]; non-bare is slower and an old issue reports long warm-up on slow devices (#3044) [reported]. Expect
  several seconds per "Tell Rosie" call including model time [inferred]; fine for an approve-then-write UX, use
  `prewarm()` or a spinner.
- **Memory**: each call is a Claude Code process (~230–260 MB idle per prewarmed spare, [read]). Serialize calls
  (queue of 1) on a small VM [inferred].
- **Concurrency / limits**: all usage shares Ross's 5-hour and weekly limits with his own interactive Claude use
  [read]. A runaway loop could lock Ross out of Claude for the week [inferred] → hard `maxTurns` (e.g. 3–4),
  rate-limit Rosie's own calls, handle `rate_limit_event: rejected` by degrading to manual entry.
- **Updates**: the binary changes fast (flags gated on v2.1.2xx); pin the SDK/CLI version and upgrade deliberately
  [inferred]. Under Bun: the TS SDK spawns the bundled native binary; `pathToClaudeCodeExecutable` if optional deps
  are skipped [read]; Bun compatibility itself is untested here [inferred].
- **Signals**: systemd stop sends SIGTERM → exit 143, turn unrecorded; send SIGINT / `interrupt()` first [read].
- `ANTHROPIC_API_KEY` in the environment silently overrides the subscription in `-p` [read] — scrub env.

## What Rosie should borrow

- Call Claude only via the official binary (`claude -p` or TS Agent SDK), authenticated by `CLAUDE_CODE_OAUTH_TOKEN`
  from `claude setup-token`; never touch the Messages API with that token.
- Make the model a pure *proposer*: no built-in tools (`--tools ""` / `disallowedTools: ["*"]` except Rosie's own
  read-only MCP tools), `permissionMode: "dontAsk"`, output via JSON Schema → Rosie validates → human approves →
  Rosie writes with a receipt.
- Use in-process MCP tools (`createSdkMcpServer`) for read-only lookups (tasks, schedules, last completion) so the
  prompt stays small.
- Hard limits per call: `maxTurns` 3–4, timeout via `AbortController`, one call at a time; log `session_id`,
  `num_turns`, `duration_ms`, `usage`, `modelUsage`, `subtype`, `permission_denials` into SQLite next to the receipt.
- Watch `rate_limit_event` / `system/api_retry` (`authentication_failed`, `rate_limit`) and fall back to a non-AI
  "manual log" path with a push notification to Ross.
- Deterministic config: dedicated `CLAUDE_CONFIG_DIR`, empty cwd, `settingSources: []`, explicit system prompt,
  `--strict-mcp-config`, `--no-session-persistence` (or keep sessions only if using `defer`/resume).
- Optional: the `PreToolUse` `"defer"` + `--resume` pattern if Rosie ever lets Claude call a write tool that must wait
  for approval.
- Keep a provider abstraction so the Codex/ChatGPT path (see other research) is a drop-in fallback.

## Open risks

- **Policy volatility**: four changes in 2026 (Jan block, Feb wording, Apr third-party cutoff, May/Jun announced-then-
  paused SDK split). The SDK/`claude -p` subscription allowance is explicitly "For now". Anthropic may enforce
  "without prior notice". Design for an outage of the Claude path.
- **Docs conflict**: SDK overview/quickstart still say use API keys and "does not allow third party developers to offer
  claude.ai login"; support article says SDK/`claude -p` on subscription limits is fine. Rosie relies on the reading
  that a subscriber's own private tool is not a "third-party developer" product [inferred].
- **Two humans, one account**: Carly's requests on Ross's subscription vs. Consumer Terms §2 "may not make your
  Account available to anyone else" — unaddressed; low-volume, operator-mediated use is the mitigation.
- **Consumer Terms §3(7)** bars "automated or non-human means … script" except API key "or where we otherwise
  explicitly permit it"; the permission rests on the support article and Claude Code docs, not the Terms.
- **Shared limits**: Rosie competes with Ross's own Claude/Claude Code usage (5-hour + weekly windows).
- **Token lifecycle**: one-year token; silent failure at expiry if not monitored; `/usage` quota data unavailable
  with `user:inference` scope.
- **No `--bare`** for subscription auth: slower startup and risk of picking up stray hooks/MCP/CLAUDE.md unless the
  config dir and cwd are isolated; `--bare` may become default for `-p` later (watch release notes).
- **Resource/latency** on a small VM: ~0.25 GB per Claude process, multi-second calls; Bun + SDK compatibility unverified.
- Cost figures (`total_cost_usd`) are API-price estimates, meaningless for subscription billing but useful as a
  relative "how heavy was this call" metric.
