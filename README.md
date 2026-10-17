# Rosie

A harness for managing a household and family: an agent that helps a family notice what matters, decide who owns it, and see that it actually got done. Earlier drafts call it "Home Slice".

## Running Rosie

Rosie is a small [Bun](https://bun.sh) service with a SQLite database and no runtime dependencies.

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

## Pilot

- [docs/pilot/maintenance-loop.md](docs/pilot/maintenance-loop.md): first pilot, recurring home maintenance (Oct 2026).

## Research and design

All in [docs/research](docs/research), newest first:

- [home-slice-family-harness-synthesis.md](docs/research/home-slice-family-harness-synthesis.md) (Sept 27, 2026): the family-harness direction, 30-day pilot, open decisions. Start here.
- [family-display-owner-reports.md](docs/research/family-display-owner-reports.md) (Sept 27): what parents report about Hearth, Skylight, DAKboard, Cozyla, FamilyWall and Cozi.
- [family-hub-study.md](docs/research/family-hub-study.md) (Sept 22): Waffled, Family Home Hub and Yuvomi as native-app foundations.
- [family-backend-study.md](docs/research/family-backend-study.md) (Sept 22): Tribu, Donetick, Homi/Homebox, Mealie/Grocy, Baby Buddy as backend models.
- [apple-design-reference-notes.md](docs/research/apple-design-reference-notes.md) (Sept 22): Crouton, Mela, Things, Structured and other Apple-native references.
- [home-family-agent-setup-research.md](docs/research/home-family-agent-setup-research.md) (Aug 17): safe home/family agent architecture, authority zones, approvals, failure modes.
- [home-slice-proposal.md](docs/research/home-slice-proposal.md) (June): Notion Home Hub audit and phased engine proposal.
- [home-slice-prd.md](docs/research/home-slice-prd.md) (June): PRD with phases and user stories.
- [family-management-research.md](docs/research/family-management-research.md) (June): family-app market scan.

The Notion originals live under the Home Slice page in the household Notion workspace.

Issues are tracked with [Beads](.beads/README.md).
