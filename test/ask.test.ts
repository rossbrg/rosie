import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import type { RawAction } from "../src/actions";
import { ActionError, validate } from "../src/actions";
import {
  ask,
  claudeInterpreter,
  decide,
  DecisionError,
  InterpretError,
  parseInterpretation,
  snapshot,
  type Interpreter,
  type Snapshot,
} from "../src/ask";
import { migrate } from "../src/db";
import { nextDue, type Schedule } from "../src/maintenance";
import { runNightly } from "../src/nightly";
import type { Channel } from "../src/notify";
import { createHandler, csrfToken } from "../src/web";

const TZ = "UTC";
const at = (iso: string) => new Date(`${iso}T03:00:00Z`);
const TODAY = "2026-10-20";
const now = () => at(TODAY);

const silent: Channel[] = [];

const raw = (a: Partial<RawAction> & Pick<RawAction, "type">): RawAction => ({
  task_id: null,
  schedule_id: null,
  item_id: null,
  new_item_name: null,
  title: null,
  date: null,
  interval_days: null,
  person_id: null,
  notes: null,
  checklist: null,
  ...a,
});

// Returns canned answers and remembers what it was shown.
function scripted(...answers: ({ reply: string; actions: RawAction[] } | Error)[]): Interpreter & { seen: { snap: Snapshot; message: string }[] } {
  const seen: { snap: Snapshot; message: string }[] = [];
  return {
    model: "test-model",
    seen,
    async interpret(snap, message) {
      seen.push({ snap, message });
      const next = answers.shift();
      if (!next) throw new Error("no scripted answer left");
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

let db: Database;

beforeEach(async () => {
  db = new Database(":memory:", { strict: true });
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  db.run("INSERT INTO people (id, name, login, email, ntfy_topic) VALUES ('ross', 'Ross', 'ross@test', 'r@test', 'r-topic')");
  db.run("INSERT INTO people (id, name, login, email, ntfy_topic) VALUES ('carly', 'Carly', 'carly@test', 'c@test', 'c-topic')");
  db.run("INSERT INTO items (id, name) VALUES ('mini-split', 'Mini-split')");
  db.run("INSERT INTO items (id, name) VALUES ('dehumidifier', 'Dehumidifier')");
  db.run(
    `INSERT INTO schedules (id, item_id, title, interval_days, lead_days, overdue_days, owner_id, starts_on)
     VALUES ('vacuum', 'mini-split', 'Vacuum inserts', 91, 7, 14, 'ross', '2026-10-24')`,
  );
  db.run(
    `INSERT INTO schedules (id, item_id, title, interval_days, lead_days, overdue_days, owner_id, starts_on)
     VALUES ('tank', 'dehumidifier', 'Clean tank', 30, 7, 14, 'carly', '2026-12-01')`,
  );
  await runNightly(db, silent, now(), { timeZone: TZ });
});

const task = () => db.query<{ id: number; due_on: string; status: string }, []>("SELECT id, due_on, status FROM occurrences WHERE schedule_id = 'vacuum'").get()!;
const schedule = (id: string) => db.query<Schedule, [string]>("SELECT * FROM schedules WHERE id = ?").get(id)!;
const check = (a: RawAction) => validate({ db, speaker: "ross", today: TODAY }, a);

describe("snapshot", () => {
  test("shows the model open tasks with their ids, people, and today's weekday", () => {
    const snap = snapshot(db, "ross", TODAY);
    expect(snap.weekday).toBe("Tuesday");
    expect(snap.speaker).toEqual({ id: "ross", name: "Ross" });
    expect(snap.schedules.find((s) => s.id === "vacuum")!.open_task).toEqual({ task_id: task().id, due_on: "2026-10-24", owner_id: "ross" });
    expect(snap.schedules.find((s) => s.id === "tank")!.open_task).toBeNull();
    expect(snap.schedules.find((s) => s.id === "tank")!.next_due).toBe("2026-12-01");
  });
});

describe("validating what the model proposed", () => {
  test("a completion defaults to today and the writer", () => {
    expect(check(raw({ type: "complete", task_id: task().id }))).toEqual({
      type: "complete",
      task_id: task().id,
      on: TODAY,
      by: "ross",
      notes: null,
    });
  });

  test("ids that don't exist and future completion dates are refused", () => {
    expect(() => check(raw({ type: "complete", task_id: 999 }))).toThrow(ActionError);
    expect(() => check(raw({ type: "complete", task_id: task().id, person_id: "grandma" }))).toThrow(ActionError);
    expect(() => check(raw({ type: "complete", task_id: task().id, date: "2026-10-21" }))).toThrow("in the future");
    expect(() => check(raw({ type: "complete", task_id: task().id, date: "2026-02-30" }))).toThrow("not a YYYY-MM-DD");
  });

  test("logging work on a schedule that has a task waiting completes that task instead", () => {
    expect(check(raw({ type: "log", schedule_id: "vacuum", title: "Vacuumed", date: "2026-10-19" }))).toMatchObject({
      type: "complete",
      task_id: task().id,
      on: "2026-10-19",
    });
  });

  test("a snooze must land after today, and an owner change must change something", () => {
    expect(() => check(raw({ type: "snooze", task_id: task().id, date: TODAY }))).toThrow("past today");
    expect(() => check(raw({ type: "set_owner", schedule_id: "vacuum", person_id: "ross" }))).toThrow("already has");
  });

  test("a new schedule needs a usable interval and an item", () => {
    expect(() => check(raw({ type: "add_schedule", title: "Descale", item_id: "mini-split", interval_days: 0 }))).toThrow("interval");
    expect(() => check(raw({ type: "add_schedule", title: "Descale", interval_days: 91 }))).toThrow("item");
    expect(check(raw({ type: "add_schedule", title: "Descale", new_item_name: "Coffee brewer", interval_days: 91 }))).toMatchObject({
      item_id: null,
      new_item_name: "Coffee brewer",
      first_due: TODAY,
      owner_id: null,
    });
  });
});

describe("asking and approving", () => {
  test("nothing changes until the writer approves, and approving twice writes once", async () => {
    const rosie = scripted({
      reply: "Nice work.",
      actions: [raw({ type: "complete", task_id: task().id, notes: "left head was filthy" })],
    });
    const result = await ask(db, rosie, "ross", "vacuumed the inserts, left head was filthy", TODAY, now);
    expect(rosie.seen[0]!.message).toBe("vacuumed the inserts, left head was filthy");
    expect(result.proposals.map((p) => p.summary)).toEqual([`Mark "Vacuum inserts" done on Tue, Oct 20 with the note "left head was filthy".`]);
    expect(task().status).toBe("open");

    const proposal = db.query<{ id: number }, []>("SELECT id FROM proposals").get()!.id;
    decide(db, proposal, "ross", true, TODAY, now());
    decide(db, proposal, "ross", true, TODAY, now());
    expect(task().status).toBe("done");
    expect(db.query("SELECT completed_by, notes FROM completions").all()).toEqual([{ completed_by: "ross", notes: "left head was filthy" }]);
    expect(db.query("SELECT status FROM proposals").get()).toEqual({ status: "applied" });
  });

  test("only the writer can decide a proposal, and a dismissed one stays dismissed", async () => {
    await ask(db, scripted({ reply: "OK", actions: [raw({ type: "complete", task_id: task().id })] }), "ross", "done", TODAY, now);
    const proposal = db.query<{ id: number }, []>("SELECT id FROM proposals").get()!.id;
    expect(() => decide(db, proposal, "carly", true, TODAY, now())).toThrow(DecisionError);
    decide(db, proposal, "ross", false, TODAY, now());
    expect(() => decide(db, proposal, "ross", true, TODAY, now())).toThrow("already dismissed");
    expect(task().status).toBe("open");
  });

  test("a proposal that went stale fails with the reason when approved", async () => {
    await ask(db, scripted({ reply: "OK", actions: [raw({ type: "complete", task_id: task().id })] }), "ross", "done", TODAY, now);
    const proposal = db.query<{ id: number }, []>("SELECT id FROM proposals").get()!.id;
    db.run("UPDATE occurrences SET status = 'cancelled'");
    expect(() => decide(db, proposal, "ross", true, TODAY, now())).toThrow("already cancelled");
    expect(db.query("SELECT status, error FROM proposals").get()).toEqual({ status: "failed", error: `task ${task().id} is already cancelled` });
  });

  test("actions naming things that don't exist are left out and the reply says so", async () => {
    const result = await ask(
      db,
      scripted({ reply: "Done.", actions: [raw({ type: "complete", task_id: 42 })] }),
      "ross",
      "done with the gutters",
      TODAY,
      now,
    );
    expect(result.proposals).toHaveLength(0);
    expect(result.reply).toBe("Done. (I left out a change I couldn't make: there is no task 42.)");
  });

  test("a model failure is recorded on the request and nothing is proposed", async () => {
    const result = await ask(db, scripted(new Error("ECONNRESET")), "ross", "done", TODAY, now);
    expect(result.error).toBe("Rosie couldn't reach her model. Try again in a minute.");
    expect(db.query("SELECT status, error, model FROM requests").get()).toEqual({
      status: "error",
      error: "Rosie couldn't reach her model. Try again in a minute. (Error: ECONNRESET)",
      model: "test-model",
    });
    expect(db.query("SELECT COUNT(*) AS n FROM proposals").get()).toEqual({ n: 0 });
  });
});

describe("applying each kind of action", () => {
  async function approveAll(actions: RawAction[], speaker = "ross") {
    await ask(db, scripted({ reply: "OK", actions }), speaker, "message", TODAY, now);
    for (const { id } of db.query<{ id: number }, []>("SELECT id FROM proposals WHERE status = 'proposed'").all()) {
      decide(db, id, speaker, true, TODAY, now());
    }
  }

  test("a snooze moves the due date, drops queued reminders, and delays the overdue alert", async () => {
    db.run("INSERT INTO outbox (dedupe_key, person_id, occurrence_id, channel, subject, body, created_at) VALUES ('x', 'ross', ?, 'email', 's', 'b', ?)", [
      task().id,
      now().toISOString(),
    ]);
    await approveAll([raw({ type: "snooze", task_id: task().id, date: "2026-11-07" })]);
    expect(task()).toMatchObject({ due_on: "2026-11-07", status: "open" });
    expect(db.query("SELECT snoozed_from FROM occurrences").get()).toEqual({ snoozed_from: "2026-10-24" });
    expect(db.query("SELECT cancelled_at FROM outbox").get()).not.toEqual({ cancelled_at: null });

    // The nightly check keeps the snoozed task and only calls it overdue 14 days after the new date.
    await runNightly(db, silent, at("2026-11-08"), { timeZone: TZ });
    await runNightly(db, silent, at("2026-11-21"), { timeZone: TZ });
    expect(db.query("SELECT COUNT(*) AS n FROM occurrences").get()).toEqual({ n: 1 });
    expect(db.query("SELECT overdue_alerted_at FROM occurrences").get()).toEqual({ overdue_alerted_at: null });
    await runNightly(db, silent, at("2026-11-22"), { timeZone: TZ });
    expect(db.query("SELECT overdue_alerted_at FROM occurrences").get()).not.toEqual({ overdue_alerted_at: null });
  });

  test("logging early work on a schedule moves its next due date", async () => {
    await approveAll([raw({ type: "log", schedule_id: "tank", title: "Clean tank", date: "2026-10-18" })], "carly");
    expect(nextDue(db, schedule("tank")).due).toBe("2026-11-17");
    expect(db.query("SELECT completed_by, occurrence_id FROM completions").get()).toEqual({ completed_by: "carly", occurrence_id: null });
  });

  test("a new schedule on a new item is planned by the next nightly check", async () => {
    await approveAll([
      raw({ type: "add_schedule", title: "Descale coffee brewer", new_item_name: "Coffee brewer", interval_days: 91, date: "2026-10-25", person_id: "carly" }),
    ]);
    expect(schedule("descale-coffee-brewer")).toMatchObject({ item_id: "coffee-brewer", owner_id: "carly", starts_on: "2026-10-25", lead_days: 7 });
    await runNightly(db, silent, at("2026-10-21"), { timeZone: TZ });
    expect(db.query("SELECT due_on, owner_id FROM occurrences WHERE schedule_id = 'descale-coffee-brewer'").get()).toEqual({
      due_on: "2026-10-25",
      owner_id: "carly",
    });
  });

  test("a new owner takes over the open task at the next nightly check", async () => {
    await approveAll([raw({ type: "set_owner", schedule_id: "vacuum", person_id: "carly" })]);
    expect(schedule("vacuum").owner_id).toBe("carly");
    await runNightly(db, silent, at("2026-10-21"), { timeZone: TZ });
    expect(db.query("SELECT owner_id FROM occurrences WHERE schedule_id = 'vacuum' AND status = 'open'").get()).toEqual({ owner_id: "carly" });
  });

  test("every applied action leaves a receipt", async () => {
    await approveAll([raw({ type: "set_owner", schedule_id: "tank", person_id: null })]);
    const r = db.query<{ kind: string; summary: string }, []>("SELECT kind, summary FROM runs WHERE kind = 'set_owner'").get()!;
    expect(JSON.parse(r.summary)).toEqual({ schedule: "tank", from: "carly", to: null, approvedBy: "ross" });
  });
});

describe("the model call", () => {
  function fakeClient(response: Partial<Anthropic.Beta.BetaMessage>) {
    const calls: Record<string, unknown>[] = [];
    const client = {
      beta: {
        messages: {
          async create(body: Record<string, unknown>) {
            calls.push(body);
            return { model: "claude-opus-5-5", usage: { input_tokens: 10, output_tokens: 5 }, ...response };
          },
        },
      },
    } as unknown as Anthropic;
    return { client, calls };
  }

  test("asks for structured output with refusal fallbacks and parses the answer", async () => {
    const { client, calls } = fakeClient({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ reply: "Hi", actions: [] }), citations: null }],
    });
    const out = await claudeInterpreter({ client }).interpret(snapshot(db, "ross", TODAY), "hello");
    expect(out).toEqual({ reply: "Hi", actions: [], model: "claude-opus-5-5", usage: { input_tokens: 10, output_tokens: 5 } });
    expect(calls[0]).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] });
    expect((calls[0]!.output_config as { format: { type: string } }).format.type).toBe("json_schema");
  });

  test("a refusal becomes a readable error", async () => {
    const { client } = fakeClient({ stop_reason: "refusal", content: [] });
    expect(claudeInterpreter({ client }).interpret(snapshot(db, "ross", TODAY), "hello")).rejects.toThrow(InterpretError);
  });

  test("malformed answers are rejected", () => {
    expect(() => parseInterpretation("not json")).toThrow(InterpretError);
    expect(() => parseInterpretation(JSON.stringify({ reply: "hi" }))).toThrow(InterpretError);
  });
});

