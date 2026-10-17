import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { migrate } from "../src/db";
import { completeOccurrence, health, planMaintenance } from "../src/maintenance";
import { runNightly } from "../src/nightly";
import {
  channelsFromEnv,
  deliverOutbox,
  MAX_ATTEMPTS,
  ntfyPush,
  resendEmail,
  type Channel,
  type ChannelName,
  type Message,
  type Recipient,
} from "../src/notify";
import { seed } from "../src/seed";
import { createHandler, csrfToken } from "../src/web";

const TZ = "UTC";
const at = (iso: string) => new Date(`${iso}T03:00:00Z`);

function recorder(
  name: ChannelName,
  failTimes = 0,
  delayMs = 0,
): Channel & { sent: { to: string; msg: Message }[] } {
  let failures = failTimes;
  const sent: { to: string; msg: Message }[] = [];
  return {
    name,
    sent,
    unreachable: () => null,
    async send(to: Recipient, msg: Message) {
      if (delayMs) await Bun.sleep(delayMs);
      if (failures > 0) {
        failures--;
        throw new Error("simulated outage");
      }
      sent.push({ to: to.id, msg });
    },
  };
}

let db: Database;

beforeEach(() => {
  db = new Database(":memory:", { strict: true });
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  db.run("INSERT INTO people (id, name, login, email, ntfy_topic) VALUES ('ross', 'Ross', 'ross@test', 'r@test', 'r-topic')");
  db.run("INSERT INTO items (id, name) VALUES ('mini-split', 'Mini-split')");
  db.run(
    `INSERT INTO schedules (id, item_id, title, interval_days, lead_days, overdue_days, owner_id, starts_on)
     VALUES ('vacuum', 'mini-split', 'Vacuum inserts', 91, 7, 14, 'ross', '2026-10-24')`,
  );
});

const openOccurrences = () =>
  db.query<{ id: number; due_on: string }, []>("SELECT id, due_on FROM occurrences WHERE status = 'open'").all();

describe("nightly planning", () => {
  test("nothing is created before the lead window", async () => {
    await runNightly(db, [recorder("email"), recorder("push")], at("2026-10-16"), { timeZone: TZ });
    expect(openOccurrences()).toHaveLength(0);
  });

  test("creates one occurrence inside the lead window and reminds the owner once", async () => {
    const email = recorder("email");
    const push = recorder("push");
    await runNightly(db, [email, push], at("2026-10-17"), { timeZone: TZ });
    await runNightly(db, [email, push], at("2026-10-17"), { timeZone: TZ });
    await runNightly(db, [email, push], at("2026-10-18"), { timeZone: TZ });

    expect(openOccurrences()).toEqual([{ id: 1, due_on: "2026-10-24" }]);
    expect(email.sent).toHaveLength(1);
    expect(push.sent).toHaveLength(1);
    expect(email.sent[0]!.msg.subject).toBe("Due 2026-10-24: Vacuum inserts");
  });

  test("a late completion moves the next due date from the completion, not the old due date", async () => {
    const channels = [recorder("email"), recorder("push")];
    await runNightly(db, channels, at("2026-10-20"), { timeZone: TZ });
    const [occ] = openOccurrences();
    completeOccurrence(db, occ!.id, "ross", "2026-11-10", null, at("2026-11-10"));

    // Next due = 2026-11-10 + 91 days = 2027-02-09; nothing new until the lead window.
    await runNightly(db, channels, at("2027-01-25"), { timeZone: TZ });
    expect(openOccurrences()).toHaveLength(0);
    await runNightly(db, channels, at("2027-02-02"), { timeZone: TZ });
    expect(openOccurrences().map((o) => o.due_on)).toEqual(["2027-02-09"]);
  });

  test("an early completion landing on the old due date still produces the next occurrence", async () => {
    // Completing exactly one interval before the next due date must not collide with the old key.
    db.run("UPDATE schedules SET starts_on = '2026-10-24', interval_days = 7, lead_days = 7");
    const channels = [recorder("email"), recorder("push")];
    await runNightly(db, channels, at("2026-10-17"), { timeZone: TZ });
    const [first] = openOccurrences();
    completeOccurrence(db, first!.id, "ross", "2026-10-17", null, at("2026-10-17"));
    await runNightly(db, channels, at("2026-10-17"), { timeZone: TZ });
    expect(openOccurrences().map((o) => o.due_on)).toEqual(["2026-10-24"]);
  });

  test("an overdue occurrence alerts the owner exactly once", async () => {
    const email = recorder("email");
    const channels = [email, recorder("push")];
    await runNightly(db, channels, at("2026-10-20"), { timeZone: TZ });
    await runNightly(db, channels, at("2026-11-08"), { timeZone: TZ });
    await runNightly(db, channels, at("2026-11-09"), { timeZone: TZ });
    expect(email.sent.map((s) => s.msg.subject)).toEqual(["Due 2026-10-24: Vacuum inserts", "Overdue: Vacuum inserts"]);
  });
});

