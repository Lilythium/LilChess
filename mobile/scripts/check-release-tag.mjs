// Release gate for mobile releases. Run by .github/workflows/mobile-tag-check.yml:
//
//   node mobile/scripts/check-release-tag.mjs mobile-v1.0.0-1
//
// Fails unless:
//   1. the tag is exactly mobile-v<versionName>-<buildNumber> from mobile/version.json, and
//   2. buildNumber (the Android versionCode) is higher than that of every other mobile-v* tag.
// Android refuses to update an install to a versionCode that is not higher, and F-Droid detects releases from tags.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { argv, stdout } from "node:process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { versionName, buildNumber } = JSON.parse(readFileSync(resolve(root, "version.json"), "utf8"));
const tag = argv[2];
const pattern = /^mobile-v(\d+\.\d+\.\d+)-(\d+)$/;

if (!tag || !pattern.test(tag)) {
  throw new Error(`Tag must look like mobile-v1.2.3-45, got ${JSON.stringify(tag)}`);
}

const expected = `mobile-v${versionName}-${buildNumber}`;
if (tag !== expected) {
  throw new Error(`Tag ${tag} does not match mobile/version.json (expected ${expected}). Edit version.json, run version:sync, commit, then tag.`);
}

const others = execFileSync("git", ["tag", "--list", "mobile-v*"], { encoding: "utf8" })
  .split("\n")
  .map((t) => t.trim())
  .filter((t) => t && t !== tag && pattern.test(t))
  .map((t) => ({ tag: t, build: Number(pattern.exec(t)[2]) }));

const clash = others.find((o) => o.build >= buildNumber);
if (clash) {
  throw new Error(`buildNumber ${buildNumber} is not higher than ${clash.tag} (${clash.build}). versionCode must only ever increase.`);
}

stdout.write(`OK: ${tag} (versionCode ${buildNumber}); highest earlier release ${Math.max(0, ...others.map((o) => o.build))}\n`);
