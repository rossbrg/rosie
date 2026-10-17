# Harness research: how existing agent systems work, and what Rosie should take

*Research round of 2026-10-17, run after Ross asked to go back to planning and study existing systems before building more of Rosie's agent layer. It builds on his Notion list ([reference-links.md](reference-links.md)). The detailed notes, with a source link on every claim and each claim marked as read in a source or inferred, are in [harness-round/](harness-round/). This page is the summary. The plan that follows from it is [docs/pilot/harness-plan.md](../pilot/harness-plan.md).*

## The short version

1. **Rosie can run on Ross's subscriptions, but only through the official command-line tools.** That means the unmodified `claude` binary (`claude -p`, or the Agent SDK that wraps it), signed in with a one-year token from `claude setup-token`, and `codex exec` signed in with Ross's ChatGPT account. Rosie must never take the login token out and call either company's API itself. That is the exact thing Anthropic blocked for OpenClaw-style tools in April, and OpenAI's own guide rules it out too.
2. **The rules are permissive today and unstable.** Anthropic changed its subscription policy four times in 2026. Its support page currently says "You can still use the Claude Agent SDK, claude -p, and third-party apps with your subscription limits", but the developer docs still tell product builders to use API keys, and Anthropic can enforce "without prior notice". Rosie needs a second provider and a mode where everything except "Tell Rosie" keeps working with no model at all.
3. **Carly is the grey area.** Both companies' consumer terms say you may not make your account "available to anyone else". Neither addresses a household assistant run by the account holder. Keeping the model to occasional proposal calls, never a chat stream, is the reasonable mitigation; a cleaner answer would be Carly having her own subscription token.
4. **Every serious harness converges on the shape Rosie already has:** a small loop, a short list of named tools, the model proposing, code checking, and a person approving anything that changes the world. The places Rosie should go further than the products studied are approval (OpenClaw's prompt says "a requested action with an available tool is authorized"; Home Assistant has no confirmation step) and memory (Letta and ChatGPT rewrite memory without asking).
5. **The loop is trivial; the checks are the product.** That is the common thread of Ross's Coding-page links (Huntley, the Ralph posts, "back pressure", Factory's linters). For Rosie the runtime checks are the validator plus the approval tap. The build checks are types, tests, the eval set and a few invariant tests.
6. **None of the four unstudied apps has an agent.** Centriq is dead (shut down around January 2026, deleting accounts; its export left out photos and manuals), which is exactly the "never get Centriq'd" scenario. The useful ideas are photo-of-the-rating-plate onboarding, warranties on the maintenance calendar, starter task libraries you add from, and how-to cards in reminders.

## 1. Running on the subscriptions

| | Claude | ChatGPT / Codex |
|---|---|---|
| Sanctioned route | Unmodified `claude -p` or the TypeScript Agent SDK (which spawns the same binary) | Unmodified `codex exec`, per OpenAI's guide to running automation "as your Codex account" on "trusted private infrastructure" |
| Login on the VM | `claude setup-token` once, then `CLAUDE_CODE_OAUTH_TOKEN` in the service's environment. Lasts a year and does not rotate. | `codex login --device-auth` once into a dedicated `CODEX_HOME`. Codex refreshes the token itself about every 8 days and rewrites `auth.json`; never restore that file from a copy. |
| Structured output | `--output-format json --json-schema` returns the object in `structured_output` | `--output-schema file -o out.json`; `--json` streams events with token usage |
| Locking it down | `--tools ""`, `--permission-mode dontAsk`, `--strict-mcp-config`, `--max-turns`, a dedicated config folder and an empty working folder | Default sandbox is already read-only; add `--ephemeral --skip-git-repo-check` and a dedicated `CODEX_HOME` |
| Traps | `--bare` (the fast mode) ignores subscription logins. A stray `ANTHROPIC_API_KEY` silently wins. Without `--bare`, `-p` loads hooks and MCP servers from whatever folder it runs in. Claude Code's own auto-memory is on by default. | One `auth.json` per serialized stream: never two Codex calls at once on the same login. `codex mcp-server` is gone from current Codex. Models retire (GPT-5.5 left on Oct 14). |
| Limits | Shares Ross's 5-hour and weekly Claude limits with his own coding | Shares Ross's Codex limits; Plus has 5-hour windows and possible weekly caps |
| Not allowed | Calling the Messages API with the subscription token; storing Claude.ai tokens in Rosie | Lifting tokens out of `auth.json` into Rosie's own HTTP client |

Details and quotes: [01](harness-round/01-claude-code-and-anthropic-terms.md), [02](harness-round/02-codex-and-openai-terms.md).

