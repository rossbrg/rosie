import { describe, expect, test } from "bun:test";
import { readdirSync, writeFileSync } from "node:fs";
import { InterpretError, ModelUnavailable, type Interpretation, type Interpreter, type Snapshot } from "../src/ask";
import { claudeCli, codexCli, firstThatAnswers, interpreterFromEnv, oneAtATime, runProcess, type Runner } from "../src/llm";

const snap: Snapshot = {
  today: "2026-10-20",
  weekday: "Tuesday",
  speaker: { id: "ross", name: "Ross" },
  people: [{ id: "ross", name: "Ross" }],
  items: [],
  schedules: [],
  recent_history: [],
};

const answer = { reply: "Hi", actions: [] };

// Stands in for a CLI: remembers how it was started and answers with `respond`.
function fakeRun(respond: (cmd: string[], cwd: string) => { code?: number; stdout?: string; stderr?: string }) {
  const calls: { cmd: string[]; input: string; cwd: string; env: Record<string, string | undefined>; cwdFiles: string[] }[] = [];
  const run: Runner = async (cmd, input, { cwd, env }) => {
    calls.push({ cmd, input, cwd, env, cwdFiles: readdirSync(cwd) });
    const r = respond(cmd, cwd);
    return { code: r.code ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
  return { run, calls };
}

const flag = (cmd: string[], name: string) => cmd[cmd.indexOf(name) + 1];

describe("claude-cli", () => {
  const ok = JSON.stringify({
    subtype: "success",
    is_error: false,
    structured_output: answer,
    modelUsage: {
      "claude-haiku-5-5": { inputTokens: 900, outputTokens: 10 },
      "claude-opus-5-5": { inputTokens: 2, outputTokens: 60, cacheCreationInputTokens: 2000 },
    },
  });

  test("runs as a locked-down parser: no tools, settings, MCP servers, memory, API key or project folder", async () => {
    const { run, calls } = fakeRun(() => ({ stdout: ok }));
    const env = { PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-should-not-pass", CLAUDE_CODE_OAUTH_TOKEN: "tok" };
    const out = await claudeCli({ run, env, configDir: "/var/rosie/claude" }).interpret(snap, "hello");
    expect(out).toMatchObject({ reply: "Hi", actions: [], model: "claude-cli:claude-opus-5-5", usage: { input_tokens: 2902, output_tokens: 70 } });

    const { cmd, env: used, cwdFiles } = calls[0]!;
    expect(cmd.slice(0, 2)).toEqual(["claude", "-p"]);
    expect(flag(cmd, "--tools")).toBe("");
    expect(flag(cmd, "--permission-mode")).toBe("dontAsk");
    expect(flag(cmd, "--setting-sources")).toBe("");
    expect(flag(cmd, "--max-turns")).toBe("2");
    expect(flag(cmd, "--output-format")).toBe("json");
    expect(cmd).toContain("--strict-mcp-config");
    expect(cmd).toContain("--no-session-persistence");
    expect(JSON.parse(flag(cmd, "--json-schema")!).required).toEqual(["reply", "actions"]);
    expect(used.ANTHROPIC_API_KEY).toBeUndefined();
    expect(used).toMatchObject({ CLAUDE_CODE_OAUTH_TOKEN: "tok", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1", CLAUDE_CONFIG_DIR: "/var/rosie/claude" });
    expect(cwdFiles).toEqual([]);
  });

  test("a retry shows the model its previous answer and what was wrong", async () => {
    const { run, calls } = fakeRun(() => ({ stdout: ok }));
    await claudeCli({ run, env: {} }).interpret(snap, "hello", { retry: { previous: '{"reply":"x"}', problems: ["there is no task 42"] } });
    expect(calls[0]!.input).toContain("<previous_answer>\n{\"reply\":\"x\"}\n</previous_answer>");
    expect(calls[0]!.input).toContain("- there is no task 42");
  });

  test("a sign-in failure, plan limit or crash means the model is unavailable", async () => {
    const limit = fakeRun(() => ({ code: 1, stdout: JSON.stringify({ subtype: "error_during_execution", is_error: true, result: "usage limit reached" }) }));
    expect(claudeCli({ run: limit.run, env: {} }).interpret(snap, "hello")).rejects.toThrow(ModelUnavailable);
    const crash = fakeRun(() => ({ code: 1, stderr: "Invalid API key · Please run /login" }));
    const err = await claudeCli({ run: crash.run, env: {} }).interpret(snap, "hello").catch((e) => e);
    expect(err).toBeInstanceOf(ModelUnavailable);
    expect(err.detail).toBe("claude-cli: Invalid API key · Please run /login");
  });
});

describe("codex-cli", () => {
  test("runs read-only and ephemeral with its own sign-in folder and no API key", async () => {
    const { run, calls } = fakeRun((cmd) => {
      writeFileSync(flag(cmd, "--output-last-message")!, JSON.stringify(answer));
      return {};
    });
    const out = await codexCli({ run, env: { OPENAI_API_KEY: "sk-no" }, home: "/var/rosie/codex" }).interpret(snap, "hello");
    expect(out).toMatchObject({ reply: "Hi", actions: [], model: "codex-cli:default" });
    const { cmd, env, input } = calls[0]!;
    expect(cmd.slice(0, 2)).toEqual(["codex", "exec"]);
    expect(flag(cmd, "--sandbox")).toBe("read-only");
    expect(cmd).toContain("--ephemeral");
    expect(cmd).toContain("--skip-git-repo-check");
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.CODEX_HOME).toBe("/var/rosie/codex");
    expect(input.startsWith("You are Rosie")).toBe(true);
  });

  test("a failed run means the model is unavailable", async () => {
    const { run } = fakeRun(() => ({ code: 1, stderr: "not logged in" }));
    expect(codexCli({ run, env: {} }).interpret(snap, "hello")).rejects.toThrow(ModelUnavailable);
  });
});

describe("fallbacks and the queue", () => {
  const answering = (model: string): Interpreter => ({ model, interpret: async () => ({ ...answer, model }) });
  const failing = (model: string, err: Error): Interpreter => ({
    model,
    interpret: async () => {
      throw err;
    },
  });

  test("falls through to the next interpreter and notes why", async () => {
    const out = await firstThatAnswers([failing("claude", new ModelUnavailable("claude-cli: usage limit")), answering("codex")]).interpret(snap, "hi");
    expect(out).toMatchObject({ model: "codex", fallbacks: ["claude-cli: usage limit"] });
  });

  test("unavailable only if no model could be reached; an unusable answer stays an unusable answer", async () => {
    const down = new ModelUnavailable("down");
    expect(firstThatAnswers([failing("a", down), failing("b", down)]).interpret(snap, "hi")).rejects.toThrow(ModelUnavailable);
    const bad = new InterpretError("Rosie's answer wasn't valid JSON");
    expect(firstThatAnswers([failing("a", bad), failing("b", down)]).interpret(snap, "hi")).rejects.toThrow(InterpretError);
  });

  test("reads one message at a time", async () => {
    let running = 0;
    let most = 0;
    const slow: Interpreter = {
      model: "slow",
      async interpret(): Promise<Interpretation> {
        most = Math.max(most, ++running);
        await Bun.sleep(20);
        running--;
        return answer;
      },
    };
    const queued = oneAtATime(slow);
    await Promise.all([queued.interpret(snap, "a"), queued.interpret(snap, "b"), queued.interpret(snap, "c")]);
    expect(most).toBe(1);
  });

  test("gives each message a time limit that starts on its turn", async () => {
    const seen: AbortSignal[] = [];
    const hangs: Interpreter = {
      model: "hangs",
      interpret: (_s, _m, o = {}) =>
        new Promise((_, reject) => {
          seen.push(o.signal!);
          o.signal!.addEventListener("abort", () => reject(new ModelUnavailable("timed out")));
        }),
    };
    const queued = oneAtATime(hangs, 30);
    const results = await Promise.allSettled([queued.interpret(snap, "a"), queued.interpret(snap, "b")]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(seen).toHaveLength(2);
  });

  test("ROSIE_INTERPRETER picks the routes; unset turns the box off", () => {
    expect(interpreterFromEnv({})).toBeUndefined();
    expect(interpreterFromEnv({ ROSIE_INTERPRETER: "claude-cli, codex-cli" })!.model).toBe("claude-cli:claude-opus-5-5 → codex-cli:default");
    expect(() => interpreterFromEnv({ ROSIE_INTERPRETER: "gpt" })).toThrow("unknown interpreter");
    expect(() => interpreterFromEnv({ ROSIE_INTERPRETER: "claude-direct" })).toThrow("CLAUDE_CODE_OAUTH_TOKEN");
    expect(interpreterFromEnv({ ROSIE_INTERPRETER: "claude-direct", CLAUDE_CODE_OAUTH_TOKEN: "tok" })!.model).toBe("claude-direct:claude-opus-5-5");
  });
});

describe("running a process", () => {
  test("passes the message on stdin and returns what it printed", async () => {
    const r = await runProcess(["sh", "-c", "cat; echo done >&2"], "hello", { cwd: "/", env: { PATH: process.env.PATH }, signal: AbortSignal.timeout(5000) });
    expect(r).toEqual({ code: 0, stdout: "hello", stderr: "done\n" });
  });

  test("stops a process that runs past its time limit", async () => {
    const started = performance.now();
    const r = await runProcess(["sleep", "5"], "", { cwd: "/", env: { PATH: process.env.PATH }, signal: AbortSignal.timeout(100) });
    expect(r.code).toBe(-1);
    expect(r.stderr).toContain("timed out");
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