describe("completion", () => {
  test("completing twice keeps the first completion", async () => {
    await runNightly(db, [recorder("email"), recorder("push")], at("2026-10-20"), { timeZone: TZ });
    const [occ] = openOccurrences();
    const a = completeOccurrence(db, occ!.id, "ross", "2026-10-21", "first", at("2026-10-21"));
    const b = completeOccurrence(db, occ!.id, "ross", "2026-10-22", "second", at("2026-10-22"));
    expect(b).toEqual(a);
    expect(db.query("SELECT COUNT(*) AS n FROM completions").get()).toEqual({ n: 1 });
  });
});

describe("delivery", () => {
  test("a failed send is retried on the next run without sending twice", async () => {
    const email = recorder("email", 1);
    const push = recorder("push");
    await runNightly(db, [email, push], at("2026-10-17"), { timeZone: TZ });
    expect(email.sent).toHaveLength(0);
    await runNightly(db, [email, push], at("2026-10-18"), { timeZone: TZ });
    await runNightly(db, [email, push], at("2026-10-19"), { timeZone: TZ });
    expect(email.sent).toHaveLength(1);
    expect(push.sent).toHaveLength(1);
  });
});

describe("missed runs", () => {
  test("health goes stale after 36 hours and the next run alerts once", async () => {
    const email = recorder("email");
    const channels = [email, recorder("push")];
    await runNightly(db, channels, at("2026-10-01"), { timeZone: TZ, alertPersonId: "ross" });
    expect(health(db, at("2026-10-02")).ok).toBe(true);
    expect(health(db, at("2026-10-04")).ok).toBe(false);

    await runNightly(db, channels, at("2026-10-04"), { timeZone: TZ, alertPersonId: "ross" });
    await runNightly(db, channels, at("2026-10-04"), { timeZone: TZ, alertPersonId: "ross" });
    expect(email.sent.filter((s) => s.msg.subject === "Rosie missed a nightly check")).toHaveLength(1);
    expect(health(db, at("2026-10-04")).ok).toBe(true);
  });
});

describe("web", () => {
  const handlerAt = (iso: string) => createHandler(db, { timeZone: TZ, now: () => at(iso) });

  test("refuses requests without a household identity", async () => {
    const res = await handlerAt("2026-10-20")(new Request("http://rosie/"));
    expect(res.status).toBe(401);
  });

  test("lists what's due and marks it done for the signed-in person", async () => {
    await runNightly(db, [recorder("email"), recorder("push")], at("2026-10-20"), { timeZone: TZ });
    const handle = handlerAt("2026-10-21");
    const headers = { "Tailscale-User-Login": "ross@test" };

    const page = await (await handle(new Request("http://rosie/", { headers }))).text();
    expect(page).toContain("Vacuum inserts");
    expect(page).toContain('<time datetime="2026-10-24">Due in 3 days</time>');

    expect(page).toContain(`name="csrf" value="${csrfToken(db, "ross")}"`);

    const form = new FormData();
    form.set("notes", "all three heads");
    form.set("csrf", csrfToken(db, "ross"));
    const res = await handle(new Request("http://rosie/occurrences/1/complete", { method: "POST", headers, body: form }));
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/");
    expect(db.query("SELECT completed_by, completed_on, notes FROM completions").get()).toEqual({
      completed_by: "ross",
      completed_on: "2026-10-21",
      notes: "all three heads",
    });
  });

  test("healthz reports 503 before any nightly run", async () => {
    const res = await handlerAt("2026-10-20")(new Request("http://rosie/healthz"));
    expect(res.status).toBe(503);
  });

  test("escapes stored text", async () => {
    db.run("UPDATE schedules SET title = '<script>x</script>'");
    await runNightly(db, [recorder("email"), recorder("push")], at("2026-10-20"), { timeZone: TZ });
    const page = await (
      await handlerAt("2026-10-21")(new Request("http://rosie/", { headers: { "Tailscale-User-Login": "ross@test" } }))
    ).text();
    expect(page).not.toContain("<script>x");
  });
});

