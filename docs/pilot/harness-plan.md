# Harness plan: Rosie's agent layer

*Drafted 2026-10-17 from the [harness research round](../research/harness-research.md). Status: **proposal for Ross to react to. Nothing here is being built yet.** It replaces the API-key approach in PR #6; the rest of PR #6 (proposals, validation, approval, receipts, evals) carries forward.*

## The rule everything follows

**The model proposes; code decides; a person approves; code writes and leaves a receipt.**

The model never holds a tool that changes anything. Approval is a state change in Rosie's database that code checks, never a judgement by the model or a line in memory. Reminders, recurrence and overdue alerts stay plain scheduled code with no model in them, so they keep working whenever no model is available.

## How a message flows

```
Ross or Carly types into the page (signed in through Tailscale)
  │
  ├─ 1. Plain parsing first: "done coffee descale", "snooze dehumidifier to Sunday"
  │     → matched without any model call → straight to step 4
  │
  ├─ 2. Otherwise: queue one model call (one at a time, 90 s cap)
  │     Claude on Ross's subscription first, Codex on his subscription as fallback
  │     JSON schema for the answer, no tools that change anything
  │     input = compact household slice + pinned facts + the message
  │
  ├─ 3. Validator checks every proposed action against the database
  │     rejected → reasons that suggest the fix go back to the model, one retry
  │     still bad → "I couldn't work that out", nothing is proposed
  │
  ├─ 4. Proposals stored server-side with a version; the page shows the
  │     code-written sentence ("Mark Descale coffee brewer done, today")
  │
  └─ 5. Asker taps Do it → one transaction: check it's still pending, still
        current and theirs → mark it used → apply → receipt in `runs`
```

Every model call is logged (prompt version, provider, model, duration, tokens, raw output, what validation said), so any real misfire becomes an eval case with one command.

## Model access: Ross's subscriptions

Rosie runs on Ross's Claude subscription, with his Codex subscription as the fallback. There are two ways to call each, and Phase 1 tries both and keeps whichever is faster and more reliable on the VM:

- **Through the command-line tools.** Claude: `claude -p` signed in with a `claude setup-token` token in the VM's `.env`, with `--tools "" --permission-mode dontAsk --strict-mcp-config --max-turns 2 --output-format json --json-schema`, run from an empty folder with its own `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, and no `ANTHROPIC_API_KEY` in the environment. Codex: `codex exec --ephemeral --skip-git-repo-check --output-schema` with its own `CODEX_HOME`, signed in once with `codex login --device-auth`. These give schema checking and retries for free, at the cost of a process start-up per call.
- **Directly with the subscription sign-in.** Rosie calls the models itself using the same logins. Faster per call and no extra process, but Rosie does its own schema checking and retries.

Either way:
- **Budget:** usage comes out of the allowance Ross codes with, so Rosie gets a daily cap on its own model calls (say 50), and a clear "Rosie can't read messages right now, use the buttons" state when a login fails or a limit is hit, with one alert to Ross.
- **Auth stays on the VM:** tokens live in the VM's `.env` or the tools' own folders, never in the database or the repo.

## What gets built, in order

Each phase is useful on its own and ends with tests and the eval set green. Nothing gets deployed to the Rosie VM without Ross saying so.

**Phase 0: ground rules for the coding agents (docs only)**
- `AGENTS.md` (with `CLAUDE.md` pointing to it): how to build and test, the rule above, "commit, don't push", and where specs live.
- Invariant tests: only `src/actions.ts` writes household tables; the model-call code can't import write helpers; every action type leaves a receipt.
- Update the README's Tell Rosie section to the subscription setup.

**Phase 1: Tell Rosie on the subscriptions**
- Build the Claude interpreter both ways (revive the parked CLI version from commit `d55574a` with the lockdown above, and a direct-call version), with the one-at-a-time queue and the daily cap. Keep the faster, more reliable one; Codex follows the same pattern as the fallback.
- Add the model-call log table and a `bun run eval --interpreter ...` that runs the 28 cases through any interpreter, on Ross's Mac or the VM.
- Make approval atomic with a version check, so a double tap or a stale page can't apply twice. (Being fixed in the "Harness plan visualizations" thread; check its merged PR first.)
- Feed validation failures back for one retry.
- Exit check: the eval set passes on Claude, and we know Codex's score, which route we're keeping, and how long each call takes on the VM.

**Phase 2: cheaper and sturdier**
- Plain parsing for the common one-liners, so most messages never use the subscription.
- A "fixed date" recurrence option ("every year on March 10") next to "N days after last done".
- Complete export (database plus every stored file) as a button, so Rosie can never Centriq the family.

**Phase 3: memory and onboarding (later, each its own decision)**
- Facts table (supersede, never overwrite), rendered into the prompt by code, changed only through approved proposals.
- Photo of an appliance's rating plate → proposed item with make, model and manual link.
- Starter schedules proposed from a few questions about the house, added one at a time.
- How-to cards on schedules so reminder emails stand on their own.

Out of scope for now: chat channels (Telegram, iMessage), a heartbeat that runs the model on a timer, Home Assistant readings, and Phoenix tracing. Each is reasonable later; none is needed for the pilot.

## Decisions

Settled by Ross on 2026-10-17:
- The subscriptions power Rosie, for both Ross and Carly.
- Claude first, Codex as the fallback.

Open:
- **Start Phase 0 and Phase 1?** That gets "Tell Rosie" working on the subscriptions with the safeguards above, and the eval set tells us whether it's good enough before anyone relies on it.
