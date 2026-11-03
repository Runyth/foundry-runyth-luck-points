# Changelog

## 1.1.4 - 2026-11-03

### Fixed and improved

- AGENTS.md conformance release: the manifest author carries the standard organisational URL, and the shipped house-rule content states its CC BY-SA 4.0 content licence in the README. No runtime behaviour relationship or dependency change.

## 1.1.3 — 2026-10-28

- First publication as a Runyth module: `runyth-luck-points` / **Runyth Luck Points** with the publication standard in place — deterministic `-mod`, `-src`, and `-doc` archives with per-version checksums, byte-identical rebuild verification, standard quality and release pipelines, the full GNU AGPL-3.0-or-later licence with the standard source notice, the standard README licence chapter, and the manifest URL surfaces.

### Fixed

- Restored the **post-D&D5e chat-render hook** alongside Foundry v13's core hook. D&D5e 5.3.3 performs additional HTML processing after core message rendering; controls now survive that late processing and any replacement of the card markup.
- Mounted Luck Point buttons in the message content area instead of matching `.dice-roll` DOM elements to serialized roll indices, which is unreliable on attack and mixed attack/damage cards.
- Classified roll types using per-roll metadata before message-wide flags, preventing an attack roll from being suppressed by a mixed card's metadata.
- Ensured previously failed (non-natural-1) attacks remain eligible for both self-spending and teammate assistance. Natural 1 attacks remain blocked.
- Re-rendered visible controls after changes to Luck Point chat messages, and recognized both nested and flattened module-flag updates.
- Checked the visibility of whispered/blind rolls before displaying or authorizing support.
- Rejected malformed bonus values and roll indices at the GM authority boundary; preserved the original d20 when reconstructing already-evaluated rolls.
- Improved debit rollback on failed chat-message writes. A failed optional announcement or third-party post-spend listener no longer misreports a committed spend as failed.

### Verified

- Multiple sequential contributions deduct points from the correct players (1:1 self, 2:1 ally), share the +10 cap, and persist on the original chat message.
- Tests cover failed attacks, mixed attack/damage chat cards, late D&D5e processing, natural 1, private rolls, limits, authority responses, and localization parity.
- No changes to existing stored points, claims, migrations, public API, or language files.

### Integration note

- Modifying a roll after an automation module has already resolved a hit does not retroactively rerun damage/effects or reverse automated workflow decisions. A GM or an integration listening to `luckPointsApplied` must handle such side effects.

## 1.1.2 — 2026-10-10

### Fixed

- Switched Luck Point chat controls to Foundry VTT v13's core `renderChatMessageHTML` hook so controls are attached reliably to D&D 5e chat messages and subsequent re-renders.
- Refreshes rendered chat cards when the local player's Luck Point flags change, preventing missing or stale ally-support buttons after awards, manual corrections, or expenditures.
- Hardened roll-owner resolution across Foundry v13 ChatMessage author/user representations, assigned characters, speaker actors, and actor ownership.
- Prevented overlapping spend dialogs and submissions for the same user and roll, reducing accidental double expenditure from rapid repeated clicks.
- Ally support buttons now show the `2:1` cost ratio directly in the chat card.

### Verified

- Ally contributions deduct the supporting player's own Luck Points at exactly 2 points per +1 bonus.
- Self contributions remain 1:1.
- All contributions continue to share the +10 per-roll cap and are serialized through the active primary Game Master.
- Natural 1 attack protection and existing reward, localization, migration, and administration behavior remain unchanged.
- Expanded automated regression coverage for contribution deductions, chat hook registration, and balance-driven chat refreshes.

## 1.1.1 — 2026-08-03

### Fixed

- Removed the hard-coded German package title, package description, and internal log label.
- Made English the explicit source/default language and first manifest language.
- Corrected the Game Master table header count and alignment.

### Changed

- Converted the default README and package metadata to English.
- Retained German as a fully modular translation in `lang/de.json` and added `README.de.md`.
- Documented Foundry's native language selection and the process for adding further translations.
- Added automated checks for English default metadata, language ordering, translation parity, and hard-coded German runtime strings.

## 1.1.0 — 2026-07-25

### Changed

- Replaced pre-roll preparation with spending after the visible d20 result.
- Changed earned rewards from Game-Master-rolled points to pending 1d4 claims rolled by the affected player.
- Added a batch action that grants punctuality to every player.
- Changed natural-1 handling: an attack natural 1 now prevents spending instead of refunding a prepared expenditure.
- Updated all player and Game Master instructions to match the clarified session workflow.

### Added

- Luck Point controls directly below eligible D&D 5e chat rolls.
- Persistent per-roll contribution history and original-to-adjusted result display.
- Ally contributions after the roll at the required 2:1 cost ratio.
- Revocation of unrolled reward claims.
- `luckPointsApplied` integration hook.
- Public API methods for post-roll spending and pending reward claims.
- Automatic refund migration for unused prepared bonuses from 1.0.0.

## 1.0.0 — 2026-07-25

- Initial release.
- Personal point totals with a maximum of 20.
- Pre-roll self and ally bonuses with a shared +10 cap.
- Game Master 1d4 awards and direct point correction.
