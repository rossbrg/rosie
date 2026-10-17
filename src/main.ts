import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { openDb } from "./db";
import { interpreterFromEnv } from "./llm";
import { runNightly } from "./nightly";
import { channelsFromEnv } from "./notify";
import { seed } from "./seed";
import { createHandler } from "./web";

const env = process.env;
const dbPath = env.ROSIE_DB ?? "data/rosie.sqlite";
mkdirSync(dirname(dbPath), { recursive: true });
const db = openDb(dbPath);

switch (process.argv[2]) {
  case "migrate":
    console.log(`Database ready at ${dbPath}`);
    break;
  case "seed": {
    const path = process.argv[3] ?? "seed/household.json";
    seed(db, path, new Date());
    console.log(`Seeded from ${path}`);
    break;
  }
  case "nightly": {
    const alert = env.ROSIE_ALERT_PERSON;
    if (alert && !db.query("SELECT 1 FROM people WHERE id = ?").get(alert)) {
      // Still runs (planning doesn't depend on it), but say so loudly.
      console.error(`ROSIE_ALERT_PERSON "${alert}" doesn't match a person id; missed-run alerts can't be sent.`);
    }
    const summary = await runNightly(db, channelsFromEnv(env), new Date(), {
      timeZone: env.ROSIE_TZ,
      alertPersonId: env.ROSIE_ALERT_PERSON,
    });
    console.log(JSON.stringify(summary, null, 2));
    break;
  }
  case "serve": {
    if (env.ROSIE_DEV_LOGIN && env.ROSIE_DEV !== "1") {
      console.error("ROSIE_DEV_LOGIN is for local development; set ROSIE_DEV=1 to use it.");
      process.exit(1);
    }
    const port = Number(env.PORT ?? 8787);
    // Bind to localhost; `tailscale serve` publishes it to the tailnet with identity headers.
    // "Tell Rosie" runs on the Claude Code / Codex CLIs named in ROSIE_INTERPRETER;
    // without it the page simply doesn't offer the box.
    const interpreter = interpreterFromEnv(env);
    Bun.serve({
      hostname: "127.0.0.1",
      port,
      // Rosie waits on the model (and maybe a fallback) while reading a message; Bun's default is 10s.
      idleTimeout: 240,
      fetch: createHandler(db, { timeZone: env.ROSIE_TZ, devLogin: env.ROSIE_DEV_LOGIN, interpreter }),
    });
    console.log(`Rosie on http://127.0.0.1:${port}`);
    break;
  }
  default:
    console.error("usage: bun src/main.ts migrate | seed [file] | nightly | serve");
    process.exit(1);
}
