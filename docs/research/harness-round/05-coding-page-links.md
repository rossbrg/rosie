# 05: Ross's "Coding" links, read for Rosie

Researched 2026-10-17. Each entry gives what the source says, then what it means for Rosie: (a) the runtime agent (message, propose, validate, approve, write with a receipt) and (b) how we direct the coding agents that build Rosie. Where the original couldn't be read, the section says so and names the secondary source used.

Repo context checked: Rosie has `evals/run.ts` + `evals/cases.json`, `bun test`, `bunx tsc --noEmit`, CI in `.github/workflows/ci.yml` and a `.beads/` tracker. It has **no `AGENTS.md`/`CLAUDE.md`**. The README's "Tell Rosie" and eval sections still say `ANTHROPIC_API_KEY`, which no longer matches the subscription-only plan.

---

## 1. Geoffrey Huntley, "How to build a coding agent" (https://ghuntley.com/agent/)
Fetched directly.
- A coding agent is "300 lines of code running in a loop with LLM tokens". Send the context, check whether the model asked for a tool, run the tool, append the result, repeat until the reply has no tool call. Cursor, Claude Code, Amp and the rest are thin harnesses around that loop.
- A tool is a name, a natural-language description (which nudges the model to call it), an input schema and a function. Five primitives cover most coding work: `read_file`, `list_files`, `bash`, `edit_file` (an empty `old_str` creates a file) and `code_search` (ripgrep, "no special indexing magic").
- Treat the context window as scarce memory. About 176k of an advertised 200k is usable after the harness takes its share. Tool definitions eat it too: one example spent about 76K tokens on MCP tool definitions. "Less is more."
- Keep one activity per context. Mixing unrelated tasks in one session leaks irrelevant material into the output.
- Model roles: "agentic" models are biased toward incremental tool calls. A reasoning "oracle" model can be registered as a tool the agentic model calls for planning or review.
- Guidance in the harness prompt is only guidance (models are non-deterministic). Tune it with prompt evals.

**For Rosie**
- (a) Rosie's runtime is the loop without the dangerous tools. Give it a few narrow, well-described read tools (household snapshot, item history) and **zero write tools**. Proposals come back as data that code validates. Keep the tool list short and the descriptions precise, since the description is what steers the model.
- (a) The oracle pattern maps to an optional second-opinion call (for example, Codex checking an ambiguous proposal). It's a later idea, not needed for v1.
- (b) Give each coding-agent session one task. Start a fresh session per bead or issue rather than one long chat.

## 2. "The Ralph Wiggum Loop from 1st principles" (https://www.youtube.com/watch?v=4Nna09dG_c0)
**Video not watched (no transcript was reachable).** From the YouTube metadata: Geoffrey Huntley's own channel, uploaded 2026-01-11. The description calls Ralph "an orchestrator pattern" that manages the context window to avoid compaction and context rot, and says the video covers how he writes specs and uses them to drive Ralph. The bullets below are from secondary sources, labeled: Huntley's own post https://ghuntley.com/ralph/ [GH], a DreamHost explainer https://www.dreamhost.com/blog/ralph-wiggum/ [DH], and a Reddit summary of a related explainer video [RD].
- In its purest form the loop is `while :; do cat PROMPT.md | claude-code ; done` [GH]. Every iteration starts with a fresh context. State lives in the repo (specs, plan, git history), and an external check decides when the work is done, not the model [DH]. "Context windows are arrays" [DH, quoting Huntley].
- File set [GH]: `specs/*` (one spec per file, written out of a long requirements conversation), `fix_plan.md` (a prioritized TODO list that a separate *planning* run generates and that is often thrown away and regenerated) and `AGENT.md` (how to build and run, plus short learnings Ralph adds).
- One item per loop, and the model picks which. Many subagents can search, but **only one may run build/test**. "The wheel has got to turn fast": types, tests and static analysis reject bad output [GH].
- Known failure modes [GH]: Ralph wrongly concludes code is missing and builds a duplicate (fix: tell it to search before assuming), and it writes placeholder or stub code (fix: an explicit "no placeholders" rule plus extra loops that hunt stubs). When Ralph misbehaves, add a "sign" to the prompt. Recovery is `git reset --hard` and regenerate the plan.
- Specs must leave room in each loop's context. A bloated spec pushes every iteration into the "dumb zone". Read and edit every line of the spec yourself [RD]. Avoid the Stop-hook plugin variant, because it keeps all iterations in one context [RD, DH].
- Huntley says Ralph suits greenfield work (it gets about 90% of the way) and he advises against using it on existing codebases [GH].

