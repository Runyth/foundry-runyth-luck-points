import assert from "node:assert/strict";
import test from "node:test";

import {
  LIMITS,
  activeD20Result,
  appliedBonusTotal,
  evaluateSpend,
  normalizeApplications,
  normalizeClaims,
  normalizePoints,
  rollCapacity,
  validateSpend
} from "../scripts/core.mjs";

test("point totals are clamped to the configured maximum", () => {
  assert.equal(normalizePoints(-5), 0);
  assert.equal(normalizePoints(12), 12);
  assert.equal(normalizePoints(999), LIMITS.maxPoints);
});

test("award claims retain only supported reasons and valid identifiers", () => {
  const claims = normalizeClaims([
    { id: "a", reason: "recap", grantedByUserId: "gm", grantedAt: 10 },
    { id: "b", reason: "unknown" },
    { id: "" },
    null
  ]);

  assert.deepEqual(claims, [
    { id: "a", reason: "recap", grantedByUserId: "gm", grantedAt: 10 },
    { id: "b", reason: "extra", grantedByUserId: "", grantedAt: claims[1].grantedAt }
  ]);
});

test("applications share the per-roll maximum", () => {
  const applications = normalizeApplications([
    {
      id: "a",
      sourceUserId: "u1",
      targetUserId: "u1",
      rollIndex: 0,
      bonus: 4,
      cost: 4
    },
    {
      id: "b",
      sourceUserId: "u2",
      targetUserId: "u1",
      rollIndex: 0,
      bonus: 3,
      cost: 6,
      kind: "ally"
    },
    {
      id: "c",
      sourceUserId: "u1",
      targetUserId: "u1",
      rollIndex: 1,
      bonus: 2,
      cost: 2
    }
  ]);

  assert.equal(appliedBonusTotal(applications, 0), 7);
  assert.equal(rollCapacity(applications, 0), 3);
  assert.equal(appliedBonusTotal(applications, 1), 2);
});

test("self spending costs one point per bonus", () => {
  const result = validateSpend({
    points: 8,
    appliedBonus: 0,
    requestedBonus: 5,
    costRatio: 1
  });

  assert.deepEqual(result, {
    ok: true,
    bonus: 5,
    cost: 5,
    maximumBonus: 8
  });
});

test("ally spending costs two points per bonus", () => {
  const result = validateSpend({
    points: 8,
    appliedBonus: 0,
    requestedBonus: 4,
    costRatio: 2
  });

  assert.equal(result.ok, true);
  assert.equal(result.cost, 8);
  assert.equal(result.maximumBonus, 4);
});

test("ally spending deducts the supporting player's points at the 2:1 ratio", () => {
  const result = evaluateSpend({
    sourceUserId: "supporter",
    targetUserId: "roller",
    points: 9,
    appliedBonus: 1,
    requestedBonus: 3
  });

  assert.deepEqual(result, {
    ok: true,
    bonus: 3,
    cost: 6,
    maximumBonus: 4,
    kind: "ally",
    costRatio: 2,
    remainingPoints: 3
  });
});

test("self spending remains 1:1 and deducts from the rolling player", () => {
  const result = evaluateSpend({
    sourceUserId: "roller",
    targetUserId: "roller",
    points: 9,
    appliedBonus: 0,
    requestedBonus: 4
  });

  assert.equal(result.ok, true);
  assert.equal(result.kind, "self");
  assert.equal(result.costRatio, 1);
  assert.equal(result.cost, 4);
  assert.equal(result.remainingPoints, 5);
});

test("spending validation enforces the shared +10 cap", () => {
  const result = validateSpend({
    points: 20,
    appliedBonus: 9,
    requestedBonus: 2,
    costRatio: 1
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "bonus-too-high");
  assert.equal(result.maximumBonus, 1);
});

test("active d20 result ignores discarded dice", () => {
  const roll = {
    dice: [{
      faces: 20,
      results: [
        { result: 1, active: false, discarded: true },
        { result: 14, active: true }
      ]
    }]
  };

  assert.equal(activeD20Result(roll), 14);
});

test("a preserved original d20 remains available after a deterministic fallback", () => {
  const roll = {
    options: {
      "runyth-luck-points": { originalD20: 7 }
    },
    dice: []
  };

  assert.equal(activeD20Result(roll), 7);
});
