import { CSS, esc, FAVICON, ICON } from "./page";

// The two sign-in screens: ask for an email, then for the code sent to it.
// Plain forms that post to Rosie; the only script counts down the resend wait.

export interface SignInState {
  step: "email" | "code";
  email?: string;
  message?: string;
  // Whether `message` reports a problem (shown in the error colour, announced at once).
  error?: boolean;
  // Seconds until another code can be sent.
  retryAfter?: number;
}

export function renderSignIn(state: SignInState): string {
  const email = state.email ?? "";
  const note = state.message
    ? `<p id="note" class="note${state.error ? " error" : ""}" role="${state.error ? "alert" : "status"}">${esc(state.message)}</p>`
    : "";
  const described = state.message ? ` aria-describedby="note"` : "";
  const invalid = state.error ? ` aria-invalid="true"` : "";

  const body =
    state.step === "email"
      ? `
  <section class="hero">
    <h1>Sign in</h1>
    <p class="summary">Rosie will email you a 6-digit code.</p>
  </section>
  <form class="card signin" method="post" action="/sign-in/send-code">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" value="${esc(email)}" autocomplete="email" inputmode="email"
      autocapitalize="off" spellcheck="false" required maxlength="254" autofocus${described}${invalid}>
    ${note}
    <button type="submit">Send code</button>
  </form>`
      : `
  <section class="hero">
    <h1>Check your email</h1>
    <p class="summary">If ${esc(email)} can sign in, a code is on its way. It works for 5 minutes.</p>
  </section>
  <form class="card signin" method="post" action="/sign-in/verify-code">
    <input type="hidden" name="email" value="${esc(email)}">
    <label for="code">6-digit code</label>
    <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*"
      maxlength="6" required autofocus class="code"${described}${invalid}>
    ${note}
    <button type="submit">Sign in</button>
  </form>
  <div class="signin-alt">
    <form method="post" action="/sign-in/send-code">
      <input type="hidden" name="email" value="${esc(email)}">
      <button type="submit" class="link" id="resend" data-wait="${Math.max(0, Math.ceil(state.retryAfter ?? 0))}">Send a new code</button>
    </form>
    <a class="link" href="/sign-in">Use a different email</a>
  </div>`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f6f3ee" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#151413" media="(prefers-color-scheme: dark)">
<meta name="referrer" content="same-origin">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(FAVICON)}">
<title>Sign in · Rosie</title>
<style>${CSS}${SIGN_IN_CSS}</style>
</head>
<body>
<main>
  <header class="top">
    <div class="brand"><span class="logo" aria-hidden="true">${ICON.home}</span>Rosie</div>
  </header>
  ${body}
</main>
${state.step === "code" ? RESEND_SCRIPT : ""}
</body></html>`;
}

// Disables "Send a new code" until the cooldown is over. Without script the button
// stays enabled and the server says how long to wait.
const RESEND_SCRIPT = `<script>
(() => {
  const b = document.getElementById("resend");
  let wait = Number(b && b.dataset.wait);
  if (!b || !(wait > 0)) return;
  const label = b.textContent;
  const tick = () => {
    if (wait <= 0) { b.disabled = false; b.textContent = label; return; }
    b.disabled = true; b.textContent = label + " in " + wait + "s"; wait--; setTimeout(tick, 1000);
  };
  tick();
})();
</script>`;

const SIGN_IN_CSS = `
.signin { display: flex; flex-direction: column; gap: 10px; padding: 18px 16px; margin-top: 18px; }
.signin label { font-weight: 650; font-size: 15px; }
.signin input {
  font: inherit; font-size: 17px; color: var(--text); background: var(--surface-2);
  border: 1px solid transparent; border-radius: 12px; padding: 12px 13px; width: 100%;
}
.signin input:focus { outline: 2px solid var(--accent); outline-offset: 1px; border-color: var(--accent); }
.signin input.code { font-size: 26px; letter-spacing: .3em; font-variant-numeric: tabular-nums; text-align: center; }
.signin button {
  cursor: pointer; font: inherit; font-weight: 650; color: var(--accent-ink); background: var(--accent);
  border: 0; border-radius: 12px; padding: 13px 16px; margin-top: 4px;
}
.signin button:focus-visible, .link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.note { margin: 0; font-size: 15px; color: var(--muted); }
.note.error { color: var(--late); font-weight: 550; }
.signin-alt { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; padding: 10px 4px; }
.signin-alt form { margin: 0; }
.link {
  cursor: pointer; font: inherit; font-size: 15px; font-weight: 600; color: var(--accent);
  background: none; border: 0; padding: 8px 0; text-decoration: none;
}
.link:disabled { color: var(--muted); cursor: default; }
`;