**For Rosie**
- (a) The same contract fits the runtime: **state in SQLite, completion decided by code**. The model never decides that something "happened". The validator and the person's tap do.
- (b) Rosie is small and brownfield, so use bounded loops only (an iteration cap plus `bun test && bun run typecheck` as the gate) on well-specified mechanical work, such as adding eval cases or refactoring `actions.ts`. Never use an open-ended loop on the agent layer's design.
- (b) Adopt the file set as `docs/specs/*.md` (the action schema, the approval flow, the receipt format) plus a plan or the beads queue, with `AGENTS.md` for learnings.

## 3. Luke Parker, "Stop chatting with AI, start loops" (https://lukeparker.dev/stop-chatting-with-ai-start-loops-ralph-driven-development)
Fetched directly.
- Ralph-driven development: stateless headless iterations (`opencode run` in a Bash or PowerShell loop) re-read the whole plan each time, so there is no drift. When the agent fails, fix the prompt, the context or its data access, not just the code, and leave a "sign".
- Workflow: spend about an hour planning with no code, reading every line, then crystallize the plan into `plan.md` as a checkbox backlog of small, isolated tasks. Then freeze it and loop. Each iteration picks one task, verifies it, completes it, commits, updates `plan.md` and `AGENTS.md`, and exits when everything is done.
- **The agent may commit but never push.** A human reviews before any PR, which is why he argues (against Huntley) that the method also works on brownfield code.
- Make the codebase verifiable from the CLI, and turn warnings into errors (`TreatWarningsAsErrors`, the latest analyzers), so any warning fails the iteration.
- Prefer plain CLI tools the agent can `--help` over MCP servers, to save context.

**For Rosie**
- (b) **Commit-only, never push** is the right default for Rosie's coding agents. A human (Ross) merges. This matches the runtime rule "a person approves, code writes".
- (b) Make `tsc --noEmit` strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) and add a no-warnings lint step to CI, so the loop gate is unforgiving.
- (a) Expose Rosie's internals as CLI subcommands (`bun src/main.ts eval|replay|propose`), so both people and agents can verify behavior without the web page.

## 4. Moss, "Don't waste your back pressure" (https://banay.me/dont-waste-your-backpressure/)
Fetched directly. Published 2026-01-17.
- "Back pressure" is automated feedback that lets an agent catch its own mistakes mid-task. Without it, the human is the feedback loop (pointing out missing imports and misplaced UI), which wastes engineer time and caps agents at easy problems.
- Sources of back pressure: running builds through bash, expressive type systems ("make invalid states unrepresentable"), compilers with fix-suggesting errors (Rust, Elm), Playwright/DevTools browser MCPs for UI, LSP bridges, proof assistants (Lean), fuzzing, and docs generated from specs (OpenAPI) to compare against intent.
- Recommendations: audit where you spend feedback time and automate the repeats. Give agents tools to *observe results*, not only to edit. Then loop until the checks pass (he links to Ralph).
- "The payoff of investing into higher quality testing is growing massively."

**For Rosie**
- (a) The validator *is* the runtime agent's back pressure. Return **structured, fix-suggesting rejection reasons** to the model ("task 42 is already done; did you mean schedule 7?") and allow one bounded retry before showing anything to a person.
- (b) Note every time Ross corrects an agent by hand, and turn each repeat into a test, a type, an eval case or a lint rule. For the web page, give the agent a headless browser check of the page (Playwright via `bunx`, no install in prod).

## 5. "Advanced context engineering for coding agents" (https://www.youtube.com/watch?v=42AzKZRNhsk)
**The video page was blocked by YouTube's bot check, so the video wasn't watched.** Metadata: Boundary's "AI That Works" #17, 2025-08-06, with Dex Horthy (HumanLayer) and Vaibhav Gupta (BAML). Content comes from the episode page https://boundaryml.com/podcast/2025-08-05-advanced-context-engineering-for-coding-agents and Dex's companion essay https://humanlayer.dev/blog/advanced-context-engineering, labeled secondary.
- "Context is the only lever." Each turn is stateless. Optimize the window for correctness, then completeness, then size, then trajectory: wrong information is worse than missing information, which is worse than noise. Keep utilization around **40-60%**.
- **Frequent intentional compaction**: have the agent write its goal, approach, progress and current failure to a markdown file, then restart fresh from that file. The biggest context hogs are searches, code tracing, test/build logs and large JSON tool output.
- **Research, then plan, then implement.** Research maps the files and data flow. The plan lists exact edits and a verification step per phase. Implementation runs phase by phase, compacting status back into the plan after each phase.
- Subagents exist for **context control, not role-play**: a fresh window searches and returns a compact summary.
- Human leverage compounds upstream: a bad line of code costs one line, a bad line of plan hundreds, a bad line of research thousands. Review research and plans more than code. The stated priority order is CLAUDE.md > prompts > research > plans > implementation.
- Results claimed: a bug fix in BAML (300k lines of Rust) in about an hour by someone new to the codebase, and about 35k lines in about 7 hours. Limits: a Hadoop removal failed on shallow research. Prompts live in `humanlayer/.claude/commands`.

