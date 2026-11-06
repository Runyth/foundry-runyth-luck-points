// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
// Narrow-window button containment regressions for Runyth Luck Points.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(path.join(root, name), "utf8");
const css = read("styles/runyth-luck-points.css");

test("button labels wrap inside the button box instead of escaping it", () => {
  assert.match(css, /\.luck-points button:not\(\.icon\) \{[^}]*white-space: normal;/u);
  assert.match(css, /\.luck-points button:not\(\.icon\) \{[^}]*overflow-wrap: anywhere;/u);
  assert.match(css, /\.luck-points button:not\(\.icon\) \{[^}]*min-width: 0;/u);
});

test("the section headings wrap so the trailing button stays contained at narrow widths", () => {
  assert.match(css, /\.luck-points-section-heading \{[^}]*flex-wrap: wrap;/u);
});

test("no added rule reintroduces nowrap for button labels in either look", () => {
  for (const nowrap of css.matchAll(/white-space: nowrap;/gu)) {
    const context = JSON.stringify(nowrap);
    assert.ok(false, `the stylesheet must not carry nowrap: ${context}`);
  }
  const fleetLayerStart = css.indexOf(".runyth-luck-points-fleet-ui {");
  const fleetLayer = css.slice(fleetLayerStart);
  assert.doesNotMatch(fleetLayer, /white-space:\s*nowrap/u);
});
