// Runs the "Tell Rosie" eval set against the real model.
//
//   bun run eval                      all cases, default model
//   bun run eval --only snooze        cases whose id contains "snooze"
//   bun run eval --interpreter codex  score Codex instead of Claude (default: ROSIE_INTERPRETER, else claude)
//   bun run eval --model <name>       try another model on that CLI
//   bun run eval --repeat 3           run each case 3 times to see how stable it is
//
// Each case is scored on the actions Rosie would show for approval, after the same
// validation the web page uses, so a case passes only if the person would see
// exactly the right suggestions. Runs through the same signed-in Claude Code / Codex CLIs
// as the server, so it uses the subscription, not an API key. Results go to evals/results/.

import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { Action } from "../src/actions";
import { review, snapshot } from "../src/ask";
import { migrate } from "../src/db";
import { interpreterFromEnv } from "../src/llm";
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
    // Each case starts a CLI process; keep it gentle on the plan's rate limits.
    concurrency: { type: "string", default: "3" },
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

const which = args.interpreter ?? process.env.ROSIE_INTERPRETER ?? "claude";
const interpreter = interpreterFromEnv({
  ...process.env,
  ROSIE_INTERPRETER: which,
  ...(args.model ? { ROSIE_CLAUDE_MODEL: args.model, ROSIE_CODEX_MODEL: args.model } : {}),
})!;
const cases = suite.cases.filter((c) => !args.only || c.id.includes(args.only));
const runs = cases.flatMap((c) => Array.from({ length: Number(args.repeat) }, () => c));

interface Result {
  id: string;
  pass: boolean;
  problems: string[];
  reply: string;
  actions: Record<string, unknown>[];
  ms: number;
  usage?: { input_tokens: number; output_tokens: number };
}

async function runOne(c: Case): Promise<Result> {
  const speaker = c.speaker ?? "ross";
  const started = performance.now();
  try {
    const out = await interpreter.interpret(snapshot(db, speaker, today), c.message);
    const { proposals, rejected } = review(db, speaker, today, out.actions);
    const actions = proposals.map((p) => comparable(p.action));
    const problems = score(c, actions, rejected, out.reply);
    return { id: c.id, pass: problems.length === 0, problems, reply: out.reply, actions, ms: performance.now() - started, usage: out.usage };
  } catch (err) {
    return { id: c.id, pass: false, problems: [`error: ${String(err)}`], reply: "", actions: [], ms: performance.now() - started };
  }
}

const results: Result[] = [];
const queue = [...runs];
await Promise.all(
  Array.from({ length: Number(args.concurrency) }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const r = await runOne(c);
      results.push(r);
      console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.id.padEnd(30)} ${(r.ms / 1000).toFixed(1)}s`);
      for (const p of r.problems) console.log(`        ${p}`);
      if (!r.pass && r.reply) console.log(`        reply: ${r.reply}`);
    }
  }),
);

const passed = results.filter((r) => r.pass).length;
const tokens = results.reduce((t, r) => ({ in: t.in + (r.usage?.input_tokens ?? 0), out: t.out + (r.usage?.output_tokens ?? 0) }), { in: 0, out: 0 });
console.log(`\n${passed}/${results.length} passed with ${interpreter.model} (${tokens.in} input, ${tokens.out} output tokens)`);

mkdirSync(`${here}results`, { recursive: true });
const file = `${here}results/${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(file, JSON.stringify({ model: interpreter.model, today, passed, total: results.length, tokens, results }, null, 2));
console.log(`Details in ${file}`);
process.exit(passed === results.length ? 0 : 1);