**For Rosie**
- (a) Rosie's household snapshot is a context-engineering problem. Send only the relevant slice (matched items, open tasks, the last N history rows) and keep it compact, rather than the whole DB. Measure snapshot size per eval case.
- (b) For any non-trivial Rosie change, require a short research note and a plan file in `docs/plans/` that Ross reads **before** implementation. A 100-line plan is reviewable; 1,000 lines of diff are not.
- (b) Keep `AGENTS.md` small and treat it as the highest-leverage file. It doesn't exist yet.

## 6. HumanLayer PR #513, "ralph. is back" (https://github.com/humanlayer/humanlayer/pull/513)
The PR page was fetched, but its body is an empty template. The API and GitHub MCP were not available for this repo in this session. The file list comes from the PR's `/files` web page.
- Opened by dexhorthy, with 19 commits on 2025-08-27/28, mostly authored by "claude". It was **closed, not merged**. It touched about 130 files: a React refactor of `humanlayer-wui` (a Zustand store migration, error boundaries, Storybook stories and tests).
- The harness was tiny. `.simonsays/prompt.md` (13 lines) says: read `REACT_REFACTOR_PLAN.md`, "implement the SINGLE highest-priority change with tests", run `make -C humanlayer-wui check test`, update the plan, then commit and push to the `refactor` branch.
- `ralph.sh` loops `sync.sh` with a 10-second sleep. `sync.sh` pipes the prompt to `claude -p --dangerously-skip-permissions` and logs to `claude_output.jsonl` (gitignored).
- Planning docs sat beside the code: `REACT_CODING_STANDARDS.md` and `REACT_REFACTOR_PLAN.md`. A Vim swap file got committed by accident, a small sign that nobody reviewed the unattended commits.

**For Rosie**
- (b) This is a working template for a bounded Rosie loop: a 13-line prompt, a plan file, one change per iteration, a `make check test`-style gate, and JSONL logs. Differences to make for Rosie: an iteration cap, commit-only (no push), and no `--dangerously-skip-permissions` outside a throwaway worktree or container.
- (b) The closed, unmerged result is a caution. A loop is good at producing a large mechanical refactor branch, and a human still decides whether it lands.

## 7. Factory, "Using linters to direct agents" (https://factory.ai/news/using-linters-to-direct-agents)
This URL redirects to https://factory.com/news/using-linters-to-direct-agents, which was fetched directly (Sept 2025).
- `AGENTS.md` explains the "why" in prose but is ambiguous and unenforced. Lint rules turn it into enforceable checks with severities, autofixes and AST/type awareness, and they run everywhere: in the editor, pre-commit, CI, PR bots and agent toolchains. **"Lint green" is the definition of done.**
- Rule categories: grep-ability (named exports, consistent error types), glob-ability (predictable file locations), architectural boundaries (no cross-layer imports, no cycles), security (no secrets, input validation required, no `eval`), testability (colocated tests, no network in unit tests), observability (structured logs) and docs (TSDoc on public APIs).
- Loop: notice drift, have an LLM draft the rule (with tests and docs), surface violations, fix them with codemods or parallel agents, and enforce in CI. **Every bug or drift becomes a rule.** Start a new rule as a warning, then promote it to an error.
- Map each `AGENTS.md` guideline to a rule ID that links to the rule's docs, and time-box waivers.

**For Rosie**
- (b) Encode Rosie's invariants as checks, not prose. Examples: only `src/actions.ts` may `INSERT`/`UPDATE` household tables; the model-call module may not import `db.ts` write helpers; no `fetch` in tests; every action type has a receipt. A small `bun test` that scans imports and SQL is enough, with no ESLint dependency needed.
- (a) The same idea at runtime: every class of bad proposal seen in evals becomes a validator rule with a clear message, not an extra prompt sentence.

