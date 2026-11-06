// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
// Fleet look and stock Foundry look toggle regressions for Runyth Luck Points.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = (name) => path.join(root, name);
const read = (name) => readFileSync(repo(name), "utf8");

class ApplicationV2Stub {
  constructor(options) {
    this.options = options;
  }
}

class DialogV2Stub {
  constructor(options) {
    this.options = options;
  }
}

function fakeWindowElement(classes = []) {
  const set = new Set(classes);
  const attributes = new Map();
  return {
    classes: set,
    attributes,
    classList: {
      add: (name) => set.add(name),
      remove: (name) => set.delete(name),
      contains: (name) => set.has(name),
      toggle: (name, force) => {
        const active = force === undefined ? !set.has(name) : Boolean(force);
        if (active) set.add(name);
        else set.delete(name);
        return active;
      }
    },
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: (name) => attributes.get(name) ?? null
  };
}

function configureStockLook(value) {
  globalThis.game = {
    settings: {
      register: () => undefined,
      registerMenu: () => undefined,
      get: (moduleId, key) => (moduleId === "runyth-luck-points" && key === "stockFoundryLook" ? value : undefined)
    }
  };
}

test("registers the look toggle disabled by default on the client scope and wires the look hooks", async () => {
  const registrations = new Map();
  const menus = new Map();
  const hooks = new Map();
  const onceHooks = [];
  globalThis.Hooks = {
    once: (name, callback) => onceHooks.push([name, callback]),
    on: (name, handler) => hooks.set(name, handler)
  };
  globalThis.game = {
    settings: {
      register: (moduleId, key, data) => registrations.set(key, data),
      registerMenu: (moduleId, key, data) => menus.set(key, data),
      get: () => undefined
    }
  };
  globalThis.foundry = { applications: { api: { ApplicationV2: ApplicationV2Stub, DialogV2: DialogV2Stub } } };

  await import("../scripts/luck-points.mjs");

  const initCallbacks = onceHooks.filter(([name]) => name === "init");
  assert.equal(initCallbacks.length, 1);
  initCallbacks[0][1]();

  const entry = registrations.get("stockFoundryLook");
  assert.ok(entry, "the stock Foundry look toggle is registered");
  assert.equal(entry.scope, "client");
  assert.equal(entry.config, true);
  assert.equal(entry.type, Boolean);
  assert.equal(entry.default, false);
  assert.equal(entry.name, "runyth-luck-points.Settings.StockFoundryLook.Name");

  assert.ok(hooks.has("closeSettingsConfig"), "settings closure re-syncs mounted windows");

  const { syncRenderedWindow } = await import("../scripts/window-look.mjs");
  assert.equal(hooks.get("renderDialogV2"), syncRenderedWindow);
  assert.equal(hooks.get("renderApplicationV2"), syncRenderedWindow);

  const menu = menus.get("open");
  assert.ok(menu?.type, "the main application is registered through the menu");
});

test("applies the fleet class by default and keeps the stock look verbatim when toggled", async () => {
  const { applyUiLook, windowClasses, FLEET_UI_CLASS } = await import("../scripts/ui-look.mjs");
  const { mountWindowIdentity } = await import("../scripts/window-look.mjs");

  configureStockLook(false);
  const fleetElement = fakeWindowElement();
  applyUiLook(fleetElement);
  assert.equal(fleetElement.classList.contains(FLEET_UI_CLASS), true);
  assert.deepEqual(
    windowClasses(["runyth-luck-points-spend-dialog"]),
    ["runyth-luck-points-spend-dialog", FLEET_UI_CLASS]
  );

  configureStockLook(true);
  const stockElement = fakeWindowElement();
  applyUiLook(stockElement);
  assert.equal(stockElement.classList.contains(FLEET_UI_CLASS), false);
  assert.deepEqual(
    windowClasses(["runyth-luck-points-spend-dialog"]),
    ["runyth-luck-points-spend-dialog"]
  );

  configureStockLook(false);
  mountWindowIdentity({ options: { classes: ["runyth-luck-points"] }, element: fleetElement });
  assert.equal(fleetElement.classList.contains(FLEET_UI_CLASS), true);
  assert.equal(fleetElement.getAttribute("data-runyth-luck-points-window"), "");
  configureStockLook(true);
  mountWindowIdentity({ options: { classes: ["runyth-luck-points"] }, element: fleetElement });
  assert.equal(fleetElement.classList.contains(FLEET_UI_CLASS), false);
});

