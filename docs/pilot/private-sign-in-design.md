# Rosie: private email sign-in

Approved by Ross on October 17, 2026. No authentication code or deployment changes have been made.

## Intended result

Rosie stays at its current private Tailscale address. Ross opens the page, enters his email, receives a short code through the existing Resend connection, and stays signed in on that browser. The app uses that session to recognize Ross instead of relying on a recorded Tailscale user login.

Only Ross gets an account in this first change. Carly's household record and reminder address remain, but neither grants sign-in access. Her account and Tailscale onboarding are deferred until Ross asks to enable them.

The Claude credential is separate: one server-side credential can serve the app. This authentication change does not configure or enable Tell Rosie.

## Confirmed constraints

- Keep the app private behind Tailscale. Keep Bun listening on localhost and preserve Tailscale Serve; do not introduce a public hostname, Funnel, tunnel, or public listener.
- Use Bun and the existing SQLite architecture.
- Reuse the configured Resend sender and API key without revealing either secret.
- Push delivery remains disabled. Its existing queued-message health issue is separate work.
- No public registration, password management, social login, or household invitation interface in this first version.
- Preserve existing tasks, completions, household person IDs, and approval ownership.
- Implementation and live rollout are separate from this design review. The original restriction on VM changes remains until Ross authorizes deployment of the new authentication code.

## Approach

Use Better Auth's email OTP and session support with its Bun SQLite adapter. This adds a maintained authentication dependency while retaining Rosie's existing server-rendered pages and database.

Alternatives considered: retaining only Tailscale identity would be the smallest change but would not add the requested in-app sign-in; implementing custom OTP/session primitives would reduce dependencies but create avoidable security-sensitive maintenance. Email codes also avoid email-link scanners accidentally consuming sign-in links.

Pin the dependency version and review its generated database schema during implementation. Documentation support is not a substitute for verifying compatibility with Rosie's actual Bun runtime.

## User flow

1. An unauthenticated visit to the household page opens a simple email form.
2. Ross submits his configured email address and receives a six-digit code from Rosie.
3. The code screen offers code entry, resend after a cooldown, and a way to change the address.
4. A valid code opens the household page as the existing `ross` person. The browser remembers the session for 30 days, renewed at most daily while in use.
5. A POST-based sign-out action revokes the current session and clears its cookie.

Show the same generic response for an unrecognized or disabled address. Such requests do not send an email or create an account. Expired or incorrect codes produce a useful retry message. Delivery failures show a retryable error without displaying provider response bodies or credentials.

## Household access and stored identity

Add an explicit `auth_enabled` flag to household people, defaulting to false. Populate it through the existing private seed override: enable Ross; leave Carly disabled. A stored reminder email or legacy Tailscale login never implicitly enables sign-in.

Provision authentication users only through a trusted local bootstrap for enabled household people. Disable automatic sign-up. Maintain a unique, server-controlled mapping from the authentication user to the existing household person ID. The browser cannot supply or change that mapping.

Normalize email by trimming and lowercasing; do not rewrite Gmail dots or plus aliases. Reject missing or duplicate normalized addresses among enabled people. Require successful email verification before granting a session access to household routes. Recheck the person's enabled status when resolving each session, so disabling access takes effect immediately.

Use distinct authentication table names in the existing SQLite file. Append reviewed migrations rather than changing shipped migrations. Migration and bootstrap must be repeatable without losing household data.

## Authentication boundary

- Configure codes to expire after five minutes, permit at most three incorrect attempts, and become unusable after successful sign-in. Store code hashes, never plaintext codes.
- Resending rotates the code and invalidates the older code. Require a 60-second resend cooldown and cap requests per normalized address, with persistent counters so restarting does not reset them. Also apply a conservative global limit. Do not rely on unvalidated forwarded IP headers.
- Explicitly enable request throttling; verify the actual form-to-auth request path is covered. Better Auth's internal server API does not automatically apply its HTTP rate limiter.
- Use same-origin, host-only, HttpOnly, Secure, SameSite=Lax session cookies in production. Disable cookie-based session caching so revocation remains immediate.
- Set a fixed trusted origin to the existing Tailscale HTTPS URL. Validate origins on authentication mutations and retain Rosie's CSRF protection on household actions. Sign-out also requires CSRF protection.
- Mount only the needed authentication routes. Disable or reject registration, profile mutation, account linking, email changes, and unused authentication endpoints.
- Preserve the current `/healthz` endpoint within the private network. Unauthenticated household GET requests redirect to sign-in; unauthenticated mutations fail without changing data.
- In email-auth mode, Tailscale identity headers and development identity overrides cannot bypass the session check.
- Never log codes, session cookies, shared model tokens, or API keys. Use a fake delivery transport in automated tests.

## Configuration and rollout

Add an explicit `ROSIE_AUTH_MODE` with `tailscale` and `email-otp` modes. Keep the current mode as the default until deployment is deliberately configured. Email mode requires the Resend pair, an HTTPS `BETTER_AUTH_URL`, a securely generated `BETTER_AUTH_SECRET`, and at least one enabled household person; fail closed if these are incomplete.

The local checkout and live VM currently contain different versions. Implement from an agreed code baseline in an isolated branch, preserve unrelated work, and review the full deployment difference before updating the VM. Do not accidentally deploy model-related features with the auth change.

Before an authorized rollout, back up the database, apply the additive migrations, provision Ross, enable email auth, and verify access on the private URL. Keep a documented rollback to the previous code and explicit Tailscale mode; retain new additive tables rather than deleting data. A rollback requires the previously recorded Tailscale identity to remain available.

## Acceptance checks

- Ross can request a code and sign in; the session maps to `ross` and persists through an app restart.
- Carly's configured reminder email and all unknown addresses cannot create accounts or access household data.
- A correct Tailscale user header alone cannot authenticate in email mode.
- Incorrect, expired, reused, superseded, and concurrently submitted codes are handled safely.
- Cooldown, attempt limits, and request limits work on the actual HTTP routes and survive restart where configured.
- Tampered cookies, expired sessions, revoked sessions, and disabled people are rejected.
- Cross-origin sign-in, sign-out, and household mutations are rejected; existing owner-only proposal approvals still hold.
- Migration preserves household records; tests use isolated databases and send no real email.
- Type checking and the existing test suite pass alongside focused authentication tests.
- Live verification after deployment distinguishes successful HTTP responses, provider acceptance, and Ross actually receiving the sign-in email.

## References

- [Better Auth email OTP](https://better-auth.com/docs/plugins/email-otp)
- [Bun SQLite adapter](https://better-auth.com/docs/adapters/sqlite)
- [Sessions](https://better-auth.com/docs/concepts/session-management)
- [Cookies and secure-cookie settings](https://better-auth.com/docs/concepts/cookies)
- [Request throttling and server-API limitations](https://better-auth.com/docs/concepts/rate-limit)

## Next step

Prepare and review the implementation plan for this approved Ross-only, private-network design. Carly's account and live deployment remain separate decisions.