## 8. AI Jason, "Claude Skills: the SOP for your agent" (https://www.youtube.com/watch?v=1WImBwiA7RA)
**The video page was blocked by the bot check and no transcript was found.** Metadata: AI Jason (Jason Zhou), 2025-10-17. Chapters: what agent skills are, why they're "better than MCP", example skills, and building skills for your own codebase. A summarizer page (https://www.chaindesk.ai/tools/youtube-summarizer/claude-skills-the-sop-for-your-agent-that-is-bigger-than-mcp-1WImBwiA7RA) adds little. The mechanics below come from Anthropic's post https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills, labeled secondary.
- A skill is a folder with `SKILL.md`. Its YAML frontmatter `name` and `description` are always loaded, and the description decides when the skill triggers. Per the summarizer, skills are reusable and composable and add capability while saving tokens.
- **Progressive disclosure** has three levels: the frontmatter is always in context, the body loads when the skill is relevant, and linked files load only when needed. That is why skills cost far less context than always-on MCP tool definitions (the "bigger than MCP" claim).
- Bundled scripts run as tools, which is better for deterministic work (sorting, form extraction) than generating tokens. Make it clear whether a script should be run or read.
- Authoring: run the agent on real tasks first, then write skills for the gaps. Watch how it uses them, and have Claude write successes and mistakes back into the skill. Only install skills you trust, since a skill can carry injected instructions.

**For Rosie**
- (b) Write repo skills under `.claude/skills/` (Codex reads `AGENTS.md`, so keep a pointer there) for recurring SOPs: "add an eval case from a real message", "add a new action type end to end (schema, validator, receipt, test, eval)", "run and read the eval report".
- (a) Rosie's household domain knowledge (how each appliance's maintenance works, family conventions) can live as small markdown "skills" loaded only when the message mentions that item, instead of bloating every prompt.

## 9. Simon Willison, "Building software on top of LLMs" (https://simonwillison.net/2025/May/15/building-on-llms/)
Fetched directly. This is the write-up of his PyCon US 2025 workshop.
- Exercises: the `llm` CLI and its prompt logs, the Python API, text-to-SQL, **structured extraction** ("possibly the most economically valuable" use), embeddings and RAG, and tool use. Build so you can switch models easily.
- **Prompt injection** attacks the application, not the model. Once an assistant can act (read and send email), injected text in content can turn it against the user. A filter that is 99% effective is not security.
- **Dual LLM pattern**: a privileged LLM with tools never sees untrusted text, only variable references. A quarantined LLM reads untrusted content and has no tools, and its output is treated as tainted. CaMeL (DeepMind) extends this idea.
- **Evals are the LLM unit tests.** Use labeled sets where answers are objectively right or wrong, and LLM-as-judge only for subjective output. A good domain eval set is what lets you swap models and prompts with confidence.
- Models have a "jagged frontier". Keep notes on failed tasks and retry them when new models ship.

**For Rosie**
- (a) Rosie already follows the safe shape. The model only *proposes*, code validates, a person approves, and code writes. Keep untrusted text (forwarded emails, notes, history free text) away from anything that can act. Where a message carries outside content, extract it with a no-tools call and pass only typed fields onward. The planted-injection eval case is exactly right; add more.
- (a) The 28-case exact-match eval is the right core because the outputs are objective actions. Use LLM-as-judge only for reply tone, and score it separately.
- (a) Log every prompt and response to SQLite (as `llm` does), so any real failure can become an eval case with one command.

## 10. Arize Phoenix (https://phoenix.arize.com/)
This URL redirects to https://arize.com/phoenix/. Docs were also read: the Docker page, the Claude Code and Codex integrations, and the TypeScript client experiments page.
- Open-source LLM tracing and evals under the **ELv2** license (fine for personal self-hosting). Run it with `uvx arize-phoenix serve`, or `docker run -p 6006:6006 -p 4317:4317 arizephoenix/phoenix` (pin a version). The UI and OTLP HTTP endpoint (`/v1/traces`) are on 6006 and OTLP gRPC is on 4317. Storage is SQLite (via `PHOENIX_WORKING_DIR`) or Postgres 14+. Kubernetes/Helm is also supported.
- It is native **OpenTelemetry** and uses the **OpenInference** semantic conventions (`llm.input_messages`, token counts, tool spans), so any OTLP span with those attributes shows up, whatever the language.
- **CLI-driven calls:** the `Arize-ai/coding-harness-tracing` plugin hooks **Claude Code** lifecycle events and **Codex** `notify` events and streams OpenInference spans (turns, LLM spans with tokens and cost, nested tool and subagent spans, session grouping) to a self-hosted Phoenix at `localhost:6006`. Prompt and tool logging can each be turned off. It also works with the Claude Agent SDK (TS/Python) but needs `ClaudeSDKClient`, because `query()` has no hooks. **The docs don't say whether headless `claude -p` or `codex exec` is covered.** The fallback is for Rosie to wrap each CLI call in its own span.
- **Evals:** datasets built from traces or uploaded, and experiments that run a task over a dataset with evaluators. In TypeScript, `@arizeai/phoenix-client` provides `createDataset` (upserts by name) and `runExperiment({dataset, task, evaluators, repetitions})`. Code evaluators come from `asExperimentEvaluator({kind: "CODE", evaluate})`; LLM-as-judge and human annotations are also supported, plus a prompt playground/IDE.

