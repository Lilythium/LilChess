// Copies mobile/version.json into the iOS project (MARKETING_VERSION and CURRENT_PROJECT_VERSION).
// Android reads the same file from android/app/build.gradle, so it needs no copy.
//
//   npm run version:sync -w mobile
//
// To release: edit mobile/version.json (raise buildNumber for every store upload), run this, commit.
// mobile/src/releaseConfig.test.ts fails if the files drift apart.
import { readFileSync, writeFileSync } from "node:fs";
import { stdout } from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { versionName, buildNumber } = JSON.parse(readFileSync(resolve(root, "version.json"), "utf8"));

if (typeof versionName !== "string" || !/^\d+\.\d+\.\d+$/.test(versionName)) {
  throw new Error(`version.json: versionName must look like 1.2.3, got ${JSON.stringify(versionName)}`);
}
if (!Number.isSafeInteger(buildNumber) || buildNumber < 1) {
  throw new Error(`version.json: buildNumber must be a positive integer, got ${JSON.stringify(buildNumber)}`);
}

const pbxproj = resolve(root, "ios/App/App.xcodeproj/project.pbxproj");
const before = readFileSync(pbxproj, "utf8");
const after = before
  .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${versionName};`)
  .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${buildNumber};`);
if (after !== before) writeFileSync(pbxproj, after);
stdout.write(`iOS ${after === before ? "already at" : "set to"} ${versionName} (${buildNumber})\n`);
