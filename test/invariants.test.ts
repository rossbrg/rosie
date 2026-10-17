import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { apply, type Action } from "../src/actions";
import { OUTPUT_SCHEMA } from "../src/ask";
import { migrate } from "../src/db";
import { runNightly } from "../src/nightly";

// Checks for the rule in AGENTS.md: the model proposes, code decides, a person
// approves, code writes and leaves a receipt. If one of these fails, the design is
// changing; say so in the PR rather than loosening the test.

const SRC = join(import.meta.dir, "..", "src");
const files = readdirSync(SRC)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => ({ name: f, text: readFileSync(join(SRC, f), "utf8") }));

const HOUSEHOLD = ["people", "items", "schedules", "occurrences", "completions"];
const householdWrite = new RegExp(`\\b(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+(${HOUSEHOLD.join("|")})\\b`, "i");
const anyWrite = /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i;

// Seeding, the maintenance loop and approved actions are the only writers of household records.
const HOUSEHOLD_WRITERS = ["actions.ts", "maintenance.ts", "seed.ts"];

// A file talks to a model if it loads a model SDK, starts a process, or calls a model host.
const talksToModel = (text: string) => /@anthropic-ai\/sdk|@openai\/|Bun\.spawn|api\.anthropic\.com|api\.openai\.com|chatgpt\.com/.test(text);
const WRITE_MODULES = ["./actions", "./maintenance", "./notify", "./nightly", "./seed", "./db", "./ask"];

describe("who may write", () => {
  test("only seeding, the maintenance loop and approved actions write household records", () => {
    const writers = files.filter((f) => householdWrite.test(f.text)).map((f) => f.name);
    expect(writers.filter((w) => !HOUSEHOLD_WRITERS.includes(w))).toEqual([]);
  });

  test("code that talks to a model can't write anything", () => {
    const modelFiles = files.filter((f) => talksToModel(f.text));
    expect(modelFiles.map((f) => f.name)).toContain("llm.ts");
    for (const f of modelFiles) {
      expect({ file: f.name, writes: anyWrite.test(f.text) }).toEqual({ file: f.name, writes: false });
      // Type-only imports are fine (shapes, not behaviour); value imports of writers aren't,
      // except the prompt, schema and parser from ./ask, which don't touch the database.
      const imports = [...f.text.matchAll(/^import\s+(type\s+)?\{([^}]*)\}\s+from\s+"(\.\/[^"]+)"/gm)];
      for (const [, typeOnly, names, from] of imports) {
        if (typeOnly || !WRITE_MODULES.includes(from!)) continue;
        const values = names!
          .split(",")
          .map((n) => n.trim())
          .filter((n) => n && !n.startsWith("type "));
        if (from === "./ask") {
          expect(values.filter((v) => !["InterpretError", "OUTPUT_SCHEMA", "parseInterpretation", "SYSTEM_PROMPT", "userContent"].includes(v))).toEqual([]);
        } else {
          expect({ file: f.name, from, values }).toEqual({ file: f.name, from, values: [] });
        }
      }
    }
  });
});

describe("receipts", () => {
  test("every kind of action Rosie can propose leaves a receipt when applied", async () => {
    const TODAY = "2026-10-20";
    const now = new Date(`${TODAY}T03:00:00Z`);
    const db = new Database(":memory:", { strict: true });
    db.exec("PRAGMA foreign_keys = ON");
    migrate(db);
    db.run("INSERT INTO people (id, name) VALUES ('ross', 'Ross'), ('carly', 'Carly')");
    db.run("INSERT INTO items (id, name) VALUES ('mini-split', 'Mini-split')");
    db.run(
      `INSERT INTO schedules (id, item_id, title, interval_days, lead_days, overdue_days, owner_id, starts_on)
       VALUES ('vacuum', 'mini-split', 'Vacuum inserts', 91, 7, 14, 'ross', '2026-10-22')`,
    );
    await runNightly(db, [], now, { timeZone: "UTC" });
    const openTask = () => db.query<{ id: number }, []>("SELECT id FROM occurrences WHERE status = 'open'").get()!.id;

    const examples: Record<Action["type"], () => Action> = {
      snooze: () => ({ type: "snooze", task_id: openTask(), until: "2026-10-25" }),
      complete: () => ({ type: "complete", task_id: openTask(), on: TODAY, by: "ross", notes: null }),
      log: () => ({ type: "log", item_id: "mini-split", schedule_id: null, title: "Wiped the heads", on: TODAY, by: "carly", notes: null }),
      add_schedule: () => ({
        type: "add_schedule",
        item_id: null,
        new_item_name: "Kettle",
        title: "Descale kettle",
        interval_days: 91,
        first_due: "2026-11-01",
        owner_id: "carly",
        checklist: null,
      }),
      set_owner: () => ({ type: "set_owner", schedule_id: "vacuum", owner_id: "carly" }),
    };
    // A new action type in the model's schema has to get an example here.
    expect(Object.keys(examples).sort()).toEqual([...OUTPUT_SCHEMA.properties.actions.items.properties.type.enum].sort());

    const receipts = () => db.query<{ n: number }, []>("SELECT count(*) AS n FROM runs").get()!.n;
    for (const [type, make] of Object.entries(examples)) {
      const before = receipts();
      apply(db, make(), "ross", TODAY, now);
      expect({ type, receipts: receipts() - before }).toEqual({ type, receipts: 1 });
    }
  });
});
