// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
// Dependency-free validation for Runyth Luck Points.
import { accessSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(path.join(root, "module.json"), "utf8"));
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const packageLock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));

function assert(condition, message) {
  if (!condition) {
    process.stderr.write(`Check failed: ${message}\n`);
    process.exit(1);
  }
}

const version = manifest.version;
assert(manifest.id === "runyth-luck-points", "manifest id");
assert(manifest.title === "Runyth Luck Points", "manifest title");
assert(manifest.license === "LICENSE", "manifest licence field");
assert(manifest.url === "https://github.com/Runyth/foundry-runyth-luck-points", "manifest url");
assert(manifest.manifest === "https://github.com/Runyth/foundry-runyth-luck-points/releases/latest/download/module.json", "manifest URL");
assert(
  manifest.download === `https://github.com/Runyth/foundry-runyth-luck-points/releases/download/v${version}/runyth-luck-points-v${version}-mod.zip`,
  "manifest download URL"
);
assert(manifest.authors.length === 1, "manifest must carry exactly one author");
assert(manifest.authors[0].name === "Runyth", "manifest author organisation");
assert(manifest.compatibility.minimum === "13", "Foundry minimum pin");
assert(manifest.relationships?.systems?.length === 1, "the module binds exactly one game system");
assert(manifest.relationships.systems[0].id === "dnd5e", "the bound system is dnd5e");

assert(packageJson.name === manifest.id, "package name");
assert(packageJson.version === version, "package version");
assert(packageJson.license === "AGPL-3.0-or-later", "package licence");
assert(packageLock.packages?.[""]?.version === version, "package-lock root version");
assert(packageLock.packages?.[""]?.license === "AGPL-3.0-or-later", "package-lock root licence");

const requiredFiles = [
  "module.json",
  "package.json",
  "package-lock.json",
  "LICENSE",
  "README.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  ...manifest.esmodules,
  ...(manifest.styles ?? []),
  ...((manifest.languages ?? []).map((entry) => entry.path))
];
for (const relativePath of requiredFiles) {
  accessSync(path.join(root, relativePath));
}

for (const script of readdirSync(path.join(root, "scripts")).filter((name) => name.endsWith(".mjs"))) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, "scripts", script)], {
    cwd: root,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
}

console.log(`Validated ${requiredFiles.length} required files and ${readdirSync(path.join(root, "scripts")).length} module sources.`);
