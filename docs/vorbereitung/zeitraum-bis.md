# Vorbereitung — Unbefristete Angebote (`zeitraum_bis` NOT NULL)

Nur Bestandsaufnahme (Nachtauftrag 09.10.2026, Stand main `a23e009`), nichts
gebaut, nichts entschieden. Frage: Wo wirkt `zeitraum_bis NOT NULL`, was
bräche bei NULL, welche Weggabelungen gibt es, und was kostet der Umbau?

**Entschieden (E75, Eric 09.10.2026):** `zeitraum_bis NULL` = unbefristet
für `biomassestrom` und `output_bedarf`, CHECK `bis IS NULL OR bis >= von`;
ein unbefristeter Datensatz zählt in jedem Jahr ab Beginn (Jahresfilter,
Auswertung); Anzeige „ab MM/JJJJ, unbefristet"; Export-Zelle „unbefristet"
(E24, keine leere Zelle); Import nur ausdrücklich („unbefristet", „offen",
„unbegrenzt" in „Zeitraum bis" oder Lauf-Standard „unbefristet"), leere
Zelle = Lauf-Zeitraum; `validiereVergaben` bei offenem Ende nur gegen den
Beginn. Alles Weitere wie in Abschnitt 3 empfohlen. Umsetzung in zwei PRs
(E75a Modell + Verfügbarkeit, E75b Formular, Import, Anzeige, Export,
Vollständigkeit), siehe Entscheidungslog §49.

## 1. Wo `zeitraum_bis` heute wirkt

Datenmodell (`packages/db/src/schema.ts`, Migration 0001):

- `biomassestrom.zeitraum_bis date NOT NULL` (Zeile 492) und
  `output_bedarf.zeitraum_bis date NOT NULL` (Zeile 585). Kein CHECK
  `bis >= von` in der DB; die Reihenfolge prüft nur die App.
- `import_lauf.zeitraum_bis date` (nullable, Migration 0047) — der
  Lauf-Standard für Zeilen ohne eigenen Zeitraum; Pflicht wurde dort bewusst
  nach dem Modell gesetzt (§39: „zeitraum_bis ist im Modell NOT NULL —
  ‚unbefristet' gibt es nicht").
- `vergabe_zeitraum.vergeben_bis` ist bereits nullable (`vergabe_mindestens_
  ein_datum_check`): eine Vergabe ohne Ende gibt es, ein Angebot ohne Ende
  nicht.

Formular (`lib/formular-modell.ts`, `lib/strom-schreibweg.ts`,
`components/stroeme/FormularPanel.tsx`): `bisMonat` Pflicht
(`pflicht("zeitraum_bis", …)`, Zeile 208), Fehler „Bis-Monat liegt vor dem
Ab-Monat" (Zeile 260), `zeitraumBis = monatZuBis(bisMonat)` (Monatsletzter,
Schreibweg Zeile 202); `validiereVergaben(vonMonat, bisMonat, vergaben)`
verlangt Vergaben innerhalb des Zeitraums.

Import (`lib/import-zuordnung.ts` Zielfeld `zeitraum_bis`, `lib/import-zeitraum.ts`,
`lib/import-actions.ts`, `components/import/Probelauf.tsx`): Zeilen ohne
eigenen Zeitraum nehmen den Lauf-Zeitraum, der vor dem Probelauf Pflicht ist
(`zeilenOhneZeitraum`); eine Spalte „Zeitraum bis" ohne Wert ist damit kein
Fehler, ein leerer Lauf-Zeitraum schon.

Verfügbarkeit E41/E52 (`lib/verfuegbarkeit.ts`): „abgelaufen", wenn das
Fenster nach `zeitraumBis` liegt (Zeile 173); Vergaben ohne `vergebenBis`
laufen bis `zeitraumBis` (Zeile 179, Fallback `v.vergebenBis ?? strom.zeitraumBis`).
`lib/fenster.ts` (Monatsraster und Jahresfilter) gibt ohne `zeitraumBis`
`null` zurück (Zeile 46) und setzt „abgelaufen" am Jahr (Zeile 94);
`lib/vergabe-fenster.ts` nutzt denselben Fallback (Zeile 85).

Filter und Register (`lib/register.ts`): `jahrFilter(zeitraumVon,
zeitraumBis, filter.jahr)` für Angebote und Bedarfe (Zeilen 72, 311) — ein
Strom zählt zum Jahr, wenn sich die Zeiträume schneiden; Typen erlauben
`zeitraumBis: string | null`, die DB liefert nie NULL.

Auswertung (`lib/auswertung-modell.ts` Zeilen 676–682): Jahres- und
Zeitraum-Aggregation über `[zeitraumVon, zeitraumBis]`; ein Datensatz mit
NULL wird heute ausdrücklich als „unbestimmt" behandelt (Zeile 682 prüft
`== null` und meldet den Zustand).

Export (`lib/export-modell.ts` Zeile 257): Spalte „Zeitraum bis" als
`csvDatum`, Einstufung keine Belegangabe; Vollständigkeit
(`lib/vollstaendigkeit.ts` Zeile 71) zählt `zeitraumBis` als Pflichtfeld,
Feldeinstufung (`lib/feldeinstufung.ts`) „fachlich".

E70 „wird frei" (`lib/wird-frei.ts`): rechnet nur mit `vergeben_bis` der
Vergabekette, **nicht** mit dem Ende des Verfügbarkeitszeitraums (bewusst,
§44). Vergabe ohne Ende = nie frei. `zeitraum_bis` spielt hier keine Rolle.