describe("seed", () => {
  test("the household seed loads and re-runs without duplicating history", () => {
    const fresh = new Database(":memory:", { strict: true });
    fresh.exec("PRAGMA foreign_keys = ON");
    migrate(fresh);
    seed(fresh, "seed/household.json", at("2026-10-17"));
    seed(fresh, "seed/household.json", at("2026-10-17"));
    expect(fresh.query("SELECT COUNT(*) AS n FROM completions").get()).toEqual({ n: 2 });
    expect(fresh.query("SELECT COUNT(*) AS n FROM schedules WHERE active = 1").get()).toEqual({ n: 2 });
  });
});

const outbox = () =>
  db
    .query<{ dedupe_key: string; sent_at: string | null; cancelled_at: string | null; attempts: number; last_error: string | null }, []>(
      "SELECT dedupe_key, sent_at, cancelled_at, attempts, last_error FROM outbox ORDER BY id",
    )
    .all();

describe("review fixes: delivery", () => {
  test("a person with no address keeps the message queued, unspent, and health says so", async () => {
    db.run("UPDATE people SET email = NULL");
    const email = resendEmail("re_test", "Rosie <r@test>");
    await runNightly(db, [email, recorder("push")], at("2026-10-17"), { timeZone: TZ });
    const [row] = outbox().filter((r) => r.dedupe_key.endsWith(":email"));
    expect(row).toMatchObject({ sent_at: null, attempts: 0, last_error: "Ross has no email address" });
    await runNightly(db, [email, recorder("push")], at("2026-10-19"), { timeZone: TZ });
    expect(health(db, at("2026-10-19"))).toMatchObject({ ok: false, stuck: 1 });
  });

  test("an unconfigured channel never marks messages sent", async () => {
    await runNightly(db, [recorder("email")], at("2026-10-17"), { timeZone: TZ });
    const push = outbox().find((r) => r.dedupe_key.endsWith(":push"))!;
    expect(push).toMatchObject({ sent_at: null, attempts: 0, last_error: "push is not configured" });
  });

  test("channels must be fully configured, and the console stand-in is opt-in", () => {
    expect(() => channelsFromEnv({ RESEND_API_KEY: "re_x" })).toThrow("ROSIE_EMAIL_FROM");
    expect(channelsFromEnv({})).toEqual([]);
    expect(channelsFromEnv({ ROSIE_CONSOLE_CHANNELS: "1" }).map((c) => c.name)).toEqual(["email", "push"]);
  });

  test("a message that exhausts its retries turns health red", async () => {
    const email = recorder("email", 99);
    for (let day = 17; day < 17 + MAX_ATTEMPTS; day++) {
      await runNightly(db, [email, recorder("push")], at(`2026-10-${day}`), { timeZone: TZ });
    }
    expect(health(db, at("2026-10-21"))).toMatchObject({ ok: false, dead: 1 });
  });

  test("overlapping deliveries send each message once", async () => {
    planMaintenance(db, "2026-10-17", at("2026-10-17"), undefined);
    const email = recorder("email", 0, 20);
    const push = recorder("push", 0, 20);
    await Promise.all([deliverOutbox(db, [email, push], at("2026-10-17")), deliverOutbox(db, [email, push], at("2026-10-17"))]);
    expect(email.sent).toHaveLength(1);
    expect(push.sent).toHaveLength(1);
  });

  test("completing a task cancels its queued reminders", async () => {
    const email = recorder("email", 1);
    const channels = [email, recorder("push")];
    await runNightly(db, channels, at("2026-10-17"), { timeZone: TZ });
    completeOccurrence(db, openOccurrences()[0]!.id, "ross", "2026-10-18", null, at("2026-10-18"));
    await runNightly(db, channels, at("2026-10-19"), { timeZone: TZ });
    expect(email.sent).toHaveLength(0);
    expect(outbox().find((r) => r.dedupe_key.endsWith(":email"))!.cancelled_at).not.toBeNull();
    expect(health(db, at("2026-10-19")).ok).toBe(true);
  });

  test("push titles with non-Latin-1 characters go in the JSON body", async () => {
    const real = globalThis.fetch;
    let sent: { url: string; body: unknown } | undefined;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(String(init.body)) };
      return new Response("{}");
    }) as unknown as typeof fetch;
    try {
      const to = { id: "ross", name: "Ross", email: null, ntfy_topic: "r-topic" };
      await ntfyPush("https://ntfy.test/").send(to, { subject: "Ross’s filter — monthly", body: "b" });
    } finally {
      globalThis.fetch = real;
    }
    expect(sent).toEqual({ url: "https://ntfy.test", body: { topic: "r-topic", title: "Ross’s filter — monthly", message: "b" } });
  });
});

