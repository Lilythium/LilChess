import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageSwiftPath = resolve(dirname(fileURLToPath(import.meta.url)), "../ios/App/CapApp-SPM/Package.swift");
const packageSwift = await readFile(packageSwiftPath, "utf8");
const normalized = packageSwift.replace(/(path: ")([^"]*)(")/g, (_, before, path, after) =>
  `${before}${path.replaceAll("\\", "/")}${after}`,
);

if (normalized !== packageSwift) await writeFile(packageSwiftPath, normalized);