**For Rosie**
- (a) Optional and later. Rosie's own SQLite log of prompt, raw output, validated actions and decision is the source of truth and costs nothing. If Ross wants a UI, run Phoenix in Docker on the VM, bound to the tailnet, and emit one OTLP span per model call with OpenInference attributes. That is a hand-written span, not an SDK hook into the CLI.
- (a) The 28 cases map onto a Phoenix dataset, with the existing exact-match scorer as a CODE evaluator and `repetitions: 3` to measure flakiness across Claude and Codex. It's worth doing only once comparing runs over time hurts.
- (b) The coding-harness-tracing plugin could show where Rosie's coding agents spend context. It's a curiosity, not a priority. It does send prompts to the collector, but that collector would be local.

## 11. Swamp (https://swamp.club/)
This URL redirects to https://swamp-club.com/, which was fetched. The hands-on detail comes from a secondary tutorial, https://flaviocopes.com/swamp/ [FC]. The project comes from Adam Jacob's company (System Initiative lineage), now Elder Swamp Club, Inc.
- The pitch: instead of open-ended, token-heavy agents, your harness (Claude Code, Codex, Cursor) turns intent into **repeatable "behaviors"** that run deterministically afterwards. When no integration exists, the agent **writes the tool itself**: an extension, with a registry of about 1,700 listed.
- Mechanics [FC]: a *model type* is a TypeScript file in `extensions/models/` with **Zod schemas** for its arguments and outputs and methods that call `context.writeResource()`. *Definitions* are YAML instances. *Workflows* are YAML DAGs with CEL `assert` steps over saved data. Outputs are typed, versioned and queryable (`swamp data query`).
- Secrets are injected from vaults and redacted from output. Every run is audited and traces export over OTel. The repo ships `AGENTS.md` and `.agents/skills/` so the harness knows how to extend it.
- Caveats: the site is heavily promotional with self-reported stats. Extensions are executable code and need review like any package [FC]. License is AGPL-3.0 with an extension exception, and an account is required [FC]. The tutorial calls it overkill for a one-line cron job.

**For Rosie**
- (a) The core idea matches Rosie's: **the model designs, deterministic code repeats and checks**. Applied to Rosie, once a person approves a new kind of recurring thing, it should become a typed, schema-validated schedule row, not a prompt the model re-reads every night.
- (b) Don't adopt Swamp (wrong scale, account required, AGPL). Do borrow the pattern: Zod-style schemas for every action (one source for the model's JSON schema, the validator and the docs), typed versioned outputs, and CEL-like asserts as tests.

---

## Themes
1. **The loop is trivial; the gates are the product.** Huntley, Ralph, Moss and Factory all say the agent loop is 300 lines and the value is in back pressure (types, tests, lint, evals) that rejects bad output automatically. For Rosie the runtime gate is the validator plus the person's approval, and the build gate is `tsc` + `bun test` + `bun run eval` + invariant checks.
2. **Fresh context, durable state on disk.** Ralph, Dex and Parker all reset context each task and keep the truth in files (specs, plan, `AGENTS.md`, git). Rosie's runtime does the same with SQLite. Its coding agents need specs and plans in `docs/` and an `AGENTS.md`, which is missing today.
3. **Review upstream.** A bad line of research or plan costs far more than a bad line of code. Ross should read specs and plans for the agent layer, and let gates check the implementation.
4. **Turn every failure into a rule.** A Ralph "sign", a Factory lint rule, a Willison eval case, a skill update: same move. A Rosie mistake becomes an eval case or validator rule, and a coding-agent mistake becomes a test, lint rule or `AGENTS.md` line.
5. **Humans hold the irreversible step.** Agents commit but don't push (Parker), the model proposes but doesn't write (Rosie), and untrusted text never reaches anything that can act (Willison). The one cautionary data point is PR #513: an unattended loop produced 130 files that were closed, not merged.
6. **Spend context sparingly.** Use few tools, progressive disclosure (skills), compact snapshots and a 40-60% utilization target. That applies to Rosie's household snapshot as much as to coding sessions.
7. **Observability can start in SQLite.** Log prompt, output, validation and decision per call first. Phoenix (self-hostable, OTel/OpenInference, Claude Code/Codex hooks, TS experiments API) is a good later upgrade, not a v1 dependency.
