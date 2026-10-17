import { describe, expect, test } from "bun:test";
import { AuthConfigError, readAuthConfig } from "../src/auth-config";

// Dummy values only; nothing here is a real credential.
const EMAIL_MODE = {
  ROSIE_AUTH_MODE: "email-otp",
  BETTER_AUTH_URL: "https://rosie.example.ts.net",
  BETTER_AUTH_SECRET: "s".repeat(32),
  RESEND_API_KEY: "re_test_dummy",
  ROSIE_EMAIL_FROM: "Rosie <rosie@example.com>",
};

const fails = (env: Record<string, string | undefined>) => expect(() => readAuthConfig(env)).toThrow(AuthConfigError);

describe("auth mode", () => {
  test("defaults to the Tailscale header", () => {
    expect(readAuthConfig({})).toEqual({ mode: "tailscale" });
    expect(readAuthConfig({ ROSIE_AUTH_MODE: "tailscale", ROSIE_DEV_LOGIN: "ross@test" })).toEqual({ mode: "tailscale" });
  });

  test("email mode with everything set", () => {
    expect(readAuthConfig({ ...EMAIL_MODE, BETTER_AUTH_URL: "https://rosie.example.ts.net/" })).toEqual({
      mode: "email-otp",
      baseURL: "https://rosie.example.ts.net",
      secret: EMAIL_MODE.BETTER_AUTH_SECRET,
      resendKey: EMAIL_MODE.RESEND_API_KEY,
      emailFrom: EMAIL_MODE.ROSIE_EMAIL_FROM,
    });
  });

  test("an unknown mode refuses to start", () => {
    fails({ ROSIE_AUTH_MODE: "email" });
    fails({ ROSIE_AUTH_MODE: "none" });
  });

  test("email mode fails closed when anything is missing or loose", () => {
    fails({ ...EMAIL_MODE, RESEND_API_KEY: undefined });
    fails({ ...EMAIL_MODE, ROSIE_EMAIL_FROM: " " });
    fails({ ...EMAIL_MODE, BETTER_AUTH_SECRET: undefined });
    fails({ ...EMAIL_MODE, BETTER_AUTH_SECRET: "s".repeat(31) });
    fails({ ...EMAIL_MODE, BETTER_AUTH_URL: undefined });
    fails({ ...EMAIL_MODE, BETTER_AUTH_URL: "not a url" });
    fails({ ...EMAIL_MODE, BETTER_AUTH_URL: "http://rosie.example.ts.net" });
    fails({ ...EMAIL_MODE, BETTER_AUTH_URL: "https://user:pass@rosie.example.ts.net" });
    fails({ ...EMAIL_MODE, BETTER_AUTH_URL: "https://rosie.example.ts.net/app" });
    fails({ ...EMAIL_MODE, BETTER_AUTH_URL: "https://rosie.example.ts.net/?x=1" });
    fails({ ...EMAIL_MODE, BETTER_AUTH_URL: "https://rosie.example.ts.net/#top" });
  });

  test("a development identity override can't be active with email sign-in", () => {
    fails({ ...EMAIL_MODE, ROSIE_DEV_LOGIN: "ross@test" });
  });

  test("errors never repeat the secret or the key", () => {
    for (const env of [
      { ...EMAIL_MODE, BETTER_AUTH_SECRET: "short-secret-value" },
      { ...EMAIL_MODE, BETTER_AUTH_URL: "https://user:pass@rosie.example.ts.net" },
    ]) {
      try {
        readAuthConfig(env);
      } catch (err) {
        const message = String((err as Error).message);
        expect(message).not.toContain("short-secret-value");
        expect(message).not.toContain("pass@");
        expect(message).not.toContain(EMAIL_MODE.RESEND_API_KEY);
      }
    }
  });
});
