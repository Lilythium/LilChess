import Database from "better-sqlite3";
import { config } from "../config.js";
import { checkIntegrity } from "../db/integrity.js";

const args = process.argv.slice(2);
const deep = args.includes("--deep");
const path = args.find((a) => !a.startsWith("--")) ?? `${config.dataDir}/lilchess.db`;

const db = new Database(path, { readonly: true, fileMustExist: true });
const issues = checkIntegrity(db, { deep });
db.close();

if (issues.length === 0) {
  console.log(`${path}: OK${deep ? " (deep)" : ""}`);
  process.exit(0);
}
for (const i of issues) console.error(`[${i.check}] ${i.detail}`);
process.exit(1);