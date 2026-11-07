// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
// Dependency-free release verification for Runyth Luck Points.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { readZip } from "./zip.mjs";
import { build } from "./build.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MODULE_ID = "runyth-luck-points";
const VERSION = "1.2.2";

function fail(message) {
  process.stderr.write(`Verification failed: ${message}\n`);
  process.exitCode = 1;
}

function hashFile(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function archivePath(kind) {
  return path.join(ROOT, "..", "dist", `${MODULE_ID}-v${VERSION}-${kind}.zip`);
}

function riffleScan(text, { stripHolder = false } = {}) {
  const composed = (...parts) => parts.join("");
  const holderFragment = composed("// Copyright (C) 2026 Daniel ", "Brani", "ewski. See the LICENSE file for rights and obligations.");
  const licenceLine = composed("Copyright © 2026  [Daniel ", "Brani", "ewski](https://brani.dev/)");
  let decoded = text.replaceAll(holderFragment, "");
  if (stripHolder) decoded = decoded.replaceAll(licenceLine, "");
  const patterns = [
    new RegExp(composed("aki", "to"), "iu"),
    new RegExp(composed("akki", "@"), "iu"),
    new RegExp(composed("ik", "\\.me"), "iu"),
    new RegExp(composed("GITHUB_", "TOKEN")),
    new RegExp(composed("gh", "[psro]_[A-Za-z0-9]{20,}")),
    new RegExp(composed("https?://[^\\s]*x-", "access-", "token")),
    new RegExp(composed("AUTHORIZATION", ": "), "iu"),
    new RegExp(composed("http.*\\.extra", "header")),
    new RegExp(composed("/mnt", "/"), "u"),
    new RegExp(composed("/home", "/"), "u"),
    new RegExp(composed("/Users", "/"), "u"),
    new RegExp(composed("token-", "hud-wildcard"), "iu"),
    new RegExp(composed("Token HUD ", "Wildcard"), "iu")
  ];
  const offenders = [];
  for (const pattern of patterns) {
    if (pattern.test(decoded)) offenders.push(pattern.toString());
  }
  return offenders;
}

// deterministic rebuild
const names = build();
{
  const built = {};
  for (const key of ["mod", "src", "doc", "checksums", "report"]) {
    const artifact = path.join(ROOT, "..", "dist", names[key]);
    built[key] = hashFile(artifact);
  }
  build();
  for (const key of ["mod", "src", "doc", "checksums", "report"]) {
    const artifact = path.join(ROOT, "..", "dist", names[key]);
    if (built[key] !== hashFile(artifact)) fail(`packaging is not deterministic for ${names[key]}`);
  }
  console.log("Packaging is byte-for-byte deterministic.");
}

const rootManifest = JSON.parse(readFileSync(path.join(ROOT, "..", "module.json"), "utf8"));

// -mod zip
{
  const modPath = archivePath("mod");
  if (!existsSync(modPath)) fail("the installable archive is missing");
  const entries = readZip(readFileSync(modPath));
  const namesInArchive = entries.map((entry) => entry.name);
  if (namesInArchive[0] !== `${MODULE_ID}/`) fail(`archive root is ${namesInArchive[0]}`);
  for (const name of namesInArchive.slice(1)) {
    if (!name.startsWith(`${MODULE_ID}/`)) fail(`entry outside the module root: ${name}`);
  }
  for (const forbidden of ["tools/", "tests/", "docs/", "examples/", "types/", "CHANGELOG.md", ".git/"]) {
    if (namesInArchive.some((name) => name.startsWith(`${MODULE_ID}/${forbidden}`))) fail(`installable archive carries forbidden path ${forbidden}`);
  }
  for (const required of [
    "module.json",
    "LICENSE",
    "README.md",
    ...rootManifest.esmodules,
    ...(rootManifest.styles ?? []),
    ...((rootManifest.languages ?? []).map((row) => row.path)),
  ]) {
    const entryName = `${MODULE_ID}/${required}`;
    if (!namesInArchive.includes(entryName)) fail(`installable archive misses ${required}`);
  }
  const manifestEntry = entries.find((entry) => entry.name === `${MODULE_ID}/module.json`);
  const archiveManifest = JSON.parse(manifestEntry.data.toString("utf8"));
  if (JSON.stringify(archiveManifest) !== JSON.stringify(rootManifest)) {
    fail("the archive manifest differs from the repository manifest");
  }
  console.log("Installable archive: name, manifest, and runtime file set verified.");
}

// -src zip
{
  const srcPath = archivePath("src");
  if (!existsSync(srcPath)) fail("the source archive is missing");
  const expectedRoot = `${MODULE_ID}-v${VERSION}-src`;
  const entries = readZip(readFileSync(srcPath));
  const namesInArchive = entries.map((entry) => entry.name);
  for (const name of namesInArchive) {
    if (!name.startsWith(`${expectedRoot}/`)) fail(`source archive entry outside the root: ${name}`);
  }
  for (const required of [
    "module.json",
    "package.json",
    "package-lock.json",
    ".gitignore",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
    "CONTRIBUTING.md",
    "SECURITY.md",
    ".github/workflows/quality.yml",
    ".github/workflows/release.yml",
    "scripts/core.mjs",
    "scripts/luck-points.mjs",
    "styles/runyth-luck-points.css",
    "lang/de.json",
    "lang/en.json",
    "tools/zip.mjs",
    "tools/check.mjs",
    "tools/build.mjs",
    "tools/verify-release.mjs",
    "tests/core.test.mjs",
    "tests/localization.test.mjs",
    "tests/module-load.test.mjs",
    "tests/roll-regressions.test.mjs",
    "tests/manifest.test.mjs",
    "tests/hygiene.test.mjs",
    "docs/LOCALIZATION.md",
    "README.de.md"
  ]) {
    if (!namesInArchive.includes(`${expectedRoot}/${required}`)) fail(`source archive misses ${required}`);
  }
  for (const entry of entries) {
    if (entry.name.endsWith(".git/") || entry.name.includes("/.git/")) fail(`source archive carries git metadata at ${entry.name}`);
    if (entry.name.endsWith(".py") && (entry.mode & 0o111) === 0) fail(`source archive lost the executable mode for ${entry.name}`);
  }
  const offenders = [];
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const text = entry.data.toString("utf8");
    const stripHolder = entry.name === `${expectedRoot}/README.md`;
    for (const offender of riffleScan(text, { stripHolder })) {
      offenders.push(`${entry.name}: ${offender}`);
    }
  }
  if (offenders.length) fail(`source archive carries forbidden material:\n${offenders.slice(0, 6).join("\n")}`);
  console.log("Source archive: scope, modes, and publication scan verified.");
}

