import {
  AWARD_REASONS,
  LIMITS,
  activeD20Result,
  appliedBonusTotal,
  clampInteger,
  evaluateSpend,
  isNaturalOneAttack,
  normalizeApplications,
  normalizeClaims,
  normalizePoints,
  rollCapacity
} from "./core.mjs";

const MODULE_ID = "runyth-luck-points";
const MODULE_TITLE = "Luck Points";
const SOCKET_CHANNEL = `module.${MODULE_ID}`;
const DATA_VERSION = 2;
const INELIGIBLE_ROLL_TYPES = new Set(["damage", "healing", "initiative"]);

const { ApplicationV2, DialogV2 } = foundry.applications.api;

let application = null;
let authorityQueue = Promise.resolve();
const pendingRequests = new Map();
const pendingSpendRequests = new Set();
let chatRefreshTimeoutId = null;

function localize(key, data = {}) {
  const fullKey = `${MODULE_ID}.${key}`;
  return Object.keys(data).length
    ? game.i18n.format(fullKey, data)
    : game.i18n.localize(fullKey);
}

function escapeHTML(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

function getUser(userId = game.user.id) {
  return game.users.get(userId) ?? null;
}

function userFromReference(reference) {
  if (!reference) return null;
  if (typeof reference === "object" && reference.id) {
    return getUser(reference.id) ?? reference;
  }
  return getUser(String(reference));
}

function getPoints(user = game.user) {
  return normalizePoints(user?.getFlag(MODULE_ID, "points") ?? 0);
}

function getClaims(user = game.user) {
  return normalizeClaims(user?.getFlag(MODULE_ID, "claims") ?? []);
}

function getApplications(message) {
  return normalizeApplications(message?.getFlag(MODULE_ID, "applications") ?? []);
}

function activePrimaryGM() {
  return game.users
    .filter((user) => user.active && user.isGM)
    .sort((left, right) => left.id.localeCompare(right.id))[0] ?? null;
}

function playerUsers({ activeOnly = false } = {}) {
  return game.users
    .filter((user) => !user.isGM && (!activeOnly || user.active))
    .sort((left, right) => left.name.localeCompare(right.name, game.i18n.lang));
}

function openApplication() {
  if (application?.rendered) {
    application.bringToFront();
    return application;
  }

  application = new LuckPointsApplication();
  application.render({ force: true });
  return application;
}

function refreshApplication() {
  if (application?.rendered) application.render();
}

function hasModuleFlagChange(changes) {
  if (!changes || typeof changes !== "object") return false;
  if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) return true;
  const prefix = `flags.${MODULE_ID}`;
  return Object.keys(changes).some((key) => key === prefix || key.startsWith(`${prefix}.`))
    || Object.keys(changes.flags ?? {}).some((key) => key === MODULE_ID || key.startsWith(`${MODULE_ID}.`));
}

function scheduleChatRefresh() {
  if (chatRefreshTimeoutId !== null) return;

  chatRefreshTimeoutId = window.setTimeout(() => {
    chatRefreshTimeoutId = null;
    game.messages?.render?.();
  }, 0);
}

async function updateUserFlags(user, changes) {
  const update = {};
  for (const [key, value] of Object.entries(changes)) {
    update[`flags.${MODULE_ID}.${key}`] = value;
  }
  return user.update(update);
}

function notifyError(error) {
  const message = error instanceof Error ? error.message : String(error);
  ui.notifications.error(message);
}

function errorFromCode(code, data = {}) {
  const keyByCode = {
    "roll-full": "Errors.RollFull",
    "insufficient-points": "Errors.InsufficientPoints",
    "bonus-too-high": "Errors.BonusTooHigh",
    "no-gm": "Errors.NoGM",
    "invalid-target": "Errors.InvalidTarget",
    "invalid-roll": "Errors.InvalidRoll",
    "natural-one": "Errors.NaturalOne",
    "invalid-award": "Errors.InvalidAward",
    "not-authorized": "Errors.NotAuthorized",
    "not-found": "Errors.NotFound",
    "action-pending": "Errors.ActionPending"
  };
  return new Error(localize(keyByCode[code] ?? "Errors.Generic", data));
}

async function requestAuthority(action, payload = {}) {
  const primaryGM = activePrimaryGM();
  if (game.user.isGM && primaryGM?.id === game.user.id) {
    return enqueueAuthorityAction({
      type: "request",
      action,
      payload,
      requestId: foundry.utils.randomID(),
      requesterUserId: game.user.id
    });
  }

  if (!primaryGM) throw errorFromCode("no-gm");

  const requestId = foundry.utils.randomID();
  const request = {
    type: "request",
    action,
    payload,
    requestId,
    requesterUserId: game.user.id
  };

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(errorFromCode("no-gm"));
    }, 10000);

    pendingRequests.set(requestId, { resolve, reject, timeoutId });
    game.socket.emit(SOCKET_CHANNEL, request);
  });
}

