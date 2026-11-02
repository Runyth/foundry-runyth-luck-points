import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readJSON(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

async function readText(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("German and English localization files expose identical keys", async () => {
  const german = await readJSON("../luck-points/lang/de.json");
  const english = await readJSON("../luck-points/lang/en.json");

  assert.deepEqual(Object.keys(german).sort(), Object.keys(english).sort());
});

test("English is the explicit default package language", async () => {
  const manifest = await readJSON("../luck-points/module.json");

  assert.equal(manifest.title, "Luck Points");
  assert.match(manifest.description, /^A player resource/);
  assert.deepEqual(manifest.languages[0], {
    lang: "en",
    name: "English",
    path: "lang/en.json"
  });
});

test("runtime source and package metadata contain no hard-coded German UI copy", async () => {
  const runtime = await readText("../luck-points/scripts/luck-points.mjs");
  const manifest = await readText("../luck-points/module.json");
  const combined = `${runtime}\n${manifest}`;

  assert.doesNotMatch(combined, /Glückspunkte|Pünktlichkeit|Spielleiter|Würfelwurf|Punktestand/);
});

test("all localization keys remain namespaced", async () => {
  const english = await readJSON("../luck-points/lang/en.json");

  for (const key of Object.keys(english)) {
    assert.match(key, /^luck-points\./);
  }
});
