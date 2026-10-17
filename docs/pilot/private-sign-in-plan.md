# Rosie Private Sign-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add email-code sign-in for Ross while Rosie remains private behind Tailscale and Carly's account stays disabled.

**Architecture:** Better Auth manages OTPs and persistent sessions in the existing Bun SQLite database. Thin server-rendered form routes enforce household eligibility, request limits, and a fixed origin before calling the auth handler. Existing household routes resolve a verified session to the existing person ID; Tailscale remains the network boundary.

**Tech Stack:** Bun, TypeScript, SQLite, Better Auth 1.7.10 pinned exactly, existing Resend HTTP integration, Bun's test runner.

**Spec:** [Approved private sign-in design](private-sign-in-design.md).

## Global Constraints

- Keep the app private behind Tailscale. Keep Bun listening on localhost and preserve Tailscale Serve; do not introduce a public hostname, Funnel, tunnel, or public listener.
- Use Bun and the existing SQLite architecture.
- Reuse the configured Resend sender and API key without revealing either secret.
- Push delivery remains disabled. Its existing queued-message health issue is separate work.
- No public registration, password management, social login, or household invitation interface in this first version.
- Preserve existing tasks, completions, household person IDs, and approval ownership.
- Implementation and live rollout are separate from this design review. The original restriction on VM changes remains until Ross authorizes deployment of the new authentication code.
- Codes: six digits, five-minute lifetime, three incorrect attempts, hashed storage, rotation on resend. Sessions: 30 days, renewal at most daily, no cookie session cache.
- Only explicitly enabled household people can authenticate. Ross is the only person enabled in the private setup example; Carly's reminder address is not an invitation.
- No secrets in repository files, command arguments, logs, screenshots, or test output. No live mail, model calls, pushes, merges, or deployment during implementation.

## Baseline and workspace

Use an isolated branch from verified `origin/main` commit `eedfc871d5bc89b65dc9b4f6dbc91163e8514ba8` (October 17 inspection). It contains the merged harness changes and invariant tests. The primary Mac checkout remains on `fix/atomic-approval` at `a1c75e9`; do not switch, reset, or modify it. The last inspected VM commit was `ae6266a` and is not the implementation baseline.

At execution, follow the worktree skill and inspect existing attached worktrees before creating one for this repository. Recheck main for new changes and record the actual base. Copy this approved spec and plan into `docs/pilot/` in the execution branch. Do not copy the primary checkout's `.env`, production database, or private household seed into a test fixture.

The local Bun version inspected is 1.3.14. Verify the pinned auth package against that runtime and the VM's Bun version before recommending deployment. Do not upgrade runtimes or silently replace the dependency if incompatible; report a concrete compatibility finding.

## Review Focus

1. An existing reminder recipient is accidentally enrolled: Task 1 and Task 2 prove Carly remains disabled and unprovisioned.
2. An enabled person's email changes while a session exists: Task 2 rejects stale identity mappings and revokes old sessions during reprovisioning.
3. Two tabs submit or resend concurrently: Task 3 proves request limits are atomic; Task 4 proves one-time consumption and replacement codes.
4. A proxy header or stale development variable bypasses login: Task 5 proves neither identifies a caller in email mode.
5. A successful login loses its cookie through a wrapper or restart: Tasks 4–6 prove all Set-Cookie headers survive, renewals propagate, and persisted sessions reopen correctly.

## File map

All paths below are relative to the isolated repository checkout.

| Files | Responsibility |
| --- | --- |
| `src/db.ts`, `src/seed.ts` | Additive schemas and explicit household access flag; preserve seed omission semantics |
| `src/auth-config.ts` | Parse auth mode and validate email-mode settings |
| `src/auth-users.ts` | Read eligible people; bootstrap and reconcile auth-only user mappings |
| `src/auth-limits.ts` | Atomic persistent cooldown and request budgets |
| `src/auth-mail.ts` | Immediate Resend code delivery with safe error reporting |
| `src/auth.ts` | Better Auth configuration, session resolution, controlled auth requests |
| `src/auth-page.ts` | Accessible email/code forms and retry states |
| `src/web.ts`, `src/page.ts`, `src/main.ts` | Route integration, sign-out, startup and bootstrap command |
| `test/auth-*.test.ts` | Isolated schema, identity, limits, library, route and UI coverage |
| `.env.example`, `README.md`, `package.json`, `bun.lock` | Configuration, commands, pinned dependency and setup instructions |

## Task 1: Explicit household eligibility and configuration

