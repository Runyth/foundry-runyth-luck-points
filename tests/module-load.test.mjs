// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
import assert from "node:assert/strict";
import test from "node:test";

const registeredHooks = [];
const onceCallbacks = new Map();
const onCallbacks = new Map();

globalThis.foundry = {
  applications: {
    api: {
      ApplicationV2: class {},
      DialogV2: class {}
    }
  },
  utils: {}
};

globalThis.Hooks = {
  once(name, callback) {
    registeredHooks.push(name);
    onceCallbacks.set(name, callback);
  },
  on(name, callback) {
    registeredHooks.push(name);
    const callbacks = onCallbacks.get(name) ?? [];
    callbacks.push(callback);
    onCallbacks.set(name, callbacks);
  },
  callAll() {
    return true;
  }
};

test("the Foundry entrypoint loads and registers lifecycle hooks", async () => {
  await import("../scripts/luck-points.mjs");

  assert.ok(registeredHooks.includes("init"));
  assert.ok(registeredHooks.includes("ready"));
  assert.ok(registeredHooks.includes("updateUser"));
  assert.ok(registeredHooks.includes("updateChatMessage"));
});

test("init uses both the core hook and D&D5e's post-processing hook for chat controls", async () => {
  const settings = new Map();
  globalThis.game = {
    settings: {
      register(moduleId, key, config) {
        settings.set(`${moduleId}.${key}`, config.default);
      },
      registerMenu() {},
      get(moduleId, key) {
        return settings.get(`${moduleId}.${key}`);
      }
    }
  };
  globalThis.ui = { controls: null };

  const init = onceCallbacks.get("init");
  assert.equal(typeof init, "function");
  init();

  assert.equal(onCallbacks.has("renderChatMessageHTML"), true);
  assert.equal(onCallbacks.has("dnd5e.renderChatMessage"), true);
});

test("local Luck Point flag changes request a chat refresh so support controls stay current", async () => {
  let renderCount = 0;
  globalThis.window = {
    setTimeout(callback) {
      callback();
      return 1;
    },
    clearTimeout() {}
  };
  globalThis.game = {
    user: { id: "player-2" },
    messages: {
      render() {
        renderCount += 1;
      }
    }
  };
  globalThis.foundry.utils.hasProperty = (object, path) => (
    path === "flags.runyth-luck-points" && object?.flags?.["runyth-luck-points"] !== undefined
  );

  const updateUser = onCallbacks.get("updateUser")?.[0];
  assert.equal(typeof updateUser, "function");

  updateUser({ id: "player-2" }, { flags: { "runyth-luck-points": { points: 8 } } });
  assert.equal(renderCount, 1);

  updateUser({ id: "player-3" }, { flags: { "runyth-luck-points": { points: 8 } } });
  assert.equal(renderCount, 1);
});

test("an eligible teammate receives an ally-support button on another player's d20 chat card", () => {
  class FakeElement {
    constructor(tagName = "div") {
      this.tagName = tagName;
      this.className = "";
      this.dataset = {};
      this.innerHTML = "";
      this.children = [];
      this.disabled = false;
      this.listeners = new Map();
    }

    get childElementCount() {
      return this.children.length;
    }

    append(child) {
      this.children.push(child);
    }

    replaceChildren(...children) {
      this.children = [...children];
    }

    addEventListener(name, callback) {
      this.listeners.set(name, callback);
    }

    querySelector() {
      return null;
    }
  }

  const roller = {
    id: "roller",
    name: "Roller",
    isGM: false,
    active: true,
    getFlag() {
      return 0;
    }
  };
  const supporter = {
    id: "supporter",
    name: "Supporter",
    isGM: false,
    active: true,
    getFlag(moduleId, key) {
      if (moduleId === "runyth-luck-points" && key === "points") return 8;
      return undefined;
    }
  };
  const users = [roller, supporter];
  users.get = (id) => users.find((user) => user.id === id);
  users.filter = Array.prototype.filter.bind(users);

  globalThis.game = {
    user: supporter,
    users,
    actors: { get: () => null },
    i18n: {
      lang: "en",
      localize: (key) => key,
      format: (key, data) => `${key} ${JSON.stringify(data)}`
    }
  };
  globalThis.foundry.utils.escapeHTML = (value) => String(value);
  globalThis.document = {
    createElement(tagName) {
      return new FakeElement(tagName);
    }
  };

  const roll = {
    total: 10,
    options: { rollType: "check" },
    dice: [{ faces: 20, results: [{ result: 10, active: true }] }]
  };
  const message = {
    id: "message-1",
    isContentVisible: true,
    rolls: [roll],
    flags: {},
    getFlag(moduleId, key) {
      if (moduleId !== "runyth-luck-points") return undefined;
      if (key === "targetUserId") return roller.id;
      if (key === "applications") return [];
      if (key === "originalTotals") return {};
      return undefined;
    }
  };
  const host = new FakeElement();
  const html = {
    querySelectorAll(selector) {
      return selector === ".dice-roll" ? [host] : [];
    },
    querySelector(selector) {
      return selector === ".message-content" || selector === ".dice-roll" ? host : null;
    }
  };

  const renderChat = onCallbacks.get("renderChatMessageHTML")?.[0];
  assert.equal(typeof renderChat, "function");
  renderChat(message, html);

  assert.equal(host.children.length, 1);
  const group = host.children[0];
  assert.equal(group.className, "luck-points-chat-controls");
  assert.equal(group.children.length, 1);
  const controls = group.children[0];
  assert.equal(controls.className, "luck-points-roll-controls");
  assert.equal(controls.children.length, 1);
  const button = controls.children[0];
  assert.equal(button.className, "luck-points-spend-button");
  assert.match(button.innerHTML, /SpendAlly/);
  assert.match(button.innerHTML, /"ratio":2/);
  assert.match(button.innerHTML, /"maximum":4/);
});

