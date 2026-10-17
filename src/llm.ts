import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InterpretError, OUTPUT_SCHEMA, parseInterpretation, SYSTEM_PROMPT, userContent, type Interpretation, type Interpreter } from "./ask";

// Rosie reads messages through the Claude Code and Codex command-line tools, signed in
// with the household's subscriptions, not an API key. Each message runs one CLI process
// with no tools, no saved session and a JSON schema for the answer.

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Runner = (cmd: string[], input: string, timeoutMs: number) => Promise<RunResult>;

// How long one model gets before Rosie gives up on it.
const TIMEOUT_MS = 90_000;

export const runProcess: Runner = async (cmd, input, timeoutMs) => {
  const proc = Bun.spawn(cmd, { stdin: new Blob([input]), stdout: "pipe", stderr: "pipe", cwd: tmpdir() });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    return { code: proc.signalCode ? -1 : code, stdout, stderr: proc.signalCode ? `timed out after ${timeoutMs / 1000}s` : stderr };
  } catch (err) {
    return { code: -1, stdout: "", stderr: String(err) };
  } finally {
    clearTimeout(timer);
  }
};

function failed(name: string, r: RunResult): InterpretError {
  const why = (r.stderr || r.stdout).trim().split("\n").slice(-3).join(" ").slice(0, 400) || `exit code ${r.code}`;
  return new InterpretError("Rosie couldn't get an answer just now. Try again in a few minutes.", `${name}: ${why}`);
}

interface ClaudeResult {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  structured_output?: unknown;
  modelUsage?: Record<string, { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number }>;
}

export function claudeCli(opts: { bin?: string; model?: string; effort?: string; run?: Runner } = {}): Interpreter {
  const run = opts.run ?? runProcess;
  const model = opts.model ?? "opus";
  return {
    model: `claude:${model}`,
    async interpret(snap, message): Promise<Interpretation> {
      const r = await run(
        [
          opts.bin ?? "claude",
          "-p",
          "--model", model,
          "--effort", opts.effort ?? "low",
          "--output-format", "json",
          "--json-schema", JSON.stringify(OUTPUT_SCHEMA),
          "--system-prompt", SYSTEM_PROMPT,
          // A parser, not an agent: no tools, no settings, MCP servers or saved session.
          "--tools", "",
          "--setting-sources", "",
          "--strict-mcp-config",
          "--no-session-persistence",
        ],
        userContent(snap, message),
        TIMEOUT_MS,
      );
      let out: ClaudeResult;
      try {
        out = JSON.parse(r.stdout) as ClaudeResult;
      } catch {
        throw failed("claude", r);
      }
      if (out.is_error || out.subtype !== "success") throw failed("claude", { ...r, stderr: `${out.subtype ?? "error"}: ${out.result ?? r.stderr}` });
      const answer = out.structured_output !== undefined ? JSON.stringify(out.structured_output) : (out.result ?? "");
      const usage = Object.entries(out.modelUsage ?? {});
      const tokens = usage.reduce(
        (t, [, u]) => ({
          input_tokens: t.input_tokens + (u.inputTokens ?? 0) + (u.cacheReadInputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0),
          output_tokens: t.output_tokens + (u.outputTokens ?? 0),
        }),
        { input_tokens: 0, output_tokens: 0 },
      );
      // modelUsage lists the main model plus any small helper calls; the main one has the most output.
      const main = usage.sort(([, a], [, b]) => (b.outputTokens ?? 0) - (a.outputTokens ?? 0))[0]?.[0];
      return { ...parseInterpretation(answer), model: main ? `claude:${main}` : `claude:${model}`, usage: tokens };
    },
  };
}

export function codexCli(opts: { bin?: string; model?: string; effort?: string; run?: Runner } = {}): Interpreter {
  const run = opts.run ?? runProcess;
  return {
    model: `codex:${opts.model ?? "default"}`,
    async interpret(snap, message): Promise<Interpretation> {
      const dir = mkdtempSync(join(tmpdir(), "rosie-codex-"));
      try {
        const schema = join(dir, "schema.json");
        const last = join(dir, "answer.json");
        writeFileSync(schema, JSON.stringify(OUTPUT_SCHEMA));
        const r = await run(
          [
            opts.bin ?? "codex",
            "exec",
            ...(opts.model ? ["--model", opts.model] : []),
            "-c", `model_reasoning_effort="${opts.effort ?? "low"}"`,
            // Nothing to run: read-only sandbox, no git checks, nothing saved.
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
          `${SYSTEM_PROMPT}\n\n${userContent(snap, message)}`,
          TIMEOUT_MS,
        );
        if (r.code !== 0) throw failed("codex", r);
        let answer: string;
        try {
          answer = readFileSync(last, "utf8");
        } catch {
          throw failed("codex", { ...r, stderr: `no answer written. ${r.stderr}` });
        }
        return { ...parseInterpretation(answer), model: `codex:${opts.model ?? "default"}` };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

// Tries each interpreter in turn, so a plan limit or outage on one falls through to the next.
export function firstThatAnswers(interpreters: Interpreter[]): Interpreter {
  if (interpreters.length === 1) return interpreters[0]!;
  return {
    model: interpreters.map((i) => i.model).join(" → "),
    async interpret(snap, message) {
      const errors: string[] = [];
      for (const i of interpreters) {
        try {
          return await i.interpret(snap, message);
        } catch (err) {
          errors.push(err instanceof InterpretError ? (err.detail ?? `${i.model}: ${err.message}`) : `${i.model}: ${String(err)}`);
        }
      }
      throw new InterpretError("Rosie couldn't get an answer just now. Try again in a few minutes.", errors.join("; "));
    },
  };
}

// ROSIE_INTERPRETER lists the CLIs to use in order, e.g. "claude" or "claude,codex".
// Unset means "Tell Rosie" is off.
export function interpreterFromEnv(env: Record<string, string | undefined>, run?: Runner): Interpreter | undefined {
  const names = (env.ROSIE_INTERPRETER ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!names.length) return undefined;
  return firstThatAnswers(
    names.map((name) => {
      if (name === "claude") return claudeCli({ bin: env.ROSIE_CLAUDE_BIN, model: env.ROSIE_CLAUDE_MODEL || undefined, run });
      if (name === "codex") return codexCli({ bin: env.ROSIE_CODEX_BIN, model: env.ROSIE_CODEX_MODEL || undefined, run });
      throw new Error(`ROSIE_INTERPRETER: unknown "${name}" (use claude, codex, or both, comma-separated)`);
    }),
  );
}