describe("review fixes: planning", () => {
  test("moving starts_on while a task is open replans it and reminds again", async () => {
    const email = recorder("email");
    await runNightly(db, [email, recorder("push")], at("2026-10-17"), { timeZone: TZ });
    db.run("UPDATE schedules SET starts_on = '2026-10-20'");
    await runNightly(db, [email, recorder("push")], at("2026-10-18"), { timeZone: TZ });
    expect(openOccurrences().map((o) => o.due_on)).toEqual(["2026-10-20"]);
    expect(email.sent.map((s) => s.msg.subject)).toEqual(["Due 2026-10-24: Vacuum inserts", "Due 2026-10-20: Vacuum inserts"]);

    // Pushed out past the lead window: the open task goes away until it's due again.
    db.run("UPDATE schedules SET starts_on = '2026-12-01'");
    await runNightly(db, [email, recorder("push")], at("2026-10-19"), { timeZone: TZ });
    expect(openOccurrences()).toHaveLength(0);
  });

  test("reassigning a schedule moves the open task to the new owner", async () => {
    db.run("INSERT INTO people (id, name) VALUES ('sam', 'Sam')");
    const email = recorder("email");
    await runNightly(db, [email, recorder("push")], at("2026-10-17"), { timeZone: TZ });
    db.run("UPDATE schedules SET owner_id = 'sam'");
    await runNightly(db, [email, recorder("push")], at("2026-10-18"), { timeZone: TZ });
    expect(email.sent.map((s) => s.to)).toEqual(["ross", "sam"]);
  });

  test("an unowned schedule reminds the alert person", async () => {
    db.run("UPDATE schedules SET owner_id = NULL");
    const email = recorder("email");
    await runNightly(db, [email, recorder("push")], at("2026-10-17"), { timeZone: TZ, alertPersonId: "ross" });
    expect(email.sent.map((s) => s.to)).toEqual(["ross"]);
  });

  test("a wrong alert person doesn't stop planning after a missed night", async () => {
    await runNightly(db, [recorder("email"), recorder("push")], at("2026-10-10"), { timeZone: TZ, alertPersonId: "Ross" });
    const summary = await runNightly(db, [recorder("email"), recorder("push")], at("2026-10-20"), {
      timeZone: TZ,
      alertPersonId: "Ross",
    });
    expect(summary.missedPreviousRun).toBe(true);
    expect(openOccurrences()).toHaveLength(1);
    expect(health(db, at("2026-10-20"))).toMatchObject({ ok: false, errors: 1 });
  });

  test("one schedule with a bad date doesn't block the others", async () => {
    db.run(
      `INSERT INTO schedules (id, item_id, title, interval_days, owner_id, starts_on)
       VALUES ('broken', 'mini-split', 'Broken', 30, 'ross', '2026-2-9')`,
    );
    const summary = await runNightly(db, [recorder("email"), recorder("push")], at("2026-10-17"), { timeZone: TZ });
    expect(summary.errors.map((e) => e.schedule)).toEqual(["broken"]);
    expect(openOccurrences()).toHaveLength(1);
  });

  test("a completion leaves a receipt in the run log", async () => {
    await runNightly(db, [recorder("email"), recorder("push")], at("2026-10-17"), { timeZone: TZ });
    const c = completeOccurrence(db, openOccurrences()[0]!.id, "ross", "2026-10-18", null, at("2026-10-18"));
    const receipt = db.query<{ summary: string }, []>("SELECT summary FROM runs WHERE kind = 'completion'").get()!;
    expect(JSON.parse(receipt.summary)).toMatchObject({ completion: c.id, by: "ross", on: "2026-10-18" });
  });
});

