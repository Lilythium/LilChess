// Checks the Fastlane metadata that F-Droid publishes (fastlane/metadata/android/<locale>/).
//
//   node mobile/scripts/check-fastlane.mjs              structure and limits (runs in `npm test`)
//   node mobile/scripts/check-fastlane.mjs --release    also fails on unfilled placeholders (run by mobile-tag-check.yml)
//   node mobile/scripts/check-fastlane.mjs --root DIR   check another checkout (used by the tests)
//
// Limits and layout: https://f-droid.org/docs/All_About_Descriptions_Graphics_and_Screenshots/
import { Buffer } from "node:buffer";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { argv, exit, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(argv.includes("--root") ? argv[argv.indexOf("--root") + 1] : join(here, "..", ".."));
const release = argv.includes("--release");
const dir = join(root, "fastlane", "metadata", "android", "en-US");
const problems = [];
const read = (path) => (existsSync(path) ? readFileSync(path, "utf8") : undefined);

const title = read(join(dir, "title.txt"));
const short = read(join(dir, "short_description.txt"));
const full = read(join(dir, "full_description.txt"));
if (title === undefined) problems.push("title.txt is missing");
if (short === undefined) problems.push("short_description.txt is missing");
if (full === undefined) problems.push("full_description.txt is missing");

if (title !== undefined && title.trim().length > 30) problems.push(`title is ${title.trim().length} characters (max 30)`);
if (short !== undefined && short.trim().length > 80) problems.push(`short description is ${short.trim().length} characters (max 80)`);
if (full !== undefined) {
  if (full.length > 4000) problems.push(`full description is ${full.length} characters (max 4000)`);
  const allowed = new Set("b big blockquote br cite em i li ol small strike strong sub sup tt u ul".split(" "));
  for (const [, name] of full.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)) {
    if (!allowed.has(name.toLowerCase())) problems.push(`full description uses <${name}>, which F-Droid does not render`);
  }
  // What the listing must say plainly (docs/mobile-store-listing.md): an app that needs a server must not look broken.
  for (const [needle, why] of [
    [/self-hosted/i, "that the app connects to self-hosted servers"],
    [/demo/i, "the demo server and guest flow"],
    [/no analytics/i, "that there is no analytics"],
    [/must use https/i, "the HTTPS-only policy"],
    [/mobile-privacy\.md/, "a link to the privacy document"],
  ]) {
    if (!needle.test(full)) problems.push(`full description no longer says ${why}`);
  }
  if (!/demo guests cannot[^.]*tournaments/i.test(full)) problems.push("full description must say demo guests cannot join tournaments (do not promise server-dependent features on the demo)");
  if (/lichess|chess\.com|chesscom/i.test(full)) problems.push("full description names another chess service; do not imply affiliation");
}

const version = JSON.parse(readFileSync(join(root, "mobile", "version.json"), "utf8"));
const changelog = read(join(dir, "changelogs", `${version.buildNumber}.txt`));
if (changelog === undefined) problems.push(`changelogs/${version.buildNumber}.txt is missing (named after the versionCode, no padding)`);
else if (Buffer.byteLength(changelog) > 500) problems.push(`changelog ${version.buildNumber}.txt is over 500 bytes`);

const icon = join(dir, "images", "icon.png");
if (!existsSync(icon)) problems.push("images/icon.png is missing");
else {
  const png = readFileSync(icon);
  const isPng = png.length > 24 && png.subarray(1, 4).toString("latin1") === "PNG";
  if (!isPng) problems.push("images/icon.png is not a PNG");
  else if (png.readUInt32BE(16) !== 512 || png.readUInt32BE(20) !== 512) problems.push(`images/icon.png is ${png.readUInt32BE(16)}x${png.readUInt32BE(20)}, expected 512x512`);
}

const shots = join(dir, "images", "phoneScreenshots");
if (existsSync(shots)) {
  for (const f of readdirSync(shots)) if (!/\.(png|jpe?g)$/i.test(f)) problems.push(`phoneScreenshots/${f} is not a PNG or JPEG`);
}

if (release) {
  if (full !== undefined && /REPLACE_WITH_/.test(full)) problems.push("full description still contains REPLACE_WITH_DEMO_ADDRESS: put the real https demo address in");
  const count = existsSync(shots) ? readdirSync(shots).filter((f) => /\.(png|jpe?g)$/i.test(f)).length : 0;
  if (count < 2) problems.push(`only ${count} phone screenshot(s) in images/phoneScreenshots/ (capture them with the demo server, see docs/mobile-store-listing.md)`);
}

if (problems.length > 0) {
  stderr.write(`Fastlane metadata problems:\n${problems.map((p) => `  - ${p}\n`).join("")}`);
  exit(1);
}
stdout.write(`Fastlane metadata OK${release ? " (release checks included)" : ""}\n`);
