// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.

const MODULE_ID = "runyth-luck-points";
const SETTING_KEY = "stockFoundryLook";

export const FLEET_UI_CLASS = "runyth-luck-points-fleet-ui";

// Rendered Luck Points windows are marked with this attribute at render time
// so the fleet/class toggling reaches every mounted window even when the host
// Foundry build does not forward window `classes` options onto the element.
export const WINDOW_MARKER = "data-runyth-luck-points-window";

export function isStockFoundryLook() {
  try {
    return Boolean(globalThis.game?.settings?.get(MODULE_ID, SETTING_KEY));
  } catch {
    return false;
  }
}

export function applyUiLook(element, stock = isStockFoundryLook()) {
  element?.classList?.toggle(FLEET_UI_CLASS, !stock);
}

export function windowClasses(classes) {
  if (isStockFoundryLook()) return [...classes];
  return [...classes, FLEET_UI_CLASS];
}

const WINDOW_SELECTOR = [
  `[${WINDOW_MARKER}]`,
  ".runyth-luck-points",
  ".runyth-luck-points-spend-dialog"
].join(",");

export function syncOpenWindows() {
  const stock = isStockFoundryLook();
  const matches = globalThis.document?.querySelectorAll?.(WINDOW_SELECTOR) ?? [];
  for (const element of new Set(matches)) {
    applyUiLook(element, stock);
  }
  return stock;
}