describe("web", () => {
  const as = (login: string, path: string, init: RequestInit = {}) =>
    new Request(`http://rosie.test${path}`, { ...init, headers: { "Tailscale-User-Login": login, ...init.headers } });
  const post = (path: string, fields: Record<string, string>) => as("ross@test", path, { method: "POST", body: new URLSearchParams(fields) });

  test("the box only appears when Rosie has a model", async () => {
    const without = await (await createHandler(db, { timeZone: TZ, now })(as("ross@test", "/"))).text();
    expect(without).not.toContain("Tell Rosie");
    const withModel = await (await createHandler(db, { timeZone: TZ, now, interpreter: scripted() })(as("ross@test", "/"))).text();
    expect(withModel).toContain("Tell Rosie");
  });

  test("a message becomes a suggestion on the page, and approving it marks the task done", async () => {
    const handle = createHandler(db, {
      timeZone: TZ,
      now,
      interpreter: scripted({ reply: "Nice — <b>logged</b>.", actions: [raw({ type: "complete", task_id: task().id })] }),
    });
    const csrf = csrfToken(db, "ross");
    expect((await handle(post("/ask", { message: "did the inserts" }))).status).toBe(403);
    const sent = await handle(post("/ask", { csrf, message: "did the inserts" }));
    expect(sent.status).toBe(303);
    expect(sent.headers.get("Location")).toBe("/#ask");

    const page = await (await handle(as("ross@test", "/"))).text();
    expect(page).toContain("did the inserts");
    expect(page).toContain("Nice — &lt;b&gt;logged&lt;/b&gt;.");
    expect(page).toContain(`Mark &quot;Vacuum inserts&quot; done on Tue, Oct 20.`);
    // Carly doesn't see Ross's conversation.
    expect(await (await handle(as("carly@test", "/"))).text()).not.toContain("did the inserts");

    const proposal = db.query<{ id: number }, []>("SELECT id FROM proposals").get()!.id;
    expect((await handle(as("carly@test", `/proposals/${proposal}/approve`, { method: "POST", body: new URLSearchParams({ csrf: csrfToken(db, "carly") }) }))).status).toBe(404);
    expect((await handle(post(`/proposals/${proposal}/approve`, { csrf }))).status).toBe(303);
    expect(task().status).toBe("done");
    expect(await (await handle(as("ross@test", "/"))).text()).toContain(">Done<");
  });

  test("an overlong message is refused before reaching the model", async () => {
    const rosie = scripted();
    const handle = createHandler(db, { timeZone: TZ, now, interpreter: rosie });
    const res = await handle(post("/ask", { csrf: csrfToken(db, "ross"), message: "x".repeat(2001) }));
    expect(res.status).toBe(413);
    expect(rosie.seen).toHaveLength(0);
  });
});
