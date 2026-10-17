# 04: Agent memory designs and Home Assistant's LLM integration

Researched 2026-10-17. Tags: **[read]** = stated in the cited source. **[inferred]** = my conclusion, not stated there.
Every claim has its URL inline. Some pages were read through a summarizing fetcher, so wording is paraphrased unless quoted.

## A. Long-term memory designs

### A1. Letta (formerly MemGPT): status first
- The `letta-ai/letta` repo now says "the current source code lives in" `letta-ai/letta-code`. The V1 API server is retired to an `archive` branch. The main product is Letta Code (terminal UI, app server, desktop/web apps). [read] https://github.com/letta-ai/letta
- The Letta docs say: "We do not recommend building on memory blocks anymore." New work should use shared memory repositories / MemFS. [read] https://docs.letta.com/v1-sdk/memory/shared-memory
- Conclusion: the classic MemGPT vocabulary (core/archival/recall) is still worth borrowing as concepts. Letta itself is moving fast and is a poor dependency for a small Bun app. [inferred]

### A2. Memory blocks ("core memory")
- A block has a `label`, a `description` ("the main information used by the agent to determine how to read and write to that block"), a `value`, and a character `limit`. [read] https://docs.letta.com/v1-sdk/memory/memory-blocks
- Blocks are read-write by default. `read_only: true` stops the agent from editing a block. The docs' example is a shared "policies" block. [read] https://docs.letta.com/v1-sdk/memory/memory-blocks
- One block can be attached to several agents. Setting `value` replaces the whole block, so the last write wins. [read] https://docs.letta.com/v1-sdk/memory/memory-blocks
- Read-only is all-or-nothing: "You cannot make a block read-only for some agents but writable for others." [read] https://docs.letta.com/v1-sdk/memory/shared-memory
- Agent edit tools: `memory_insert` (append, safe under concurrency), `memory_replace` (targeted edit that fails if the target text changed), and `memory_rethink` (full rewrite, not concurrency-safe). The docs warn that concurrent `memory_rethink` "leads to lost updates" and advise one owner for big edits. [read] https://docs.letta.com/v1-sdk/memory/shared-memory
- Sizing guidance: blocks are always in context, and the docs suggest under 50k characters per block and under 20 blocks per agent. [read] https://docs.letta.com/guides/core-concepts/memory/context-hierarchy/

