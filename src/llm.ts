import type Anthropic from "@anthropic-ai/sdk";
import { InterpretError, OUTPUT_SCHEMA, parseInterpretation, SYSTEM_PROMPT, userContent, type Interpreter } from "./ask";

// How Rosie reaches a model. Everything that talks to a model lives here and only
// returns data; it never imports anything that writes to the household's tables.

export const DEFAULT_MODEL = "claude-opus-5-5";

export function claudeInterpreter(opts: { apiKey?: string; model?: string; client?: Anthropic } = {}): Interpreter {
  let client = opts.client;
  const model = opts.model ?? DEFAULT_MODEL;
  return {
    model,
    async interpret(snap, message) {
      // Loaded on first use, so the nightly check never depends on the SDK being installed.
      client ??= new (await import("@anthropic-ai/sdk")).default({ apiKey: opts.apiKey, timeout: 90_000, maxRetries: 1 });
      const response = await client.beta.messages.create({
        model,
        max_tokens: 4000,
        // A short, well-specified parsing job; low effort keeps it quick.
        output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
        // If a safety classifier declines a harmless household message, retry on the
        // model Anthropic recommends instead of failing.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent(snap, message) }],
      });
      if (response.stop_reason === "refusal") throw new InterpretError("Rosie couldn't take that message. Try rewording it.");
      if (response.stop_reason === "max_tokens") throw new InterpretError("Rosie's answer was cut off. Try a shorter message.");
      const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      return {
        ...parseInterpretation(text),
        model: response.model,
        usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
      };
    },
  };
}