function enqueueAuthorityAction(request) {
  authorityQueue = authorityQueue
    .catch(() => undefined)
    .then(() => handleAuthorityAction(request));
  return authorityQueue;
}

async function onSocketMessage(message) {
  if (!message || typeof message !== "object") return;

  if (message.type === "response" && message.recipientUserId === game.user.id) {
    const pending = pendingRequests.get(message.requestId);
    if (!pending) return;

    window.clearTimeout(pending.timeoutId);
    pendingRequests.delete(message.requestId);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(message.error || localize("Errors.Generic")));
    return;
  }

  const primaryGM = activePrimaryGM();
  if (message.type !== "request" || !game.user.isGM || primaryGM?.id !== game.user.id) return;

  try {
    const result = await enqueueAuthorityAction(message);
    game.socket.emit(SOCKET_CHANNEL, {
      type: "response",
      requestId: message.requestId,
      recipientUserId: message.requesterUserId,
      ok: true,
      result
    });
  } catch (error) {
    console.error(`${MODULE_TITLE} | Authority request failed`, error);
    game.socket.emit(SOCKET_CHANNEL, {
      type: "response",
      requestId: message.requestId,
      recipientUserId: message.requesterUserId,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function handleAuthorityAction(request) {
  const requester = getUser(request.requesterUserId);
  if (!requester) throw errorFromCode("not-found");

  switch (request.action) {
    case "spend-on-roll":
      return spendOnRoll({
        requester,
        messageId: request.payload.messageId,
        rollIndex: request.payload.rollIndex,
        requestedBonus: request.payload.bonus
      });

    case "grant-award":
      if (!requester.isGM) throw errorFromCode("not-authorized");
      return grantAward({
        requester,
        targetUserId: request.payload.targetUserId,
        reason: request.payload.reason
      });

    case "grant-punctual-all":
      if (!requester.isGM) throw errorFromCode("not-authorized");
      return grantPunctualToAll({ requester });

    case "revoke-award":
      if (!requester.isGM) throw errorFromCode("not-authorized");
      return revokeAward({
        targetUserId: request.payload.targetUserId,
        claimId: request.payload.claimId
      });

    case "redeem-award":
      if (requester.isGM) throw errorFromCode("not-authorized");
      return redeemAward({
        requester,
        claimId: request.payload.claimId,
        rollData: request.payload.roll
      });

    case "set-points":
      if (!requester.isGM) throw errorFromCode("not-authorized");
      return setPoints({
        targetUserId: request.payload.targetUserId,
        points: request.payload.points,
        announce: true
      });

    default:
      throw errorFromCode("not-found");
  }
}

function getRollType(message, roll) {
  // A single D&D5e activity card can contain both attack and damage rolls. Its
  // message-level flags describe the card, not necessarily every contained roll.
  const perRollType = roll?.options?.rollType
    ?? roll?.options?.type
    ?? roll?.options?.dnd5e?.rollType
    ?? roll?.options?.dnd5e?.type;
  if (perRollType !== undefined && perRollType !== null && perRollType !== "") {
    return String(perRollType).toLowerCase();
  }

  return String(message?.flags?.dnd5e?.roll?.type ?? "").toLowerCase();
}

function isAttackRoll(message, roll) {
  return getRollType(message, roll) === "attack";
}

function isEligibleD20Roll(message, roll) {
  if (!roll || activeD20Result(roll) === null) return false;
  return !INELIGIBLE_ROLL_TYPES.has(getRollType(message, roll));
}

function canUserSeeRoll(message, user) {
  if (!message || !user || message.blind) return false;
  const recipients = Array.isArray(message.whisper) ? message.whisper : [];
  return recipients.length === 0 || recipients.some((recipient) => (
    (typeof recipient === "object" ? recipient?.id : recipient) === user.id
  ));
}

function resolveRollTargetUser(message) {
  const flaggedUserId = message?.getFlag(MODULE_ID, "targetUserId");
  const flaggedUser = getUser(flaggedUserId);
  if (flaggedUser && !flaggedUser.isGM) return flaggedUser;

  const author = userFromReference(message?.author)
    ?? userFromReference(message?.user)
    ?? userFromReference(message?._source?.author)
    ?? userFromReference(message?._source?.user);
  if (author && !author.isGM) return author;

  const actor = message?.speakerActor
    ?? (message?.speaker?.actor ? game.actors.get(message.speaker.actor) : null);
  if (!actor) return null;

  const assignedPlayers = playerUsers().filter((user) => (
    user.character?.id === actor.id || user.character === actor
  ));
  if (assignedPlayers.length === 1) return assignedPlayers[0];

  const owners = playerUsers().filter((user) => actor.testUserPermission(user, "OWNER"));
  const activeOwners = owners.filter((user) => user.active);
  if (activeOwners.length === 1) return activeOwners[0];
  if (owners.length === 1) return owners[0];
  return null;
}

function cloneEvaluatedTerm(term) {
  return term.constructor.fromData(term.toJSON());
}

function addBonusToRoll(roll, bonus) {
  const options = foundry.utils.deepClone(roll.options ?? {});
  options[MODULE_ID] = {
    ...(options[MODULE_ID] ?? {}),
    originalD20: activeD20Result(roll)
  };

  try {
    const terms = roll.terms.map(cloneEvaluatedTerm);
    terms.push(new foundry.dice.terms.OperatorTerm({ operator: "+" }));
    terms.push(new foundry.dice.terms.NumericTerm({
      number: bonus,
      options: { flavor: localize("Roll.Flavor") }
    }));

    const adjusted = roll.constructor.fromTerms(terms, options).evaluateSync({ strict: true });
    // Never accept an accidental reroll of the original d20 during term
    // reconstruction; the already-visible roll must stay immutable.
    if (Number(adjusted.total) !== Number(roll.total) + bonus
      || activeD20Result(adjusted) !== activeD20Result(roll)) {
      throw new Error("Reconstructing the roll changed its original result");
    }
    return adjusted;
  } catch (error) {
    console.warn(`${MODULE_TITLE} | Falling back to a deterministic adjusted roll`, error);
    const adjusted = new Roll(
      `${Number(roll.total)} + ${bonus}[${localize("Roll.Flavor")}]`,
      {},
      options
    );
    return adjusted.evaluateSync({ strict: true });
  }
}

async function spendOnRoll({ requester, messageId, rollIndex, requestedBonus }) {
  if (requester.isGM) throw errorFromCode("not-authorized");

  const message = game.messages.get(String(messageId ?? ""));
  const index = Number(rollIndex);
  const roll = Number.isSafeInteger(index) && index >= 0 ? message?.rolls?.[index] : null;
  if (!message || !roll || !isEligibleD20Roll(message, roll)
    || !canUserSeeRoll(message, requester)) {
    throw errorFromCode("invalid-roll");
  }

  const target = resolveRollTargetUser(message);
  if (!target || target.isGM) throw errorFromCode("invalid-target");
  if (isAttackRoll(message, roll) && isNaturalOneAttack(roll)) throw errorFromCode("natural-one");

  if (!Number.isSafeInteger(requestedBonus) || requestedBonus < 1) {
    throw errorFromCode("invalid-roll");
  }

  const applications = getApplications(message);
  const currentBonus = appliedBonusTotal(applications, index);
  const validation = evaluateSpend({
    sourceUserId: requester.id,
    targetUserId: target.id,
    points: getPoints(requester),
    appliedBonus: currentBonus,
    requestedBonus
  });

  if (!validation.ok) {
    throw errorFromCode(validation.code, { maximum: validation.maximumBonus });
  }

  const beforeTotal = Number(roll.total);
  const adjustedRoll = addBonusToRoll(roll, validation.bonus);
  const applicationEntry = {
    id: foundry.utils.randomID(),
    sourceUserId: requester.id,
    targetUserId: target.id,
    rollIndex: index,
    bonus: validation.bonus,
    cost: validation.cost,
    kind: validation.kind,
    appliedAt: Date.now()
  };

  const originalTotals = foundry.utils.deepClone(message.getFlag(MODULE_ID, "originalTotals") ?? {});
  if (!Number.isFinite(Number(originalTotals[index]))) originalTotals[index] = beforeTotal;

  await updateUserFlags(requester, { points: validation.remainingPoints });
  try {
    const updatedRolls = message.rolls.map((candidate, candidateIndex) => (
      candidateIndex === index ? adjustedRoll : candidate
    ));

    await message.update({
      rolls: updatedRolls.map((candidate) => candidate.toJSON()),
      [`flags.${MODULE_ID}.applications`]: [...applications, applicationEntry],
      [`flags.${MODULE_ID}.originalTotals`]: originalTotals,
      [`flags.${MODULE_ID}.targetUserId`]: target.id
    });
  } catch (error) {
    try {
      // Refund the committed debit without overwriting other updates made while
      // the chat document was being saved.
      await updateUserFlags(requester, {
        points: Math.min(LIMITS.maxPoints, getPoints(requester) + validation.cost)
      });
    } catch (refundError) {
      console.error(`${MODULE_TITLE} | Automatic refund failed`, refundError);
    }
    throw error;
  }

  // Notifications and third-party callbacks are not part of the committed spend:
  // an integration error must never be reported as a failed debit or roll update.
  if (game.settings.get(MODULE_ID, "announceChanges")) {
    try {
      const key = validation.kind === "self" ? "Chat.AppliedSelf" : "Chat.AppliedAlly";
      await postModuleMessage(localize(key, {
        source: escapeHTML(requester.name),
        target: escapeHTML(target.name),
        bonus: validation.bonus,
        cost: validation.cost,
        before: beforeTotal,
        after: Number(adjustedRoll.total)
      }));
    } catch (error) {
      console.warn(`${MODULE_TITLE} | Spend announcement failed`, error);
    }
  }

  try {
    Hooks.callAll("luckPointsApplied", {
    message,
    rollIndex: index,
    sourceUser: requester,
    targetUser: target,
    bonus: validation.bonus,
    cost: validation.cost,
    kind: validation.kind,
    previousTotal: beforeTotal,
    total: Number(adjustedRoll.total)
    });
  } catch (error) {
    console.warn(`${MODULE_TITLE} | Post-spend integration hook failed`, error);
  }

  return {
    bonus: validation.bonus,
    cost: validation.cost,
    kind: validation.kind,
    previousTotal: beforeTotal,
    total: Number(adjustedRoll.total),
    points: validation.remainingPoints
  };
}

function createClaim({ requester, target, reason }) {
  return {
    id: foundry.utils.randomID(),
    reason: AWARD_REASONS.includes(reason) ? reason : "extra",
    grantedByUserId: requester.id,
    grantedAt: Date.now()
  };
}

async function grantAward({ requester, targetUserId, reason }) {
  const target = getUser(targetUserId);
  if (!target || target.isGM) throw errorFromCode("invalid-target");

  const claim = createClaim({ requester, target, reason });
  await updateUserFlags(target, { claims: [...getClaims(target), claim] });

  if (game.settings.get(MODULE_ID, "announceChanges")) {
    await postModuleMessage(localize("Chat.AwardGranted", {
      target: escapeHTML(target.name),
      reason: localize(`Reasons.${claim.reason}`)
    }));
  }

  return claim;
}

async function grantPunctualToAll({ requester }) {
  const targets = playerUsers();
  for (const target of targets) {
    const claim = createClaim({ requester, target, reason: "punctual" });
    await updateUserFlags(target, { claims: [...getClaims(target), claim] });
  }

  if (targets.length && game.settings.get(MODULE_ID, "announceChanges")) {
    await postModuleMessage(localize("Chat.PunctualAllGranted", { count: targets.length }));
  }

  return { count: targets.length };
}

async function revokeAward({ targetUserId, claimId }) {
  const target = getUser(targetUserId);
  if (!target || target.isGM) throw errorFromCode("invalid-target");

  const claims = getClaims(target);
  const claim = claims.find((candidate) => candidate.id === String(claimId));
  if (!claim) throw errorFromCode("not-found");

  await updateUserFlags(target, {
    claims: claims.filter((candidate) => candidate.id !== claim.id)
  });
  return claim;
}

function validateAwardRoll(rollData) {
  let roll;
  try {
    roll = Roll.fromData(rollData);
  } catch {
    throw errorFromCode("invalid-award");
  }

  const d4s = roll.dice.filter((die) => Number(die.faces) === 4 && Number(die.number) === 1);
  const total = Number(roll.total);
  if (roll.dice.length !== 1 || d4s.length !== 1 || !Number.isInteger(total) || total < 1 || total > 4) {
    throw errorFromCode("invalid-award");
  }
  return { roll, total };
}

async function redeemAward({ requester, claimId, rollData }) {
  const claims = getClaims(requester);
  const claim = claims.find((candidate) => candidate.id === String(claimId));
  if (!claim) throw errorFromCode("not-found");

  const { total: rolled } = validateAwardRoll(rollData);
  const before = getPoints(requester);
  const after = Math.min(LIMITS.maxPoints, before + rolled);
  const applied = after - before;

  await updateUserFlags(requester, {
    claims: claims.filter((candidate) => candidate.id !== claim.id),
    points: after
  });

  return {
    reason: claim.reason,
    rolled,
    applied,
    total: after
  };
}

async function redeemClaim(claimId) {
  const claim = getClaims(game.user).find((candidate) => candidate.id === String(claimId));
  if (!claim) throw errorFromCode("not-found");

  const roll = await new Roll("1d4").evaluate();
  const result = await requestAuthority("redeem-award", {
    claimId: claim.id,
    roll: roll.toJSON()
  });

  await roll.toMessage({
    speaker: { alias: game.user.name },
    flavor: localize("Chat.AwardRolled", {
      target: escapeHTML(game.user.name),
      reason: localize(`Reasons.${result.reason}`),
      rolled: result.rolled,
      applied: result.applied,
      total: result.total
    })
  });

  return result;
}

async function setPoints({ targetUserId, points, announce = false }) {
  const target = getUser(targetUserId);
  if (!target || target.isGM) throw errorFromCode("invalid-target");

  const normalized = normalizePoints(points);
  await updateUserFlags(target, { points: normalized });
  if (announce && game.settings.get(MODULE_ID, "announceChanges")) {
    await postModuleMessage(localize("Chat.SetPoints", {
      target: escapeHTML(target.name),
      total: normalized
    }));
  }
  return normalized;
}

async function postModuleMessage(content) {
  return ChatMessage.create({
    speaker: { alias: MODULE_TITLE },
    content: `<div class="luck-points-chat"><i class="fa-solid fa-clover" aria-hidden="true"></i> ${content}</div>`
  });
}

function maximumSpendForCurrentUser(message, rollIndex) {
  const roll = message?.rolls?.[rollIndex];
  const target = resolveRollTargetUser(message);
  if (!roll || !target || game.user.isGM || !isEligibleD20Roll(message, roll)
    || !canUserSeeRoll(message, game.user)) return null;
  if (isAttackRoll(message, roll) && isNaturalOneAttack(roll)) {
    return { target, kind: game.user.id === target.id ? "self" : "ally", ratio: 1, maximum: 0, naturalOne: true };
  }

  const kind = game.user.id === target.id ? "self" : "ally";
  const ratio = kind === "self" ? 1 : LIMITS.allyCostRatio;
  const capacity = rollCapacity(getApplications(message), rollIndex);
  const maximum = Math.min(capacity, Math.floor(getPoints(game.user) / ratio));
  return { target, kind, ratio, maximum, naturalOne: false };
}

async function promptSpendOnRoll(messageId, rollIndex) {
  const pendingKey = `${game.user.id}:${messageId}:${rollIndex}`;
  if (pendingSpendRequests.has(pendingKey)) throw errorFromCode("action-pending");
  pendingSpendRequests.add(pendingKey);

  try {
    const message = game.messages.get(messageId);
    const spend = maximumSpendForCurrentUser(message, rollIndex);
    if (!spend || spend.maximum < 1) {
      throw errorFromCode(spend?.naturalOne ? "natural-one" : "insufficient-points");
    }

    const bonus = await DialogV2.prompt({
      window: { title: localize(spend.kind === "self" ? "SpendDialog.SelfTitle" : "SpendDialog.AllyTitle") },
      content: `
        <div class="luck-points-dialog">
          <p>${localize(spend.kind === "self" ? "SpendDialog.SelfHint" : "SpendDialog.AllyHint", {
            target: escapeHTML(spend.target.name),
            ratio: spend.ratio,
            maximum: spend.maximum
          })}</p>
          <label>
            <span>${localize("Fields.Bonus")}</span>
            <input name="bonus" type="number" min="1" max="${spend.maximum}" step="1" value="1" autofocus>
          </label>
        </div>
      `,
      rejectClose: false,
      modal: true,
      ok: {
        label: localize("Actions.Apply"),
        icon: "fa-solid fa-clover",
        callback: (event, button) => clampInteger(
          button.form.elements.bonus.valueAsNumber,
          1,
          spend.maximum
        )
      }
    });

    if (!bonus) return null;
    const result = await requestAuthority("spend-on-roll", { messageId, rollIndex, bonus });
    ui.notifications.info(localize("Notifications.Applied", {
      bonus: result.bonus,
      cost: result.cost,
      total: result.total
    }));
    return result;
  } finally {
    pendingSpendRequests.delete(pendingKey);
  }
}

function renderRollApplications(message, rollIndex) {
  const applications = getApplications(message).filter((entry) => entry.rollIndex === rollIndex);
  if (!applications.length) return "";

  const totalBonus = appliedBonusTotal(applications, rollIndex);
  const originalTotals = message.getFlag(MODULE_ID, "originalTotals") ?? {};
  const original = Number(originalTotals[rollIndex]);
  const current = Number(message.rolls?.[rollIndex]?.total);
  const resultText = Number.isFinite(original) && Number.isFinite(current)
    ? localize("ChatControl.Result", { original, current })
    : "";
  const contributors = applications.map((entry) => {
    const source = getUser(entry.sourceUserId);
    return localize("ChatControl.Contribution", {
      source: escapeHTML(source?.name ?? localize("Common.Unknown")),
      bonus: entry.bonus,
      cost: entry.cost
    });
  }).join(" · ");

  return `
    <div class="luck-points-roll-summary">
      <strong><i class="fa-solid fa-clover" aria-hidden="true"></i> +${totalBonus}</strong>
      <span>${resultText}</span>
      <small>${contributors}</small>
    </div>
  `;
}

function renderLuckControls(message, html) {
  if (!message?.isContentVisible || !message.rolls?.length || !html?.querySelector) return;

  // Do not correlate `.dice-roll` DOM elements to message.rolls indices. D&D5e
  // activity cards and other modules can embed extra dice widgets, or render a
  // failed attack with a different card template. Always mount in the stable
  // message content container, and retain the original roll index in our UI.
  const host = html.querySelector(".message-content")
    ?? (html.matches?.(".message-content") ? html : null)
    ?? html.querySelector(".dice-roll")
    ?? html;
  if (!host?.append) return;

  let group = host.querySelector?.(".luck-points-chat-controls");
  if (!group) {
    // Core's early hook can run before D&D5e has built its final card body.
    // Move an existing group into the final container rather than duplicating it.
    group = html.querySelector(".luck-points-chat-controls");
    if (!group) {
      group = document.createElement("div");
      group.className = "luck-points-chat-controls";
    }
    host.append(group);
  }
  // Recompute balances and contribution history on every render pass. Reusing
  // old controls would leave stale limits after a point or roll update.
  group.replaceChildren();

  for (const [rollIndex, roll] of message.rolls.entries()) {
    if (!isEligibleD20Roll(message, roll)) continue;

    const controls = document.createElement("div");
    controls.className = "luck-points-roll-controls";
    controls.dataset.rollIndex = String(rollIndex);
    controls.innerHTML = renderRollApplications(message, rollIndex);

    const spend = maximumSpendForCurrentUser(message, rollIndex);
    if (spend?.naturalOne) {
      const notice = document.createElement("p");
      notice.className = "luck-points-natural-one";
      notice.innerHTML = `<i class="fa-solid fa-ban" aria-hidden="true"></i> ${localize("ChatControl.NaturalOne")}`;
      controls.append(notice);
    } else if (spend && spend.maximum > 0) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "luck-points-spend-button";
      button.innerHTML = `<i class="fa-solid fa-clover" aria-hidden="true"></i> ${localize(
        spend.kind === "self" ? "ChatControl.SpendSelf" : "ChatControl.SpendAlly",
        { maximum: spend.maximum, target: escapeHTML(spend.target.name), ratio: spend.ratio }
      )}`;
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await promptSpendOnRoll(message.id, rollIndex);
        } catch (error) {
          notifyError(error);
        } finally {
          button.disabled = false;
        }
      });
      controls.append(button);
    }

    if (controls.childElementCount) group.append(controls);
  }

  if (!group.childElementCount) group.remove?.();
}

