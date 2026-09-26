# F6 — Kommunen-PDF und Export: Handoff

**Stand: 25.09.2026.** Dieses Dokument ist noch kein vollständiger Handoff —
es hält bis dahin die Festlegungen fest, die aus anderen Paketen hierher
zeigen, damit sie nicht nur im Gesprächsverlauf stehen.

## Vorgemerkt aus E34: die Freigabe zur externen Verwendung

Mit E34 (25.09.2026) ist `beleg.extern_nachvollziehbar` **keine Aussage über
die Nachweiskraft mehr** und geht nicht in die Qualitätsstufe ein. Es ist
eine **Freigabe zur externen Verwendung**: Ein Beleg kann sachlich gut sein
und trotzdem nicht nach außen verwendet werden dürfen.

**Der Ort, an dem die Freigabe wirkt, ist F6.** PDF-Abzug und CSV-Export
berücksichtigen sie: Nicht freigegebene Belege erscheinen dort **nicht** oder
sind **sichtbar als intern gekennzeichnet**. Welche der beiden Varianten
gilt, entscheidet Eric, wenn F6 ansteht — bis dahin ist das eine Vormerkung,
kein offener Punkt.

**Warum das hier steht:** Der alte Hilfetext des Feldes versprach genau diese
Wirkung („die Quelle darf im Kommunen-PDF erscheinen"), ohne dass irgendwo im
Code etwas davon umgesetzt war. Der Fehlerbericht aus dem Praxistest vom
24.09.2026 ging darauf zurück. Mit F6 wird das Versprechen eingelöst; bis
dahin sagt der Hilfetext ausdrücklich, dass die Freigabe die Qualitätsstufe
nicht beeinflusst.

## Was sonst schon feststeht

- Der PDF-Export hat ein **eigenes Print-Layout ohne Glaseffekte**
  (`docs/design-system.md`).
- Die Formatierung erbt F6 über dieselben zentralen Funktionen aus
  `lib/format.ts` (E20) — keine eigenen Rundungen im PDF-Pfad.

## E36 — Freigabe und Export (Eric, 26.09.2026)

Die Variantenfrage oben ist entschieden, und zwar präziser als beide
Varianten: **Die Freigabe schützt nur den Beleg.** Ist sie nicht gesetzt,
erscheinen Quellenangabe, Datei, Link und Belegnummer in externen Ausgaben
nicht — an ihrer Stelle steht benannt „nicht zur externen Verwendung
freigegeben" (E24, nie eine leere Zelle; leer hieße „kein Beleg"). Mengen und
Preise des Stroms dürfen hinaus, einzeln wie in Summen. **Ergänzung:** Bei
Vergaben wird extern der Abnehmername zurückgehalten; Zeitraum und „an bhyo"
bzw. „extern vergeben" bleiben. Eine Vergabe benennt einen Vertrag zwischen
Dritten und liegt näher am Beleg als an der Menge.

Ob eine Ausgabe extern ist, wird **beim Export gewählt**: „extern" oder
„intern", voreingestellt extern. Wer alles sehen will, muss es bewusst
wählen, damit Vergessen nie zu einem Leck führt. Keine Rollenbeschränkung für
„intern": Wer die Anwendung sieht, sieht die Belege dort ohnehin.

### Exportmodell (PR A, `apps/web/lib/export-modell.ts`)

Jede Spalte trägt Schlüssel, Kopf, Wertfunktion und eine **Pflicht-
Einstufung**: `keine_belegangabe`, `belegangabe` (die vier oben) oder
`gekuerzt` (Vergaben). Ein Test lässt eine Spalte ohne Einstufung scheitern;
ein zweiter erzeugt eine echte externe Datei mit nicht freigegebenem Beleg
und externer Vergabe, liest sie ein und prüft, dass keine der vier Angaben
und kein Abnehmername vorkommt (einmal rot gezeigt, indem die Einstufung
wirkungslos gemacht wurde).