Job-Hinweise (`lib/inbox/hinweise.ts`, `lib/jobs/verifikation.ts`): hängen
an `verifiziert_bis`/`gueltig_bis` der Belege und an den Vergaben, nicht an
`zeitraum_bis`.

Grid/Tabelle/Detail (`components/stroeme/Grid.tsx`, `Tabelle.tsx`,
`Detail.tsx`): Anzeige „Verfügbar MM/JJJJ bis MM/JJJJ"; `stroeme-modell.ts`
Zeile 762 fällt bei NULL auf `""` zurück (Sortierung).

## 2. Was bei NULL bräche

- DB: Insert/Update scheitert an NOT NULL — zuerst Migration.
- Formular: Pflichtprüfung lehnt leer ab; `validiereVergaben` kann Vergaben
  nicht gegen ein offenes Ende prüfen.
- Verfügbarkeit: `fenster.ts` liefert `null` (kein Monatsraster, Strom
  verschwindet aus Jahresansichten); `verfuegbarkeit.ts` Zeile 173 würde
  `fenster.von > null` auswerten — in JS `false`, also nie „abgelaufen",
  aber der Vergabe-Fallback `v.vergebenBis ?? strom.zeitraumBis` wird NULL
  und die Überlappungsprüfung (`null >= fenster.von` → `false`) blendet
  laufende Vergaben ohne Ende aus → **falscher Status „verfügbar" trotz
  Vergabe**.
- Register-Jahresfilter: `jahrFilter` mit NULL-Ende findet den Strom in
  keinem Jahr (SQL-Vergleich mit NULL) → Strom fällt aus gefilterten Listen.
- Auswertung: meldet „unbestimmt" und nimmt den Strom aus Summen.
- Export: leere Zelle (unkritisch); Vollständigkeit sinkt (Strom gilt als
  unvollständig, kein „geprüft").
- Import: Lauf-Zeitraum „bis" Pflicht müsste optional werden; Zeilen ohne
  Ende wären importierbar.
- Tests: `verfuegbarkeit.test.ts`, `fenster.test.ts`, `register`-Tests und
  die Formular-Tests setzen ein Ende voraus.

## 3. Weggabelungen

1. **Bedeutung von „unbefristet"**: (a) NULL = unbefristet, oder (b)
   eigenes Kennzeichen `unbefristet boolean` mit `zeitraum_bis` weiterhin
   gesetzt (z. B. Jahresende + n). Empfehlung: **(a) NULL = unbefristet**,
   wie bei `vergeben_bis` schon üblich — ein Kennzeichen plus Pseudo-Datum
   erzeugt zwei Wahrheiten. Dazu CHECK `zeitraum_bis IS NULL OR zeitraum_bis
   >= zeitraum_von`.
2. **Nur Angebote oder auch Bedarfe?** Beide Tabellen haben das Feld; der
   Auftrag nennt Angebote. Empfehlung: beide gleich behandeln (eine Logik
   in `verfuegbarkeit.ts`/`fenster.ts`), aber die Freigabe pro Formular
   steuern (Bedarf unbefristet ist fachlich seltener).
3. **Verfügbarkeit ohne Ende**: Fenster-Vergleich `bis ?? +∞`; Jahresfilter
   „schneidet jedes Jahr ab von"; Auswertung „unbestimmt" bleibt für Summen
   je Jahr (Menge pro Jahr ist bei unbefristet trotzdem definiert — Menge
   gilt je Jahr), Empfehlung: unbefristet zählt in jedem Jahr ab `von`.
4. **Anzeige**: „Verfügbar ab MM/JJJJ, unbefristet" statt „bis –"; Export
   leere Zelle plus Spalte „unbefristet ja/nein"? Empfehlung: leere Zelle
   reicht, Kopfzeile dokumentiert.
5. **Import**: Zielfeld „Zeitraum bis" darf leer bleiben, wenn die Datei
   eine Spalte „unbefristet" trägt oder das Lauf-Standardfeld „unbefristet"
   gesetzt ist — sonst bleibt leer = Lauf-Zeitraum (keine stille
   Unbefristung). Empfehlung: ausdrückliches Kennzeichen im Lauf.
6. **Vergaben**: `validiereVergaben` prüft „innerhalb des Zeitraums"; bei
   offenem Ende nur gegen `von`.

## 4. Aufwand (grob)

- Migration (additiv, E21): NOT NULL fallen lassen + CHECK, keine
  Datenänderung — klein. Mit erstem Verbraucher in denselben PR.
- App: `verfuegbarkeit.ts`, `fenster.ts`, `vergabe-fenster.ts`,
  `register.ts` (`jahrFilter`), `auswertung-modell.ts`, `formular-modell.ts`
  + Panel, `strom-schreibweg.ts`, Import (Zielfeld, Lauf-Standard,
  Probelauf), Export, Vollständigkeit, Anzeige in Grid/Tabelle/Detail —
  etwa 12 Dateien, je mit Test. Schätzung 2 PRs (Modell + Verfügbarkeit/
  Filter; Formular + Import + Anzeige), zusammen 1–1,5 Tage, plus
  Probe in der Wegwerf-DB (CHECK, Jahresfilter mit NULL).
- Risiko: der Status „verfügbar trotz Vergabe" (Abschnitt 2) — deshalb
  zuerst Verfügbarkeit und Fenster, mit Rot-Nachweis für `bis = NULL`.
