import type { EmailAuthConfig } from "./auth-config";

// Sends a sign-in code straight away through Resend. Codes never go through the
// outbox: they are only useful for five minutes and must not sit in the database.

export type CodeSender = (email: string, code: string) => Promise<void>;

export class CodeDeliveryError extends Error {}

export const CODE_SUBJECT = "Your Rosie sign-in code";
const TIMEOUT_MS = 10_000;

export function codeEmailText(code: string): string {
  return `Your Rosie sign-in code is ${code}\n\nIt works once, for the next 5 minutes. If you didn't ask for it, you can ignore this email.\n`;
}

// Errors say only what went wrong in general: never Resend's response body (it can
// echo the request), the key, or the code.
export function createCodeSender(config: EmailAuthConfig, fetcher: typeof fetch = fetch, timeoutMs = TIMEOUT_MS): CodeSender {
  return async (email, code) => {
    let res: Response;
    try {
      res = await fetcher("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${config.resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: config.emailFrom, to: [email], subject: CODE_SUBJECT, text: codeEmailText(code) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new CodeDeliveryError(timedOut ? "Resend didn't answer in time." : "Couldn't reach Resend.");
    }
    await res.body?.cancel().catch(() => {});
    if (!res.ok) throw new CodeDeliveryError(`Resend didn't accept the message (HTTP ${res.status}).`);
  };
}
