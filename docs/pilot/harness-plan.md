# Harness plan: Rosie's agent layer

*Drafted 2026-10-17 from the [harness research round](../research/harness-research.md). Status: **proposal for Ross to react to. Nothing here is being built yet.** It replaces the API-key approach in PR #6; the rest of PR #6 (proposals, validation, approval, receipts, evals) carries forward.*

## The rule everything follows

**The model proposes; code decides; a person approves; code writes and leaves a receipt.**

The model never holds a tool that changes anything. Approval is a state change in Rosie's database that code checks, never a judgement by the model or a line in memory. Reminders, recurrence and overdue alerts stay plain scheduled code with no model in them, so they keep working if both subscriptions stop working tomorrow.

## How a message flows

```
Ross or Carly types into the page (signed in through Tailscale)
  │
  ├─ 1. Plain parsing first: "done coffee descale", "snooze dehumidifier to Sunday"
  │     → matched without any model call → straight to step 4
  │
  ├─ 2. Otherwise: queue one model call (one at a time, 90 s cap)
  │     Claude: unmodified `claude -p`, Ross's setup-token, JSON schema, no tools
  │     Codex: unmodified `codex exec`, read-only sandbox, output schema
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

## Model access, done the sanctioned way

- **Primary: Claude** through the unmodified `claude` binary, signed in with a one-year `claude setup-token` token held only in the VM's `.env`. Flags: `--tools "" --permission-mode dontAsk --strict-mcp-config --max-turns 2 --output-format json --json-schema`, run from an empty folder with its own `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, and `ANTHROPIC_API_KEY` scrubbed from the environment.
- **Fallback: Codex** through the unmodified `codex exec --ephemeral --skip-git-repo-check --output-schema`, with its own `CODEX_HOME` signed in once with `codex login --device-auth`. Rosie never copies or restores `auth.json`.
- **Never** take either login token out and call an API directly. Pin both CLI versions and upgrade on purpose.
- **Budget:** a daily cap on Rosie's own model calls (say 50), and a clear "Rosie can't read messages right now, use the buttons" state when a login fails or a limit is hit, with one alert to Ross.

## What gets built, in order

Each phase is useful on its own and ends with tests and the eval set green. Nothing gets deployed to the Rosie VM without Ross saying so.

**Phase 0: ground rules for the coding agents (docs only)**
- `AGENTS.md` (with `CLAUDE.md` pointing to it): how to build and test, the rule above, "commit, don't push", and where specs live.
- Invariant tests: only `src/actions.ts` writes household tables; the model-call code can't import write helpers; every action type leaves a receipt.
- Update the README's Tell Rosie section to the subscription setup.

**Phase 1: Tell Rosie on the subscriptions**
- Revive the parked CLI interpreter (commit `d55574a`) with the lockdown above, the one-at-a-time queue, and the daily cap.
- Add the model-call log table and a `bun run eval --interpreter claude|codex` that runs the 28 cases through either CLI, on Ross's Mac or the VM.
- Make approval atomic with a version check, so a double tap or a stale page can't apply twice.
- Feed validation failures back for one retry.
- Exit check: the eval set passes on Claude, and we know Codex's score and how long each call takes on the VM.

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

## Decisions for Ross

1. **Claude first, Codex as fallback?** My pick. The parked prototype already speaks Claude's output format and the eval set was tuned on Claude; Codex is the safety net if Anthropic's policy moves again.
2. **Carly's messages on your subscription.** Both companies' terms say an account can't be made "available to anyone else", and neither addresses a household assistant. Low volume through the proposal step is the mitigation I'd take; the alternative is waiting until Carly has her own login.
3. **Start with Phase 0 and Phase 1?** That gets "Tell Rosie" working on your subscriptions with the safeguards above, and the eval set tells us whether it's good enough before anyone relies on it.