**Files:** Modify `src/db.ts`, `src/seed.ts`, `.env.example`; create `src/auth-config.ts`, `test/auth-config.test.ts`, `test/auth-seed.test.ts`.

**Interfaces:**

```ts
type AuthConfig = { mode: "tailscale" } | {
  mode: "email-otp"; baseURL: string; secret: string;
  resendKey: string; emailFrom: string;
};
function readAuthConfig(env: Record<string, string | undefined>): AuthConfig;
```

- [ ] Write tests for default Tailscale mode, explicit email mode, and rejection of unknown modes, absent Resend fields, a secret shorter than 32 characters, and a non-HTTPS or credential-bearing base URL. Allow only a bare origin: no query, fragment, or non-root path.
- [ ] Write seed tests with these assertions:

```ts
expect(person("carly").auth_enabled).toBe(0);
expect(person("ross").auth_enabled).toBe(1); // after an explicit true override
expect(person("ross").auth_enabled).toBe(1); // after a later seed omits the flag
expect(person("ross").auth_enabled).toBe(0); // after an explicit false override
expect(snapshotHousehold()).toEqual(before); // migration preserves existing household data
```

- [ ] Run `bun test test/auth-config.test.ts test/auth-seed.test.ts`; confirm failures identify the missing behavior.
- [ ] Append `auth_enabled INTEGER NOT NULL DEFAULT 0 CHECK(auth_enabled IN (0,1))`. Extend the seed type with optional `auth_enabled?: boolean`; omission preserves an existing flag, explicit false disables it. Validate enabled people's trimmed, lowercased emails and duplicates before committing the seed transaction. Do not alter dots or plus aliases.
- [ ] Implement the config interface. Reject active development identity overrides in email mode. Add commented example variables without real values.
- [ ] Run the focused tests, `bun run typecheck`, and `bun test`; explicitly stage these files and commit.

## Task 2: Pinned auth schema and trusted user provisioning

**Files:** Modify `package.json`, `bun.lock`, `src/db.ts`, `src/main.ts`; create `src/auth-users.ts`, `test/auth-users.test.ts`.

**Interfaces:**

```ts
type AuthPerson = { id: string; name: string; email: string };
function enabledAuthPeople(db: Database): AuthPerson[];
function bootstrapAuthUsers(db: Database, now: Date): { created: number; updated: number; revoked: number };
function mappedAuthPerson(db: Database, userId: string, verifiedEmail: string): AuthPerson | null;
```

- [ ] Add `better-auth@1.7.10` using Bun with an exact version. Inspect its Bun SQLite adapter and generated schema in scratch files; use dummy credentials and isolated databases. Confirm imports work on the actual supported Bun runtime.
- [ ] Write failing tests: migration can run twice; Ross provisions once; Carly provisions zero users; unverified auth users cannot resolve; a mismatched or changed email cannot resolve; disabling a person blocks resolution immediately.
- [ ] Append the pinned library's reviewed schema with table names `auth_user`, `auth_session`, `auth_account`, `auth_verification`, and `auth_rate_limit`. Add `auth_household_user` with unique foreign keys for both auth user ID and household person ID. Use generated field names/types, not assumptions about library internals.
- [ ] Implement trusted bootstrap using the reviewed schema. Create passwordless users with unverified email; create no password/account credential. On a normalized email change, revoke that user's sessions and reset verification before updating the auth identity. Read household tables only from this module; retain `seed.ts` as the household writer so existing invariant tests stay meaningful.
- [ ] Add `bun run auth:bootstrap` through a new `src/main.ts` command. Print only created/updated/revoked counts, never secrets. Require email-mode config and at least one eligible person. Do not auto-provision from a browser request.
- [ ] Run `bun test test/auth-users.test.ts`, then typecheck and the full suite; explicitly stage the task files and commit.

## Task 3: Request budgets and safe code delivery

**Files:** Create `src/auth-limits.ts`, `src/auth-mail.ts`, `test/auth-limits.test.ts`, `test/auth-mail.test.ts`; extend `src/db.ts` with throttle storage.

**Interfaces:**

```ts
type LimitDecision = { allowed: true } | { allowed: false; retryAfter: number };
function consumeCodeRequest(db: Database, email: string, now: Date): LimitDecision;
type CodeSender = (email: string, code: string) => Promise<void>;
function createCodeSender(config: Extract<AuthConfig, { mode: "email-otp" }>, fetcher?: typeof fetch): CodeSender;
```

