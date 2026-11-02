// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
// Source notice, licence, and publication hygiene for Runyth Luck Points.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = (name) => path.join(root, name);
const read = (name) => readFileSync(repo(name), "utf8");

function everyProgramFile(directory, extensions) {
  const rows = readdirSync(repo(directory), { withFileTypes: true });
  const files = [];
  for (const row of rows) {
    const absolute = path.join(repo(directory), row.name);
    if (row.isDirectory()) files.push(...everyProgramFile(`${directory}/${row.name}`, extensions));
    else if (extensions.some((value) => row.name.endsWith(value))) files.push(`${directory}/${row.name}`);
  }
  return files;
}

const programFiles = [
  ...everyProgramFile("scripts", [".mjs"]),
  ...everyProgramFile("tools", [".mjs"]),
  ...everyProgramFile("tests", [".mjs"])
];

test("every program file starts with the standard two-line source notice", () => {
  assert.ok(programFiles.length >= 6);
  const holder = ["// SPDX-License-Identifier: AGPL-3.0-or-later", "// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations."];
  const holderFragment = ["// Copyright (C) 2026 Daniel ", "Brani", "ewski. See the LICENSE file for rights and obligations."].join("");
  for (const file of programFiles) {
    const lines = read(file).split("\n");
    assert.deepEqual(lines.slice(0, 2), holder, `${file} carries the source notice`);
    assert.ok(lines[1].startsWith(holderFragment), `${file} notice holder`);
  }
});

test("the LICENSE file is the full GNU Affero General Public License v3", () => {
  const licence = read("LICENSE");
  assert.match(licence, /GNU AFFERO GENERAL PUBLIC LICENSE/);
  assert.match(licence, /Version 3, 19 November 2007/);
  assert.ok(licence.length > 30000);
});

test("the README quotes the standard licence chapter", () => {
  const readme = read("README.md");
  const holderLine = ["Copyright © 2026  [Daniel ", "Brani", "ewski](https://brani.dev/)"].join("");
  assert.ok(readme.includes("## Licence"));
  assert.ok(readme.includes(holderLine));
  assert.ok(readme.includes("This program is free software: you can redistribute it and/or modify"));
  assert.ok(readme.includes("<https://www.gnu.org/licenses/>"));
});

test("the changelog carries the 1.1.3 release section and its Runyth publication record", () => {
  const changelog = read("CHANGELOG.md");
  assert.ok(changelog.includes("## 1.1.3 — 2026-10-28"));
  assert.ok(changelog.includes("First publication as a Runyth module"));
});

test("published surfaces name no foreign module and give no foreign credit", () => {
  const foreignProject = ["token-", "hud-wildcard"].join("");
  const foreignName = ["Token HUD ", "Wildcard"].join("");
  const presentationSource = ["garb", "-and-", "grime"].join("");
  const presentationSourceName = ["Garb", " & ", "Grime"].join("");
  const externalProject = ["orphan-", "black"].join("");
  const externalCredit = ["Mid", "i-QoL"].join("");
  const volunteer = ["aki", "to"].join("");
  const mitRule = new RegExp(["MIT ", "License|Permission is hereby ", "granted"].join(""), "");
  for (const file of ["module.json", "README.md", "README.de.md", "CHANGELOG.md", ...programFiles]) {
    const text = read(file);
    assert.ok(!text.includes(foreignProject), `${file} must not carry the foreign module id`);
    assert.ok(!text.includes(foreignName), `${file} must not carry the foreign module name`);
    assert.ok(!text.includes(presentationSource), `${file} must not carry the foreign presentation module id`);
    assert.ok(!text.includes(presentationSourceName), `${file} must not carry the foreign presentation module name`);
    assert.ok(!text.includes(externalProject), `${file} must not carry the private campaign name`);
    assert.ok(!text.includes(externalCredit), `${file} must not carry third-party module credit`);
    assert.ok(!/[Cc]ourtesy of|[Tt]hanks to/.test(text), `${file} must not hand out upstream credit`);
    assert.ok(!text.includes(volunteer), `${file} must not carry personal identity outside licence surfaces`);
    assert.ok(!mitRule.test(text), `${file} must not quote the removed MIT licence`);
  }
});

test("compatibility references stay technical and dependency-free", () => {
  // D&D 5e roll integration and roll options are game-system surfaces, not module credits;
  // the module binds the system and ships with no required modules.
  const manifest = JSON.parse(read("module.json"));
  assert.equal(manifest.relationships.systems.length, 1);
  assert.equal(manifest.relationships.systems[0].id, "dnd5e");
  assert.ok(!manifest.relationships.requires?.length);
  for (const file of ["README.md", "README.de.md", "docs/LOCALIZATION.md"]) {
    const text = read(file);
    assert.ok(!/donate|patreon|ko-?fi/i.test(text), `${file} must not carry funding prompts`);
  }
});

test("no private material lives on published source surfaces", () => {
  const pattern = (...parts) => new RegExp(parts.join(""), "iu"); // rules assembled at runtime
  const patterns = [
    pattern(["akki", "@"]),
    pattern(["ik", "\\.me"]),
    pattern(["GITHUB_", "TOKEN"]),
    pattern(["gh", "[psro]_[A-Za-z0-9]{20,}"]),
    pattern(["http.*\\.extra", "header"]),
    pattern(["x-", "access-", "token"]),
    pattern(["/mnt", "/"]),
    pattern(["/home", "/"]),
    pattern(["aki", "to"]),
    pattern(["ORPHAN-", "[-\\s]*", "BLACK"])
  ];
  for (const file of [
    "module.json",
    "package.json",
    "package-lock.json",
    "README.md",
    "README.de.md",
    "CHANGELOG.md",
    ".github/workflows/quality.yml",
    ".github/workflows/release.yml",
    ...programFiles,
    ...(readdirSync(repo("docs"), { withFileTypes: true }).flatMap((row) => row.isFile() ? [`docs/${row.name}`] : [])).filter((file) => file.endsWith(".md") || file.endsWith(".txt"))
  ]) {
    const text = read(file);
    for (const rule of patterns) {
      assert.ok(!rule.test(text), `${file} must not match ${String(rule)}`);
    }
  }
});
