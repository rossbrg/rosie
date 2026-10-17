# Private sign-in: configuration and rollout

*Written 2026-10-17 with the implementation on branch `feat/private-sign-in`. Nothing below has been run on the Rosie VM; each step needs Ross's go-ahead. Design: [private-sign-in-design.md](private-sign-in-design.md). Plan: [private-sign-in-plan.md](private-sign-in-plan.md).*

## What changes

With `ROSIE_AUTH_MODE=email-otp`, Rosie stops trusting the `Tailscale-User-Login` header. Opening the page shows a sign-in form; Rosie emails a six-digit code through the existing Resend sender, and the browser stays signed in for 30 days (renewed at most once a day while in use). Only people with `"auth_enabled": true` in `seed/household.local.json` can sign in, and only after `bun run auth:bootstrap` has made their account. Rosie stays bound to `127.0.0.1` behind `tailscale serve`; nothing is published outside the tailnet.

The default stays `tailscale`, so deploying the code alone changes nothing until the settings below are added.

## Configuration

In the VM's `.env` (never in the repo):

| Setting | Value |
|---|---|
| `ROSIE_AUTH_MODE` | `email-otp` |
| `BETTER_AUTH_URL` | Rosie's existing HTTPS tailnet address, no path, e.g. `https://rosie.<tailnet>.ts.net` (as `tailscale serve status` shows it). Requests whose `Origin` isn't exactly this are refused. |
| `BETTER_AUTH_SECRET` | New, random, at least 32 characters. Generate it on the VM so it never leaves it (below). Changing it later signs everyone out. |
| `RESEND_API_KEY`, `ROSIE_EMAIL_FROM` | Already set; reused as they are. |
| `ROSIE_DEV_LOGIN` | Must be unset; email mode refuses to start with it. |

In `seed/household.local.json`, add `"auth_enabled": true` to Ross's entry only. Leave Carly's entry as it is: her reminder address doesn't let her sign in. Leaving the flag out keeps whatever the database has; `"auth_enabled": false` turns sign-in off for someone (their next request is refused, and the next bootstrap deletes their sign-in account).

Email mode refuses to start if any of this is missing or loose, if nobody is enabled, or if an enabled person has no account at their current address.

## Deploying (later, when Ross says so)

1. **Check the gap.** On the VM: `cd ~/rosie && git rev-parse HEAD && ~/.bun/bin/bun --version`. The last check found the VM at `ae6266a`; `main` adds the harness work since then (Phase 0 rules, "Tell Rosie" on the subscriptions, the model-call log and its migration, the "done" prompt fix). Review `git log ae6266a..feat/private-sign-in` before deploying. "Tell Rosie" stays off as long as `ROSIE_INTERPRETER` is unset in `.env`; confirm that before restarting.
2. **Check Bun.** `bun.lock` is in the newer text format (lockfile version 2); Bun 1.3.x ignores it and `bun install --frozen-lockfile` fails (this is already true of `main`). Use a Bun that reads it (1.4.2 on Ross's Mac does) or note the gap before installing. Don't upgrade the VM's Bun without deciding to.
3. **Back up the database** with SQLite's own copy, which is safe while the service runs: `bun -e 'new (require("bun:sqlite").Database)("data/rosie.sqlite").run("VACUUM INTO ?", ["data/rosie-before-sign-in.sqlite"])'`.
4. **Update the code** to the reviewed commit and `bun install --frozen-lockfile`.
5. **Migrate and seed.** `bun run migrate` adds the `auth_enabled` column (everyone off), the `auth_*` tables and the code-request log; it changes no household rows. Add Ross's `"auth_enabled": true` to `seed/household.local.json`, then `bun run seed`.
6. **Add the settings without echoing secrets.** Generate the secret on the VM: `openssl rand -base64 32 | sed 's/^/BETTER_AUTH_SECRET=/' >> .env`. Append the other two by typing them into `cat >> .env` (stdin, not arguments): `ROSIE_AUTH_MODE=email-otp` and `BETTER_AUTH_URL=https://…`.
7. **Provision.** `bun run auth:bootstrap` should print `1 created, 0 updated, 0 revoked`. It prints counts only.
8. **Restart and check.** `systemctl --user restart rosie-web`, then `systemctl --user status rosie-web` and the journal: it should log `Rosie on http://127.0.0.1:8787 (email sign-in)`. `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/healthz` and the same through the tailnet URL; `/` should now answer `303` to `/sign-in`.
9. **Sign in for real.** Ross asks for a code on the page. Check three things separately: the page said a code is on its way (HTTP worked), Resend accepted the message (its dashboard, or no "couldn't send" error on the page), and the email actually arrived. Then enter it and confirm the household page opens as Ross and **Sign out** works.

## Rolling back

Check out the previously recorded commit, set `ROSIE_AUTH_MODE=tailscale` (or remove the line), and restart. The `Tailscale-User-Login` header identifies people again through `people.login`, which this change never touches, so keep Ross's recorded tailnet login in `seed/household.local.json`. Keep the new tables and column: older code ignores them (its migrations stop at its own last version, and inserts into `people` get `auth_enabled`'s default). Restore the backup only if household data itself went wrong.

## Not in this change

- Carly's account and her tailnet onboarding (her record and reminder address are untouched; enabling her is one seed flag plus a bootstrap, when Ross decides).
- Push delivery stays off; its queued-message health issue is separate.
- No model, prompt or "Tell Rosie" configuration changes.
