# Rosie

A harness for managing a household and family: an agent that helps a family notice what matters, decide who owns it, and see that it actually got done. Earlier drafts call it "Home Slice".

## Running Rosie

Rosie is a small [Bun](https://bun.sh) service with a SQLite database. Its one runtime dependency is the Anthropic SDK, used only by the direct route for "Tell Rosie".

```sh
bun install
cp .env.example .env              # then fill in what you need
bun run seed                      # loads seed/household.json (+ seed/household.local.json if present)
bun run nightly                   # plan due maintenance and send reminders; run once a night
bun run serve                     # web page on 127.0.0.1:8787
bun test
```

People's Tailscale logins, emails and ntfy push topics go in `seed/household.local.json`, which is git-ignored:

```json
{ "people": [{ "id": "ross", "login": "you@example.com", "email": "you@example.com", "ntfy_topic": "rosie-ross-<random>" }] }
```

On the home server (a Linux machine on the tailnet that stays on), with the repo checked out at `~/rosie`:

```sh
cp deploy/rosie-* ~/.config/systemd/user/
systemctl --user enable --now rosie-web rosie-nightly.timer
loginctl enable-linger "$USER"     # keep user services running when logged out
tailscale serve --bg 8787
```

- `rosie-nightly.timer` runs the check at 03:00, and on the next boot if the machine was off.
- Publish the page to the tailnet with `tailscale serve --bg 8787`. Rosie identifies people from the `Tailscale-User-Login` header that `tailscale serve` adds, so it must stay bound to localhost.
- Point an outside monitor (Uptime Kuma, Healthchecks, Home Assistant) at `/healthz`. It returns 503 when the last good nightly run is older than 36 hours, when a message gave up after 5 tries or has sat unsent for 36 hours, or when a schedule couldn't be planned, so a dead server or a broken channel still gets noticed.
- Messages wait in the queue until their channel is set up and the person has an address; nothing is marked sent that wasn't. Set `ROSIE_CONSOLE_CHANNELS=1` to print them instead while developing.

## Tell Rosie

With `ROSIE_INTERPRETER` set, the page has a box where either of you can write what happened or what you want in your own words: "vacuumed the inserts yesterday, left head was filthy", "push the dehumidifier to Sunday", "start tracking descaling the kettle every 3 months, Carly owns it", or a question like "when did we last descale the coffee brewer?".

- Rosie reads the message with a snapshot of the household (people, items, schedules, open tasks, recent history) and answers with a short reply plus suggested changes: mark a task done, move a task, record unscheduled work, add a schedule, or change an owner.
- Code checks every suggestion against the database and writes the one-line description you approve, so what you read is what happens. If a suggestion names something that doesn't exist, Rosie gets one more try with the reason. Nothing is written until you tap **Do it**, and only the person who asked can approve. Each applied change leaves a receipt in `runs`.
- Reminders never depend on a model. If no model answers, the box says to use the buttons and Ross gets one alert that day.

### Models: the household's subscriptions

Rosie runs on Ross's Claude subscription with his Codex subscription as the fallback; there is no API key. `ROSIE_INTERPRETER` lists what to try, in order:

| Name | What it does | Sign-in |
|---|---|---|
| `claude-cli` | Runs `claude -p` as a locked-down parser: no tools, settings, MCP servers, memory or saved session, in an empty folder | `claude setup-token`, saved as `CLAUDE_CODE_OAUTH_TOKEN` in `.env` |
| `claude-direct` | Calls the Messages API itself with the same token; no extra process per message | the same `CLAUDE_CODE_OAUTH_TOKEN` |
| `codex-cli` | Runs `codex exec`, read-only and ephemeral | `CODEX_HOME=<folder> codex login --device-auth` once, with that folder as `ROSIE_CODEX_HOME` |

For example `ROSIE_INTERPRETER=claude-cli,codex-cli`. On the server, install the CLIs for the user that runs Rosie and give their full paths in `ROSIE_CLAUDE_BIN` and `ROSIE_CODEX_BIN`, since systemd's `PATH` is short.

- Messages are read one at a time, and each gets 90 seconds, fallbacks included.
- Rosie makes at most `ROSIE_DAILY_MODEL_CALLS` model calls a day (default 50, retries included), so she can't eat into the allowance Ross codes with. After that the box is replaced by a note until tomorrow.
- Every call is logged in `model_calls`: which route and model answered, the prompt version, how long it took, tokens, the raw answer, and anything validation refused.
- The model code is in `src/llm.ts`, the prompt and the approval flow in `src/ask.ts`, the actions in `src/actions.ts`.

### Evals

`bun run eval` runs [evals/cases.json](evals/cases.json) (28 real-style messages against the household in [evals/household.json](evals/household.json)) through a real model and scores the suggestions you would see, field by field. The set includes the hard cases: an ambiguous "done", a task finished by the other person, relative dates, two changes in one message, questions that should change nothing, and a prompt injection planted in the history notes. Run it after any change to the prompt, the schema or the model, and add a case for every real message Rosie gets wrong.

```sh
bun run eval                                  # ROSIE_INTERPRETER, or claude-cli if unset
bun run eval --interpreter codex-cli          # one route
bun run eval --interpreter claude-direct      # needs CLAUDE_CODE_OAUTH_TOKEN
bun run eval --only snooze --repeat 3         # some cases, several times
```

Each case goes through the same path as the page, retry included. The summary gives the pass count and how long each message took; details go to `evals/results/`.

## Pilot

- [docs/pilot/maintenance-loop.md](docs/pilot/maintenance-loop.md): first pilot, recurring home maintenance (Oct 2026).
- [docs/pilot/harness-plan.md](docs/pilot/harness-plan.md): proposed plan for the agent layer on the Claude and Codex subscriptions (Oct 17, not started).

## Research and design

All in [docs/research](docs/research), newest first:

- [harness-research.md](docs/research/harness-research.md) (Oct 17): how Claude Code, Codex, OpenClaw, pi, Letta, the OpenAI Agents SDK and Home Assistant's LLM API work, how to run on the Claude and Codex subscriptions, Ross's Coding-page links, and four home apps. Detailed notes in [harness-round/](docs/research/harness-round/).
- [home-slice-family-harness-synthesis.md](docs/research/home-slice-family-harness-synthesis.md) (Sept 27, 2026): the family-harness direction, 30-day pilot, open decisions. Start here.
- [family-display-owner-reports.md](docs/research/family-display-owner-reports.md) (Sept 27): what parents report about Hearth, Skylight, DAKboard, Cozyla, FamilyWall and Cozi.
- [family-hub-study.md](docs/research/family-hub-study.md) (Sept 22): Waffled, Family Home Hub and Yuvomi as native-app foundations.
- [family-backend-study.md](docs/research/family-backend-study.md) (Sept 22): Tribu, Donetick, Homi/Homebox, Mealie/Grocy, Baby Buddy as backend models.
- [apple-design-reference-notes.md](docs/research/apple-design-reference-notes.md) (Sept 22): Crouton, Mela, Things, Structured and other Apple-native references.
- [home-family-agent-setup-research.md](docs/research/home-family-agent-setup-research.md) (Aug 17): safe home/family agent architecture, authority zones, approvals, failure modes.
- [reference-links.md](docs/research/reference-links.md) (Oct 17): the product and agent links collected in Notion, with which doc covers each.
- [home-slice-proposal.md](docs/research/home-slice-proposal.md) (June): Notion Home Hub audit and phased engine proposal.
- [home-slice-prd.md](docs/research/home-slice-prd.md) (June): PRD with phases and user stories.
- [family-management-research.md](docs/research/family-management-research.md) (June): family-app market scan.

The Notion originals live under the Home Slice page in the household Notion workspace.

Issues are tracked with [Beads](.beads/README.md).