**Anthropic's 2026 timeline**, for context on how fast this moves: a January statement that third-party harnesses on subscriptions break the terms; a February legal-page wording that briefly named the Agent SDK too; an April 4 cutoff for OpenClaw and similar tools; a mid-May plan to move Agent SDK and `claude -p` use onto a separate monthly credit; that plan paused on June 15 ("For now, nothing has changed"); and on October 7, monthly API credits added to Max and Team plans (usable only with an API key, which Ross has ruled out).

**OpenAI** launched "Sign in with ChatGPT" plan usage for third-party apps on September 29. It is a preview, Responses-API-only, and unclear for a private app. Not worth building on yet; `codex exec` is the better-documented route.

**Practical consequences for Rosie:** each call is a separate CLI process (around 250 MB for Claude, a few seconds per call at best), so calls go one at a time through a queue with a timeout. Usage comes out of the same allowance Ross codes with, so a runaway loop could lock him out for the week: Rosie needs a hard cap on its own calls, and a clear "try again later" when a limit or a login fails.

## 2. What the harnesses do, and what to borrow

| System | What it is | Borrow | Avoid |
|---|---|---|---|
| **Claude Code / Agent SDK** ([01](harness-round/01-claude-code-and-anthropic-terms.md)) | Anthropic's agent loop, usable headless | JSON-schema output as the contract; in-process MCP for a few read-only lookups; per-call turn and time caps; logging each result's session, turns, duration and usage next to the receipt; the `PreToolUse` "defer" decision as a pause-for-approval mechanism if Rosie ever lets the model call a write tool | Loading project hooks, skills or CLAUDE.md implicitly; relying on its cost estimate (meaningless on a subscription) |
| **Codex CLI** ([02](harness-round/02-codex-and-openai-terms.md)) | OpenAI's open-source agent CLI | Read-only sandbox by default; `AGENTS.md` as the instruction file (32 KiB cap, rebuilt each run); destructive tools always need approval | Its MCP server mode (removed) |
| **OpenAI Agents SDK** ([02](harness-round/02-codex-and-openai-terms.md)) | Agent library with human-in-the-loop | Its approval rules, which are the best written down anywhere: authenticate the reviewer from the session, accept only IDs of approvals the server already stored, mark the approval used atomically so a replay can't apply twice, check inputs before asking and again at write time, fail closed on bad input, store a version with saved state | Using the SDK itself (it needs an API key) |
| **OpenClaw** ([03](harness-round/03-openclaw-and-pi.md)) | Open-source personal assistant that runs on your machine and talks through chat apps | One process owning channels, scheduler and database; deny-by-default sender allowlists; per-conversation run queues with a version check inside the write transaction; "command payload" cron jobs that run code with no model; a metadata-only audit ledger; running `claude -p` with Rosie's own tools over a local MCP bridge, never holding Anthropic tokens | Model-held write authority; a skill marketplace (341 malicious skills found on ClawHub); trusting localhost or proxy headers as identity (thousands of exposed gateways); one shared session for everyone |
| **pi** ([03](harness-round/03-openclaw-and-pi.md)) | The minimal harness OpenClaw started from | Prompt plus tool definitions under 1,000 tokens; four tools; append-only session log with parent links | Its "full YOLO" no-permissions default |
| **Letta** ([04](harness-round/04-memory-and-home-assistant.md)) | Long-term memory research system (MemGPT) | The vocabulary: always-in-prompt core memory, searchable recall, archival; read-only blocks | The code (its own docs now say not to build on memory blocks); background "dreaming" that edits memory without asking |
| **Home Assistant LLM API** ([04](harness-round/04-memory-and-home-assistant.md)) | How HA lets an LLM control a house | The smallest API that works; an action exists for the model only if explicitly registered; every tool declares read-only or destructive, and undeclared means destructive; household actions separate from admin actions; plain parsing before any model call | Its MCP server as a read path for Rosie: the read tool shares a credential with the tools that switch devices |

## 3. Memory

Rosie will eventually need to remember things that aren't schedules: who handles what, preferences ("no push before 8am"), item facts (filter size), vendors, and past decisions. The research points to one design ([04](harness-round/04-memory-and-home-assistant.md)):

- **Facts are rows, not prose.** A change adds a new row that supersedes the old one, with who proposed it, who approved it and which message it came from. Nothing is edited in place.
- **Code renders the current facts** into a short, capped block in each prompt. The model can read it but not edit it.
- **The model only proposes memory changes**, through the same approve-and-receipt path as maintenance actions. Any nightly clean-up job only queues proposals.
- **Search over past messages and notes** uses SQLite's built-in full-text search. A vector database adds nothing at household scale.
- **Turn off the CLIs' own memory** (`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`), so household facts never pile up in `~/.claude` outside Rosie's records.

