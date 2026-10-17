import type Anthropic from "@anthropic-ai/sdk";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InterpretError,
  ModelUnavailable,
  OUTPUT_SCHEMA,
  parseInterpretation,
  SYSTEM_PROMPT,
  userContent,
  type InterpretOptions,
  type Interpretation,
  type Interpreter,
} from "./ask";

// How Rosie reaches a model. Everything that talks to a model lives here and only
// returns data; it never imports anything that writes to the household's tables.
//
// Rosie runs on the household's subscriptions, not an API key: Claude first, through
// the Claude Code CLI or directly with its sign-in token, and Codex as the fallback.

export const DEFAULT_MODEL = "claude-opus-5-5";

// How long one message may take, fallbacks included.
export const TIMEOUT_MS = 90_000;

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Runner = (cmd: string[], input: string, opts: { cwd: string; env: Record<string, string | undefined>; signal: AbortSignal }) => Promise<RunResult>;

export const runProcess: Runner = async (cmd, input, { cwd, env, signal }) => {
  if (signal.aborted) return { code: -1, stdout: "", stderr: "timed out before starting" };
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(cmd, { stdin: new Blob([input]), stdout: "pipe", stderr: "pipe", cwd, env });
  } catch (err) {
    return { code: -1, stdout: "", stderr: String(err) };
  }
  const kill = () => proc.kill();
  signal.addEventListener("abort", kill, { once: true });
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout as ReadableStream).text(),
      new Response(proc.stderr as ReadableStream).text(),
      proc.exited,
    ]);
    return signal.aborted ? { code: -1, stdout, stderr: `timed out after ${TIMEOUT_MS / 1000}s` } : { code, stdout, stderr };
  } finally {
    signal.removeEventListener("abort", kill);
  }
};

function unavailable(name: string, r: RunResult): ModelUnavailable {
  const why = (r.stderr || r.stdout).trim().split("\n").slice(-3).join(" ").slice(0, 400) || `exit code ${r.code}`;
  return new ModelUnavailable(`${name}: ${why}`);
}

