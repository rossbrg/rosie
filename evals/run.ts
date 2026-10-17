// Runs the "Tell Rosie" eval set against a real model, signed in with a subscription.
//
//   bun run eval                                   all cases through ROSIE_INTERPRETER, or claude-cli
//   bun run eval --interpreter codex-cli           try another route (claude-cli, claude-direct, codex-cli)
//   bun run eval --interpreter claude-cli,codex-cli  a fallback chain, as the page would use it
//   bun run eval --only snooze                     cases whose id contains "snooze"
//   bun run eval --model <id>                      try another model on the Claude routes
//   bun run eval --repeat 3                        run each case 3 times to see how stable it is
//
// Each case goes through the same path as the page (ask(): the model call, validation,
// and one retry when validation refuses something) and is scored on the suggestions the
// person would see, so a case passes only if they'd see exactly the right ones.
// Results, with each call's time, go to evals/results/.

import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { Action } from "../src/actions";
import { ask } from "../src/ask";
import { buildInterpreter } from "../src/llm";
import { migrate } from "../src/db";
import { runNightly } from "../src/nightly";
import { seed } from "../src/seed";

interface Case {
  id: string;
  speaker?: string;
  message: string;
  expect: Record<string, unknown>[];
  reply_matches?: string;
}

const here = new URL(".", import.meta.url).pathname;
const { values: args } = parseArgs({
  options: {
    only: { type: "string" },
    interpreter: { type: "string" },
    model: { type: "string" },
    repeat: { type: "string", default: "1" },
    concurrency: { type: "string", default: "2" },
  },
});

const suite = JSON.parse(readFileSync(`${here}cases.json`, "utf8")) as { today: string; cases: Case[] };
const today = suite.today;

const db = new Database(":memory:", { strict: true });
db.exec("PRAGMA foreign_keys = ON");
migrate(db);
seed(db, `${here}household.json`, new Date(`${today}T03:00:00Z`));
await runNightly(db, [], new Date(`${today}T03:00:00Z`), { timeZone: "UTC" });

const scheduleOf = (taskId: number) =>
  db.query<{ schedule_id: string }, [number]>("SELECT schedule_id FROM occurrences WHERE id = ?").get(taskId)?.schedule_id;

// Task ids depend on insertion order, so cases name the schedule instead.
function comparable(a: Action): Record<string, unknown> {
  if (a.type === "complete" || a.type === "snooze") {
    const { task_id, ...rest } = a;
    return { ...rest, schedule: scheduleOf(task_id) };
  }
  return { ...a };
}

function matches(actual: Record<string, unknown>, want: Record<string, unknown>): boolean {
  return Object.entries(want).every(([k, v]) => (v === "*" ? actual[k] != null : actual[k] === v));
}

function score(c: Case, actions: Record<string, unknown>[], rejected: string[], reply: string): string[] {
  const problems: string[] = [];
  const left = [...actions];
  for (const want of c.expect) {
    const i = left.findIndex((a) => matches(a, want));
    if (i === -1) problems.push(`missing ${JSON.stringify(want)}`);
    else left.splice(i, 1);
  }
  for (const extra of left) problems.push(`unexpected ${JSON.stringify(extra)}`);
  for (const r of rejected) problems.push(`invalid action: ${r}`);
  if (c.reply_matches && !new RegExp(c.reply_matches, "i").test(reply)) problems.push(`reply didn't match /${c.reply_matches}/`);
  return problems;
}

const names = (args.interpreter ?? process.env.ROSIE_INTERPRETER ?? "claude-cli").split(",").map((n) => n.trim());
const interpreter = buildInterpreter(names, { ...process.env, ...(args.model ? { ROSIE_CLAUDE_MODEL: args.model } : {}) });
const cases = suite.cases.filter((c) => !args.only || c.id.includes(args.only));
const runs = cases.flatMap((c) => Array.from({ length: Number(args.repeat) }, () => c));

interface Result {
  id: string;
  pass: boolean;
  problems: string[];
  reply: string;
  actions: Record<string, unknown>[];
  ms: number;
  calls: { attempt: number; model: string | null; status: string; duration_ms: number; error: string | null }[];
  usage: { input_tokens: number; output_tokens: number };
}

interface CallRow {
  attempt: number;
  model: string | null;
  status: string;
  duration_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  error: string | null;
}

async function runOne(c: Case): Promise<Result> {
  const speaker = c.speaker ?? "ross";
  const started = performance.now();
  const out = await ask(db, interpreter, speaker, c.message, today, () => new Date(`${today}T12:00:00Z`), { dailyCap: Infinity });
  const ms = performance.now() - started;
  const rows = db
    .query<CallRow, [number]>("SELECT attempt, model, status, duration_ms, input_tokens, output_tokens, error FROM model_calls WHERE request_id = ? ORDER BY id")
    .all(out.requestId);
  const usage = rows.reduce((t, r) => ({ input_tokens: t.input_tokens + (r.input_tokens ?? 0), output_tokens: t.output_tokens + (r.output_tokens ?? 0) }), {
    input_tokens: 0,
    output_tokens: 0,
  });
  const calls = rows.map(({ attempt, model, status, duration_ms, error }) => ({ attempt, model, status, duration_ms, error }));
  if (out.error) {
    const why = rows.at(-1)?.error;
    return { id: c.id, pass: false, problems: [`error: ${out.error}${why ? ` (${why})` : ""}`], reply: "", actions: [], ms, calls, usage };
  }
  const actions = out.proposals.map((p) => comparable(p.action));
  const problems = score(c, actions, out.rejected, out.reply ?? "");
  return { id: c.id, pass: problems.length === 0, problems, reply: out.reply ?? "", actions, ms, calls, usage };
}

const results: Result[] = [];
const queue = [...runs];
await Promise.all(
  Array.from({ length: Number(args.concurrency) }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const r = await runOne(c);
      results.push(r);
      const retried = r.calls.length > 1 ? ", retried" : "";
      console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.id.padEnd(30)} ${(r.ms / 1000).toFixed(1)}s${retried}`);
      for (const p of r.problems) console.log(`        ${p}`);
      if (!r.pass && r.reply) console.log(`        reply: ${r.reply}`);
    }
  }),
);

const passed = results.filter((r) => r.pass).length;
const tokens = results.reduce((t, r) => ({ in: t.in + r.usage.input_tokens, out: t.out + r.usage.output_tokens }), { in: 0, out: 0 });
// How long a person waits, per message, retries included.
const waits = results.map((r) => r.ms).sort((a, b) => a - b);
const pct = (p: number) => (waits[Math.min(waits.length - 1, Math.floor(p * waits.length))]! / 1000).toFixed(1);
const retried = results.filter((r) => r.calls.length > 1).length;
const answeredBy = [...new Set(results.flatMap((r) => r.calls.map((c) => c.model).filter(Boolean)))].join(", ");
console.log(`\n${passed}/${results.length} passed with ${interpreter.model}${answeredBy ? ` (answered by ${answeredBy})` : ""}`);
console.log(`Wait per message: median ${pct(0.5)}s, 90th percentile ${pct(0.9)}s, slowest ${pct(1)}s. ${retried} retried after validation.`);
console.log(`${tokens.in} input, ${tokens.out} output tokens`);

mkdirSync(`${here}results`, { recursive: true });
const file = `${here}results/${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(
  file,
  JSON.stringify({ interpreter: interpreter.model, today, passed, total: results.length, tokens, wait_s: { p50: pct(0.5), p90: pct(0.9), max: pct(1) }, retried, results }, null, 2),
);
console.log(`Details in ${file}`);
process.exit(passed === results.length ? 0 : 1);
