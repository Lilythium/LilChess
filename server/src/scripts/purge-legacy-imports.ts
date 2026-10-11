import { config } from "../config.js";
import { closeDb, getDb, openDb } from "../db/connection.js";
import { findLegacyImports, purgeLegacyImports } from "../imported/legacy.js";
import { purgeUnusedGuests } from "../maintenance.js";

// One-off cleanup for PGN imports made before imported games got their own tables.
//   npm run purge-legacy-imports -w server            lists them (changes nothing)
//   npm run purge-legacy-imports -w server -- --apply deletes them, then removes guest accounts nobody uses
// Back up the data directory first. The PGN files themselves can simply be imported again afterwards.
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const path = args.find((a) => !a.startsWith("--")) ?? `${config.dataDir}/lilchess.db`;

openDb(path);
const found = findLegacyImports(getDb());

if (found.length === 0) {
  console.log(`${path}: no legacy imports found`);
} else {
  for (const g of found) console.log(`${g.id}  ${g.white} vs ${g.black}  (${g.ply} plies, ${g.result ?? g.status})`);
  if (!apply) {
    console.log(`\n${found.length} game(s) would be deleted. Re-run with --apply to delete them.`);
  } else {
    const games = purgeLegacyImports(getDb());
    const guests = purgeUnusedGuests();
    console.log(`\nDeleted ${games} game(s) and ${guests} unused guest account(s).`);
  }
}
closeDb();