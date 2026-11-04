// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
// Dependency-free deterministic packaging for Runyth Luck Points.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { FIXED_TIME, sha256, writeZip } from "./zip.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DIST = path.join(ROOT, "dist");

const moduleManifest = JSON.parse(readFileSync(path.join(ROOT, "module.json"), "utf8"));
const MODULE_ID = moduleManifest.id;
const VERSION = moduleManifest.version;
const packageJson = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));

const installName = `${MODULE_ID}-v${VERSION}-mod.zip`;
const sourceName = `${MODULE_ID}-v${VERSION}-src.zip`;
const docName = `${MODULE_ID}-v${VERSION}-doc.zip`;
const checksumsName = `${MODULE_ID}-v${VERSION}-SHA256SUMS.txt`;
const reportName = `${MODULE_ID}-v${VERSION}-build-report.json`;

if (packageJson.version !== VERSION) {
  throw new Error(`package.json version ${packageJson.version} does not match module version ${VERSION}`);
}

function trackedFiles() {
  const result = spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "buffer" });
  if (result.status !== 0) throw new Error("unable to enumerate the tracked tree");
  return result.stdout.toString().split("\0").filter(Boolean);
}

function buildZipEntries(rootName, names) {
  const rows = [{ name: `${rootName}/`, isDirectory: true }];
  const seen = new Set();
  for (const name of names.sort()) {
    if (seen.has(name)) continue;
    seen.add(name);
    const absolute = path.join(ROOT, name);
    if (!existsSync(absolute)) throw new Error(`missing packaging input ${name}`);
    if (statSync(absolute).isDirectory()) continue;
    const mode = name.endsWith(".py") || name.endsWith(".sh") ? 0o755 : 0o644;
    rows.push({ name: `${rootName}/${name}`, data: readFileSync(absolute), mode });
  }
  return rows;
}

function esImportedNames(entryName, entryText) {
  // carries the entry together with its transitive relative imports so the
  // browser's runtime import of ./foo.mjs resolves from the installable zip.
  const closure = new Set([entryName]);
  const queue = [entryName];
  while (queue.length) {
    const current = queue.pop();
    const absolute = path.join(ROOT, current);
    if (!existsSync(absolute)) continue;
    const text = readFileSync(absolute, "utf8");
    for (const spec of reImportSpecifiers(text)) {
      if (!spec.startsWith(".")) continue;
      const resolved = path.normalize(path.join(path.posix.dirname(current), spec));
      for (const candidate of [resolved, `${resolved}/index.mjs`, `${resolved}/index.js`]) {
        if (existsSync(path.join(ROOT, candidate)) && !closure.has(candidate)) {
          closure.add(candidate);
          queue.push(candidate);
          break;
        }
      }
    }
  }
  return [...closure];
}

function reImportSpecifiers(text) {
  const found = [];
  for (const match of text.matchAll(/(?:from|import)\s+["'](\.[^"'\n]+)["']/g)) {
    found.push(match[1]);
  }
  for (const match of text.matchAll(/import\(["'](\.[^"'\n]+)["']\)/g)) {
    found.push(match[1]);
  }
  return found;
}

function runtimeNames() {
  const names = ["module.json", "LICENSE", "README.md", ...moduleManifest.esmodules];
  if (moduleManifest.styles) names.push(...moduleManifest.styles);
  if (moduleManifest.languages) {
    for (const language of moduleManifest.languages) names.push(language.path);
  }
  for (const script of moduleManifest.esmodules) {
    const absolute = path.join(ROOT, script);
    if (existsSync(absolute)) {
      names.push(...esImportedNames(script, readFileSync(absolute, "utf8")));
    }
  }
  return names;
}

function docNames() {
  return [
    "CHANGELOG.md",
    "README.md",
    "README.de.md",
    "docs/LOCALIZATION.md"
  ];
}

function sourceNames() {
  return trackedFiles().filter((name) => !name.startsWith("dist/") && name !== checksumsName);
}

export function build() {
  if (existsSync(DIST)) rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });

  const names = {
    mod: installName,
    src: sourceName,
    doc: docName,
    checksums: checksumsName,
    report: reportName
  };

  writeFileSync(path.join(DIST, names.mod), writeZip(buildZipEntries(MODULE_ID, runtimeNames())));
  writeFileSync(path.join(DIST, names.doc), writeZip(buildZipEntries(`${MODULE_ID}-v${VERSION}-doc`, docNames())));
  writeFileSync(path.join(DIST, names.src), writeZip(buildZipEntries(`${MODULE_ID}-v${VERSION}-src`, sourceNames())));

  const checksumRows = [names.mod, names.src, names.doc, "module.json"].map((name) => {
    const source = name === "module.json" ? path.join(ROOT, name) : path.join(DIST, name);
    const digest = createHash("sha256").update(readFileSync(source)).digest("hex");
    return `${digest}  ${name}`;
  });
  writeFileSync(path.join(DIST, names.checksums), `${checksumRows.join("\n")}\n`);

  const report = {
    moduleId: MODULE_ID,
    title: moduleManifest.title,
    version: VERSION,
    generatedAt: FIXED_TIME.toISOString(),
    artifacts: {},
    notes: ["Deterministic packaging with fixed timestamps and store-mode entries."]
  };
  for (const name of [names.mod, names.src, names.doc, names.checksums]) {
    const buffer = readFileSync(path.join(DIST, name));
    report.artifacts[name] = { bytes: buffer.length, sha256: sha256(buffer) };
  }
  writeFileSync(path.join(DIST, names.report), `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Packaged ${names.mod} (${statSync(path.join(DIST, names.mod)).size} bytes)`);
  console.log(`Packaged ${names.src} (${statSync(path.join(DIST, names.src)).size} bytes)`);
  console.log(`Packaged ${names.doc} (${statSync(path.join(DIST, names.doc)).size} bytes)`);
  console.log(`Wrote ${names.checksums}`);
  console.log(`Wrote ${names.report}`);
  return names;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) build();