function normalizeLegacyPending(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      sourceUserId: String(entry.sourceUserId ?? ""),
      cost: clampInteger(entry.cost, 1, LIMITS.maxPoints)
    }))
    .filter((entry) => entry.sourceUserId);
}

async function migrateLegacyPreparedBonuses() {
  if (!game.user.isGM || activePrimaryGM()?.id !== game.user.id) return;
  const version = Number(game.settings.get(MODULE_ID, "dataVersion") ?? 0);
  if (version >= DATA_VERSION) return;

  const refunds = new Map();
  for (const target of playerUsers()) {
    const pending = normalizeLegacyPending(target.getFlag(MODULE_ID, "pending"));
    for (const entry of pending) {
      refunds.set(entry.sourceUserId, (refunds.get(entry.sourceUserId) ?? 0) + entry.cost);
    }
    await updateUserFlags(target, { pending: [], recent: [] });
  }

  let refunded = 0;
  for (const [sourceUserId, amount] of refunds) {
    const source = getUser(sourceUserId);
    if (!source) continue;
    const before = getPoints(source);
    const after = Math.min(LIMITS.maxPoints, before + amount);
    refunded += after - before;
    await updateUserFlags(source, { points: after });
  }

  await game.settings.set(MODULE_ID, "dataVersion", DATA_VERSION);
  if (refunded > 0) {
    ui.notifications.info(localize("Notifications.LegacyRefund", { points: refunded }));
  }
}