test("the GM authority path automatically deducts ally points and persists the 2:1 contribution", async () => {
  class FakeAdjustedRoll {
    constructor(formula, data = {}, options = {}) {
      this.formula = formula;
      this.options = options;
      this.total = Number.parseInt(String(formula), 10);
      const match = String(formula).match(/^\s*(-?\d+(?:\.\d+)?)\s*\+\s*(\d+)/);
      if (match) this.total = Number(match[1]) + Number(match[2]);
      this.dice = [];
    }

    evaluateSync() {
      return this;
    }

    toJSON() {
      return {
        formula: this.formula,
        total: this.total,
        options: this.options,
        dice: this.dice
      };
    }
  }

  const makeUser = ({ id, name, isGM = false, points = 0 }) => ({
    id,
    name,
    isGM,
    active: true,
    flags: { "runyth-luck-points": { points } },
    getFlag(moduleId, key) {
      return this.flags[moduleId]?.[key];
    },
    async update(changes) {
      for (const [path, value] of Object.entries(changes)) {
        if (path === "flags.runyth-luck-points.points") this.flags["runyth-luck-points"].points = value;
      }
      return this;
    }
  });

  const gm = makeUser({ id: "gm", name: "GM", isGM: true });
  const roller = makeUser({ id: "roller", name: "Roller", points: 5 });
  const supporter = makeUser({ id: "supporter", name: "Supporter", points: 9 });
  const users = [gm, roller, supporter];
  users.get = (id) => users.find((user) => user.id === id);
  users.filter = Array.prototype.filter.bind(users);

  const messageFlags = {
    applications: [],
    originalTotals: {},
    targetUserId: roller.id
  };
  const originalRoll = {
    total: 10,
    options: { rollType: "check" },
    dice: [{ faces: 20, results: [{ result: 10, active: true }] }]
  };
  const message = {
    id: "message-authority",
    isContentVisible: true,
    rolls: [originalRoll],
    flags: { dnd5e: { roll: { type: "check" } } },
    getFlag(moduleId, key) {
      return moduleId === "runyth-luck-points" ? messageFlags[key] : undefined;
    },
    async update(changes) {
      if (changes.rolls) {
        this.rolls = changes.rolls.map((rollData) => ({
          ...rollData,
          dice: rollData.dice ?? []
        }));
      }
      if (changes["flags.runyth-luck-points.applications"]) {
        messageFlags.applications = changes["flags.runyth-luck-points.applications"];
      }
      if (changes["flags.runyth-luck-points.originalTotals"]) {
        messageFlags.originalTotals = changes["flags.runyth-luck-points.originalTotals"];
      }
      if (changes["flags.runyth-luck-points.targetUserId"]) {
        messageFlags.targetUserId = changes["flags.runyth-luck-points.targetUserId"];
      }
      return this;
    }
  };
  const messages = [message];
  messages.get = (id) => messages.find((entry) => entry.id === id);
  messages.filter = Array.prototype.filter.bind(messages);
  messages.render = () => {};

  const socketHandlers = new Map();
  const emitted = [];
  globalThis.Roll = FakeAdjustedRoll;
  globalThis.game = {
    user: gm,
    users,
    messages,
    actors: { get: () => null },
    system: { id: "dnd5e" },
    settings: {
      get(moduleId, key) {
        if (moduleId === "runyth-luck-points" && key === "dataVersion") return 2;
        if (moduleId === "runyth-luck-points" && key === "announceChanges") return false;
        return undefined;
      },
      async set() {}
    },
    socket: {
      on(channel, callback) {
        socketHandlers.set(channel, callback);
      },
      emit(channel, payload) {
        emitted.push({ channel, payload });
      }
    },
    i18n: {
      lang: "en",
      localize: (key) => key,
      format: (key, data) => `${key} ${JSON.stringify(data)}`
    }
  };
  globalThis.ui = {
    notifications: {
      error() {},
      info() {}
    }
  };
  globalThis.foundry.utils = {
    ...globalThis.foundry.utils,
    deepClone: (value) => structuredClone(value),
    escapeHTML: (value) => String(value),
    randomID: () => "application-1",
    hasProperty: () => false
  };

  const ready = onceCallbacks.get("ready");
  assert.equal(typeof ready, "function");
  await ready();

  const socketHandler = socketHandlers.get("module.runyth-luck-points");
  assert.equal(typeof socketHandler, "function");

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await socketHandler({
      type: "request",
      action: "spend-on-roll",
      requestId: "request-1",
      requesterUserId: supporter.id,
      payload: {
        messageId: message.id,
        rollIndex: 0,
        bonus: 3
      }
    });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(supporter.flags["runyth-luck-points"].points, 3);
  assert.equal(message.rolls[0].total, 13);
  assert.equal(messageFlags.applications.length, 1);
  assert.deepEqual(
    {
      sourceUserId: messageFlags.applications[0].sourceUserId,
      targetUserId: messageFlags.applications[0].targetUserId,
      bonus: messageFlags.applications[0].bonus,
      cost: messageFlags.applications[0].cost,
      kind: messageFlags.applications[0].kind
    },
    {
      sourceUserId: supporter.id,
      targetUserId: roller.id,
      bonus: 3,
      cost: 6,
      kind: "ally"
    }
  );

  const response = emitted.find((entry) => entry.payload?.requestId === "request-1");
  assert.equal(response?.payload?.ok, true);
  assert.equal(response?.payload?.result?.cost, 6);
  assert.equal(response?.payload?.result?.points, 3);
  assert.equal(response?.payload?.result?.total, 13);

  async function submit(requestId, requesterUserId, bonus) {
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      await socketHandler({
        type: "request",
        action: "spend-on-roll",
        requestId,
        requesterUserId,
        payload: { messageId: message.id, rollIndex: 0, bonus }
      });
    } finally {
      console.warn = originalWarn;
    }
    return emitted.find((entry) => entry.payload.requestId === requestId)?.payload;
  }

  // A second player spends on the same roll without modifying the first debit.
  const selfResponse = await submit("request-self", roller.id, 5);
  assert.equal(selfResponse.ok, true);
  assert.equal(selfResponse.result.cost, 5);
  assert.equal(roller.flags["runyth-luck-points"].points, 0);
  assert.equal(supporter.flags["runyth-luck-points"].points, 3);
  assert.equal(message.rolls[0].total, 18);
  assert.equal(messageFlags.applications.length, 2);

  // Insufficient supporter points never charge either player.
  const declined = await submit("request-insufficient", supporter.id, 2);
  assert.equal(declined.ok, false);
  assert.equal(supporter.flags["runyth-luck-points"].points, 3);
  assert.equal(message.rolls[0].total, 18);

  const lastAvailable = await submit("request-final", supporter.id, 1);
  assert.equal(lastAvailable.ok, true);
  assert.equal(lastAvailable.result.cost, 2);
  assert.equal(supporter.flags["runyth-luck-points"].points, 1);
  assert.equal(message.rolls[0].total, 19);
  assert.equal(messageFlags.applications.length, 3);

  // Even a player with extra points cannot exceed the shared +10 cap.
  roller.flags["runyth-luck-points"].points = 20;
  const beyondCap = await submit("request-cap", roller.id, 2);
  assert.equal(beyondCap.ok, false);
  assert.equal(roller.flags["runyth-luck-points"].points, 20);
  assert.equal(message.rolls[0].total, 19);

  // A fresh natural-one attack cannot be improved by teammates.
  message.rolls = [{
    total: 1,
    options: { rollType: "attack" },
    dice: [{ faces: 20, results: [{ result: 1, active: true }] }]
  }];
  messageFlags.applications = [];
  const natOne = await submit("request-nat-one", supporter.id, 1);
  assert.equal(natOne.ok, false);
  assert.equal(supporter.flags["runyth-luck-points"].points, 1);
  assert.equal(message.rolls[0].total, 1);
});
