import { config } from "../config.js";
import { closeDb, openDb } from "../db/connection.js";
import { purgeDemoData } from "../demo/data.js";

// Wipes all demo data now (every guest and every game against the practice bot), instead of waiting for the
// DEMO_RETENTION_HOURS sweep. Registered accounts and their games are left alone.
// Refuses to run unless DEMO_MODE=true, so it cannot be pointed at a normal server by accident.
if (!config.demoMode) {
  console.error("reset-demo: DEMO_MODE is not true in this environment. Nothing was deleted.");
  process.exit(1);
}

openDb(`${config.dataDir}/lilchess.db`);
const result = purgeDemoData(Date.now() + 1, 0);
closeDb();
console.log(`reset-demo: deleted ${result.games} demo games and ${result.guests} guest accounts`);