// -doc zip
{
  const docPath = archivePath("doc");
  if (!existsSync(docPath)) fail("the documentation archive is missing");
  const expectedRoot = `${MODULE_ID}-v${VERSION}-doc`;
  const entries = readZip(readFileSync(docPath));
  const namesInArchive = entries.map((entry) => entry.name);
  for (const required of ["CHANGELOG.md", "README.md", "README.de.md", "docs/LOCALIZATION.md"]) {
    if (!namesInArchive.includes(`${expectedRoot}/${required}`)) fail(`documentation archive misses ${required}`);
  }
  console.log("Documentation archive: contract files verified.");
}

// checksums
{
  const checksumPath = path.join(ROOT, "..", "dist", `${MODULE_ID}-v${VERSION}-SHA256SUMS.txt`);
  if (!existsSync(checksumPath)) fail("the checksum file is missing");
  const rows = readFileSync(checksumPath, "utf8").trim().split("\n");
  const expectedRows = 4;
  if (rows.length !== expectedRows) fail(`checksum file has ${rows.length} rows, expected ${expectedRows}`);
  for (const row of rows) {
    const [digest, name] = row.split(/ {2}/);
    if (!name) fail("checksum file has an unparseable row");
    const source = name === "module.json" ? path.join(ROOT, "..", "module.json") : path.join(ROOT, "..", "dist", name);
    if (!existsSync(source)) fail(`checksum row references missing ${name}`);
    if (hashFile(source) !== digest) fail(`checksum mismatch for ${name}`);
  }
  console.log("Checksum file verified.");
}

// build report
{
  const reportPath = path.join(ROOT, "..", "dist", `${MODULE_ID}-v${VERSION}-build-report.json`);
  if (!existsSync(reportPath)) fail("the build report is missing");
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  if (report.moduleId !== MODULE_ID || report.version !== VERSION) fail("build report identity drift");
  const normalizedMatch = Object.keys(report.artifacts).length === 4;
  if (!normalizedMatch) fail("build report artifacts drift");
  console.log("Build report verified.");
}

if (process.exitCode === 1) process.exit(1);
console.log("Release verification passed.");
