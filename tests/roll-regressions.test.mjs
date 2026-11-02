import assert from "node:assert/strict";
import test from "node:test";
import { activeD20Result } from "../luck-points/scripts/core.mjs";

const hooks = new Map();
const lifecycle = new Map();

globalThis.foundry = {
  applications: { api: { ApplicationV2: class {}, DialogV2: class {} } },
  utils: {
    escapeHTML: (value) => String(value),
    randomID: () => `id-${Math.random()}`,
    deepClone: (value) => structuredClone(value),
    hasProperty: (obj, path) => path.split(".").reduce((item, key) => item?.[key], obj) !== undefined
  }
};
globalThis.Hooks = {
  once: (name, fn) => lifecycle.set(name, fn),
  on: (name, fn) => hooks.set(name, fn),
  callAll: () => true
};
await import("../luck-points/scripts/luck-points.mjs");
globalThis.game = { settings: { register() {}, registerMenu() {} } };
globalThis.ui = { controls: null };
lifecycle.get("init")();

class Element {
  constructor(tag = "div") {
    this.tagName = tag;
    this.children = [];
    this.className = "";
    this.dataset = {};
    this.innerHTML = "";
    this.events = new Map();
  }

  append(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = [...children]; }
  remove() { this.removed = true; }
  get childElementCount() { return this.children.length; }
  addEventListener(name, fn) { this.events.set(name, fn); }
  querySelector(selector) {
    if (selector === ".message-content") return this.children.find((el) => el.className === "message-content") ?? null;
    if (selector === ".dice-roll") return this.children.find((el) => el.className === "dice-roll") ?? null;
    if (selector === ".luck-points-chat-controls") return this.children.find((el) => el.className === "luck-points-chat-controls") ?? null;
    if (selector.includes(".luck-points-roll-controls")) {
      const index = selector.match(/data-roll-index="(\d+)"/)?.[1];
      return this.children.find((el) => el.className === "luck-points-roll-controls" && el.dataset.rollIndex === index) ?? null;
    }
    return null;
  }
  matches(selector) { return `.${this.className}` === selector; }
}

globalThis.document = { createElement: (tag) => new Element(tag) };

function user(id, points = 20, isGM = false) {
  return {
    id, name: id, active: true, isGM,
    flags: { "luck-points": { points } },
    getFlag(moduleId, key) { return this.flags[moduleId]?.[key]; },
    async update(changes) {
      for (const [key, value] of Object.entries(changes)) {
        if (key === "flags.luck-points.points") this.flags["luck-points"].points = value;
      }
      return this;
    }
  };
}

function gameForUsers(current, list) {
  list.get = (id) => list.find((item) => item.id === id);
  globalThis.game = {
    user: current,
    users: list,
    actors: { get: () => null },
    i18n: {
      lang: "en",
      localize: (key) => key,
      format: (key, args) => `${key}:${JSON.stringify(args)}`
    },
    settings: { get: () => false }
  };
}

function roll(result, rollType = "attack") {
  return {
    total: result,
    options: { rollType },
    dice: [{ faces: 20, results: [{ result, active: true }] }]
  };
}

function chat({ roller, rolls, flags = {}, whisper = [], blind = false }) {
  return {
    id: "chat-roll",
    isContentVisible: true,
    rolls,
    flags: { dnd5e: { roll: { type: "damage" } }, ...flags },
    whisper,
    blind,
    getFlag(mod, key) {
      if (mod !== "luck-points") return undefined;
      if (key === "targetUserId") return roller.id;
      if (key === "applications") return [];
      if (key === "originalTotals") return {};
      return undefined;
    }
  };
}

function mount(message) {
  const root = new Element();
  const dice1 = new Element(); dice1.className = "dice-roll";
  const dice2 = new Element(); dice2.className = "dice-roll";
  const content = new Element(); content.className = "message-content";
  root.append(dice1);
  root.append(dice2);
  root.append(content);
  hooks.get("renderChatMessageHTML")(message, root);
  return { root, content, dice1, dice2, group: content.querySelector(".luck-points-chat-controls") };
}