Home Assistant: if Rosie ever wants appliance readings such as filter runtime, Rosie's code (not the model) should poll a short allowlist of entities through HA's REST API with a dedicated non-owner user, and store the readings. HA tokens have no scopes, so that token must never reach the model. This keeps Ross's decision that reminders don't run through HA.

## 4. Ross's Coding-page links

Full notes: [05](harness-round/05-coding-page-links.md). The three YouTube videos couldn't be watched from here; their sections use labeled companion sources.

For **Rosie's runtime agent**:
- Make the validator the model's feedback. Rejections should say what's wrong and suggest the fix ("task 42 is already done; did you mean the dehumidifier schedule?"), with one bounded retry before anything reaches a person.
- Send a compact slice of the household (matched items, open tasks, recent history), not the whole database. Context is the scarce resource.
- Keep untrusted text away from anything that can act (Simon Willison's dual-LLM pattern). Rosie's planted-injection eval case is the right instinct; add more.
- Log every prompt and response to SQLite, so a real misfire becomes an eval case with one command. Phoenix (self-hostable tracing and evals) is a reasonable later upgrade, not a first step.
- Once a person approves a new recurring thing, it becomes a typed schedule row that code runs, not a prompt the model rereads (Swamp's core idea).

For **directing the coding agents that build Rosie**:
- Rosie has no `AGENTS.md` or `CLAUDE.md`. Every source treats it as the highest-leverage file.
- Write a short research note and plan before code, and review those more than the diff ("a bad line of plan costs hundreds of lines of code").
- Turn invariants into tests rather than prose: only `src/actions.ts` writes household tables; the model-call module can't import write helpers; every action type leaves a receipt.
- Loops only for bounded, well-specified work, with an iteration cap, commits but no pushes, and `tsc` + `bun test` + evals as the gate. The one real-world example in the list (HumanLayer's PR) produced 130 files and was closed unmerged.

## 5. The four unstudied apps

Full notes: [06](harness-round/06-four-products.md).

| App | Status | Takeaway |
|---|---|---|
| **Centriq** | Dead. Shut down around Jan 31, 2026 after about six weeks' notice; accounts deleted; export left out photos and manuals. Funded by affiliate links, acquired twice. | Rebuild its rating-plate-photo onboarding as a model proposal. Store copies of every file Rosie relies on, and make complete exports a feature. |
| **Mini Castle** | Active, small (3 App Store ratings). Free tier plus $24.99/yr. | Inventory items linked to each other and to tasks; warranty expirations on the maintenance calendar; a starter checklist you add items from; an emailed digest. |
| **Home Maint List** | Free hobby site with a 28-task library. | How-to cards (time, things needed, steps, video) attached to each schedule so the reminder is useful on its own. Annual tasks spread across fixed dates. |
| **Benji** | Active "life OS", $10/mo, iOS still in TestFlight. Chores are habits with streaks. | A fast capture box. Avoid streaks for maintenance: an overdue date means something, a broken streak doesn't. |

Two gaps none of them fill and Rosie can: tailoring tasks to the home's actual equipment (ask a few questions, propose schedules), and per-occurrence owners with overdue escalation. Rosie also needs both kinds of recurrence: "every 3 months after it was last done" (what it has) and "every year on March 10" (what it lacks).

## 6. What this means for what's already built

- **PR #6's shape holds up.** Proposals validated by code, a code-written approval sentence, only the asker can approve, receipts in `runs`, and an eval set with an injection case all match what the research recommends.
- **Its model call has to change.** It uses the Messages API with an API key, which is ruled out. The parked CLI version (commit `d55574a`) is close to the sanctioned route, but needs the lockdown flags above, a dedicated config folder, a one-at-a-time queue, Claude's auto-memory off, and API-key scrubbing.
- **Gaps to fill:** approvals aren't yet marked used atomically with a version check; there is no log of model calls; rejections don't feed back to the model; simple messages always go to the model; there is no `AGENTS.md`.
- **The README is out of date**: its Tell Rosie and eval sections still say `ANTHROPIC_API_KEY`.

## Not verified

- Nothing was installed or run. Latency, memory use and limit-error behaviour on the VM are from documentation and reports, not measurement.
- `docs.openclaw.ai`, Home Assistant's 2026.10 release notes and parts of OpenAI's config reference were blocked from the research environment; those sections rely on raw repository files or secondary sources, as marked in the notes.
- The terms reading in section 1 is an interpretation of public pages, not legal advice, and could change without notice.
