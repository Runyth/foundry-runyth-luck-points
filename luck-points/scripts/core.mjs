export const LIMITS = Object.freeze({
  maxPoints: 20,
  maxBonusPerRoll: 10,
  allyCostRatio: 2
});

export const AWARD_REASONS = Object.freeze([
  "punctual",
  "recap",
  "log",
  "extra"
]);

export function clampInteger(value, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return minimum;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export function normalizePoints(value) {
  return clampInteger(value, 0, LIMITS.maxPoints);
}

export function normalizeClaims(value) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      id: String(entry.id ?? ""),
      reason: AWARD_REASONS.includes(entry.reason) ? entry.reason : "extra",
      grantedByUserId: String(entry.grantedByUserId ?? ""),
      grantedAt: Number.isFinite(Number(entry.grantedAt)) ? Number(entry.grantedAt) : Date.now()
    }))
    .filter((entry) => entry.id);
}

export function normalizeApplications(value) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      id: String(entry.id ?? ""),
      sourceUserId: String(entry.sourceUserId ?? ""),
      targetUserId: String(entry.targetUserId ?? ""),
      rollIndex: clampInteger(entry.rollIndex, 0, 99),
      bonus: clampInteger(entry.bonus, 1, LIMITS.maxBonusPerRoll),
      cost: clampInteger(entry.cost, 1, LIMITS.maxPoints),
      kind: entry.kind === "ally" ? "ally" : "self",
      appliedAt: Number.isFinite(Number(entry.appliedAt)) ? Number(entry.appliedAt) : Date.now()
    }))
    .filter((entry) => entry.id && entry.sourceUserId && entry.targetUserId);
}

export function appliedBonusTotal(entries, rollIndex = null) {
  return normalizeApplications(entries)
    .filter((entry) => rollIndex === null || entry.rollIndex === rollIndex)
    .reduce((sum, entry) => sum + entry.bonus, 0);
}

export function rollCapacity(entries, rollIndex = null) {
  return Math.max(0, LIMITS.maxBonusPerRoll - appliedBonusTotal(entries, rollIndex));
}

export function validateSpend({ points, appliedBonus = 0, requestedBonus, costRatio }) {
  const availablePoints = normalizePoints(points);
  const currentBonus = clampInteger(appliedBonus, 0, LIMITS.maxBonusPerRoll);
  const capacity = Math.max(0, LIMITS.maxBonusPerRoll - currentBonus);
  const ratio = clampInteger(costRatio, 1, LIMITS.allyCostRatio);
  const maximumAffordableBonus = Math.floor(availablePoints / ratio);
  const maximumBonus = Math.min(capacity, maximumAffordableBonus);
  const bonus = clampInteger(requestedBonus, 1, LIMITS.maxBonusPerRoll);

  if (capacity <= 0) {
    return { ok: false, code: "roll-full", maximumBonus: 0 };
  }
  if (maximumAffordableBonus <= 0) {
    return { ok: false, code: "insufficient-points", maximumBonus: 0 };
  }
  if (bonus > maximumBonus) {
    return { ok: false, code: "bonus-too-high", maximumBonus };
  }

  return {
    ok: true,
    bonus,
    cost: bonus * ratio,
    maximumBonus
  };
}

export function evaluateSpend({
  sourceUserId,
  targetUserId,
  points,
  appliedBonus = 0,
  requestedBonus
}) {
  const kind = String(sourceUserId) === String(targetUserId) ? "self" : "ally";
  const costRatio = kind === "self" ? 1 : LIMITS.allyCostRatio;
  const validation = validateSpend({ points, appliedBonus, requestedBonus, costRatio });

  if (!validation.ok) return { ...validation, kind, costRatio };

  return {
    ...validation,
    kind,
    costRatio,
    remainingPoints: normalizePoints(points) - validation.cost
  };
}

export function activeD20Result(roll) {
  const original = roll?.options?.["luck-points"]?.originalD20;
  if (original !== null && original !== undefined && original !== "") {
    const preserved = Number(original);
    if (Number.isInteger(preserved) && preserved >= 1 && preserved <= 20) return preserved;
  }

  const dice = [roll?.d20, ...(Array.isArray(roll?.dice) ? roll.dice : [])];
  for (const die of dice) {
    if (Number(die?.faces) !== 20 || !Array.isArray(die?.results)) continue;
    const active = die.results.find((result) => (
      result?.active !== false && !result?.discarded && Number.isInteger(Number(result?.result))
        && Number(result.result) >= 1 && Number(result.result) <= 20
    ));
    if (active) return Number(active.result);
  }
  return null;
}

export function isNaturalOneAttack(roll) {
  return activeD20Result(roll) === 1;
}
