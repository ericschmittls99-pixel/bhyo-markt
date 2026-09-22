# AP1j — Verfügbarkeit, Vergabe und Zeitbezug der Auswertung

Handoff für das Verfügbarkeits-/Vergabe-Modell und den KPI-Zeitbezug.
Beschlossen im Dialog mit Eric am 21.09.2026 (Punkt E aus AP1i PR 7 plus
Erweiterungen). Dieses Dokument ist die verbindliche Fachreferenz für die
PRs ① – ⑤ unten.

## Ausgangsproblem

Alle KPI-Kacheln und Module der auswertung. summieren bisher zeitraumlos
über alle gefilterten Belege: Ein 2025 ausgelaufener Beleg zählt genauso
wie ein laufender Vertrag, und die Mengen-KPI (t atro/a) widerspricht der
Jahresscheibe des Moduls „verfügbarer feedstock je jahr.". Außerdem fehlt
die Marktdimension: Ströme, die an Dritte vergeben sind (z. B. verlorene
Ausschreibung), sind von freien Strömen nicht unterscheidbar.

## Datenmodell

### Bestehend (unverändert)

`zeitraum_von` / `zeitraum_bis` am `biomassestrom` und `output_bedarf`
sind der **Verfügbarkeitszeitraum**: Wann fällt die Biomasse physisch an
bzw. wann besteht der Bedarf? Monatsgenau, beide Pflicht.

### Neu: Tabelle `vergabe_zeitraum` (0..n je Strom)

Ein Abschnitt innerhalb des Verfügbarkeitszeitraums, in dem der Strom
vergeben ist. Beide Stromarten nutzen dieselbe Tabelle — genau ein
Elternbezug ist gesetzt (CHECK).

| Spalte | Typ | Bedeutung |
| --- | --- | --- |
| `id` | uuid PK | |
| `biomassestrom_id` | uuid FK, nullable | genau eins von beiden |
| `output_bedarf_id` | uuid FK, nullable | genau eins von beiden |
| `vergeben_von` | date, nullable | leer = ab Verfügbarkeitsbeginn |
| `vergeben_bis` | date, nullable | leer = unbefristet (bis Verfügbarkeitsende) |
| `vergeben_an` | text, nullable | Empfänger, Freitext |
| `an_bhyo` | boolean, default false | Vergabe an bhyo (gewonnene Ausschreibung) |