- [ ] Write failing limit tests for a 60-second cooldown, maximum five code requests per normalized address per hour, and maximum 20 globally per hour. Unknown and disabled addresses consume the same request budgets. Concurrent callers cannot both claim one cooldown slot; reopen a file-backed database to prove persistence.
- [ ] Implement one SQLite immediate transaction that checks and consumes all budgets together. Return `Retry-After` seconds. Never use client-controlled forwarding headers as the authoritative key.
- [ ] Test immediate code delivery using an injected fetch stub: configured sender, intended recipient, code expiry wording, and a 10-second request timeout. Resend errors must not expose the response body, API key, or code in thrown errors/logs. Verify no maintenance outbox row is created.
- [ ] Implement the sender as an immediate email operation, independent of the nightly queue and console notification mode. Use the fixed subject `Your Rosie sign-in code` and plain-text body with the code and five-minute expiry.
- [ ] Run the focused tests, typecheck and the full suite; explicitly stage the task files and commit.

## Task 4: OTP and session boundary

**Files:** Create `src/auth.ts`, `test/auth-library.test.ts`; use the schemas and interfaces from Tasks 1–3.

**Interfaces:**

```ts
type AuthResolution = { person: AuthPerson | null; headers: Headers };
type AuthService = {
  resolve(request: Request): Promise<AuthResolution>;
  submit(action: "send-code" | "verify-code" | "sign-out", request: Request): Promise<Response>;
};
function createAuthService(db: Database, config: Extract<AuthConfig, { mode: "email-otp" }>,
  dependencies: { sendCode: CodeSender; now: () => Date }): AuthService;
```

- [ ] Write real-library integration tests with a fake sender. Assert six-digit codes, 300-second expiry, rejection after three wrong attempts, rotation on resend, hash-only database storage, and exactly one successful session from concurrent verification of the same code. Test delayed old emails, blocked addresses, and a sender failure followed by a permitted retry. Control the clock used by the actual library with Bun's test clock and restore it after each test; injecting a clock into only Rosie's wrapper does not prove library expiry.
- [ ] Configure OTP with `disableSignUp: true`, `storeOTP: "hashed"`, and only sign-in delivery. Configure 30-day sessions, one-day update age, no cookie cache, forced Secure/HttpOnly/host-only/SameSite=Lax cookies, the fixed base URL and trusted origin. Turn HTTP request limiting on explicitly with database storage.
- [ ] Route mutation calls through the library's HTTP handler so its HTTP protections run; do not assume `auth.api` mutation calls are rate limited. Apply Task 3's persistent send budgets at the outer boundary. Serialize send/verify operations per normalized address within the single web process so resends and verification cannot interleave unexpectedly; prove one-time behavior rather than relying on configuration names.
- [ ] Before invoking the library, require an exact matching Origin on mutations, reject cross-site Fetch Metadata, limit bodies to 8 KiB, accept only the expected fields, and ignore caller-supplied person IDs or OTP types. Do not expose the raw auth handler publicly.
- [ ] Make service construction fail before listening if there are no eligible people or if any enabled person lacks a valid provisioned mapping. Resolve sessions through the library and the immutable household mapping. Check email verification, current email match, and current `auth_enabled` on every request. Preserve all Set-Cookie headers returned by session refresh and mutations.
- [ ] Test cookies through tampering, expiry, logout, restart, and disabled-person scenarios. A failed send must not return a session or make a usable code available to the requester.
- [ ] Run focused tests, typecheck and the full suite; explicitly stage the task files and commit. Do not weaken failing security assertions to accommodate the dependency.

## Task 5: Server-rendered sign-in and household integration

**Files:** Create `src/auth-page.ts`, `test/auth-web.test.ts`; modify `src/web.ts`, `src/page.ts`, `src/main.ts`.

**Interfaces:**

```ts
function renderSignIn(state: {
  step: "email" | "code"; email?: string; message?: string; retryAfter?: number;
}): string;
// Extend WebOptions with auth?: AuthService. The absent value preserves Tailscale mode.
```

