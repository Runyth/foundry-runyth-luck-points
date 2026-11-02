# Glückspunkte

**Version 1.1.3** — Foundry VTT v13, D&D Fifth Edition 5.0.0–5.3.3

Glückspunkte verwaltet eine persönliche Spielerressource, die durch selbst gewürfelte 1W4-Belohnungen wächst und nach einem sichtbaren d20-Wurf ausgegeben werden kann.

## Regeln

- Maximal 20 Glückspunkte pro Spieler.
- Pro verdientem Grund gibt der Spielleiter einen offenen 1W4-Anspruch frei.
- Der betreffende Spieler würfelt diesen 1W4 selbst; das Ergebnis wird seinem Punktestand gutgeschrieben.
- Glückspunkte werden erst nach dem sichtbaren d20-Ergebnis eingesetzt.
- Eigener Wurf: 1 Glückspunkt gewährt +1.
- Verbündeter Wurf: 2 eigene Glückspunkte gewähren dem Verbündeten +1.
- Der gesamte Glücksbonus eines Wurfs ist auf +10 begrenzt.
- Eine natürliche 1 bei einem Angriff bleibt ein automatischer Fehlschlag und kann nicht verbessert werden.
- Unterstützt werden Angriffe, Attributs-, Fertigkeits- und Werkzeugchecks sowie Rettungswürfe einschließlich Konzentrations- und Todesrettungswürfen.

## Lokalisierung

Das Modul verwendet Foundrys reguläres Lokalisierungssystem:

- `lang/en.json` enthält die englische Standardsprache.
- `lang/de.json` enthält die deutsche Übersetzung.
- Die sichtbare Sprache folgt **Einstellungen konfigurieren → Kerneinstellungen → Sprache** des jeweiligen Foundry-Clients.
- Ein eigener Sprachumschalter im Dashboard ist deshalb weder notwendig noch vorhanden.
- Weitere Sprachen lassen sich ohne Änderung des Programmcodes ergänzen. Siehe [`docs/LOCALIZATION.md`](docs/LOCALIZATION.md).

## Verwendung

### Spielleiter

1. Öffne die Kleeblatt-Schaltfläche in den Token-Werkzeugen.
2. Gib pro Spieler und erfülltem Grund einen 1W4-Anspruch frei:
   - pünktliches Erscheinen
   - Session-Rückblick
   - Session-Log
   - zusätzliche Aktivität
3. Für eine vollständig pünktliche Gruppe kann die Freigabe gesammelt erfolgen.
4. Offene Ansprüche können vor dem Würfeln wieder zurückgenommen werden.
5. Punktestände können direkt korrigiert werden.

### Spieler

1. Öffne das Glückspunkte-Fenster.
2. Würfle jeden offenen 1W4-Anspruch über **1W4 selbst würfeln**.
3. Führe einen normalen d20-Wurf aus.
4. Verwende anschließend die Schaltfläche direkt unter dem Chatwurf.
5. Wähle den gewünschten Bonus. Das Modul zieht die Kosten ab und aktualisiert den gespeicherten Gesamtwert.

Jeder andere Nicht-GM-Spieler, der den passenden d20-Wurf sehen kann und genügend Glückspunkte besitzt, erhält direkt auf dieser Chatkarte eine Unterstützen-Schaltfläche. Für +1 auf den fremden Wurf werden automatisch 2 eigene Glückspunkte des unterstützenden Spielers abgezogen. Alle Beiträge teilen sich die gemeinsame +10-Grenze.

**Bereits verfehlte Angriffe:** Glückspunkte dürfen auch nach einem im Chat angezeigten Fehlschlag ausgegeben werden, sofern keine natürliche 1 beim Angriff gefallen ist. Der bereits vorhandene Würfel wird nicht erneut gewürfelt. Wenn eine andere Automatisierung den Angriff bereits abschließend verarbeitet und Schaden angewendet hat, kann das Glückspunkte-Modul diese Automatisierung nicht rückwirkend wiederholen. In diesem Fall entscheidet der Spielleiter über die daraus resultierenden Konsequenzen.

## Installation

Entpacke das Installationsarchiv so, dass folgendes Verzeichnis entsteht:

```text
<Data>/modules/luck-points/
```

Aktiviere anschließend **Luck Points** in der Modulverwaltung der Welt.