CHECK: mindestens eines von `vergeben_von` / `vergeben_bis` ist gesetzt —
**eine Zeile ganz ohne Datum ist keine Vergabe** (Eric: „wenn vergeben ab
und bis leer ist, dann ist es verfügbar"). Den Fall „vergeben, Zeitraum
völlig unbekannt" gibt es bewusst nicht; wer ihn erfassen will, setzt
vergeben-von auf den Erfassungsmonat und begründet es am Beleg.

### Neu: `reserviert_bhyo` (boolean, default false, beide Stromtabellen)

Weiche Markierung **ohne** Zeitraum: Die Kommune hat verfügbare Biomasse,
bhyo nimmt sie noch nicht ab (Projekt steht noch nicht), sie gilt aber
als reserviert. Unabhängig von den Vergabezeiträumen.

## Abgeleiteter Verfügbarkeitsstatus

Der Status wird **nie gespeichert, immer abgeleitet** (dasselbe Prinzip
wie Qualität A–D) — deterministisch aus heutigem Datum, den beiden
Zeiträumen und der Checkbox. Prüfreihenfolge, die erste zutreffende Regel
gewinnt; jeder Beleg hat damit genau einen Tag:

1. **abgelaufen.** — heute > verfügbar-bis
2. **noch nicht verfügbar.** — heute < verfügbar-ab
3. **vergeben (extern).** / **vergeben (bhyo).** — heute liegt in einem
   Vergabezeitraum; dessen `an_bhyo` entscheidet die Variante
4. **reserviert (bhyo).** — `reserviert_bhyo` gesetzt
5. **verfügbar.** — sonst

„Verfügbar" ist nie automatisch, sondern immer das Ergebnis dieser
Hierarchie: Nach dem Vergabe-Ende fällt der Strom auf den Zustand zurück,
der dann gilt (verfügbar, oder abgelaufen, oder reserviert …).

Randfall: Checkbox gesetzt + aktive externe Vergabe → Haupttag ist
„vergeben (extern).", die Reservierung erscheint zusätzlich als kleine
Pille.

### Konvention offener Enden

- vergeben-von leer → Vergabe gilt ab Verfügbarkeitsbeginn
  („vergeben bis 06/2028" = alles bis dahin weg, danach frei)
- vergeben-bis leer → unbefristet vergeben (zulässig)
- beide leer → keine Vergabe (Zeile wird nicht gespeichert)

Für Hierarchie, Überlappungsprüfung und Rechnung werden leere Enden
intern durch Verfügbarkeitsbeginn/-ende ersetzt — danach ist jeder Monat
wieder exakt einmal zugeordnet.

### Validierung (Formular)

- vergeben-von ≤ vergeben-bis (sofern beide gesetzt)
- Vergabezeiträume liegen vollständig im Verfügbarkeitszeitraum
- Vergabezeiträume untereinander überlappungsfrei; höchstens einer darf
  ein offenes Ende in dieselbe Richtung haben
- Leerzeilen (beide Daten leer) werden beim Speichern nicht angelegt

## Monatsscharfe Mengenrechnung

Mengen sind Jahresraten (t atro/a bzw. Bedarfsrate). Neu wird
**monatsscharf mit Saisonalität** gerechnet:

- Jeder Monat im Betrachtungsfenster ist entweder **frei** oder
  **vergeben** (durch die Zeiträume eindeutig, keine Doppelzählung).
- Wert eines Jahres = Rate × Σ(Saisonanteile der zählenden Monate).
  Ein Beleg ab 07/2026 zählt 2026 also nicht voll, sondern mit den
  Saisonanteilen Jul–Dez.
- Belege ohne Saisonprofil rechnen mit Gleichverteilung (n Monate ÷ 12).
- Gilt identisch für Output-Bedarfe.

Ein Strom kann im selben Fenster teils vergeben, teils frei sein
(verfügbar 2026–2035, vergeben bis 06/2028, Fenster 2026–2030): Die
Monate bis 06/2028 zählen zur vergebenen Menge, ab 07/2028 zur freien.

## auswertung.: Zeitbezug und Filter

- **Jahr-Filter**: Jahre an-/abwählbar.
- **Switch Einzeljahr ↔ Zeitraum**: Einzeljahr (Default: aktuelles Jahr)
  zeigt genau eine Jahresscheibe; Zeitraum rechnet über die gewählten
  Jahre.
- **Switch ø pro Jahr ↔ Summe im Zeitraum**: Durchschnitt (t/a, = Mittel
  der Jahresbalken im Fenster) oder Kumulation (t im Fenster). Beim
  Einzeljahr sind beide identisch.
- **Status-Filter**: verfügbar / vergeben (extern) / vergeben (bhyo) /
  reserviert (bhyo) / noch nicht verfügbar / abgelaufen.
  **Default: alles außer abgelaufen.**
- Der Status-Filter wirkt in auswertung. **fensterbezogen**, nicht auf
  heute: „verfügbar" + Fenster ab 07/2028 zeigt einen bis 06/2028
  vergebenen Strom mit seiner freien Menge; im Fenster 2026–2027
  erscheint er nur unter „vergeben (extern)". Übergreifende Fenster
  zeigen ihn anteilig in beiden Kategorien.
- Alle KPIs und Module (auch Preis/Potenzial: Preis × fensterbezogene
  Menge) nutzen dieselbe Fenster-Menge.

In **ströme.** und **karte.** (kein Jahresfenster) wirkt der
Status-Filter auf heute — deckungsgleich mit der Pille am Beleg. Der Tag
ist dort in Grid-Karten, Tabelle, Detail und Karten-Panel sichtbar und
überall filterbar.

## Verifikations-Kopplung

Läuft die Verfügbarkeit oder ein Vergabezeitraum ab, wird der Beleg
verifikationsfällig: Fälligkeit = das frühere von bisheriger
Verifikationsfrist und Ablaufdatum (verfügbar-bis bzw. vergeben-bis).
Zweck: Beim Freiwerden nachfassen.

## Sonstiges

- CSV-Export nimmt die neuen Felder mit.
- design-system.md wird um Status-Pillen und die zwei Switches ergänzt.
- „vergeben an" ist Freitext; die Begründungs-/Historienpflicht beim
  Bearbeiten gilt unverändert.

## PR-Schnitt

| PR | Inhalt |
| --- | --- |
| ① | Migration: `vergabe_zeitraum`, `reserviert_bhyo` (dieser Branch) |
| ② | Formular/Detail: Zeitraum-Liste mit „+", Validierung, Status-Pille |
| ③ | ströme./karte.: Tag + Status-Filter (heute-bezogen) |
| ④ | auswertung.: monatsscharfe Rechnung, Jahr-Filter, beide Switches, fensterbezogener Status-Filter |
| ⑤ | Verifikations-Kopplung |
