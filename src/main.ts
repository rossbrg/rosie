import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { openDb } from "./db";
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
    const summary = await runNightly(db, channelsFromEnv(env), new Date(), {
      timeZone: env.ROSIE_TZ,
      alertPersonId: env.ROSIE_ALERT_PERSON,
    });
    console.log(JSON.stringify(summary, null, 2));
    break;
  }
  case "serve": {
    const port = Number(env.PORT ?? 8787);
    // Bind to localhost; `tailscale serve` publishes it to the tailnet with identity headers.
    Bun.serve({ hostname: "127.0.0.1", port, fetch: createHandler(db, { timeZone: env.ROSIE_TZ, devLogin: env.ROSIE_DEV_LOGIN }) });
    console.log(`Rosie on http://127.0.0.1:${port}`);
    break;
  }
  default:
    console.error("usage: bun src/main.ts migrate | seed [file] | nightly | serve");
    process.exit(1);
}
