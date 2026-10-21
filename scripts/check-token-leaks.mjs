#!/usr/bin/env node
/* global console, process, URL */
// Mobile Phase 9: static scan for credential leakage in source code.
//
// Fails when production code (tests excluded) appears to:
//   1. print a credential with console.*
//   2. pass a credential to a logger call (log.*, logger.*)
//   3. put a credential in a URL query string
//
// This is a tripwire, not proof. It catches the common mistakes cheaply on every CI run. The runtime check is
// server/src/security/logLeak.test.ts and the device check is docs/mobile-release-test-plan.md (section 6).
// A line that is deliberately fine can carry the comment `leak-check-ignore: <reason>`.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SCAN_DIRS = ["server/src", "web/src", "mobile/src", "shared/src"];
const EXTENSIONS = /\.(ts|js|mjs|svelte)$/;
const SKIP_FILE = /(\.test\.|\.e2e\.|[\\/]testing[\\/]|[\\/]scripts[\\/])/;

const SECRET = String.raw`(?:session_?token|access_?token|token|bearer|ticket|password|passwd|authorization|secret)`;
const rules = [
  {
    name: "console output mentions a credential",
    re: new RegExp(String.raw`console\.\w+\([^)]*${SECRET}`, "i"),
    stripStrings: true,
  },
  {
    name: "logger call mentions a credential",
    re: new RegExp(String.raw`\b(?:log|logger|app\.log|req\.log)\.(?:trace|debug|info|warn|error|fatal)\([^)]*${SECRET}`, "i"),
    stripStrings: true,
  },
  {
    name: "credential in a URL query string",
    re: /[?&](?:token|access_token|session_?token|ticket|session|sid|password)=/i,
  },
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "dist-native") continue;
    const full = join(dir, name);
    const info = statSync(full);
    if (info.isDirectory()) yield* walk(full);
    else if (EXTENSIONS.test(name) && !SKIP_FILE.test(full)) yield full;
  }
}

const findings = [];
for (const dir of SCAN_DIRS) {
  let files;
  try {
    files = [...walk(join(ROOT, dir))];
  } catch {
    continue;
  }
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // comments describe the rule; they do not leak
      if (line.includes("leak-check-ignore")) return;
      for (const rule of rules) {
        // Message text such as "wrong password" is not a value; only identifiers and templates count.
        const subject = rule.stripStrings ? line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""') : line;
        if (rule.re.test(subject)) {
          findings.push(`${relative(ROOT, file)}:${i + 1}  ${rule.name}\n    ${line.trim()}`);
        }
      }
    });
  }
}

if (findings.length > 0) {
  console.error(`Possible credential leaks (${findings.length}):\n`);
  console.error(findings.join("\n"));
  console.error("\nIf a line is safe, add `// leak-check-ignore: <reason>` to it.");
  process.exit(1);
}
console.log("check-token-leaks: no credential leaks found in " + SCAN_DIRS.join(", "));
