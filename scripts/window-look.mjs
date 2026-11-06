// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Daniel Braniewski. See the LICENSE file for rights and obligations.
import { applyUiLook, FLEET_UI_CLASS, windowClasses, WINDOW_MARKER } from "./ui-look.mjs";

const LUCK_WINDOW_CLASS_PATTERN = /^(runyth-luck-points|runyth-luck-points-spend-dialog)$/;

let hooksRegistered = false;

// Mount the module's window identity directly onto the rendered window
// element. This never depends on the host Foundry build forwarding the
// window `classes` option — that forwarding is not reliable across live
// builds, which left earlier fleet-look releases visually inert.
export function mountWindowIdentity(dialog, fallbackClasses = []) {
  const element = dialog?.element;
  if (!element) return false;

  const identity = dialog?.options?.classes ?? fallbackClasses;
  if (element.classList?.add) {
    for (const name of identity) element.classList.add(name);
  }
  element.setAttribute?.(WINDOW_MARKER, "");
  applyUiLook(element);
  return true;
}

// Registered on the module-level window render hooks. Runs for every
// rendered window, so the look also lands when the class-level render step
// is bypassed by the host build; stays inert for foreign windows.
export function syncRenderedWindow(window) {
  const element = window?.element;
  if (!element) return false;

  const classes = window?.options?.classes ?? [];
  const own = classes.some((name) => LUCK_WINDOW_CLASS_PATTERN.test(name)) || classes.includes(FLEET_UI_CLASS)
    || element.getAttribute?.(WINDOW_MARKER) === "";
  if (!own) return false;

  return mountWindowIdentity(window);
}

export function ensureWindowLookHooks() {
  if (hooksRegistered) return false;
  hooksRegistered = true;
  Hooks.on("renderDialogV2", syncRenderedWindow);
  Hooks.on("renderApplicationV2", syncRenderedWindow);
  return true;
}

export function applyFleetWindowClasses(windowOptions) {
  const classes = windowOptions?.classes ?? [];
  windowOptions.classes = windowClasses(classes.filter((name) => name !== FLEET_UI_CLASS));
  return windowOptions;
}
