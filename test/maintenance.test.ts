import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { migrate } from "../src/db";
import { completeOccurrence, health } from "../src/maintenance";
import { runNightly } from "../src/nightly";
import type { Channel, ChannelName, Message, Recipient } from "../src/notify";
import { seed } from "../src/seed";
import { createHandler } from "../src/web";

const TZ = "UTC";
const at = (iso: string) => new Date(`${iso}T03:00:00Z`);

function recorder(name: ChannelName, failTimes = 0): Channel & { sent: { to: string; msg: Message }[] } {
  let failures = failTimes;
  const sent: { to: string; msg: Message }[] = [];
  return {
    name,
    sent,
    async send(to: Recipient, msg: Message) {
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
    expect(page).toContain("Due 2026-10-24");

    const form = new FormData();
    form.set("notes", "all three heads");
    const res = await handle(new Request("http://rosie/occurrences/1/complete", { method: "POST", headers, body: form }));
    expect(res.status).toBe(303);
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
