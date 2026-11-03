# Runyth Luck Points

**Version 1.1.3** — Foundry VTT v13, D&D Fifth Edition 5.0.0–5.3.3

Luck Points manages a personal player resource earned through self-rolled 1d4 rewards and spent after a visible d20 result.

## Rules

- Each player can hold at most 20 luck points.
- The Game Master grants one pending 1d4 claim for each earned reason.
- The affected player rolls that 1d4 themselves; the result is added to the player's total.
- Luck points are spent only after the visible d20 result.
- Own roll: 1 luck point grants +1.
- Ally's roll: 2 of the supporting player's luck points grant the ally +1.
- The combined luck bonus on one roll is limited to +10.
- A natural 1 on an attack remains an automatic failure and cannot be improved.
- Supported rolls include attacks, ability checks, skill checks, tool checks, and saving throws, including concentration and death saves.

## Example: first session with five players

1. All five players begin with 0 luck points and arrive on time.
2. The Game Master selects **Grant punctuality to all**. Each player receives one pending 1d4 claim.
3. Player 1 receives another claim for presenting the recap. Player 2 receives another claim for writing the session log.
4. Players 1 and 2 therefore roll 1d4 twice. Players 3–5 each roll 1d4 once.
5. Player 1 later rolls a total of 10 on an attack. Below the chat roll, Player 1 selects **Spend luck points**, enters +4, and pays 4 points. The stored roll total changes from 10 to 14.

## Usage

### Game Master

1. Open the clover button in the Token scene controls.
2. Grant one 1d4 claim per player and qualifying reason:
   - arriving on time
   - presenting a recap
   - writing a session log
   - an additional activity chosen by the Game Master
3. Grant punctuality to the whole group with one action when appropriate.
4. Revoke pending claims before they are rolled when necessary.
5. Correct point totals directly when necessary.

### Players

1. Open the Luck Points window.
2. Roll each pending claim through **Roll 1d4 yourself**.
3. Make a normal d20 roll.
4. Use the button directly below the chat roll.
5. Choose the desired bonus. The module deducts the cost and updates the stored total of the existing chat roll.

Every other non-GM player who can see the eligible d20 result and has enough Luck Points receives a support button on that chat card. Supporting another player's roll costs 2 of the supporting player's own Luck Points per +1. The points are deducted automatically after the active Game Master validates the request. All contributions share the same +10 cap.

## Localization

Luck Points uses Foundry VTT's standard package localization system:

- English is the default source language in `lang/en.json`.
- German is provided as a separate translation in `lang/de.json`.
- The module follows the language selected by each Foundry client through **Configure Settings → Core Settings → Language**.
- There is no module-specific language switch because Foundry already supplies the global language interface.
- Additional translations can be added without changing module code. See [`docs/LOCALIZATION.md`](docs/LOCALIZATION.md).

The package title and package description remain English because Foundry package manifests do not provide localized variants for these metadata fields. All runtime interface text, settings, notifications, chat controls, and rules are localized through namespaced keys.

## Post-roll processing

The module uses Foundry VTT v13's core `renderChatMessageHTML` hook and Foundry's serialized roll data. Existing dice are not rerolled; the luck bonus is appended as a numeric roll term. The module uses both Foundry's core `renderChatMessageHTML` hook and the later D&D5e `dnd5e.renderChatMessage` hook. D&D5e 5.3.3 changes chat markup after core rendering, so the second hook restores Luck Point controls even when the system replaces an attack card's HTML. Control mounting is idempotent and does not assume any fixed relationship between `.dice-roll` elements and persisted rolls.

**Missed attacks:** A player or teammate can spend Luck Points on an attack even after the chat card initially shows a miss, provided the attack was not a natural 1. The original roll total is amended without rerolling the dice. D&D5e's display can recalculate target-based results from the revised total. If another rest-automation module has already resolved the hit, applied damage, or advanced the workflow, this module does not retroactively undo/re-run those side effects; the GM must adjudicate those outcomes or use a compatible integration listening for `luckPointsApplied`. No AC or target threshold is revealed by Luck Points itself.

## Public API

After the `ready` hook, `game.luckPoints` is available:

```javascript
// Open the Luck Points application.
game.luckPoints.open();

// Read one player's current points and pending reward claims.
game.luckPoints.getPoints(userId);
game.luckPoints.getPendingAwards(userId);

// Spend the current user's points on an existing chat roll.
await game.luckPoints.spendOnRoll(messageId, rollIndex, bonus);

// Game Master actions.
await game.luckPoints.grantAward(targetUserId, "recap");
await game.luckPoints.grantPunctualToAll();
await game.luckPoints.setPoints(targetUserId, 10);

// Redeem one of the current player's pending claim IDs.
await game.luckPoints.redeemAward(claimId);
```

A successful application also emits this hook:

```javascript
Hooks.on("luckPointsApplied", (data) => {
  console.log(data.message, data.rollIndex, data.bonus, data.total);
});
```

## Migration from 1.0.0

Version 1.0.0 deducted points while preparing the next roll. On the first start of version 1.1.0 or newer, the active primary Game Master automatically refunds unused prepared expenditures and removes the old queue.

## Installation

Extract the installation archive so this directory exists:

```text
<Data>/modules/runyth-luck-points/
```

Then enable **Luck Points** in the world's module management screen.

## Technical references

- [Foundry VTT: Languages and Localization](https://foundryvtt.com/article/localization/)
- [Foundry VTT v13 ApplicationV2](https://foundryvtt.com/api/v13/classes/foundry.applications.api.ApplicationV2.html)
- [Foundry VTT v13 DialogV2](https://foundryvtt.com/api/v13/classes/foundry.applications.api.DialogV2.html)
- [Foundry VTT v13 Roll API](https://foundryvtt.com/api/v13/classes/foundry.dice.Roll.html)
- [Foundry VTT v13 `renderChatMessageHTML` hook](https://foundryvtt.com/api/v13/functions/hookEvents.renderChatMessageHTML.html)
- [D&D Fifth Edition system repository](https://github.com/foundryvtt/dnd5e)

## Content licence

The Luck Points currency rules this module adds are house rules, not official D&D rules; they are homebrew gameplay content licensed **CC BY-SA 4.0**. The program source is **AGPL-3.0-or-later**; see the standard licence chapter below.

## Licence

Copyright © 2026  [Daniel Braniewski](https://brani.dev/)

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