test("syncOpenWindows reaches every mounted window through classes and the render marker", async () => {
  const { syncOpenWindows, FLEET_UI_CLASS, WINDOW_MARKER } = await import("../scripts/ui-look.mjs");
  const appWindow = fakeWindowElement(["runyth-luck-points"]);
  const spendDialog = fakeWindowElement(["runyth-luck-points-spend-dialog"]);
  const markerOnly = fakeWindowElement([]);
  markerOnly.setAttribute(WINDOW_MARKER, "");

  const tracked = [];
  globalThis.document = {
    querySelectorAll: (selector) => {
      tracked.push(selector);
      return [appWindow, spendDialog, markerOnly];
    }
  };

  configureStockLook(false);
  assert.equal(syncOpenWindows(), false);
  assert.equal(appWindow.classList.contains(FLEET_UI_CLASS), true);
  assert.equal(spendDialog.classList.contains(FLEET_UI_CLASS), true);
  assert.equal(markerOnly.classList.contains(FLEET_UI_CLASS), true);

  configureStockLook(true);
  assert.equal(syncOpenWindows(), true);
  assert.equal(appWindow.classList.contains(FLEET_UI_CLASS), false);
  assert.equal(spendDialog.classList.contains(FLEET_UI_CLASS), false);
  assert.equal(markerOnly.classList.contains(FLEET_UI_CLASS), false);

  for (const selector of tracked) {
    assert.ok(selector.includes(`[${WINDOW_MARKER}]`));
    assert.ok(selector.includes(".runyth-luck-points"));
    assert.ok(selector.includes(".runyth-luck-points-spend-dialog"));
  }
  globalThis.document = undefined;
});

test("syncRenderedWindow mounts identity and look independently of the host classes forwarding", async () => {
  const { syncRenderedWindow } = await import("../scripts/window-look.mjs");
  const { FLEET_UI_CLASS, WINDOW_MARKER } = await import("../scripts/ui-look.mjs");

  configureStockLook(false);
  const element = fakeWindowElement();
  const appWindow = new ApplicationV2Stub({ classes: ["application", "runyth-luck-points"] });
  appWindow.element = element;

  assert.equal(syncRenderedWindow(appWindow), true);
  assert.equal(element.classList.contains("application"), true);
  assert.equal(element.classList.contains("runyth-luck-points"), true);
  assert.equal(element.classList.contains(FLEET_UI_CLASS), true);
  assert.equal(element.getAttribute(WINDOW_MARKER), "");

  configureStockLook(true);
  assert.equal(syncRenderedWindow(appWindow), true);
  assert.equal(element.classList.contains(FLEET_UI_CLASS), false);
  assert.equal(element.classList.contains("runyth-luck-points"), true);

  const foreignElement = fakeWindowElement();
  const foreign = new ApplicationV2Stub({ classes: ["application", "some-other-module-window"] });
  foreign.element = foreignElement;
  assert.equal(syncRenderedWindow(foreign), false);
  assert.equal(foreignElement.classes.size, 0);
  assert.equal(foreignElement.getAttribute(WINDOW_MARKER) === "", false);
});

test("renders Luck Points spend dialogs through the module render hook only for own windows", async () => {
  const { syncRenderedWindow } = await import("../scripts/window-look.mjs");
  const { FLEET_UI_CLASS, WINDOW_MARKER } = await import("../scripts/ui-look.mjs");
  configureStockLook(false);
  const spendDialogStub = class extends DialogV2Stub {};
  const spend = new spendDialogStub({
    classes: ["runyth-luck-points-spend-dialog", FLEET_UI_CLASS]
  });
  spend.element = fakeWindowElement();
  assert.equal(syncRenderedWindow(spend), true);
  assert.equal(spend.element.classList.contains("runyth-luck-points-spend-dialog"), true);
  assert.equal(spend.element.classList.contains(FLEET_UI_CLASS), true);
  assert.ok(spend.element.getAttribute(WINDOW_MARKER) === "");
});

test("the spend prompt carries the module window classes through DialogV2.prompt", () => {
  const source = read("scripts/luck-points.mjs");
  assert.match(source, /classes: windowClasses\(\["runyth-luck-points-spend-dialog"\]\)/);
});

test("the fleet layer keys every rule on the fleet class alone and never on bare globals", () => {
  const css = read("styles/runyth-luck-points.css");
  const layerStart = css.indexOf(".runyth-luck-points-fleet-ui {");
  assert.ok(layerStart > 0, "the fleet layer is appended to the stylesheet");
  const layer = css.slice(layerStart).replace(/\/\*[\s\S]*?\*\//g, "");
  const flat = layer.replace(/:(is|not)\([^()]*\)/g, "()");
  const selectors = flat.split("}").map((block) => block.split("{")[0]).filter((part) => part.trim());
  const rules = [];
  for (const chunk of selectors) {
    for (const selector of chunk.split(",")) {
      if (selector.trim()) rules.push(selector.trim());
    }
  }
  assert.ok(rules.length >= 10, "the fleet layer is present");
  for (const selector of rules) {
    assert.ok(selector.includes(".runyth-luck-points-fleet-ui"), `scoped: ${selector}`);
  }
  for (const bare of [":root", "html {", "body {"]) {
    assert.ok(!layer.includes(bare), `no bare global ${bare}`);
  }
  assert.ok(layer.includes("linear-gradient"), "the fleet shell gradient is present");
  assert.ok(layer.includes("#f0ca82"), "the gold headings are present");
});
