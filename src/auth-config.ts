// How Rosie knows who is asking. `tailscale` (the default) trusts the identity header
// that `tailscale serve` adds. `email-otp` ignores that header and requires a session
// from signing in with a code sent to the person's email.
export type AuthConfig =
  | { mode: "tailscale" }
  | { mode: "email-otp"; baseURL: string; secret: string; resendKey: string; emailFrom: string };

export type EmailAuthConfig = Extract<AuthConfig, { mode: "email-otp" }>;

export class AuthConfigError extends Error {}

// Fails closed: email mode with anything missing or loose refuses to start rather
// than falling back to the header.
export function readAuthConfig(env: Record<string, string | undefined>): AuthConfig {
  const mode = env.ROSIE_AUTH_MODE?.trim() || "tailscale";
  if (mode === "tailscale") return { mode };
  if (mode !== "email-otp") throw new AuthConfigError(`ROSIE_AUTH_MODE must be "tailscale" or "email-otp", not "${mode}".`);

  if (env.ROSIE_DEV_LOGIN) throw new AuthConfigError("ROSIE_DEV_LOGIN can't be used with email sign-in; remove it.");
  const resendKey = env.RESEND_API_KEY?.trim();
  const emailFrom = env.ROSIE_EMAIL_FROM?.trim();
  if (!resendKey || !emailFrom) throw new AuthConfigError("Email sign-in needs RESEND_API_KEY and ROSIE_EMAIL_FROM.");
  const secret = env.BETTER_AUTH_SECRET ?? "";
  if (secret.length < 32) throw new AuthConfigError("BETTER_AUTH_SECRET must be at least 32 characters (try `openssl rand -base64 32`).");
  return { mode, baseURL: privateOrigin(env.BETTER_AUTH_URL), secret, resendKey, emailFrom };
}

// The page's own HTTPS address on the tailnet, e.g. https://rosie.example.ts.net.
// Only a bare origin: it is compared exactly against each request's Origin header.
function privateOrigin(raw: string | undefined): string {
  const bad = new AuthConfigError("BETTER_AUTH_URL must be Rosie's HTTPS address with no path, e.g. https://rosie.example.ts.net.");
  let url: URL;
  try {
    url = new URL(raw?.trim() ?? "");
  } catch {
    throw bad;
  }
  const bare = url.pathname === "/" && !url.search && !url.hash;
  if (url.protocol !== "https:" || url.username || url.password || !bare) throw bad;
  return url.origin;
}