class LuckPointsApplication extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-application`,
    classes: [MODULE_ID],
    tag: "section",
    position: {
      width: 760,
      height: 760
    },
    window: {
      title: `${MODULE_ID}.Window.Title`,
      icon: "fa-solid fa-clover",
      resizable: true
    }
  };

  async _renderHTML() {
    const root = document.createElement("div");
    root.className = "luck-points-content";
    root.innerHTML = this.#renderContent();
    this.#attachListeners(root);
    return root;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  async close(options = {}) {
    if (application === this) application = null;
    return super.close(options);
  }

  #renderContent() {
    const user = game.user;
    const points = getPoints(user);
    const claims = user.isGM ? [] : getClaims(user);

    return `
      <header class="luck-points-hero">
        <div>
          <h1><i class="fa-solid fa-clover" aria-hidden="true"></i> ${localize("Window.Title")}</h1>
          <p>${localize("Window.Subtitle")}</p>
        </div>
        ${user.isGM ? "" : `
          <div class="luck-points-balance" aria-label="${localize("Window.CurrentPoints")}">
            <strong>${points}</strong><span>/${LIMITS.maxPoints}</span>
            <small>${localize("Window.Points")}</small>
          </div>
        `}
      </header>

      ${user.isGM ? "" : this.#renderClaims(claims)}

      <section class="luck-points-panel luck-points-usage">
        <h2><i class="fa-solid fa-dice-d20" aria-hidden="true"></i> ${localize("Usage.Title")}</h2>
        <p>${localize("Usage.Hint")}</p>
        <div class="luck-points-usage-grid">
          <div><strong>1:1</strong><span>${localize("Usage.Self")}</span></div>
          <div><strong>${LIMITS.allyCostRatio}:1</strong><span>${localize("Usage.Ally")}</span></div>
          <div><strong>+${LIMITS.maxBonusPerRoll}</strong><span>${localize("Usage.Maximum")}</span></div>
        </div>
      </section>

      <section class="luck-points-panel luck-points-rules">
        <h2>${localize("Rules.Title")}</h2>
        <ul>
          <li>${localize("Rules.Maximum", { maximum: LIMITS.maxPoints })}</li>
          <li>${localize("Rules.PlayerRolls")}</li>
          <li>${localize("Rules.PostRoll")}</li>
          <li>${localize("Rules.PerRoll", { maximum: LIMITS.maxBonusPerRoll })}</li>
          <li>${localize("Rules.AllyRatio", { ratio: LIMITS.allyCostRatio })}</li>
          <li>${localize("Rules.NaturalOne")}</li>
          <li>${localize("Rules.Eligible")}</li>
        </ul>
      </section>

      ${user.isGM ? this.#renderGMPanel() : ""}
    `;
  }

  #renderClaims(claims) {
    return `
      <section class="luck-points-panel">
        <div class="luck-points-section-heading">
          <div>
            <h2><i class="fa-solid fa-dice-d4" aria-hidden="true"></i> ${localize("Claims.Title")}</h2>
            <p>${localize("Claims.Hint", { count: claims.length })}</p>
          </div>
          <button type="button" class="icon" data-action="refresh" title="${localize("Actions.Refresh")}" aria-label="${localize("Actions.Refresh")}">
            <i class="fa-solid fa-rotate" aria-hidden="true"></i>
          </button>
        </div>
        ${claims.length ? `
          <ol class="luck-points-claim-list">
            ${claims.map((claim) => `
              <li>
                <div>
                  <strong>${localize(`ReasonShort.${claim.reason}`)}</strong>
                  <span>${localize(`Reasons.${claim.reason}`)}</span>
                </div>
                <button type="button" data-action="redeem-award" data-claim-id="${claim.id}">
                  <i class="fa-solid fa-dice-d4" aria-hidden="true"></i> ${localize("Actions.RollD4")}
                </button>
              </li>
            `).join("")}
          </ol>
        ` : `<div class="luck-points-empty"><i class="fa-regular fa-circle-check" aria-hidden="true"></i> ${localize("Claims.Empty")}</div>`}
      </section>
    `;
  }

  #renderGMClaims(player) {
    const claims = getClaims(player);
    if (!claims.length) return `<span class="luck-points-muted">0</span>`;

    return `
      <div class="luck-points-claim-chips">
        ${claims.map((claim) => `
          <span>
            ${localize(`ReasonShort.${claim.reason}`)}
            <button type="button" class="icon danger" data-action="revoke-award" data-user-id="${player.id}" data-claim-id="${claim.id}" title="${localize("Actions.Revoke")}" aria-label="${localize("Actions.Revoke")}">
              <i class="fa-solid fa-xmark" aria-hidden="true"></i>
            </button>
          </span>
        `).join("")}
      </div>
    `;
  }

  #renderGMPanel() {
    const users = playerUsers();
    return `
      <section class="luck-points-panel luck-points-gm">
        <div class="luck-points-section-heading">
          <div>
            <h2><i class="fa-solid fa-user-shield" aria-hidden="true"></i> ${localize("GM.Title")}</h2>
            <p>${localize("GM.Hint")}</p>
          </div>
          <button type="button" data-action="grant-punctual-all" ${users.length ? "" : "disabled"}>
            <i class="fa-solid fa-users" aria-hidden="true"></i> ${localize("Actions.AllPunctual")}
          </button>
        </div>
        ${users.length ? `
          <div class="luck-points-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>${localize("GM.Player")}</th>
                  <th>${localize("GM.Points")}</th>
                  <th>${localize("GM.OpenRolls")}</th>
                  <th>${localize("GM.Grant")}</th>
                </tr>
              </thead>
              <tbody>
                ${users.map((player) => `
                  <tr>
                    <td><span class="luck-points-status ${player.active ? "active" : ""}"></span>${escapeHTML(player.name)}</td>
                    <td>
                      <div class="luck-points-setter">
                        <input type="number" min="0" max="${LIMITS.maxPoints}" value="${getPoints(player)}" data-gm-points="${player.id}">
                        <button type="button" class="icon" data-action="set-points" data-user-id="${player.id}" title="${localize("Actions.Set")}" aria-label="${localize("Actions.Set")}">
                          <i class="fa-solid fa-check" aria-hidden="true"></i>
                        </button>
                      </div>
                    </td>
                    <td>${this.#renderGMClaims(player)}</td>
                    <td>
                      <div class="luck-points-awards">
                        ${AWARD_REASONS.map((reason) => `
                          <button type="button" data-action="grant-award" data-user-id="${player.id}" data-reason="${reason}" title="${localize(`Reasons.${reason}`)}">
                            <i class="fa-solid fa-plus" aria-hidden="true"></i> ${localize(`ReasonShort.${reason}`)}
                          </button>
                        `).join("")}
                      </div>
                    </td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        ` : `<div class="luck-points-empty">${localize("GM.NoPlayers")}</div>`}
      </section>
    `;
  }

  #attachListeners(root) {
    root.querySelector('[data-action="refresh"]')?.addEventListener("click", () => this.render());

    for (const button of root.querySelectorAll('[data-action="redeem-award"]')) {
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await redeemClaim(button.dataset.claimId);
          this.render();
        } catch (error) {
          notifyError(error);
          button.disabled = false;
        }
      });
    }

    for (const button of root.querySelectorAll('[data-action="grant-award"]')) {
      button.addEventListener("click", async () => {
        try {
          await requestAuthority("grant-award", {
            targetUserId: button.dataset.userId,
            reason: button.dataset.reason
          });
          ui.notifications.info(localize("Notifications.AwardGranted"));
          this.render();
        } catch (error) {
          notifyError(error);
        }
      });
    }

    root.querySelector('[data-action="grant-punctual-all"]')?.addEventListener("click", async () => {
      try {
        const result = await requestAuthority("grant-punctual-all");
        ui.notifications.info(localize("Notifications.PunctualAllGranted", { count: result.count }));
        this.render();
      } catch (error) {
        notifyError(error);
      }
    });

    for (const button of root.querySelectorAll('[data-action="revoke-award"]')) {
      button.addEventListener("click", async () => {
        try {
          await requestAuthority("revoke-award", {
            targetUserId: button.dataset.userId,
            claimId: button.dataset.claimId
          });
          this.render();
        } catch (error) {
          notifyError(error);
        }
      });
    }

    for (const button of root.querySelectorAll('[data-action="set-points"]')) {
      button.addEventListener("click", async () => {
        try {
          const input = root.querySelector(`[data-gm-points="${CSS.escape(button.dataset.userId)}"]`);
          await requestAuthority("set-points", {
            targetUserId: button.dataset.userId,
            points: input?.value
          });
          this.render();
        } catch (error) {
          notifyError(error);
        }
      });
    }
  }
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "showSceneControl", {
    name: `${MODULE_ID}.Settings.ShowSceneControl.Name`,
    hint: `${MODULE_ID}.Settings.ShowSceneControl.Hint`,
    scope: "world",
    config: true,
    restricted: true,
    type: Boolean,
    default: true,
    onChange: () => ui.controls?.render()
  });

  game.settings.register(MODULE_ID, "announceChanges", {
    name: `${MODULE_ID}.Settings.AnnounceChanges.Name`,
    hint: `${MODULE_ID}.Settings.AnnounceChanges.Hint`,
    scope: "world",
    config: true,
    restricted: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "dataVersion", {
    scope: "world",
    config: false,
    restricted: true,
    type: Number,
    default: 0
  });

  game.settings.registerMenu(MODULE_ID, "open", {
    name: `${MODULE_ID}.Settings.Open.Name`,
    label: `${MODULE_ID}.Settings.Open.Label`,
    hint: `${MODULE_ID}.Settings.Open.Hint`,
    icon: "fa-solid fa-clover",
    type: LuckPointsApplication,
    restricted: false
  });

  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.settings.get(MODULE_ID, "showSceneControl")) return;
    const tokenControls = controls.tokens;
    if (!tokenControls?.tools) return;

    tokenControls.tools[MODULE_ID] = {
      name: MODULE_ID,
      title: `${MODULE_ID}.SceneControl.Title`,
      icon: "fa-solid fa-clover",
      order: Object.keys(tokenControls.tools).length,
      button: true,
      visible: true,
      onChange: () => openApplication()
    };
  });

  // D&D5e 5.3.3 adjusts the HTML after core's renderChatMessageHTML hook.
  // The later system hook is necessary for activity/failed-attack cards. Both
  // routes are idempotent, so they can safely run on the same element.
  Hooks.on("renderChatMessageHTML", renderLuckControls);
  Hooks.on("dnd5e.renderChatMessage", renderLuckControls);
});