Spaltenreihenfolge: Identität (Art, Belegnummer, Bezeichnung, Akteur,
Sektor) → Ort (Ort, Landkreis, Bundesland) → Einordnung (Cluster bzw.
Gruppe, Materialart bzw. Produkt) → Zeitraum → Mengen je Einheit („Menge
[t atro/a]", „Menge stofflich [t/a]", „Menge energetisch [MWh/a]") → Preise
je Einheit („Preis min/mittel/max [€/t atro] (positiv = Kosten für bhyo)",
„Preis stofflich [€/t]", „Preis energetisch [€/MWh]") → „Potenzial [€/a]
(positiv = Erlös für bhyo)" → Nachweis (Qualität, Belegtyp, Quellenangabe,
Datei, Link, Verifikation, Fälligkeit) → Markt (Status, Verfügbarkeit,
Reserviert, Reserviert seit, Vergaben). **Eine Spalte, eine Einheit**, im
Kopf, nie in der Zelle; E20 gilt nur für die Anzeige. Energetische Werte über
den Heizwert (E23). Potenzial je Strom aus `lib/potenzial.ts` — derselbe
Ursprung wie die Kacheln der Auswertung.

Benannte Zustände statt leerer Zellen: „entfällt" (Spalte gilt für diese
Stromart nicht), „nicht erfasst" (Lücke), „kein Energieäquivalent"
(Eigenschaft), „kein Beleg", „nicht zur externen Verwendung freigegeben".
Datei nur als Dateiname, nie Speicherschlüssel oder URL auf die Ablage.

Format für deutsches Excel: Semikolon, Komma als Dezimaltrenner (E31), UTF-8
mit BOM, CRLF, Daten TT.MM.JJJJ. Dateiname
`markt-<sicht>-<modus>-<JJJJ-MM-TT>.csv`. Metazeilen oben: Modus mit Satz,
Stand (Datum, Uhrzeit), Ansicht, Bezugsjahr, aktive Filter im Klartext, nicht
angewandte Filter (E32), BKG-Vermerk (Landkreis/Bundesland sind immer
enthalten).

Bedienung: ein Export-Knopf in Toolbar und Filterzeile öffnet ein Menü —
oben extern/intern (voreingestellt extern, intern mit sichtbarem Hinweis),
darunter die Ausgaben (CSV; „Drucken" kommt mit PR B).

### Druck-Route statt Server-PDF (PR B, Entscheidung Eric, 26.09.2026 — umgesetzt)

Umsetzung: `app/auswertung/druck/page.tsx` lädt über `lib/export-server.ts`
(derselbe Ladepfad wie die CSV-Route) und rendert `DruckAbzug`: Kopf mit
Modus-Satz und Metazeilen, Zusammenfassung (Anzahl, Σ Menge Feedstock,
Σ Potenzial je Art über `fmtGeldGross`), je Strom ein Datenblatt in den neun
Gruppen des Exportmodells (dieselben Spalten, dieselbe Einstufung, Zahlen
über `fmtMenge`/`fmtPreis`), Fußzeile mit Modus, Stand, Ansicht und
BKG-Vermerk (im Druck fixiert). Im Export-Menü als „Drucken / PDF".

Kein Browser-Rendering-Binding und keine neue Token-Berechtigung. Eine Route
`/auswertung/druck` mit eigenem Druck-Stylesheet ohne Glaseffekte rendert
über dieselben Funktionen aus `lib/format.ts` (E20), übernimmt Filter und
Modus aus der Adresse und trägt dieselben Metazeilen als Kopf und Fußzeile.
Gedruckt wird aus dem Browser als PDF. **Die Karte gehört nicht hinein**
(WebGL druckt sich nicht verlässlich; Marker, Aggregation und Legende sind
Interaktion, kein Druckbild). **Ein serverseitig erzeugtes PDF kommt erst mit
AP3**, wenn Kommunen-Berichte mit Lauf-ID automatisch entstehen.