- [ ] Write route tests: `GET /sign-in`; POST `/sign-in/send-code`, `/sign-in/verify-code`, `/sign-out`; unknown `/api/auth/*` routes return 404. Unauthenticated `GET /` redirects; unauthenticated household POST fails without a write. `/healthz` stays available within the existing network boundary.
- [ ] Implement the two form screens in Rosie's visual style with labelled fields, `autocomplete="email"` and `autocomplete="one-time-code"`, numeric code input, clear focus and inline feedback, and resend cooldown. Escape every interpolated value. Put email/code values in POST bodies, not URL queries; render code entry without storing the code client-side.
- [ ] Use identical neutral send responses for unknown and disabled addresses. Handle a missing or invalid code, expired code, body-size limit, cooldown, and retryable email failure without crashing. Use `Cache-Control: no-store` for auth responses and authenticated pages.
- [ ] Integrate the service in `createHandler`. Resolve the actor once per household request and pass the existing person ID to task completion and proposal decisions. Retain current household CSRF checks and require both the fixed origin and a valid CSRF token for sign-out. Copy refreshed cookie headers to every returned response that needs them.
- [ ] Construct the auth service only in email mode at startup; leave localhost binding, interpreter construction and notification behavior unchanged. No Tailscale header or `devLogin` fallback applies when `auth` is configured.
- [ ] Add these regression assertions:

```ts
expect(await anonymousWithRossTailscaleHeader()).toRedirectTo("/sign-in");
expect(await forgedPersonIdCannotApprove()).toBe(true);
expect(await crossOriginSignOut()).toHaveStatus(403);
expect(await carlyReminderAddressCanSignIn()).toBe(false);
expect(await staleEmailSessionCanReadHousehold()).toBe(false);
```

The helper names above describe test-local functions; implement them in `test/auth-web.test.ts` using real Request/Response objects and the fake sender.

- [ ] Run focused tests, typecheck and the full suite, including existing ownership and invariant tests; explicitly stage the task files and commit.

## Task 6: End-to-end verification and rollout handoff

**Files:** Create `test/auth-restart.test.ts`, `docs/pilot/private-sign-in-rollout.md`; update `README.md` and `.env.example`.

**Interfaces:** Uses `createAuthService`, `createHandler`, and the bootstrap command without adding another authentication API.

- [ ] Add a file-backed integration test that signs in, closes and recreates the auth/database instances, reuses the session cookie successfully, signs out, and rejects that same cookie afterward. Test a renewal path and capture every Set-Cookie header.
- [ ] Document the exact configuration: `ROSIE_AUTH_MODE=email-otp`, existing private HTTPS origin in `BETTER_AUTH_URL`, a newly generated secret, the existing Resend pair, and Ross's private `auth_enabled: true` seed override. Document explicit false to disable a person; omit Carly from enrollment.
- [ ] Document a later authorized deployment: fresh VM version check, SQLite-aware backup, additive migrations, seed, trusted bootstrap, env update via stdin, restart, both health checks, Ross's actual OTP receipt/sign-in, and a rollback to the recorded prior code with explicit Tailscale mode. Warn that the main-to-VM difference includes earlier merged harness work; review it before deployment. Do not execute these live steps in this implementation task.
- [ ] Run `bun install --frozen-lockfile`, `bun run typecheck`, and `bun test`. No model eval is required because model prompts, interpreters, output schema and retry behavior are unchanged.
- [ ] Verify the phone layout locally at 390px and desktop layout with synthetic fixtures and a fake mail transport. Test keyboard navigation, code paste/autofill attributes, expiry feedback and sign-out. Confirm no test starts the nightly service or sends real mail.
- [ ] Check the diff for secrets, unintended interpreter changes, household-write invariant changes, public-listener changes, and broad staging. Run `git diff --check`; stage explicit files and commit.
- [ ] Have an independent reviewer inspect the entire branch for auth bypasses, enrollment mistakes, token leakage, session expiry/renewal, CSRF, code races and migration safety. Fix in-scope findings and rerun affected checks.
- [ ] Report implementation status, tests, branch/commits, remaining runtime compatibility limits, and the separate live deployment decision. Do not push or merge unless Ross authorizes publishing.

## Plan self-review

Coverage checked: all approved flows and constraints are mapped to the six tasks; the five Review Focus cases have explicit owning tests. The plan separates code verification from actual Resend delivery, and preserves the Tailscale fallback only as an explicit configuration mode. Authentication does not grant the model any new tools or bypass existing proposal ownership.

## Execution choice

Recommended: **Native** — implement these tightly connected tasks in this session, then obtain an independent whole-branch security review. **Subagent-driven** is also available: fresh implementation and review agents for each task, at higher context cost. Ross reviews the plan and selects the execution method before implementation.

## Reference documents

- [Better Auth email OTP](https://better-auth.com/docs/plugins/email-otp)
- [Bun SQLite support](https://better-auth.com/docs/adapters/sqlite)
- [Sessions](https://better-auth.com/docs/concepts/session-management)
- [Cookies](https://better-auth.com/docs/concepts/cookies)
- [Rate limits and server API caveat](https://better-auth.com/docs/concepts/rate-limit)