// Each CLI call runs in a fresh, empty folder so it can't pick up a CLAUDE.md, AGENTS.md
// or project settings, and the folder goes away afterwards.
async function inEmptyDir<T>(f: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "rosie-model-"));
  try {
    return await f(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface ClaudeResult {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  structured_output?: unknown;
  modelUsage?: Record<string, { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number }>;
}

export interface ClaudeCliOptions {
  bin?: string;
  model?: string;
  // Its own config folder, so Rosie's calls never share settings, memory or history with a person's.
  configDir?: string;
  env?: Record<string, string | undefined>;
  run?: Runner;
}

// `claude -p` signed in with the subscription (CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`).
// A parser, not an agent: no tools, no settings, no MCP servers, nothing saved.
export function claudeCli(opts: ClaudeCliOptions = {}): Interpreter {
  const run = opts.run ?? runProcess;
  const model = opts.model ?? DEFAULT_MODEL;
  const { ANTHROPIC_API_KEY: _, ...inherited } = opts.env ?? process.env;
  const env = {
    ...inherited,
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    // No update checks, telemetry or error reports from inside Rosie.
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    ...(opts.configDir ? { CLAUDE_CONFIG_DIR: opts.configDir } : {}),
  };
  return {
    model: `claude-cli:${model}`,
    interpret: (snap, message, o: InterpretOptions = {}) =>
      inEmptyDir(async (cwd): Promise<Interpretation> => {
        const r = await run(
          [
            opts.bin ?? "claude",
            "-p",
            "--model", model,
            "--effort", "low",
            "--output-format", "json",
            "--json-schema", JSON.stringify(OUTPUT_SCHEMA),
            "--system-prompt", SYSTEM_PROMPT,
            "--tools", "",
            "--permission-mode", "dontAsk",
            "--setting-sources", "",
            "--strict-mcp-config",
            "--no-session-persistence",
            // The structured answer takes a second turn.
            "--max-turns", "2",
          ],
          userContent(snap, message, o.retry),
          { cwd, env, signal: o.signal ?? AbortSignal.timeout(TIMEOUT_MS) },
        );
        let out: ClaudeResult;
        try {
          out = JSON.parse(r.stdout) as ClaudeResult;
        } catch {
          throw unavailable("claude-cli", r);
        }
        if (out.is_error || out.subtype !== "success") throw unavailable("claude-cli", { ...r, stderr: `${out.subtype ?? "error"}: ${out.result ?? r.stderr}` });
        const answer = out.structured_output !== undefined ? JSON.stringify(out.structured_output) : (out.result ?? "");
        const usage = Object.entries(out.modelUsage ?? {});
        const tokens = usage.reduce(
          (t, [, u]) => ({
            input_tokens: t.input_tokens + (u.inputTokens ?? 0) + (u.cacheReadInputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0),
            output_tokens: t.output_tokens + (u.outputTokens ?? 0),
          }),
          { input_tokens: 0, output_tokens: 0 },
        );
        // modelUsage lists the main model plus any small helper calls on a lighter model.
        const main = usage.find(([name]) => name.includes(model))?.[0] ?? usage.sort(([, a], [, b]) => (b.outputTokens ?? 0) - (a.outputTokens ?? 0))[0]?.[0];
        return { ...parseInterpretation(answer), model: `claude-cli:${main ?? model}`, usage: tokens, raw: answer };
      }),
  };
}

// Rosie calls the Messages API herself with the subscription's sign-in token: no extra
// process per message, but she does her own checking (parseInterpretation) and retries.
export function claudeDirect(opts: { token?: string; model?: string; client?: Anthropic } = {}): Interpreter {
  let client = opts.client;
  const model = opts.model ?? DEFAULT_MODEL;
  return {
    model: `claude-direct:${model}`,
    async interpret(snap, message, o: InterpretOptions = {}) {
      // Loaded on first use, so the nightly check never depends on the SDK being installed.
      client ??= new (await import("@anthropic-ai/sdk")).default({ apiKey: null, authToken: opts.token, timeout: TIMEOUT_MS, maxRetries: 1 });
      let response: Anthropic.Beta.BetaMessage;
      try {
        response = await client.beta.messages.create(
          {
            model,
            max_tokens: 4000,
            // A short, well-specified parsing job; low effort keeps it quick.
            output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
            // Sign-in tokens need the OAuth beta. If a safety classifier declines a harmless
            // household message, retry on the model Anthropic recommends instead of failing.
            betas: ["oauth-2025-04-20", "server-side-fallback-2026-07-01"],
            fallbacks: "default",
            system: SYSTEM_PROMPT,
            messages: [{ role: "user", content: userContent(snap, message, o.retry) }],
          },
          { signal: o.signal },
        );
      } catch (err) {
        throw new ModelUnavailable(`claude-direct: ${String(err).slice(0, 400)}`);
      }
      if (response.stop_reason === "refusal") throw new InterpretError("Rosie couldn't take that message. Try rewording it.");
      if (response.stop_reason === "max_tokens") throw new InterpretError("Rosie's answer was cut off. Try a shorter message.");
      const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      return {
        ...parseInterpretation(text),
        model: `claude-direct:${response.model}`,
        usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
        raw: text,
      };
    },
  };
}

export interface CodexCliOptions {
  bin?: string;
  model?: string;
  // Where `codex login --device-auth` saved the sign-in. Unset uses the person's own ~/.codex.
  home?: string;
  env?: Record<string, string | undefined>;
  run?: Runner;
}

// `codex exec` signed in with the Codex subscription: read-only sandbox, nothing saved.
export function codexCli(opts: CodexCliOptions = {}): Interpreter {
  const run = opts.run ?? runProcess;
  const name = `codex-cli:${opts.model ?? "default"}`;
  const { OPENAI_API_KEY: _, ...inherited } = opts.env ?? process.env;
  const env = { ...inherited, ...(opts.home ? { CODEX_HOME: opts.home } : {}) };
  return {
    model: name,
    interpret: (snap, message, o: InterpretOptions = {}) =>
      inEmptyDir(async (dir): Promise<Interpretation> => {
        const schema = join(dir, "schema.json");
        const last = join(dir, "answer.json");
        writeFileSync(schema, JSON.stringify(OUTPUT_SCHEMA));
        const r = await run(
          [
            opts.bin ?? "codex",
            "exec",
            ...(opts.model ? ["--model", opts.model] : []),
            "-c", 'model_reasoning_effort="low"',
            "--sandbox", "read-only",
            "--skip-git-repo-check",
            "--ephemeral",
            "--color", "never",
            "--cd", dir,
            "--output-schema", schema,
            "--output-last-message", last,
            "-",
          ],
          // Codex has no separate system prompt in exec mode, so the instructions lead the prompt.
          `${SYSTEM_PROMPT}\n\n${userContent(snap, message, o.retry)}`,
          { cwd: dir, env, signal: o.signal ?? AbortSignal.timeout(TIMEOUT_MS) },
        );
        if (r.code !== 0) throw unavailable("codex-cli", r);
        let answer: string;
        try {
          answer = readFileSync(last, "utf8");
        } catch {
          throw unavailable("codex-cli", { ...r, stderr: `no answer written. ${r.stderr}` });
        }
        return { ...parseInterpretation(answer), model: name, raw: answer };
      }),
  };
}

// Tries each interpreter in turn, so a sign-in problem or plan limit on one falls through
// to the next. Only says "unavailable" if no model could be reached at all.
export function firstThatAnswers(interpreters: Interpreter[]): Interpreter {
  if (interpreters.length === 1) return interpreters[0]!;
  return {
    model: interpreters.map((i) => i.model).join(" → "),
    async interpret(snap, message, o: InterpretOptions = {}) {
      const errors: string[] = [];
      let reached: InterpretError | null = null;
      for (const i of interpreters) {
        if (o.signal?.aborted) break;
        try {
          const out = await i.interpret(snap, message, o);
          return errors.length ? { ...out, fallbacks: errors } : out;
        } catch (err) {
          if (err instanceof InterpretError) reached = err;
          errors.push(err instanceof InterpretError || err instanceof ModelUnavailable ? (err.detail ?? `${i.model}: ${err.message}`) : `${i.model}: ${String(err)}`);
        }
      }
      if (reached) throw new InterpretError(reached.message, errors.join("; "));
      throw new ModelUnavailable(errors.join("; ") || "timed out");
    },
  };
}

// Reads one message at a time, so two people tapping Send at once don't run two models
// side by side on a small VM. The time limit starts when a message's turn comes.
export function oneAtATime(interpreter: Interpreter, timeoutMs = TIMEOUT_MS): Interpreter {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    model: interpreter.model,
    interpret(snap, message, o: InterpretOptions = {}) {
      const turn = tail.then(() => {
        const limit = AbortSignal.timeout(timeoutMs);
        return interpreter.interpret(snap, message, { ...o, signal: o.signal ? AbortSignal.any([o.signal, limit]) : limit });
      });
      tail = turn.catch(() => {});
      return turn;
    },
  };
}

export const INTERPRETERS = ["claude-cli", "claude-direct", "codex-cli"] as const;

// Builds the fallback chain from names like "claude-cli,codex-cli".
export function buildInterpreter(names: string[], env: Record<string, string | undefined>, run?: Runner): Interpreter {
  return firstThatAnswers(
    names.map((name) => {
      if (name === "claude-cli") {
        return claudeCli({ bin: env.ROSIE_CLAUDE_BIN, model: env.ROSIE_CLAUDE_MODEL || undefined, configDir: env.ROSIE_CLAUDE_CONFIG_DIR || undefined, env, run });
      }
      if (name === "claude-direct") {
        if (!env.CLAUDE_CODE_OAUTH_TOKEN) throw new Error("claude-direct needs CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`)");
        return claudeDirect({ token: env.CLAUDE_CODE_OAUTH_TOKEN, model: env.ROSIE_CLAUDE_MODEL || undefined });
      }
      if (name === "codex-cli") {
        return codexCli({ bin: env.ROSIE_CODEX_BIN, model: env.ROSIE_CODEX_MODEL || undefined, home: env.ROSIE_CODEX_HOME || undefined, env, run });
      }
      throw new Error(`unknown interpreter "${name}" (use ${INTERPRETERS.join(", ")}, comma-separated, in the order to try them)`);
    }),
  );
}

// ROSIE_INTERPRETER lists what to try, in order, e.g. "claude-cli,codex-cli".
// Unset means "Tell Rosie" is off and the page doesn't offer the box.
export function interpreterFromEnv(env: Record<string, string | undefined>, run?: Runner): Interpreter | undefined {
  const names = (env.ROSIE_INTERPRETER ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return names.length ? oneAtATime(buildInterpreter(names, env, run)) : undefined;
}
