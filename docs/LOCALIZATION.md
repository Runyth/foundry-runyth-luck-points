# Localization guide

Luck Points uses Foundry VTT's standard module localization mechanism documented at:

- https://foundryvtt.com/article/localization/

## Existing languages

| Language | Code | File |
|---|---|---|
| English | `en` | `lang/en.json` |
| German | `de` | `lang/de.json` |

English is the source and fallback language for development. Every translation file must expose the same complete set of namespaced keys as `lang/en.json`.

## Add another language

1. Copy `lang/en.json` to a new file such as `lang/fr.json`.
2. Translate values only. Do not rename keys or placeholders such as `{target}`, `{count}`, or `{maximum}`.
3. Add the language to `module.json`:

```json
{
  "lang": "fr",
  "name": "Français",
  "path": "lang/fr.json"
}
```

4. Run `npm run check` from the source-package root.
5. Start Foundry, select the language in **Configure Settings → Core Settings → Language**, and reload when Foundry requests it.

## Rules

- All module-owned keys use the `luck-points.` namespace.
- Runtime interface text must use `game.i18n.localize` or `game.i18n.format` through the module's `localize` helper.
- Settings names, labels, hints, scene-control titles, notifications, chat controls, and dialog text must never be hard-coded.
- `module.json` package metadata remains English because Foundry's manifest schema has singular `title` and `description` fields rather than localized variants.
- No language selector belongs in the Luck Points dashboard. Language selection is a Foundry core responsibility.