describe("review fixes: web", () => {
  const post = (headers: Record<string, string>, csrf?: string) => {
    const form = new FormData();
    if (csrf) form.set("csrf", csrf);
    return createHandler(db, { timeZone: TZ, now: () => at("2026-10-21") })(
      new Request("http://rosie/occurrences/1/complete", { method: "POST", headers, body: form }),
    );
  };
  const ross = { "Tailscale-User-Login": "ross@test" };

  test("refuses completions without a token or from another site", async () => {
    await runNightly(db, [recorder("email"), recorder("push")], at("2026-10-20"), { timeZone: TZ });
    expect((await post(ross)).status).toBe(403);
    expect((await post({ ...ross, "Sec-Fetch-Site": "cross-site" }, csrfToken(db, "ross"))).status).toBe(403);
    expect(db.query("SELECT COUNT(*) AS n FROM completions").get()).toEqual({ n: 0 });
    expect((await post({ ...ross, "Sec-Fetch-Site": "same-origin" }, csrfToken(db, "ross"))).status).toBe(303);
  });

  test("the dev login only applies to localhost", async () => {
    const handle = createHandler(db, { timeZone: TZ, devLogin: "ross@test", now: () => at("2026-10-21") });
    expect((await handle(new Request("http://localhost:8787/"))).status).toBe(200);
    expect((await handle(new Request("http://rosie.tailnet.ts.net/"))).status).toBe(401);
  });
});

describe("review fixes: seed", () => {
  const fresh = () => {
    const d = new Database(":memory:", { strict: true });
    d.exec("PRAGMA foreign_keys = ON");
    migrate(d);
    return d;
  };
  const write = async (name: string, data: unknown) => {
    const path = `${process.env.TMPDIR ?? "/tmp"}/rosie-test-${process.pid}-${name}.json`;
    await Bun.write(path, JSON.stringify(data));
    return path;
  };

  test("re-seeding without contact details keeps the ones already saved", async () => {
    const d = fresh();
    const path = await write("people", { people: [{ id: "ross", name: "Ross" }] });
    d.run("INSERT INTO people (id, name, login, email) VALUES ('ross', 'Ross', 'ross@test', 'r@test')");
    seed(d, path, at("2026-10-17"));
    expect(d.query("SELECT login, email FROM people").get()).toEqual({ login: "ross@test", email: "r@test" });
  });

  test("history without a source URL isn't duplicated on re-seed", async () => {
    const d = fresh();
    const path = await write("history", {
      items: [{ id: "x", name: "X" }],
      history: [{ item_id: "x", title: "Did it", completed_on: "2026-01-01" }],
    });
    seed(d, path, at("2026-10-17"));
    seed(d, path, at("2026-10-17"));
    expect(d.query("SELECT COUNT(*) AS n FROM completions").get()).toEqual({ n: 1 });
  });

  test("a malformed date is rejected before anything is written", async () => {
    const d = fresh();
    const path = await write("bad-date", {
      items: [{ id: "x", name: "X" }],
      schedules: [{ id: "s", item_id: "x", title: "S", interval_days: 30, starts_on: "2026-02-30" }],
    });
    expect(() => seed(d, path, at("2026-10-17"))).toThrow("not a YYYY-MM-DD date");
    expect(d.query("SELECT COUNT(*) AS n FROM items").get()).toEqual({ n: 0 });
  });
});
