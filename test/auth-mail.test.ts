import { describe, expect, test } from "bun:test";
import type { EmailAuthConfig } from "../src/auth-config";
import { CODE_SUBJECT, CodeDeliveryError, createCodeSender } from "../src/auth-mail";

// Dummy values; the fetch stub stands in for Resend, so nothing leaves the machine.
const config: EmailAuthConfig = {
  mode: "email-otp",
  baseURL: "https://rosie.example.ts.net",
  secret: "s".repeat(32),
  resendKey: "re_test_dummy_key",
  emailFrom: "Rosie <rosie@example.com>",
};

function stub(respond: (init: RequestInit) => Promise<Response> | Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond(init);
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

async function failure(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (err) {
    return err as Error;
  }
  throw new Error("expected a failure");
}

describe("sending a sign-in code", () => {
  test("goes to Resend at once, from the configured sender, to the one address", async () => {
    const { calls, fetcher } = stub(() => new Response(JSON.stringify({ id: "x" }), { status: 200 }));
    await createCodeSender(config, fetcher)("ross@example.com", "123456");
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test_dummy_key");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({ from: "Rosie <rosie@example.com>", to: ["ross@example.com"], subject: CODE_SUBJECT, text: expect.any(String) });
    expect(body.subject).toBe("Your Rosie sign-in code");
    expect(body.text).toContain("123456");
    expect(body.text).toContain("5 minutes");
  });

  test("a refusal says so without Resend's body, the key or the code", async () => {
    const { fetcher } = stub(() => new Response(`{"message":"bad key re_test_dummy_key for code 123456"}`, { status: 403 }));
    const err = await failure(createCodeSender(config, fetcher)("ross@example.com", "123456"));
    expect(err).toBeInstanceOf(CodeDeliveryError);
    expect(err.message).toContain("403");
    for (const secret of ["re_test_dummy_key", "123456", "bad key"]) expect(`${err.message} ${err.stack}`).not.toContain(secret);
  });

  test("a network error or a hang becomes a short, safe error", async () => {
    const down = stub(() => Promise.reject(new TypeError("connect ECONNREFUSED re_test_dummy_key")));
    const err = await failure(createCodeSender(config, down.fetcher)("ross@example.com", "123456"));
    expect(err).toBeInstanceOf(CodeDeliveryError);
    expect(err.message).not.toContain("re_test_dummy_key");

    const hang = stub(
      (init) => new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))),
    );
    const slow = await failure(createCodeSender(config, hang.fetcher, 20)("ross@example.com", "123456"));
    expect(slow).toBeInstanceOf(CodeDeliveryError);
    expect(slow.message).toContain("in time");
  });
});