### A3. Archival and recall memory
- Archival memory is "a general-purpose vector DB". The agent uses `archival_memory_insert` and `archival_memory_search` (semantic search with tag filters). Archival memory is kept out of context. [read] https://docs.letta.com/v1-sdk/memory/archival-memory
- Agents "cannot easily modify or delete archival memories (though developers can via SDK)." [read] https://docs.letta.com/v1-sdk/memory/archival-memory
- Recall / conversation search is automatic search over past messages. It needs no curation, unlike archival memory, which the agent stores on purpose. [read] https://docs.letta.com/v1-sdk/memory/archival-memory
- Letta's hierarchy, by data size and importance:
  - small, critical data goes in blocks (e.g., the user's name);
  - large reference docs go in read-only files;
  - "less important memories" go in archival (~300 tokens per entry);
  - huge corpora go in external RAG.
  [read] https://docs.letta.com/guides/core-concepts/memory/context-hierarchy/

### A4. Sleep-time agents / "dreaming"
- The original design: a sleep-time-enabled agent is two agents. "the primary agent is not provided with tools to edit its core memory." A background sleep-time agent edits memory asynchronously, can use a stronger and slower model, and runs at a configurable frequency (higher frequency costs more tokens). Published 2025-04-21. [read] https://www.letta.com/blog/sleep-time-compute/
- The current design (Letta Code): memory lives in **MemFS**, "a git-backed memory filesystem". Each memory is a Markdown file with YAML frontmatter. Root files are loaded into the system prompt every turn. Subdirectories with a `MEMORY.md` index load on demand. "Every memory edit is committed to the MemFS git repository." [read] https://docs.letta.com/concepts/memfs
- "Dreaming" subagents review recent conversations and update memory after N agent steps or at context compaction. They back up the repo before large reorganizations. An optional "agent reviews before applying" pass "does not ask you for approval." [read] https://docs.letta.com/configuration/memory
- Takeaway: Letta audits memory **after** the fact (git history). Rosie needs approval **before** the write. [inferred]

### A5. Agent File (.af)
- `.af` serializes an agent so it can be shared, checkpointed or version-controlled. It holds model config, message history (with `in_context` flags), the system prompt, memory blocks, tool rules, env vars, and tool source plus schema. [read] https://github.com/letta-ai/agent-file
- Secrets export as `null`. Archival passages are "currently not support[ed]". [read] https://github.com/letta-ai/agent-file
- Relevance to Rosie: low. A SQLite backup plus a versioned prompt file already covers this. The useful idea is a single exportable snapshot of "what the assistant knows", for review. [inferred]

### A6. Brief comparisons
- **Claude Code memory:**
  - CLAUDE.md is written by people. Auto memory is written by Claude. Both load every session and are treated "as context, not enforced configuration". Hooks are the way to *block* actions. [read] https://code.claude.com/docs/en/memory
  - Auto memory lives in `~/.claude/projects/<project>/memory/`: a `MEMORY.md` index (first 200 lines / 25KB loaded) plus topic files typed `user`/`feedback`/`project`/`reference`. The files are plain markdown a person can edit. [read] https://code.claude.com/docs/en/memory
  - Auto memory can be turned off with `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`. [read] https://code.claude.com/docs/en/memory
- **Claude API memory tool** (`memory_20250818`):
  - It runs client-side. "Claude requests file operations, and your application executes them." `/memories` maps onto storage you choose, such as DB keys. [read] https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool
  - Commands: view, create, str_replace, insert, delete, rename. You must validate paths (traversal) and should strip sensitive data and cap sizes. [read] https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool
  - The pattern fits Rosie: the model *requests* and code *decides*. Rosie runs on subscriptions with no API keys, so it can copy the pattern but not call this API tool directly. [inferred]
- **ChatGPT memory:**
  - It has "saved memories" (stored separately from chats, sometimes saved automatically) and "reference chat history", which "can change as ChatGPT updates what is most useful to remember". [read] https://help.openai.com/en/articles/8590148-memory-in-chatgpt
  - Users correct memories after the fact. Some plans offer version history. [read] https://help.openai.com/en/articles/8590148-memory-in-chatgpt
  - This is the "silent rewrite" model Rosie wants to avoid. [inferred]
- **Zep / Graphiti:**
  - Facts are graph edges with `created_at`/`expired_at` (transaction time) and `valid_at`/`invalid_at` (real-world time). A contradicted edge is expired, not deleted. An LLM judges contradictions and also regenerates the old fact's text. [read] https://www.getzep.com/blog/beyond-static-knowledge-graphs/
  - The bitemporal "supersede, don't delete" idea is worth copying. LLM-judged invalidation is not. [inferred]
- **mem0:** `add` runs LLM extraction of facts, decisions and preferences. The docs say new memories are "added without overwriting or deleting existing memories". `infer=False` stores raw text as given. [read] https://docs.mem0.ai/core-concepts/memory-operations/add
  - A vector store with LLM extraction is too much for two people. [inferred]

### A7. What a household assistant actually needs to remember [inferred unless noted]
| Kind | Example | Where it belongs in Rosie |
|---|---|---|
| People and roles | Carly handles the vet, Ross handles HVAC | `facts` (pinned) |
| Preferences / rules | no push before 8am; email Ross for anything >$200 | `facts` (pinned); code enforces rules that matter |
| Ownership / item attributes | furnace filter is 16x25x1, MERV 11; water heater installed 2019 | `items` columns or `item_facts`, not free text |
| Vendor contacts | HVAC: Acme Heating, 555-0100, tech "Dan" | `vendors` table linked to items |
| Past decisions + why | "decided to replace, not repair, the dishwasher (Mar 2026)" | `decisions` / `facts` with date and source |
| Episodic history | filter changed 2026-09-02, "was very dirty" | existing `completions` notes; searchable (recall) |
| Conversation log | raw messages and proposals | `messages` table + FTS5 (Letta "recall") |

The Claude Code split (`user`/`feedback`/`project`/`reference`) maps closely onto this list (https://code.claude.com/docs/en/memory). [read for the categories; mapping inferred]

### A8. Which design fits a small SQLite app where facts must not be silently rewritten [inferred]
- **Facts are rows, not prose.** Use a `facts(id, subject, predicate, value, valid_from, superseded_by, source_message_id, proposed_by, approved_by, approved_at)` table. A change is a new row that points back to the old one, so nothing is updated in place. This is Graphiti's supersede-not-delete idea (https://www.getzep.com/blog/beyond-static-knowledge-graphs/) without letting the LLM decide what is invalidated.
- **Pinned "core memory" is rendered by code** from current facts. It is a compact, size-capped block in every prompt, read-only to the model, like Letta `read_only` blocks (https://docs.letta.com/v1-sdk/memory/memory-blocks) and the MEMORY.md index cap (https://code.claude.com/docs/en/memory).
- **The model only proposes memory changes:**
  - Tools are `propose_fact`, `propose_supersede` and `propose_forget`. They go through the same validate → approve → write-with-receipt pipeline as maintenance actions.
  - This is the memory-tool pattern of "model requests, app executes" (https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool), plus an approval gate that Letta's dreaming lacks (https://docs.letta.com/configuration/memory).
  - Use append and targeted edit only, never a full rewrite: Letta's own concurrency notes show `memory_rethink`-style rewrites lose data (https://docs.letta.com/v1-sdk/memory/shared-memory).
- **Recall uses SQLite FTS5** over messages, completion notes and vendor notes. At household scale a vector DB adds nothing.
- **A "sleep-time" job, if any, only proposes.** A nightly or weekly pass may *propose* merges of duplicates, stale facts ("filter size changed?") or missing vendor links into the approval queue. It never writes directly. This is the Letta idea (https://www.letta.com/blog/sleep-time-compute/) with a human in the loop.
- **Turn off CLI-side memory** when Rosie shells out to Claude Code (`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, https://code.claude.com/docs/en/memory). Household facts should then live only in Rosie's DB, not in `~/.claude`. Check whether Codex has an equivalent setting (not researched).

## B. Home Assistant's LLM integration (as of 2026-10)

### B1. LLM API: the core abstraction
- An LLM API is "a set of tools, plus a prompt that explains how to use them". A conversation agent passes the chosen API's tools to the model and runs the calls. [read] https://contributors.home-assistant.io/core/internals/llm-api/ (redirect from developers.home-assistant.io/docs/core/llm/)
- Two built-in APIs:
  - **Assist** ("Device control") works only on entities exposed to Assist and "cannot do anything administrative".
  - **Home Assistant** (`homeassistant`) manages HA itself, is not limited to exposed entities, and "only administrators can use it".
  [read] https://contributors.home-assistant.io/core/internals/llm-api/
- Intents as tools: "Registering an intent does not make it a tool." An integration must return an `llm.IntentTool` explicitly. The model picks tools by the handler `description`. [read] same URL
- Tool names must be domain-prefixed (`my_integration__coffee_count`); unprefixed names stop working in 2027.3. Several selected APIs are merged into one for the model. [read] same URL
- Since 2026.10, tools return `llm.ToolResult(data, error)` and declare `integration`, `title` and `annotations`. [read] https://developers.home-assistant.io/blog/2026/09/26/llm-tool-result/
- Annotations are `read_only`, `destructive`, `idempotent` and `open_world`. "The defaults describe the least safe case", so an undeclared tool is treated as writing, destructive and open-world. The MCP server passes these to clients. [read] https://developers.home-assistant.io/blog/2026/09/26/llm-tool-result/
- In code, `ToolAnnotations` defaults to `read_only=False`, `destructive=True`, `idempotent=False`, `open_world=True`. [read] https://github.com/home-assistant/core/blob/dev/homeassistant/helpers/llm.py
- Design rationale (2024): intents were chosen "because it is our smallest API". The API has no automations or admin. One API per agent, because "the larger the API surface, the easier AI models, especially the smaller ones, can get confused". "AI models hallucinate and their output cannot be completely trusted." [read] https://www.home-assistant.io/blog/2024/06/07/ai-agents-for-the-smart-home/
- Built-in intents (42 supported) include HassTurnOn/Off, HassGetState, list and timer intents, climate, media and vacuum. The intents page says nothing about LLM-specific exclusions or confirmation. [read] https://developers.home-assistant.io/docs/intent_builtin/

### B2. Exposed entities: HA's main boundary
- Entities must be exposed per assistant (Assist / Google / Alexa) "to avoid that sensitive devices, such as locks and garage doors, can inadvertently be controlled by voice commands." [read] https://www.home-assistant.io/voice_control/voice_remote_expose_devices/
- HA's default for new entities is not stated on that page. Community threads complain that new entities are auto-exposed (https://community.home-assistant.io/t/wth-are-all-new-entities-exposed-to-assist-by-default/803889). [read: community, not official]
- **I found no official doc describing a confirmation step before an LLM-initiated action.** The only related mention is that the LLM can ask a question and wait for a reply. (https://www.home-assistant.io/blog/2025/09/11/ai-in-home-assistant/; https://developers.home-assistant.io/docs/intent_builtin/) [read: absence in these sources]
- Bounding in HA therefore comes from: the exposure list, a small fixed intent vocabulary, no admin capability in Assist, admin-only APIs, and "Assist handles commands first", with the LLM getting only what Assist cannot parse. [read] https://contributors.home-assistant.io/core/internals/llm-api/, https://www.home-assistant.io/blog/2025/09/11/ai-in-home-assistant/

### B3. Conversation agents
- The default agent matches community sentence templates. External LLM agents (OpenAI, Google, etc.) can be selected. `conversation.process` sends text to an agent. "Prefer handling commands locally" sends local sentence matches to the template engine first. [read] https://www.home-assistant.io/integrations/conversation/
- Users choose which LLM APIs an agent may use in the agent's options (`CONF_LLM_HASS_API`). [read] https://contributors.home-assistant.io/core/internals/llm-api/

### B4. MCP server (HA as server) and MCP client (HA as client)
- **Server:**
  - Exposes "the tools used by the configured LLM API" at `/api/mcp`. Clients "can only control or provide information about entities that are exposed".
  - Uses OAuth 2.0 with PKCE. Prompts and tools are supported; sampling and notifications are not.
  - The read-only resource `homeassistant://assist/context-snapshot` exists when the API includes `GetLiveContext`.
  - Settings "Expose all LLM APIs" and "Require an administrator account" are both on by default.
  [read] https://www.home-assistant.io/integrations/mcp_server/
- Each API is also served over Streamable HTTP at `/api/mcp/<API ID>`. "All APIs except Assist need an access token of an administrator there." [read] https://contributors.home-assistant.io/core/internals/llm-api/
- **No read-only tool mode is documented** for the MCP server. The snapshot resource is the only thing described as read-only. [read: absence] https://www.home-assistant.io/integrations/mcp_server/
- **Client:** HA connects to external MCP servers over **SSE** and offers their tools to conversation agents "similar to the Assist API". It supports tools only (no prompts or resources) and optional OAuth. [read] https://www.home-assistant.io/integrations/mcp/

### B5. AI Tasks / structured data generation
- `ai_task.generate_data(task_name, instructions, structure?, entity_id?, attachments?)` returns `data` (free text, or structured fields when `structure` is set) plus `conversation_id`. [read] https://www.home-assistant.io/actions/ai_task.generate_data/
- `structure` fields have a description, a selector (number, text, …) and `required`. A preferred AI-task entity can be set per task. `generate_image` also exists. Introduced in 2025.7. [read] https://www.home-assistant.io/integrations/ai_task/
- The pattern: automations call the LLM as a *function with a schema*, not as a free agent. [inferred]

### B6. Could Rosie read appliance state (e.g., filter runtime) from HA read-only?
- **Via MCP:** technically yes. Call the Assist API's `GetLiveContext`, or read the context-snapshot resource. (https://www.home-assistant.io/integrations/mcp_server/) Three problems:
  1. The same credential can also call HassTurnOn/Off etc. on every exposed entity. Read-only would be a client-side promise, not a server guarantee. [inferred]
  2. The default requires an admin account. [read] same URL
  3. GetLiveContext returns *all* exposed entities, not just the ones Rosie needs. [inferred from its name and the snapshot description]
- **Via REST:** simpler and narrower in practice. Use `GET /api/states/<entity_id>` and `/api/history/period` with a Bearer long-lived token. (https://developers.home-assistant.io/docs/api/rest) The docs describe no token scopes; any valid token can also `POST /api/services`. [read: absence]
- HA has entity-level read/control/edit policies, and the owner bypasses them. (https://developers.home-assistant.io/docs/auth_permissions) I found no official UI for building a custom read-only user. [read for policies; UI gap inferred, see https://community.home-assistant.io/t/read-only-access-to-api/522340]
- **Recommended shape:** Rosie's *code*, not the model, polls an allowlist of entity_ids (e.g., `sensor.thermostat_filter_runtime`) on a schedule using a dedicated non-owner HA user's token. It stores readings in SQLite, and schedules become usage-based ("change filter at 300 runtime hours"). The model only sees stored readings and never holds HA credentials. This keeps Ross's decision that reminders don't run through HA. [inferred]
- Whether a filter-runtime entity exists depends on the thermostat integration. Check Ross's install. [inferred]

## What Rosie should borrow
1. **The smallest API that works** (HA's intent rationale): a fixed, named set of `rosie__*` actions, e.g. `rosie__complete_occurrence`, `rosie__snooze_occurrence`, `rosie__propose_fact`. No generic "update row" or SQL tool. https://www.home-assistant.io/blog/2024/06/07/ai-agents-for-the-smart-home/
2. **Explicit tool registration** ("registering an intent does not make it a tool"): an action exists for the model only if it is in the registry with a description written for the model. https://contributors.home-assistant.io/core/internals/llm-api/
3. **Worst-case annotation defaults:**
   - Each action declares `read_only` / `destructive` / `idempotent`; anything undeclared is treated as destructive.
   - Read-only actions (list due tasks, look up a vendor) can skip approval. Everything else needs a person.
   - https://developers.home-assistant.io/blog/2026/09/26/llm-tool-result/
4. **Separate household and admin scopes**, like Assist vs the admin-only `homeassistant` API. Admin actions are things like deleting schedules, adding users or changing reminder channels; they need Ross. https://contributors.home-assistant.io/core/internals/llm-api/
5. **An exposure list:** per item or schedule, a flag for whether the agent may act on it. Sensitive items can be hidden or kept read-only, in the spirit of locks and garage doors in HA. https://www.home-assistant.io/voice_control/voice_remote_expose_devices/
6. **Deterministic parsing first, LLM as fallback**, like "Assist handles commands first": "done furnace filter" matches without a model call. https://www.home-assistant.io/blog/2025/09/11/ai-in-home-assistant/
7. **Structured results with an error flag** (`ToolResult`) feeding receipts, and AI-Task-style schema-bound outputs for proposals. https://developers.home-assistant.io/blog/2026/09/26/llm-tool-result/, https://www.home-assistant.io/actions/ai_task.generate_data/
8. **Memory:**
   - Pinned facts are rendered by code and read-only to the model (Letta read_only blocks).
   - Recall goes through FTS5 search.
   - Changes use append or supersede rows with provenance, not rewrites (Graphiti).
   - Every memory change goes through the approval queue (stricter than Letta's dreaming, which "does not ask you for approval").
   - https://docs.letta.com/v1-sdk/memory/memory-blocks, https://www.getzep.com/blog/beyond-static-knowledge-graphs/, https://docs.letta.com/configuration/memory
9. **Rosie's approval step is stronger than anything I found in HA's LLM path.** Keep it. [inferred from B2]

## Open risks
- **Docs churn:** Letta deprecated memory blocks in favor of MemFS within about a year, and the V1 server is archived. Borrow ideas, not code. https://docs.letta.com/v1-sdk/memory/shared-memory, https://github.com/letta-ai/letta
- **HA has no scoped tokens:** a token used for "read-only" polling can still call services. Keep it out of the model's reach, use a non-owner user, and consider a firewall or proxy allowlist of GET paths. https://developers.home-assistant.io/docs/api/rest, https://developers.home-assistant.io/docs/auth_permissions [mitigation inferred]
- **The HA MCP server gives control, not just reads.** Using it for Rosie's reads widens Rosie's blast radius into the house. https://www.home-assistant.io/integrations/mcp_server/
- **Prompt injection through memory:** vendor notes or forwarded emails stored as facts get re-injected into every prompt. Render facts as quoted data, cap their size, and never let a fact grant permissions. [inferred]
- **Approval fatigue:** if every small memory edit needs a tap, people rubber-stamp them. Consider batching memory proposals into a daily digest. [inferred]
- **CLI-side memory leaks:** Claude Code auto memory is on by default and machine-local, so household facts could pile up in `~/.claude` outside Rosie's audit trail. Codex behavior was not checked. https://code.claude.com/docs/en/memory
- **Ross/Carly conflicts:** two approvers may assert contradictory facts. A supersede chain shows the conflict but does not resolve it. A rule is needed (e.g., the most recent approved fact wins, and the other person is notified). [inferred]
- **Not verified:**
  - HA 2026.10 release notes (fetch blocked by robots).
  - HA core Assist API prompt and source (GitHub tree fetch blocked).
  - Whether `/api/mcp` accepts long-lived tokens as well as OAuth.
