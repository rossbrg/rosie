# 02: OpenAI side (Codex CLI, ChatGPT sign-in, terms, Agents SDK)

Researched 2026-10-17. Tags: **[read]** = I read it in the source at the URL. **[inferred]** = my own conclusion.
How I read the sources: Codex source files came from `raw.githubusercontent.com/openai/codex/main/...`, the `main` branch as of today. Docs pages came through a fetch tool that summarises pages, so short quotes are exact but long passages are condensed. Note that `developers.openai.com/codex/*` now 302-redirects to `learn.chatgpt.com/docs/*`. Nothing was installed and no `codex` command was run, so no behaviour here was tested.

## 1. Codex CLI headless (`codex exec`)

**Core behaviour [read]** (https://learn.chatgpt.com/docs/non-interactive-mode)
- "Progress goes to stderr, and only the final agent message goes to stdout."
- If you pipe stdin and also give a prompt, the stdin is added as a `<stdin>` block (`codex-rs/exec/src/cli.rs`, https://raw.githubusercontent.com/openai/codex/main/codex-rs/exec/src/cli.rs).
- **The default sandbox for `codex exec` is read-only.** Other modes are `--sandbox workspace-write` and `danger-full-access`. `--full-auto` is "no longer supported".
- Flags in source (cli.rs plus `codex-rs/utils/cli/src/shared_options.rs`):

  | Flag | What it does |
  |---|---|
  | `--json` | "Print events to stdout as JSONL" |
  | `--output-schema FILE` | "JSON Schema file describing the model's final response shape" |
  | `-o/--output-last-message FILE` | Writes the final message to a file |
  | `--ephemeral` | "Run without persisting session files to disk" |
  | `--skip-git-repo-check` | Allows running outside a git repo |
  | `--ignore-user-config` | Skips `$CODEX_HOME/config.toml`, but auth still uses `CODEX_HOME` |
  | `--ignore-rules` | Skips execpolicy `.rules` files |
  | `--strict-config` | Errors on unknown config keys |
  | `-m/--model` | Picks the model |
  | `-p/--profile` | Picks a profile (see Profiles below) |
  | `-s/--sandbox` | Picks the sandbox mode |
  | `--approve-for-me` | "Route approval requests through automatic review using the workspace-write sandbox" |
  | `-C/--cd DIR` | Sets the working root |
  | `--add-dir` | Adds writable directories |
  | `--dangerously-bypass-approvals-and-sandbox` | Removes both sandbox and approvals |
  | `-c key=value` | Config overrides (TS SDK README below) |

- `codex exec resume <SESSION_ID|--last> [PROMPT]` and `codex exec fork <SESSION_ID>` exist. `review` is also a subcommand (cli.rs).
- **Required MCP servers:** if an MCP server marked `required = true` fails to start, `codex exec` exits with an error (non-interactive-mode page).

**`--json` event stream [read]** (https://raw.githubusercontent.com/openai/codex/main/codex-rs/exec/src/exec_events.rs)
- Top-level event `type` values: `thread.started` (carries `thread_id`), `turn.started`, `turn.completed` (carries `usage`: input, cached input, output and reasoning tokens), `turn.failed`, `item.started`, `item.updated`, `item.completed`, `error`.
- Item types: `agent_message`, `reasoning`, `command_execution` (status in_progress/completed/failed/declined), `file_change`, `mcp_tool_call`, `collab_tool_call`, `web_search`, `todo_list`, `error`.
- Example lines from the docs: `{"type":"thread.started","thread_id":"0199a213-..."}` and `{"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"..."}}`.

**Structured output [read]**
- `codex exec "Extract project metadata" --output-schema ./schema.json -o ./project-metadata.json`. The docs' example schema uses `required` and `additionalProperties:false` (non-interactive-mode page).
- The TS SDK (`@openai/codex-sdk`) "wraps the `codex` CLI … spawns the CLI and exchanges JSONL events over stdin/stdout". It accepts `outputSchema` on each turn, and `resumeThread(id)` resumes from `~/.codex/sessions` (https://raw.githubusercontent.com/openai/codex/main/sdk/typescript/README.md).
- **[inferred]** Rosie can call `codex exec` from Bun with `Bun.spawn` and parse JSONL. It does not need the SDK, because the SDK is only a thin wrapper over the CLI.

**Sandbox and approvals [read]** (https://learn.chatgpt.com/codex/agent-approvals-security)
- Approval policies: `on-request`, `never`, and `granular = {...}`. "Codex and ChatGPT Work no longer support `approval_policy = "untrusted"`."
- The docs' read-only CI recipe is `--sandbox read-only --ask-for-approval never`.
- In `workspace-write`, network access "is off by default".
- "Linux uses `bwrap` plus `seccomp` by default."
- With `approvals_reviewer = "auto_review"`, a reviewer agent checks eligible requests.
- "Destructive app/MCP tool calls always require approval when the tool advertises a destructive annotation."

**AGENTS.md [read]** (https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- Global level: `~/.codex/AGENTS.override.md`, otherwise `AGENTS.md`.
- Project level: Codex walks from the project root down to the cwd, taking at most one file per directory.
- The combined files are capped at `project_doc_max_bytes`, default 32 KiB.
- "The instruction chain is rebuilt on every run."

**MCP client [read]** (https://learn.chatgpt.com/docs/extend/mcp.md?surface=cli)
- Servers are configured as `[mcp_servers.<name>]`. A stdio server takes `command`, `args`, `env`, `env_vars` and `cwd`. A streamable HTTP server takes `url`, `bearer_token_env_var` and `http_headers`.
- Other keys: `enabled_tools`, `disabled_tools`, `required`, `startup_timeout_sec`, `tool_timeout_sec`, `enabled`, `default_tools_approval_mode`, `tools.<tool>.approval_mode`.
- CLI commands: `codex mcp add|list|login`.

**`codex mcp-server` [read]**
- The `Subcommand` enum in `codex-rs/cli/src/main.rs` on `main` has **no `mcp-server` subcommand**.
- `codex-rs/mcp-server/Cargo.toml` returns 404.
- What is there is `codex mcp` (managing external MCP servers) and `codex app-server` [experimental] (https://raw.githubusercontent.com/openai/codex/main/codex-rs/cli/src/main.rs).
- **[inferred]** Codex-as-MCP-server (the old `codex` / `codex-reply` tools) appears to have been removed or replaced by app-server (JSON-RPC). Rosie should not rely on it.

**Profiles [read]**
- The source help text says `--profile` will "Layer $CODEX_HOME/<name>.config.toml on top of the base user config". It is accepted by `exec`, `review`, `resume`, `mcp`, `sandbox` and others (main.rs).
- **[inferred]** This is a newer "profile v2" scheme: separate `rosie.config.toml` files rather than `[profiles.x]` tables. I could not fetch the full config reference to confirm whether `[profiles.x]` is still supported.
- **[inferred]** Simplest isolation: give Rosie its own `CODEX_HOME` (for example `/var/lib/rosie/codex`) with its own `config.toml`, `AGENTS.md` and `auth.json`.

## 2. ChatGPT sign-in vs API key, headless Linux

**Sign-in methods and storage [read]** (https://learn.chatgpt.com/docs/auth)
- There are two methods: "Sign in with ChatGPT for subscription access" and "Sign in with an API key for usage-based access". With an API key, "Codex uses standard API pricing instead of included ChatGPT plan credits."
- Credentials are cached "in a plaintext file at `~/.codex/auth.json` or in your OS-specific credential store". `cli_auth_credentials_store` can be `file`, `keyring`, `auto` or `ephemeral`.
- "Codex refreshes tokens automatically during use before they expire."

**Headless login [read]** (codex-rs/cli/src/main.rs and login.rs)
- `codex login --device-auth` exists.
- The browser login flow prints: "On a remote or headless machine? Use `codex login --device-auth` instead."
- The code also "Prefers device-code login … when headless environment is detected" and falls back to browser login if device code "is not enabled".
- Other login options: `codex login --with-api-key` and `--with-access-token`, both reading from stdin.

**Running automation as your own ChatGPT account [read]** (https://learn.chatgpt.com/codex/auth/ci-cd-auth). This is the official guide for exactly Rosie's setup:
- "Use this guide only if you specifically need to run the workflow as your Codex account." It also says "API keys are still the recommended option for most CI/CD jobs" and "Do not use this workflow for public or open-source repositories". Use it only on "trusted private infrastructure".
- **How the refresh works:** "if `last_refresh` is older than about 8 days, Codex refreshes the token bundle before the run continues". After a refresh, "Codex writes the new tokens … back to `auth.json`". It also retries after a 401.
- **Seeding the file:** set `cli_auth_credentials_store = "file"` and run `codex login`. "The critical detail is to seed `auth.json` only if it is missing." Re-copying the original on every run "throw[s] away the refreshed tokens".
- **Concurrency:** "Use one `auth.json` per runner or per serialized workflow stream." "Do not share the same file across concurrent jobs or multiple machines."
- **Not permanent:** "it does not guarantee the same session lasts forever". You must reseed if the refresh token is revoked or expires.

**Personal access tokens [read]** (https://learn.chatgpt.com/codex/enterprise/access-tokens)
- "Currently supported for ChatGPT Business and Enterprise workspaces." **They are not an option on Plus/Pro.**

**Usage limits per plan [read]** (https://learn.chatgpt.com/docs/pricing, as the fetch tool returned it today)
- Plus and Standard Business, local messages per 5 hours:

  | Model | Messages per 5 hours |
  |---|---|
  | GPT-6 Astra | 5–45 |
  | GPT-6.1 Sol | 15–160 |
  | GPT-6 Sol | 15–150 |
  | GPT-6 Luna | 350–3,000 |

- "Weekly limits may also apply."
- "Pro plans currently have no five-hour limit." Pro costs "$100, $200, or $500 USD per month".
- Plus/Pro users can buy credits when they hit a limit.
- "GPT-5.5 retires from Codex with ChatGPT sign-in on October 14, 2026."
- If a limit is reached mid-turn, "Codex can continue working on that turn, subject to fair-use limits" (https://help.openai.com/en/articles/11369540-codex-in-chatgpt).

## 3. Terms and policy: using a subscription to power a personal always-on app

**Consumer Terms of Use**, effective January 1, 2026 [read] (https://openai.com/policies/terms-of-use/). Under "What you cannot do":
- "Automatically or programmatically extract data or Output"
- "Interfere with or disrupt our Services, including circumvent any rate limits or restrictions"
- "You may not share your account credentials or make your account available to anyone else"

**Codex is OpenAI's own client and is documented for unattended use [read].**
- The CI/CD guide above explicitly supports running `codex exec` as your ChatGPT account on "trusted private infrastructure". It also documents seeding and persisting `auth.json` for runners.
- **[inferred]** Running `codex exec` on Ross's own VM for his own household falls inside documented, sanctioned use. It is not "extracting" data via an unofficial client. Two cautions:
  - The Terms' "programmatically extract" clause is broad and was not written with Codex in mind.
  - Carly typing into Rosie means a second person's requests run on Ross's account. Arguably that is "making your account available to anyone else". The risk is low but real.

**"Sign in with ChatGPT" (SIWC) plan usage for third-party apps [read].** This is new, and it is the officially sanctioned OAuth route:
- **Announcement:** The New Stack, Sept 29, 2026 (https://thenewstack.io/sign-in-with-chatgpt/). "Plus and Pro subscribers" can use their plan in 16 launch partners (OpenCode, OpenClaw, Amp, Warp, …). Usage counts against plan limits, and users can set per-app weekly caps.
- **Help article** (https://help.openai.com/en/articles/20001542-using-your-chatgpt-plan-in-other-apps-and-sites, page says "Updated: 10 days ago"):
  - Plan usage "is only available with Go, Plus, and Pro".
  - "Supported open-source tools remain available to all ChatGPT users."
  - "An app limit is a cap, not a separate pool of usage."
  - "Do not share passwords, API keys, access or refresh tokens, or local files containing sign-in credentials."
- **Developer docs** (https://developers.openai.com/siwc/token-sharing-open-source):
  - "These docs explain ChatGPT plan usage for open-source and locally hosted apps."
  - Apps register dynamically with `client_id=dynamic_agent_client`, use PKCE, use a `127.0.0.1` loopback callback, and request the scopes `offline_access resource.invoke chatgpt.tokens.use.direct` (https://developers.openai.com/siwc/token-sharing-open-source/sign-in).
  - There is a self-hosted VM guide: sign in locally, then transfer the credential file over SSH. It warns: "Host-specific usage attribution and revocation of ChatGPT plan access for transferred sessions are not yet available" (https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms).
  - Inference is POST `https://api.openai.com/v1/responses` with the bearer token, and it must set `store:false` and `stream:true`. Many parameters are rejected (temperature, max_output_tokens, metadata, …), and so are hosted tools. Usage errors are `subscription_sharing_usage_limit_exceeded` and `subscription_sharing_usage_unavailable` (https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations and .../models-and-inference).
  - The client-ID page, by contrast, says SIWC "is currently offered to a select group of commercial partners" and points to a waitlist (https://developers.openai.com/siwc/request-client-id).
  - **[inferred]** That waitlist applies to commercial and website integrations. The open-source dynamic-registration path looks self-serve.
- **What the SIWC pages do not say [read]:** no page I found defines a private, closed-source household app as eligible or ineligible. No page names a prohibition for always-on background use.
- **[inferred]** Using the raw ChatGPT OAuth token that Codex stores (`auth.json`) in Rosie's own HTTP client, without going through Codex, is **not** sanctioned. The CI/CD guide scopes itself to Codex-managed auth and excludes "generic OAuth clients outside Codex". The SIWC route requires its own registration and scopes.

**Bottom line [inferred]:** There are two legitimate routes.
- (a) Shell out to the official `codex exec` with Ross's ChatGPT login on the VM, following the CI/CD auth guide.
- (b) Register Rosie as a locally hosted SIWC app (preview, Responses API only).

Route (a) is better documented and matches "no API keys". **Do not lift tokens out of `auth.json`.**

## 4. OpenAI Agents SDK: patterns worth borrowing

The SDK normally uses an API key, so it is not a fit as-is. These patterns are worth copying.

**Human-in-the-loop [read]** (https://raw.githubusercontent.com/openai/openai-agents-js/main/docs/src/content/docs/guides/human-in-the-loop.mdx)
- **Approval rule:** a tool has `needsApproval: true` or an async predicate. If approval is needed, "the tool call does not execute". The run records a `RunToolApprovalItem` and returns `interruptions`.
- **Decisions:** you resolve each item with `state.approve(item)` or `state.reject(item, {message})`. Optional `alwaysApprove` / `alwaysReject` make a sticky decision, but "an exact decision for one call ID takes precedence".
- **Fail closed on bad input:** "Malformed JSON and non-object values fail closed."
- **Long waits:** serialise with `result.state.toString()` and resume with `RunState.fromString(agent, s)`. The guide says to "Store serialized state in application-controlled storage, such as a server-side database."
- **Server-owned approvals:** `fromString()` "does not authenticate the snapshot or the person submitting it". The server must:
  1. Authenticate the reviewer from the session, never from the request body.
  2. Authorise the reviewer against the stored run.
  3. Validate decision IDs against the stored pending items. Never accept replacement args from the client.
  4. "Atomically check ownership and consume the pending request … Concurrent or replayed submissions must not resume the same snapshot twice."
- **Exactly-once is not guaranteed:** "Consumption prevents resubmitting this snapshot; it does not guarantee exactly-once tool side effects. Reconcile … before … recovery."
- **Version your state:** store a code or agent version alongside the serialised state.

**Guardrails [read]** (https://raw.githubusercontent.com/openai/openai-agents-js/main/docs/src/content/docs/guides/guardrails.mdx)
- There are input, output and tool guardrails. A guardrail sets `tripwireTriggered` to throw.
- `runInParallel:false` blocks before the model runs. Tool guardrails "run on every function-tool invocation", with input checks before execution and output checks after.
- By default, tool input guardrails run after approval. `preApprovalInputGuardrails` also runs them before the person is asked.

**Tracing [read]** (https://raw.githubusercontent.com/openai/openai-agents-js/main/docs/src/content/docs/guides/tracing.mdx)
- A trace is one workflow, with `workflow_name`, `trace_id` and `group_id` (for example a thread ID). It contains spans for generations, tools, guardrails and custom events.
- Custom processors can send traces somewhere other than OpenAI.

**Sessions [read]** (https://raw.githubusercontent.com/openai/openai-agents-js/main/docs/src/content/docs/guides/sessions.mdx)
- A pluggable `Session` interface fetches prior items before a turn and persists new ones afterwards.
- `MemorySession` is for local use. The docs give examples for file-backed and Prisma backends, and a compaction wrapper.

## 5. Practical gotchas for `codex exec` as a background job

- **Serialise runs [read + inferred].** One `auth.json` per "serialized workflow stream", and never concurrent jobs on one file (ci-cd-auth). Rosie should keep a single-worker queue for Codex calls and one dedicated `CODEX_HOME`.
- **Don't clobber refreshed tokens [read].** The VM must keep the `auth.json` it rewrites. Never restore it from a backup or seed on each start. Monitor for auth failure and alert Ross to re-run `codex login --device-auth`.
- **Read-only by default [read].** That suits a "propose only" agent. Keep `--sandbox read-only`, give no write tools, and let Rosie's code do every write.
- **Run outside a git repo [read].** Use `--skip-git-repo-check`, plus `--ephemeral` if transcripts should not pile up in `~/.codex/sessions`. Otherwise keep the rollouts as an audit trail.
- **Latency [inferred, not measured].** Each call spawns a process, loads config and AGENTS.md, starts any MCP servers, and runs an agentic turn. Expect seconds to tens of seconds, not sub-second.
  - Use the cheapest model, which on Plus is "GPT-6 Luna" at 350–3,000 messages per 5 hours.
  - Use low reasoning effort (`-c model_reasoning_effort=...`; I could not confirm the key name in the reference).
  - Keep AGENTS.md short and pass the needed context in the prompt rather than through tool calls.
  - Benchmark on the VM before choosing.
- **Rate limits [read + inferred].** The 5-hour and weekly windows are shared with Ross's interactive Codex use. Rosie's traffic eats into his coding budget and the other way round.
  - When a limit is hit, look for `turn.failed` or `error` events. I did not see the exact codes in the Codex docs; SIWC uses `subscription_sharing_usage_limit_exceeded`.
  - Rosie must degrade gracefully: queue the message, tell the person, and fall back to the Claude path.
- **Model churn [read].** GPT-5.5 left ChatGPT-login Codex on Oct 14, 2026. Pin the model in config and treat "model not available" as an alertable error.
- **Required MCP servers [read].** If one fails to start, exec exits non-zero. Treat a non-zero exit and any missing schema-valid final message as a failure.
- **Validate everything [inferred].** `--output-schema` constrains the output, but Rosie must still re-validate the JSON in code. Never trust it to be well-formed or safe.

## What Rosie should borrow

1. **Proposal as an interruption.** The model emits structured `proposed_actions` (via `--output-schema`). Rosie stores them as pending approval items in SQLite with IDs, args, a code version, and a status of `pending`, `approved`, `rejected`, `consumed` or `expired`. Nothing executes until approved. This mirrors `RunToolApprovalItem` and `interruptions`.
2. **Server-owned state.** The web page shows display details and opaque IDs only. On approval, Rosie authenticates via Tailscale identity or session, checks the item belongs to that pending batch, and atomically flips `pending→consumed` in one SQLite transaction before writing. Replays are rejected. The receipt records who approved what, and when.
3. **Per-item decisions and edits.** Support approving some items and rejecting others, plus a rejection message fed back on the next turn. Sticky "always approve" is only for low-risk action types, and only if Ross wants it.
4. **Fail closed.** Malformed or invalid proposals become "couldn't understand", never a partial write. Run a code-level "tool input guardrail" (validation) both before showing a proposal and again at write time.
5. **Trace per request.** Keep a `trace` row per "Tell Rosie" message (`workflow_name`, `group_id` = thread) with spans for the model call (model, tokens from `turn.completed.usage`, latency), validation, approval and write. This feeds receipts and debugging.
6. **Codex as a pure proposer.** Run `codex exec --sandbox read-only --ephemeral --skip-git-repo-check --output-schema ... -o ...` with a dedicated `CODEX_HOME`. Pass the current schedule snapshot in the prompt. Give it no MCP write tools.
7. **Version stored state.** Store `prompt_version` / `schema_version` with each pending proposal so stale ones expire after a deploy.

## Open risks

- **Terms ambiguity.** No OpenAI page explicitly blesses or bans a private, always-on, two-person household app on one Plus/Pro account. Carly using it may count as "making your account available to anyone else". The consumer Terms' "programmatically extract … Output" clause is broad.
- **Auth fragility.** Refresh tokens can be revoked or expire. "It does not guarantee the same session lasts forever." This requires a monitored re-login path, and device auth may be "not enabled" for some accounts.
- **CLI churn.** `codex mcp-server` has disappeared from main, profiles moved to a layered-file scheme, `--full-auto` and `untrusted` were retired, and models are retiring. Pin a Codex version on the VM and test upgrades.
- **Shared quota.** Rosie competes with Ross's own Codex usage, and weekly caps are unquantified. Rosie needs a fallback model path (Claude) and a "try later" UX.
- **SIWC is preview.** It is Responses-API-only, has many unsupported parameters and tools, offers no per-host revocation for transferred sessions, and its eligibility for a private, non-open-source app is unclear. Don't build on it yet.
- **Unverified items.** I could not fetch the full config reference (`model_reasoning_effort`, the exact `--ask-for-approval` value set for exec). Latency and limit-error codes are not measured. Verify on the VM with a pinned Codex version before committing.
