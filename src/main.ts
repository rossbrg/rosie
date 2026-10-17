import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DAILY_CAP } from "./ask";
import { AuthConfigError, readAuthConfig } from "./auth-config";
import { AuthSetupError, bootstrapAuthUsers, enabledAuthPeople } from "./auth-users";
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
  case "auth-bootstrap": {
    // Trusted, local, and the only way sign-in accounts are made: one per person the
    // private seed enables. Prints counts only.
    if (authConfig().mode !== "email-otp") fail("Set ROSIE_AUTH_MODE=email-otp (and its settings) before provisioning sign-in accounts.");
    if (setup(() => enabledAuthPeople(db)).length === 0) {
      fail('Nobody can sign in yet: set "auth_enabled": true for someone in seed/household.local.json, then `bun run seed`.');
    }
    const counts = setup(() => bootstrapAuthUsers(db, new Date()));
    console.log(`Sign-in accounts: ${counts.created} created, ${counts.updated} updated, ${counts.revoked} revoked`);
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
    // "Tell Rosie" runs on the household's subscriptions (ROSIE_INTERPRETER); without it
    // the page simply doesn't offer the box.
    const interpreter = interpreterFromEnv(env);
    Bun.serve({
      hostname: "127.0.0.1",
      port,
      // A message can wait for the one before it, then take up to 90s of its own.
      idleTimeout: 255,
      fetch: createHandler(db, {
        timeZone: env.ROSIE_TZ,
        devLogin: env.ROSIE_DEV_LOGIN,
        interpreter,
        ask: {
          dailyCap: Number(env.ROSIE_DAILY_MODEL_CALLS || DAILY_CAP),
          alertPersonId: env.ROSIE_ALERT_PERSON,
          channels: channelsFromEnv(env),
        },
      }),
    });
    console.log(`Rosie on http://127.0.0.1:${port}`);
    break;
  }
  default:
    console.error("usage: bun src/main.ts migrate | seed [file] | auth-bootstrap | nightly | serve");
    process.exit(1);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// Configuration and setup problems are the operator's to fix: say what, without a stack.
function authConfig() {
  return setup(() => readAuthConfig(env));
}

function setup<T>(run: () => T): T {
  try {
    return run();
  } catch (err) {
    if (err instanceof AuthConfigError || err instanceof AuthSetupError) fail(err.message);
    throw err;
  }
}