Hooks.once("ready", async () => {
  game.socket.on(SOCKET_CHANNEL, onSocketMessage);

  if (game.system.id !== "dnd5e") {
    ui.notifications.error(localize("Errors.WrongSystem"), { permanent: true });
  }

  game.luckPoints = Object.freeze({
    open: openApplication,
    getPoints: (userId = game.user.id) => getPoints(getUser(userId)),
    getPendingAwards: (userId = game.user.id) => getClaims(getUser(userId)),
    spendOnRoll: (messageId, rollIndex = 0, bonus = 1) => requestAuthority("spend-on-roll", {
      messageId,
      rollIndex,
      bonus
    }),
    grantAward: (targetUserId, reason = "extra") => requestAuthority("grant-award", {
      targetUserId,
      reason
    }),
    grantPunctualToAll: () => requestAuthority("grant-punctual-all"),
    redeemAward: redeemClaim,
    setPoints: (targetUserId, points) => requestAuthority("set-points", { targetUserId, points })
  });

  await migrateLegacyPreparedBonuses();
});

Hooks.on("updateUser", (user, changes) => {
  if (!hasModuleFlagChange(changes)) return;
  refreshApplication();
  if (user.id === game.user.id) scheduleChatRefresh();
});

Hooks.on("updateChatMessage", (message, changes) => {
  if (hasModuleFlagChange(changes) || Object.hasOwn(changes, "rolls")) {
    refreshApplication();
    scheduleChatRefresh();
  }
});

Hooks.on("userConnected", () => refreshApplication());