test("already-failed attacks retain a self-spend control even with extra dice markup", () => {
  const roller = user("roller", 8);
  const ally = user("ally", 10);
  gameForUsers(roller, [roller, ally]);
  const message = chat({ roller, rolls: [roll(8)] }); // lower than an illustrative AC 12
  const ui = mount(message);
  assert.equal(ui.dice1.children.length, 0);
  assert.equal(ui.dice2.children.length, 0);
  assert.equal(ui.group.children.length, 1);
  assert.match(ui.group.children[0].children[0].innerHTML, /SpendSelf/);
  assert.match(ui.group.children[0].children[0].innerHTML, /"maximum":8/);

  // A second render hook must not insert duplicate buttons.
  hooks.get("dnd5e.renderChatMessage")(message, ui.root);
  assert.equal(ui.content.children.length, 1);
  assert.equal(ui.group.children.length, 1);
});

test("an ally gets a 2:1 control on an already-failed attack, even with mismatched roll markup", () => {
  const roller = user("roller", 8);
  const ally = user("ally", 10);
  gameForUsers(ally, [roller, ally]);
  const ui = mount(chat({ roller, rolls: [roll(8)] }));
  const button = ui.group.children[0].children[0];
  assert.match(button.innerHTML, /SpendAlly/);
  assert.match(button.innerHTML, /"maximum":5/);
  assert.match(button.innerHTML, /"ratio":2/);
});

test("mixed attack/damage cards classify their rolls individually and do not spend on damage", () => {
  const roller = user("roller");
  const ally = user("ally");
  gameForUsers(ally, [roller, ally]);
  const rolls = [roll(9, "attack"), roll(12, "damage")];
  const ui = mount(chat({ roller, rolls }));
  assert.equal(ui.group.children.length, 1);
  assert.equal(ui.group.children[0].dataset.rollIndex, "0");
  assert.match(ui.group.children[0].children[0].innerHTML, /SpendAlly/);
});

test("a natural one cannot be modified by the roller or any ally", () => {
  const roller = user("roller");
  const ally = user("ally");
  for (const current of [roller, ally]) {
    gameForUsers(current, [roller, ally]);
    const ui = mount(chat({ roller, rolls: [roll(1)] }));
    assert.equal(ui.group.children[0].children.length, 1);
    assert.equal(ui.group.children[0].children[0].className, "luck-points-natural-one");
  }
});

test("a whispered or blind private roll never offers teammates a spending button", () => {
  const roller = user("roller");
  const ally = user("ally");
  gameForUsers(ally, [roller, ally]);
  for (const message of [
    chat({ roller, rolls: [roll(10)], whisper: [roller.id] }),
    chat({ roller, rolls: [roll(10)], blind: true })
  ]) {
    const ui = mount(message);
    assert.equal(ui.group?.removed, true);
    assert.equal(ui.group?.children.length, 0);
  }
});

test("no fake d20 is inferred from null/invalid stored original values", () => {
  assert.equal(activeD20Result({ options: { "luck-points": { originalD20: null } }, dice: [] }), null);
  assert.equal(activeD20Result({ options: { "luck-points": { originalD20: 30 } }, dice: [] }), null);
  assert.equal(activeD20Result({ dice: [{ faces: 20, results: [{ result: null }] }] }), null);
});


test("post-D&D5e hook restores spend controls when system rendering replaces message content", () => {
  const roller = user("roller", 7);
  const ally = user("ally", 12);
  gameForUsers(ally, [roller, ally]);
  const message = chat({ roller, rolls: [roll(9)] });
  const ui = mount(message);
  assert.equal(ui.group.children.length, 1);
  // System-specific card hydration may replace the entire message-content node.
  const newContent = new Element();
  newContent.className = "message-content";
  ui.root.children = ui.root.children.map((node) => node === ui.content ? newContent : node);
  hooks.get("dnd5e.renderChatMessage")(message, ui.root);
  const restored = newContent.querySelector(".luck-points-chat-controls");
  assert.equal(restored?.children.length, 1);
  assert.match(restored.children[0].children[0].innerHTML, /SpendAlly/);
});
