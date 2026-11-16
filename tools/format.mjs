// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PROJECT_ROOT, walkFiles } from "./lib/project.mjs";
import { matchesAny } from "./lib/glob.mjs";
import { stableJson } from "./lib/text.mjs";

const WRITE = process.argv.includes("--write");
const CHECK = process.argv.includes("--check") || !WRITE;
const TEXT_PATTERNS = ["**/*.js", "**/*.mjs", "**/*.json", "**/*.md", "**/*.yml", "**/*.yaml", "**/*.css", "**/*.hbs", ".editorconfig", ".gitattributes", ".gitignore", ".npmrc", ".node-version", ".nvmrc", "LICENSE"];
const EXCLUDE = ["dist/**", "node_modules/**", ".git/**", "coverage/**"];

let failures = 0;
for (const relativePath of await walkFiles(PROJECT_ROOT)) {
  if (!matchesAny(relativePath, TEXT_PATTERNS) || matchesAny(relativePath, EXCLUDE)) continue;
  const fullPath = path.join(PROJECT_ROOT, relativePath);
  const original = await readFile(fullPath, "utf8");
  let formatted = original.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  if (relativePath.endsWith(".json")) formatted = stableJson(JSON.parse(formatted));
  else formatted = `${formatted.split("\n").map((line) => line.replace(/[ \t]+$/u, "")).join("\n").replace(/\n*$/u, "")}\n`;

  if (formatted !== original) {
    if (WRITE) await writeFile(fullPath, formatted);
    if (CHECK) {
      console.error(`Formatting mismatch: ${relativePath}`);
      failures += 1;
    }
  }
}

if (failures > 0) process.exitCode = 1;
else console.log(WRITE ? "Formatting normalized." : "Formatting verified.");
