// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
// Manifest, URL, and package-integrity checks for Runyth Luck Points.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = (name) => path.join(root, name);
const readJson = (name) => JSON.parse(readFileSync(repo(name), "utf8"));

const manifest = readJson("module.json");
const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");

test("manifest identity", () => {
  assert.equal(manifest.id, "runyth-luck-points");
  assert.equal(manifest.title, "Runyth Luck Points");
  assert.equal(manifest.authors.length, 1);
  assert.equal(manifest.authors[0].name, "Runyth");
  assert.equal(manifest.authors[0].url, "https://github.com/Runyth");
  assert.equal(manifest.socket, true);
});

test("manifest URL surfaces", () => {
  const version = manifest.version;
  assert.equal(manifest.license, "LICENSE");
  assert.equal(manifest.url, "https://github.com/Runyth/foundry-runyth-luck-points");
  assert.equal(manifest.manifest, "https://github.com/Runyth/foundry-runyth-luck-points/releases/latest/download/module.json");
  assert.equal(
    manifest.download,
    `https://github.com/Runyth/foundry-runyth-luck-points/releases/download/v${version}/runyth-luck-points-v${version}-mod.zip`
  );
  assert.equal(manifest.changelog, "CHANGELOG.md");
});

test("package metadata agrees with the manifest", () => {
  assert.equal(packageJson.name, manifest.id);
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.type, "module");
  assert.equal(packageJson.version, manifest.version);
  assert.equal(packageJson.license, "AGPL-3.0-or-later");
  assert.ok(packageJson.engines.node.includes("22.13.0"));
  assert.equal(packageLock.packages[""].version, manifest.version);
  assert.equal(packageLock.packages[""].license, "AGPL-3.0-or-later");
  assert.equal(packageLock.name, manifest.id);
});

test("manifest runtime files", () => {
  assert.equal(manifest.compatibility.minimum, "13");
  assert.ok(manifest.compatibility.verified);
  assert.equal(manifest.relationships.systems.length, 1);
  assert.equal(manifest.relationships.systems[0].id, "dnd5e");
  assert.ok(!manifest.relationships.requires?.length);
  for (const entry of manifest.esmodules) assert.ok(existsSync(repo(entry)));
  for (const style of manifest.styles) assert.ok(existsSync(repo(style)));
  for (const language of manifest.languages) {
    assert.ok(existsSync(repo(language.path)));
    assert.doesNotThrow(() => JSON.parse(readFileSync(repo(language.path), "utf8")));
  }
  assert.ok(existsSync(repo("README.md")));
  assert.ok(existsSync(repo("README.de.md")));
  assert.ok(existsSync(repo("CHANGELOG.md")));
});

test("the localization namespace follows its module naming contract", () => {
  for (const language of manifest.languages) {
    const data = JSON.parse(readFileSync(repo(language.path), "utf8"));
    for (const key of Object.keys(data)) {
      assert.match(key, /^runyth-luck-points\./, `${language.path} key ${key}`);
    }
  }
});
