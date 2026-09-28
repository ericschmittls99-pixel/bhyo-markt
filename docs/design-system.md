# Designsystem bhyo 2.0

Verbindliche Referenz für alle UI-Arbeiten. Visuelle Fassung:
`docs/design/bhyogenics-vision-board.pdf`.

## Prinzip

Der Verlauf steht für den Phasenübergang von festem Input zu gasförmigem
Output – „das Dazwischen". Er ist Identitätsträger, kein Schmuck.

## Marken-Token (Quelle: `apps/web/app/globals.css`)

- Navy `#1F2E38` · Waldgrün `#3A5412` (Akzent) · Lime `#8CC63F` · Hellgrau `#EFEFEE`
- Neu und bislang ungenutzt: Petrol `#3AA0A0` · Beige `#D8C6A0` · Braun `#6B4423`
- Radius `14px`, Radius-Pill `999px`, Schatten weich `0 2px 10px rgba(31,46,56,.08)`
- Dark Mode: Grundfläche `#16222A`, Akzent wird Lime. Kein Schwarz.

## Datenfarben

Feedstock-Cluster (Kreis):

| Cluster | Farbe |
| --- | --- |
| `organische_rest_abfallstoffe` | `#5C8615` |
| `lignozellulosische_reststoffe` | `#9C7A4E` |
| `nachwachsende_rohstoffe` | `#A1C65F` |
| `lipide_spezialfeedstocks` | `#B7B7B4` |
| `polymere_synthetische_c_quellen` | `#313F48` |

Output nach Gruppe (Raute):

| Gruppe | Farbe |
| --- | --- |
| `primaerprodukte` | `#DDB03C` |
| `wasserstoff` | `#3AA0A0` |
| `derivate` | `#35529A` |
| `add_ons` | `#8E8880` |

Qualität A–D als Ring und Pille, Graustufen, keine Ampelfarben:
A `#1F2E38` · B `#4A5C66` · C `#97A4AB` · D `#D5D8D6`.

**Kartenmarker-Ringe (E27, 23.09.2026)** laufen dagegen über
**theme-abhängige Tokens** `--ring-a…d`, `--ring-unbelegt`,
`--ring-ausserhalb` (globals.css), nicht über feste Hex-Werte: Light behält
die dunkle Rampe (D angehoben von navy-300 auf navy-400 — als dünner Ring
war es zu schwach), Dark bekommt die helle Grau/Weiß-Rampe, weil die dunkle
Rampe auf Navy-Grund verschwand (A war praktisch unsichtbar). **In beiden
Themes dieselbe Rangfolge A > B > C > D**, dreifach getragen — Helligkeit,
Strichstärke (3 / 2,5 / 2 / 1,5 px) und Strichart (solid, solid, dashed,
dotted) —, damit sie bei Farbsehschwäche und auf unruhigem
Kartenhintergrund lesbar bleibt. Dazu die beiden E24-Zustände:
**„unbelegt"** 1,5 px dashed, zurückgenommen (kein Beleg = keine Aussage);
**„außerhalb"** 4 px **double** in voller Ringfarbe — es fällt bewusst auf,
weil es auf einen falsch gesetzten Pin hindeutet. Auch hier keine
Ampelfarbe: die Unterscheidung trägt Strichart und Breite. **„ohne
Koordinate"** hat keinen Pin und steht nur in der Legende. Die Legendenzeile
bricht um (`flex-wrap`) — mit sechs Zuständen passt sie nicht mehr in eine
Zeile.

**Marker-Hover (F2)**: Statt des nativen Browser-Tooltips erscheint ein
**Glas-Popover** über dem Orb (`.km-pop`): Titel (Akteur) fett, darunter
Materialart/Produkt, Ort und abgeleiteter Status als Captions; es fängt
keine Mausereignisse ab. Aggregat-Marker zeigen „N Ströme ·
hineinzoomen für Einzelheiten"; die kleinen Fächer-Orbs behalten den
nativen Tooltip, weil ein Popover den Fächer verdecken würde.

**Basemap-Filter (F2)**: hell `grayscale(1) contrast(0.8) brightness(1.1)`,
dunkel `grayscale(1) invert(0.92) hue-rotate(180deg) contrast(0.8)
brightness(0.94)` — feine OSM-Details treten zurück, ohne dass die Karte
unscharf wirkt.

Seit F0b sind auch **Landkreis und Bundesland reine Ableitungen** — aus der
Koordinate per räumlichem Join auf VG250 (Referenz über den ARS, nie über
den Namen). Anzeige im Detail als „Bezeichnung Name · aus Koordinate"
(z. B. „Kreisfreie Stadt Speyer · aus Koordinate"), nicht editierbar; im
Formular gibt es keine Felder mehr dafür. Zwei benannte, getrennte
Sonderfälle mit eigenen Filteroptionen: „außerhalb" (Koordinate in keinem
Gebiet — nie aufs nächstgelegene einrasten) und „ohne Koordinate".
Quellenvermerk „© GeoBasis-DE / BKG (2026), dl-de/by-2-0" in beiden
Karten-Attributionen.

Seit E23/E24 ist die Stufe eine reine Ableitung aus dem Beleg — ein Strom
ohne Beleg hat **keine** Stufe. Anzeige als Pille „unbelegt" (`konf--leer`,
nicht „–": der Zustand ist benannt und als eigener Filterwert wählbar),
Sortierung hinter D, Karten-Ring am dünnsten und fast transparent, in der
auswertung. eine eigene Zeile „ohne Beleg — keine Stufe" unterhalb von D
(Donut und A+B-Quote bleiben auf bewertete Ströme bezogen).

### Verfügbarkeits-Pillen (AP1j)

Der Verfügbarkeitsstatus wird **nie gespeichert, immer abgeleitet** (Hierarchie
in `docs/ap1j-handoff-verfuegbarkeit-vergabe.md`, Code in
`apps/web/lib/verfuegbarkeit.ts`). Die Pille nutzt die bestehenden
`spill`-Töne, keine Ampel:

Die Texte sind je Stromart verschieden (PR 3, Handoff-Tabelle „Label-Sätze
je Stromart"), die Töne je Status identisch:

| Status | Feedstock | Output | Ton |
| --- | --- | --- | --- |
| verfuegbar | verfügbar. | offen. | `active` (Lime) |
| vergeben_bhyo | vergeben (bhyo). | gedeckt (bhyo). | `running` (Waldgrün) |
| vergeben_extern | vergeben (extern). | gedeckt (extern). | `inactive` |
| abgelaufen | abgelaufen. | abgelaufen. | `inactive` |
| reserviert_bhyo | reserviert (bhyo). | reserviert (bhyo). | `quiet` |
| noch_nicht_verfuegbar | noch nicht verfügbar. | noch nicht verfügbar. | `quiet` |

Nebentag: Der kleine **Stempel mit der Bildmarke** (`res-stempel`, 22 px,
quiet-Ton) markiert, dass **bhyo an diesem Strom hängt** — er erscheint bei
einer Reservierung *und* bei einer Vergabe „an bhyo" (Review Eric,
24.09.2026), sobald das nicht schon der Haupttag ist. Bewusst keine zweite
große Pille, damit die Zeile einspurig bleibt.

Hinweis: Die Cluster- und Output-Farben werden mit **AP1f-a** in
`apps/web/lib/farben.ts` wirksam. Bis dahin beschreibt dieser Abschnitt den
Zielzustand, nicht den Code-Stand.

## Verlauf oder Flachfarbe

- Verlauf ab **20 px** Durchmesser, darunter die Flachfarbe des Clusters bzw.
  der Output-Gruppe.
- 20 px möglichst nicht unterschreiten – lieber ein Element weglassen als es zu
  klein zeigen.
- Der Verlauf ist immer Füllung, nie Rahmen.
- Diagramme, Tabellen, Formulare, Navigation, Buttons und der App-Header bleiben
  durchgängig flach.
- Verlauf = Identität (Detailpanel-Kopf, Marker-Panel, Fokusregion-Kachel,
  Cluster-Stack). Flachfarbe = Datenpunkt (Kartenmarker, Tabelle, Diagramm,
  Legende).

## Orb-Assets

- `apps/web/public/orbs/cluster/<feedstock_cluster>.webp`
- `apps/web/public/orbs/output/<output_gruppe>.webp` (`primaerprodukte`,
  `wasserstoff`, `derivate`) sowie `waerme.webp`, `co2.webp`, `asche.webp` für
  die drei Add-On-Produkte.

256×256 px WebP, benannt nach dem Enum-Code – Auflösung per Template-String,
keine Mapping-Tabelle im Code.

## Glas-Flächen (Stand PR 7, E-Log §8)

Zwei Deckkraft-Stufen, beide mit Blur `20px` + `saturate(160%)`:

- `--glass-fill` (Light `rgba(255,255,255,.72)` · Dark `rgba(31,46,56,.62)`):
  Karten und Module, die auf der Seitenfläche liegen.
- `--glass-fill-strong` (Light **`.94`** · Dark **`.95`**): alles, was über
  fremdem Inhalt schwebt — Filter-Popover, Comboboxen, Konto-Menü, Toasts,
  Karten-Overlays (Toolbar, Legende, Zeichnen-Dialog). Erhöht von .86/.84,
  weil durchscheinender Hintergrund die Lesbarkeit störte; der Blur bleibt
  als Identität.

## auswertung.-Module (Bento, Stand PR 7)

- **KPI-Kacheln**: genau eine große Kennzahl mit Einheit, Label lowercase
  mit Punkt, Caption darunter (E18). Erläuterungen — etwa die
  Rechenbasis („atro-gewichtet", „· ungewichtet") — stehen **in der
  Caption**, nie hinter einem ⓘ-Popover und nie als Stat-Mehrfachwerte in
  einer Kachel. Captions bleiben schlank (Review 22.09.: n-Angaben,
  Vorzeichen-Legende und „Target-Outputs nach Hu" gestrichen).
- **Zeilen-Module filtern per Klick** (Pool-Prinzip): Zeilen und
  Unterzeilen kommen aus dem ungefilterten Pool, Werte aus der Auswahl —
  beim Filtern bleiben Zeilen sichtbar und **dimmen auf `0.45`**, die
  aktive Zeile trägt `--surface-selected`. Klick-Highlights sind rund
  (`12px`) mit Innenabstand, nie randbündige Rechtecke.
- **Zeilen-Layout**: jede Zeile ist zweizeilig — Kopfzeile (Orb, Label,
  Meta-Caption, Wert rechtsbündig) über einem Balken bzw. Spannenband in
  **voller Modulbreite**. Haupt- und Akkordeon-Unterzeilen teilen dieselbe
  Spur: alle Balken starten und enden am selben Punkt, keine Label- oder
  Zahlenspalten neben dem Balken.
- **Kachel-Skalen (E26, 23.09.2026)**: Es gibt **keine gemeinsame Skala
  über Kacheln hinweg** — jede Kachel nennt selbst, was ein voller Balken
  bedeutet. *Zusammensetzungs-Kacheln* (feedstock je cluster., belegtypen.,
  bedarf je gruppe.) zeigen **Anteile an der Kachelsumme**: ein voller
  Balken ist 100 %, jede Zeile steht als „41 % · 48.012", die Bezugsgröße
  als Caption im Kachelkopf („Anteil an 117.300 t atro/a"). Anteile werden
  zentral per `anteileProzent` (Largest Remainder, Summe exakt 100)
  gerechnet; ein Wert 0 bekommt nie einen Rest-Prozentpunkt.
  *Zeitreihen* (verfügbarer feedstock je jahr., bedarfe je jahr.) bleiben
  **absolut**: Achse ab 0, Obergrenze sichtbar im Kopf („0 – 115.839
  t atro/a"); eine Skala je Einheit — wechselt ein Umschalter die Einheit,
  wechseln Skala und Beschriftung mit. **Nie zwei Einheiten auf einer
  Skala.** Jede %-Angabe nennt ihre Basis („von 72 Strömen der Auswahl",
  „von 69 bewerteten").
- **Nullzeilen** (Wert 0 in der Auswahl) bleiben sichtbar und dimmen auf
  `0.45` (`stumm`) — ausgeblendet wird nie.
- **Balken** tragen die Flachfarbe des Clusters bzw. der Output-Gruppe.
  **Spannenbänder** (Min–ø–Max) sind 8-px-Pillen mit Farbfüllung (`0.6`)
  und ø-Punkt in `--status-active`. Die Skala ist **für alle Zeilen des
  Moduls gemeinsam** und läuft exakt vom kleinsten Min bis zum größten Max
  aller Positionen — kein 0-Anker, volle Bandbreite (E18).
- **Zweigeteilte Listen** (energetisch/stofflich, E13) trennen Sektionen
  durch eine Caption-Zeile („energetisch · MWh/a"), nicht durch Rahmen.
- **ø-Preis-Kennzeichnung** (drei Fälle der Rechenbasis, 22.09.2026;
  n-Angabe im Review vom 22.09. wieder gestrichen): Ein gewichteter ø
  steht ohne Zusatz. Ein ungewichteter ø (keine atro-Menge ableitbar)
  trägt sichtbar „· ungewichtet" hinter dem Wert, der Grund steht im
  Popover (`title`). Zeilen **ohne ausweisbaren Wert** (Belege
  vorhanden, aber keine Menge im Bezugsjahr) zeigen keinen Preis und
  keine Spanne: Zeile gedimmt auf `0.45` (Klasse `stumm`, gleiche Optik
  wie das Vergangenheits-Dimming der Jahresachse, getrennt vom
  Filter-Dimming), Hinweis „n Belege, keine Menge im Bezugsjahr" als
  Caption und Popover. In der KPI-Kachel stehen dieselben
  Kennzeichnungen in der Caption; KPI-Captions bleiben ansonsten
  schlank („atro-gewichtet" bzw. „MWh-gewichtet über Target-Outputs").
  Gilt identisch auf der Outputs-Seite (Gewicht = Energiemenge in kWh,
  Kennzeichen „keine Energiemenge ableitbar") — eine gemeinsame
  Rechenbasis-Funktion, keine zweite Implementierung.

## Akkordeon-Muster (Materialarten/Produkte)

- Der Aufklapp-Pfeil ist ein **eigener Knopf** (`aria-expanded`, Phosphor
  `caret-down/up`), absolut oben rechts in der Zeile positioniert —
  Zeilenklick togglet die Facette, Caret klappt auf. Beides nie auf
  demselben Element. Die Kopfzeile reserviert dafür rechts 26 px
  Innenabstand, sodass Werte mit und ohne Caret bündig enden.
- **Raster (F1)**: Die Rasterzeile des Modulgitters ist eine Unter-, keine
  Obergrenze (`grid-auto-rows: minmax(168px, auto)`) — ein aufgeklapptes
  Akkordeon lässt die Zeile wachsen, statt den Inhalt zu beschneiden.
- Unterzeilen: Kopfzeile 24 px eingerückt, Caption-Typo, der Balken läuft
  aber in **voller Modulbreite auf derselben Spur und Skala wie die
  Elternzeilen**; klickbar auf ihre eigene Facette (materialart/produkt),
  ohne Code nicht klickbar. Zustand rein clientseitig, nicht in der URL.

## Belegnummer (E28, 23.09.2026; Kopf-Reihenfolge 24.09.2026)

Das Detail-Panel zeigt die **Belegnummer** `B-000123` statt der UUID; der
Kopier-Knopf kopiert die Nummer. **Reihenfolge im Kopf** (Review Eric,
24.09.): Titel (Akteur) → Nummer ohne Beschriftung → kleiner Abstand →
Zusammenfassung aus Materialart/Produkt und Verfügbarkeit (die Bezeichnung
steht unten unter „quelle." und ist aus dem Kopf raus) → Pillen → Abstand →
„quelle.". Die Nummer steht außerdem als eigene Spalte im **CSV-Export**,
den es jetzt auch in ströme. gibt — dieselbe Route und dieselben geteilten
Filter-Parameter wie in auswertung., nur mit der Art des Tabs als `sicht`.
Er sitzt in der Filterzeile **rechts außen, hinter dem Ansichts-Schalter**,
und trägt nur das Download-Icon (Review Eric, 24.09.): `btn btn--icon` —
die Nur-Icon-Variante ist quadratisch über `aspect-ratio: 1` und behält
damit die Höhe ihrer Größenklasse, statt eine eigene Maßangabe zu bekommen.
Ohne Textlabel braucht sie `aria-label` **und** `title`.
Die Freitextsuche findet die Nummer mit Präfix
(`B-000123`), ohne Präfix (`000123`) und ohne führende Nullen (`123`),
Groß- und Kleinschreibung egal — die **UUID-Suche bleibt zusätzlich**, wer
eine aus einem alten Protokoll hat, findet den Beleg weiterhin. Kein
Eingabefeld, kein Schreibpfad: die Nummer kommt aus der Sequenz
(E29), ist `NOT NULL`, `UNIQUE` und in der Datenbank per Trigger gegen
Änderung gesichert.

## Benutzerverwaltung (F8/E30 PR C, 24.09.2026)

`einstellungen.` trägt die Benutzerliste — **nur für Admins**; wer kein
Verwaltungsrecht hat, sieht den bisherigen Leerzustand mit dem Hinweis, an
wen er sich wendet. Die Seite nutzt die vorhandene Formular- und
Tabellensprache, keine eigene Designsprache für eine Admin-Seite.

- **Gelöscht wird nicht**, nur deaktiviert (wie bei den Referenzdaten). Ein
  deaktivierter Eintrag bleibt gedimmt in der Liste stehen — nicht
  durchgestrichen: Er gilt weiter, er kommt nur nicht herein, und die
  Änderungshistorie soll auf einen Namen zeigen können.
- **Der letzte aktive Admin ist sichtbar gesperrt** (Auswahl und Knopf
  `disabled`, Begründung im `title`), damit niemand erst nach dem Klick
  erfährt, dass es nicht geht. Der tragende Schutz sitzt trotzdem in der
  Server-Action: Wer sie direkt aufruft, sieht diese Seite nie.
- Die eigene Zeile trägt eine kleine Pille „du".

## Gruppierte Filter als Baum (F5 PR B, 25.09.2026)

**Ein Bauteil für alle vier Hierarchien** — Cluster → Materialart, Gruppe →
Produkt, Bundesland → Landkreis → Ort, Sektor → Akteur. Nicht vier ähnliche
Umsetzungen.

### Bedienung

**Aufklappen und Auswählen sind getrennte Ziele**, beide mindestens 32 px
hoch: Der **Pfeil** klappt auf und zu, das **Kästchen** und der **Name**
wählen — auf jeder Ebene gleich. Die häufigere Handlung bekommt die größere
Fläche.

**Tastatur ohne Mausanschluss:** ↑ ↓ bewegen über die *sichtbaren* Zeilen,
→ ← klappen auf und zu, Leertaste wählt.

**Drei Zustände, drei Bilder** — nicht drei Helligkeiten desselben Bildes:
leeres Kästchen (offen), Häkchen (gewählt), waagerechter Strich
(Teilauswahl). So bleibt der Unterschied bei Farbsehschwäche und in beiden
Themes lesbar; dieselbe Haltung wie bei den Kartenringen (E27).

**Implizit Gewähltes ist erkennbar anders** — gestricheltes Kästchen,
zurückgenommener Name — **und trotzdem einzeln abwählbar**.

### Was gespeichert wird

**Die höchste Ebene, die vollständig gewählt ist.** Wer Baden-Württemberg
wählt, bekommt `bundesland=08`, nicht alle Kreisschlüssel — das hält die
Adresszeile kurz und bleibt richtig, wenn später ein Kreis dazukommt.

Wählt jemand darunter einen Kreis ab, ist das Bundesland nicht mehr
vollständig und wird **automatisch in seine übrigen Kinder aufgelöst**
(`landkreis=08111,08115,…`). Die Adresszeile wird in diesem Fall länger; das
Modell bleibt dafür ohne Zustand, der sich nicht schreiben lässt. Werden
später wieder alle Kinder gewählt, fasst die Normalisierung sie erneut zum
Elternteil zusammen.

**Eine aufgelöste Auswahl ist eine Momentaufnahme.** Kommt später ein Kreis
dazu, ist er nicht enthalten — bei einer Ausschluss-Auswahl ist genau das
richtig. Eine zusammengefasste Auswahl (`bundesland=08`) nimmt ihn dagegen
automatisch mit.

Die Ebenen sind **ODER-verknüpft**: Ein Strom ist getroffen, wenn er auf
*einer* der gewählten Ebenen passt. Zurückgesetzt wird **je Hierarchie
einmal**.

### Ortsliste

Bundesland und Landkreis kommen räumlich über den ARS (E25), der Ort aus den
strukturierten Adressfeldern (F0a) — **eingeschränkt auf den Kreis-ARS
desselben Stroms**, damit „Neustadt" in zwei Kreisen zwei Einträge bleibt und
nicht still zu einem Filterwert verschmilzt.

Fürs Gruppieren wird normalisiert: Leerraum am Rand entfernt, mehrfache
Leerzeichen zusammengezogen, Vergleich ohne Rücksicht auf Groß- und
Kleinschreibung. **Angezeigt wird die häufigste Schreibweise; bei Gleichstand
die alphabetisch erste.** Nicht die zuerst gelesene Zeile — sonst hinge die
Anzeige an der Sortierung der Abfrage und dieselbe Datenlage ergäbe
verschiedene Bäume. Kein neuer Schlüssel und keine Ortsdatenbank; die Suche
nach einem Ortsnamen gibt es bereits über den Freitext.

**Leere Äste erscheinen nicht** — ein Bundesland, ein Kreis oder ein Ort ohne
Ströme wäre ein Eintrag, der nichts filtert. Ströme **ohne Koordinate** oder
**außerhalb** behalten ihre benannten Zustände aus E24/F0b und tauchen im
Baum nicht als leere Einträge auf.

### Sektor → Akteur

Der Sektor kommt aus der Referenztabelle (Migration 0020, acht Werte), der
Akteur aus dem Bestand. **Filterwert der Akteur-Ebene ist die ID, nicht der
Name** — zwei Akteure dürfen gleich heißen, und ein Name kann sich ändern.
Angezeigt wird der Name.

**„ohne Sektor" ist ein eigener Ast** (E24, wie „ohne Koordinate" beim
Kreis), zuletzt in der Liste: Akteure ohne Branche — etwa reine Abnehmer nach
der Zuordnung aus 0020 — sind Bestand, kein Fehler, und müssen über den Baum
erreichbar bleiben. Sonst fielen ihre Ströme bei gesetztem Sektor still
heraus. Wie überall gilt: leere Äste erscheinen nicht.

### Zusammengeklappt

Statt einer langen Liste eine Kurzfassung: der erste gewählte Name, dann die
Zahl der weiteren, benannt nach ihrer Ebene — „Baden-Württemberg, +2
Landkreise".

## Filter „Vergeben ab / bis" (F5 PR B, 25.09.2026)

Ein Filter mit **zwei Feldern**. Er beantwortet **„was ist in diesem Zeitraum
vergeben"**, nicht „was ändert sich darin" — gesucht ist die gewöhnliche
**Überschneidung**. Eine Vergabe, die das Fenster vollständig umschließt, ist
damit der wichtigste Treffer, nicht der einzige Nicht-Treffer.

Die Ränder sind **monatsgenau eingeschlossen**: Der erste Tag des Startmonats
und der letzte Tag des Endmonats zählen dazu.

**Offene Enden** werden mit derselben Ersetzung behandelt wie in der
Verfügbarkeits-Ableitung — fehlendes `vergeben_von` durch den
Verfügbarkeitsbeginn, fehlendes `vergeben_bis` durch das Verfügbarkeitsende.
Kein zweites Regelwerk für dieselbe Sache.

**Eine beidseitig offene Vergabe trifft jedes Fenster.** Wir wissen nicht,
wann sie endet, also können wir sie nicht ausschließen; ein geratenes Ende
wäre schlechter als ein weiter Treffer.

**„Nicht vergeben" ist ein wählbarer Zustand**, keine stille Ausnahme (E24):
Bei gesetztem Fenster fallen Ströme ohne jede Vergabe heraus — es sei denn,
der Zustand ist gewählt. Ist nur der Zustand gewählt und kein Fenster, zeigt
der Filter genau die unvergebenen Ströme.

Die Zielmatrix führt den Filter unter **„weitere Filter"** — die erste
Fassung hatte ihn fälschlich als Hauptfilter.

## Bereichsfilter stofflich / energetisch (F5 PR B, 25.09.2026)

**Menge und Preis sind zwei Filterpaare, nicht eins.** Vorher verglich der
eine Mengenfilter die rohen Erfassungswerte über alle Einheiten hinweg —
9 999 MWh/a lag auf derselben Skala wie 100 t/a. Jetzt gilt:

- **Stofflich** heißt: als **Masse messbar**. Feedstock-Rohmenge (t FM/a)
  und Output-Mengen in t/a; Preise in €/t, wobei €/kg umgerechnet wird
  (E20). Maßgeblich ist die **erfasste Einheit des Stroms**, nicht die
  Produktklasse — ein Methanol-Bedarf in t/a hat eine stoffliche Menge.
- **Energetisch** heißt: über den **unteren Heizwert abgeleitet**
  (`lib/energie.ts`), nie gespeichert (E23). Menge in MWh/a, Preis in €/MWh.
  Gilt nur für Outputs.

**Benannte Zustände statt stiller Ausfälle:** Ein Strom, der die gesetzte
Größe **nicht besitzt** — co2/asche „ohne Energieäquivalent", ein
MWh/a-Bedarf „ohne stoffliche Menge", ein €/MWh-Preis „ohne stofflichen
Preis" — wird **nicht mitverglichen und nicht angezeigt**, und die Leiste
sagt das sichtbar: „3 Ströme ohne Energieäquivalent nicht berücksichtigt"
(Entscheidung Eric: weder als 0 zählen noch lautlos verschwinden).

Eine **fehlende Angabe** (kein Wert erfasst) wird ebenfalls genannt, nur
anders formuliert — „5 Ströme ohne erfasste Menge nicht berücksichtigt",
„… ohne erfassten Preis …". Der Unterschied ist für den Nutzer wesentlich:
„ohne Energieäquivalent" ist eine **Eigenschaft der Sache** (Asche hat keinen
Heizwert, daran ändert niemand etwas), „ohne erfasste Menge" ist eine
**Lücke im Bestand**, und die kann er schließen. Verschwände ein Strom stumm,
weil jemand die Menge vergessen hat, erführe er es genau dann nicht, wenn es
ihm nützte (Entscheidung Eric, 25.09.2026). Zwei getrennte Hinweise in der
Leiste, Eigenschaften vor Lücken; gilt für Menge und Preis, stofflich wie
energetisch.

Gezählt werden nur Ströme, die **alle übrigen Filter bestehen** — der
Hinweis beziffert, was genau diese Grenze aus dem Ergebnis nimmt, nicht den
Bestand. Die Hinweis-Zeile teilt sich das Bauteil mit dem
E32-„gilt hier nicht"-Ausweis (`LeistenHinweise`), in allen drei Ansichten.

**Vollständigkeit** ist derselbe Bereichstyp: Erfassungsgrad 0–100 % aus
`lib/vollstaendigkeit.ts`, Min/Max in Prozent, unter „weitere Filter". Eine
Untergrenze allein deckt „mindestens 80 %" ab, ohne Stufen zu erfinden.

**Ansichts-Scope:** `filterStroeme` wendet seit F5 PR B nur an, was das
Modell für die aktuelle Ansicht vorsieht. Vorher entschied allein die
Stromart — ein gesetzter „Verfügbar ab" wirkte auch in auswertung.,
während die Leiste ihn als „gilt hier nicht" auswies.

## Eingabeformate im Formular (F9, 24.09.2026)

**Die Anwendung bestimmt das Eingabeformat, nicht der Browser.** Native
Eingabetypen richten sich nach Engine und Gebietsschema des Browsers — im
Praxistest waren Monatsfelder in einem Browser nackte Textfelder
(`type="month"` kennen Safari und Firefox nicht, `type="date"` schon), und
`type="number"` wies das Komma ab, weil `navigator.language` `en-US` war.
Deshalb gilt:

- **Monate**: `MM/JJJJ` in einem eigenen Textfeld (`MonatFeld`, Platzhalter
  sichtbar). Angenommen werden `01/2027`, `1/2027`, `01.2027`, `01-2027`,
  `012027`; beim Verlassen des Feldes wird auf `01/2027` aufgeräumt — nie
  währenddessen, sonst funkt es beim Tippen dazwischen.
- **Zahlen**: Textfeld mit `inputMode="decimal"`. **Komma** ist das
  Dezimaltrennzeichen; der Punkt wird weiterhin angenommen, damit niemand
  umgewöhnt wird. Werte aus der Datenbank erscheinen mit Komma.
- **Keine Tausenderpunkte** (Entscheidung Eric, 24.09.2026): Sie werden nicht
  getippt und nicht unterstützt. Punkt-Dreiergruppen ohne Komma sind
  mehrdeutig — `10.000` kann zehntausend sein, `33.333` ein TS-Anteil in
  Prozent — und werden als solche gemeldet („bitte Komma … oder die Punkte
  weglassen"), **nicht geraten**: `Number("10.000")` ist 10, drei
  Größenordnungen würden lautlos verschwinden.

Umgerechnet wird an **einer** Stelle (`lib/eingabe-format.ts`, reine
Funktionen), einmal in der Server-Action; danach rechnen und schreiben alle
mit demselben Wert. `type="number"` ist in den Formularen nicht mehr zulässig
und wird von einem Test bewacht.

## Beleg-Feld „Freigabe zur externen Verwendung" (E34, 25.09.2026)

Das Feld `extern_nachvollziehbar` ist seit E34 eine **Freigabe**, keine
Aussage über die Nachweiskraft, und beeinflusst die Qualitätsstufe **nicht**.
Beschriftung „Freigabe zur externen Verwendung"; Hilfetext gesetzt: „ja –
dieser Beleg darf extern verwendet werden (Kommunen-PDF, CSV-Export ab F6).
Auf die Qualitätsstufe hat das keinen Einfluss.", nicht gesetzt: „nein – nur
intern verwenden. Auf die Qualitätsstufe hat das keinen Einfluss." Im Detail
„Freigabe extern: ja, für externe Verwendung freigegeben" / „nein, nur intern".
Bis F6 ist die Freigabe beauftragt, aber ohne Wirkung — der Text sagt das,
statt eine Wirkung zu versprechen (Regel aus dem Praxistest vom 24.09.2026:
Beschriftungen beschreiben die tatsächliche Wirkung).

**Historie:** Vor E34 ging der Haken in die Qualitäts-Ableitung ein
(„vollständig" verlangte ihn), und davor versprach der Hilfetext eine
PDF-Freigabe, die es nicht gab. Beides ist Altbestand.

## Belegtypen und Qualitätsstufen (E34, 25.09.2026)

Sieben Typen, **überall in dieser Reihenfolge** (Chips im Formular,
Filteroptionen, Auswertung, Tabellensortierung): Betriebsdaten · Vertrag ·
Absichtserklärung · Angebot · Gespräch · Dokument · Webrecherche. Die
Reihenfolge ist die Rangfolge der Beweiskraft, sie kommt aus
`lib/qualitaet.ts` (`BELEG_TYPEN`) und wird nirgends zweitgepflegt.

Die Stufe hängt nur an Typ und Nachweis (Datei bzw. Link). Die Qualitäts-Box
sagt deshalb „Aus Belegtyp und Nachweis (Datei bzw. Link) berechnet". **D
heißt nicht „lückenhaft"**: Ein vollständiger Webrecherche-Beleg ist D — D ist
die niedrigste *belegte* Stufe, „unbelegt" bleibt dem Strom ohne Beleg. Bei
Webrecherche zeigt die Box das ausdrücklich („immer Stufe D; der Link ist
Pflicht im Formular, er ändert die Stufe nicht") — Formularpflicht und
Stufenbedingung sind für den Erfasser unterscheidbar.

**Ein Feld `gueltig_bis`, typabhängig beschriftet** (E33): „Daten
repräsentativ bis" (Betriebsdaten), „Vertrag läuft bis", „Absichtserklärung
gültig bis", „Angebot gültig bis" — Pflicht mit Stern, nur bei diesen vier
Typen sichtbar. Gespräch, Dokument und Webrecherche zeigen kein Datumsfeld;
ihre Frist (3 / 6 / 3 Monate ab Erhebungsdatum) erscheint als „Nächste
Verifizierung" in der Qualitäts-Box und im Detail.

## Zugang und Rollen (F8/E30, 24.09.2026)

Die **Rollen-Pille** im Konto-Menü zeigt die Rolle aus der Datenbank
(`betrachter.` / `bearbeiter.` / `admin.`) — zurückgenommen wie die
Qualitäts-Pillen (`konf--rolle`, Sunken-Fläche, Sekundärtext): Sie benennt
einen Zustand, sie wirbt nicht. Keine Ampelfarben, kein Rang durch Farbe.

Die **Zugangsseite** ist kein Randfall, sondern Regelfall: Die Access-Policy
ist eine Domänenregel, jede `@bhyo.de`-Adresse kommt durch Access — wer neu
dazukommt, landet zuerst hier. Sie ersetzt die gesamte Oberfläche
(`shell--gesperrt`, mittig, ohne Navigation daneben) und nutzt den bestehenden
`EmptyState` statt eines eigenen Layouts.

Inhalt in dieser Reihenfolge: Icon-Scheibe → Titel lowercase mit Punkt
(„kein zugang eingerichtet." bzw. „zugang deaktiviert.") → ein erklärender
Satz → Detailblock mit **der angemeldeten Adresse** (damit sichtbar ist,
welches Konto gemeint ist — man ist womöglich mit dem falschen angemeldet)
und der **Kontaktadresse**. Die Kontaktadresse ist die E-Mail des ersten
aktiven Admins, **aus der Datenbank gelesen, nie fest eingetragen**, damit sie
stimmt, wenn sich die Admins ändern; ohne aktiven Admin steht dort ein
neutraler Hinweis statt einer leeren Zeile. Zwei Fälle, zwei Wortlaute — eine
deaktivierte Adresse bekommt nicht denselben Text wie eine unbekannte.

Kein Schreibrecht heißt: Aktionen werden **ausgeblendet** (`canEdit` aus der
Rolle), nicht deaktiviert dargestellt. Die Oberfläche ist dabei nie der
Schutz — die Durchsetzung sitzt serverseitig in `lib/wache.ts`.

## Formularblock „Ort" (F0a, 23.09.2026; F4-Korrekturen 24.09.2026)

Reihenfolge von oben: Adresssuche (debounced Vorschlagsliste, Auswahl
füllt die Felder und setzt den Pin) → „Adresse von bestehendem Standort
übernehmen" (nur sichtbar, wenn der gewählte Akteur Ströme mit Adresse
hat) → Straße · Hausnummer → PLZ · Ort → Bundesland (schreibgeschützt,
Kennzeichen „vorläufig, aus der Adresssuche") → Kartenausschnitt mit
Pin. Die Suche ist Bequemlichkeit, kein Tor: Fällt der Dienst aus, sagt
die Meldung ausdrücklich, dass Adresse und Pin vollständig von Hand
gesetzt werden können. Klick setzt den Pin, Ziehen verschiebt ihn — dann
ist die Koordinate führend und die Adressfelder werden per
Rückwärtssuche als „aus Pin übernommen" nachgezogen. Der Landkreis
erscheint nicht im Formular (bleibt Attribut in Filter, Tabelle, CSV).
Attribution „Suche: © OpenStreetMap-Mitwirkende" als Caption.


**F4 (24.09.2026):** Der Hinweis „Ohne Pin erscheint der Strom nicht auf der
Karte" hängt am **tatsächlichen Pin-Zustand** und steht im Ort-Block — vorher
stand er statisch im Formular, erschien also auch nach einer Adresssuche und
blieb stehen, wenn man den Pin von Hand setzte. Das Link-Feld des Belegs ist
`type="text"` (nicht `url`): „www.beispiel.de" genügt, das `https://` ergänzt
`normalisiereUrl` beim Speichern. Die Saison-Zahlenfelder nutzen `step="any"`
— mit einem Fünferraster wies der Browser jeden Zwischenwert ab; die
Fünferschritte bleiben auf den Pfeiltasten des Balkens. „Vergeben an" ist
ausgegraut und leer, sobald „an bhyo" gesetzt ist.
## Beleg-Erfassung (F7, 23.09.2026; E33/E34 26.09.2026)

Pflicht am Beleg sind Quellenangabe und Erhebungsdatum, dazu `gueltig_bis`
bei den oberen vier Typen und der Link bei Webrecherche; Datei und Link sind
sonst optional. Die Qualitäts-Box zeigt im Moment der Entscheidung den
Preis: „Ohne Datei oder Link erreicht dieser Beleg nur Stufe X" (nur wenn
eine Datei die Stufe tatsächlich höbe — bei Gespräch und Webrecherche
nicht). Der Erfassungsgrad zählt „Datei oder Link vorhanden" als Prüfpunkt.

## Mini-Switch (Modul-Umschalter)

Pillen-SegmentedControl im Modulkopf (z. B. „energie ↔ CO₂ & Asche"):
sunken Track (`--surface-sunken`, Pill-Radius), aktive Option als Karte
(`--surface-card` + Kartenschatten), Caption-Typo. CO₂ mit tiefgestellter
2. Schaltet nur die Datenreihe des Moduls, nie die URL.

Ausnahme (AP1j PR 4): Die **Zeitbezug-Zeile** der auswertung. nutzt
dieselbe Optik für zwei URL-getriebene Switches — Einzeljahr ↔ Zeitraum
und ø pro Jahr ↔ Summe im Zeitraum (nur im Zeitraum-Modus sichtbar) —
plus Jahr-Pillen (`fchip`) aus der gedeckelten Pool-Achse. Sie ändern die
Datenbasis der ganzen Seite und leben deshalb in der URL
(`zeitmodus`/`jahre`/`agg`).

## Jahresachse (E16/E17)

- Achse **dynamisch aus den Belegzeiträumen**, lückenlos vom frühesten bis
  zum spätesten Jahr; Jahre ohne Belege als **0-Balken**, nie als Lücke.
  Offene Zeiträume beginnen ab dem aktuellen Jahr (E17).
- **E16-Deckel** (AP1j PR 4): Die Achse endet bei min(spätestes
  Zeitraumende, aktuelles Jahr + 10); läuft ein Beleg darüber hinaus,
  trägt die letzte Säule den Überlauf-Marker „+ bis JJJJ"
  (Caption, `--text-tertiary`).
- Säulen füllen die Modulbreite bis ~7 Stück; ab **8 Balken** greift die
  Mindestbreite **52 px** und der Container scrollt horizontal.
- **Vergangenheit**: Balken-Füllung `0.4`, Beschriftung `0.6`, dazu eine
  gestrichelte Hairline vor dem ersten nicht-vergangenen Jahr. Das
  **aktuelle Jahr** füllt in `--status-active`; Zukunft normal.

## Formen und Rahmen

- Ein Radius: **14 px** für alles Rechteckige, ohne Ausnahme.
- Rahmen **1 px** im Ruhezustand, **1,5 px** aktiv; die Auswahl trägt zusätzlich
  Lime. Keine 3-px-Rahmen.
- Kartenmarker bleibt auch aktiv bei 1 px: bei 12–20 px Durchmesser würde ein
  dickerer Ring zu viel Fläche fressen, dort markiert die Farbe.
- `markerGroesse()` = 12–38 px, mengenabhängig, unverändert.

## Typografie

Manrope 700/800 für Überschriften und Kennzahlen, Inter 400/600 für Fließtext
und Tabellen, Ziffern mit `tabular-nums`. Self-hosted über `next/font/google`,
kein Laufzeit-Request.

## Zahlenformate (E20, 22.09.2026)

Keine Nachkommastellen in der Darstellung — passt eine Größe damit nicht,
wechselt die **Einheit**, nicht die Regel: Feedstock-Preise €/t atro
(„78 · −124"), stoffliche Output-Preise €/t (vorher €/kg), energetische
Output-Preise €/MWh (vorher ct/kWh), Mengen ganzzahlig, Quoten und
Anteile ganzzahlig, Saisonanteile per Largest-Remainder mit Summe exakt
100. Formatiert wird ausschließlich über die Funktionen je Größenart in
`lib/format.ts` — kein `toFixed`, keine punktuellen Formatierungen in
Komponenten. Genau zwei Ausnahmen: die Mio.-Darstellung ab 1 Mio €/a
behält **eine** Nachkommastelle, und Faktoren sichtbar dargestellter
Rechenketten (TS-Gehalt, Aschegehalt, Umwegfaktor, km-Satz, Nutzlast)
behalten die erfasste Genauigkeit.

## Haltung (gilt unverändert seit V1)

- Führung über Farbe, Schriftgewicht und Weißraum, nicht über Linien.
- Minimalistisch und elegant – daher auch der 20-px-Boden.
- Noise reduzieren: keine doppelte Kodierung, keine dekorativen Icons, keine
  Ampelfarben.
- Kacheln gruppieren Inhalte; nicht jede Zeile wird eingerahmt.
- Freiflächen zulassen: Text und Diagramme dürfen ohne Kasten stehen.
- Navigation: benannte, selbsterklärende Ziele, kein Icon ohne Label.

## Export-Menü (E36, 26.09.2026)

Ein Export-Knopf (Download-Icon; in auswertung. mit Text „Export", in der
Filterzeile von ströme. nur Icon) öffnet ein Glas-Popover: oben die Wahl
**extern / intern** als zwei Zeilen mit Kurzsatz (voreingestellt extern),
bei „intern" ein sunken Hinweiskasten „Interne Datei: enthält nicht
freigegebene Belegangaben und Abnehmernamen. Nicht weitergeben.", darunter
die Ausgaben als `menu-item` mit dem gewählten Modus als `kurz`-Label. Kein
Rang durch Farbe; der Modus steht in Worten.

## Druck-Abzug (F6 PR B, 26.09.2026)

Eigenes Print-Layout ohne Glaseffekte: Papierbreite 900 px am Bildschirm
als Vorschau, im Druck A4 mit fixierter Fußzeile. Sidebar, Kopfleiste und der
Aktionsknopf sind im Druck ausgeblendet. Kopf: Titel „bhyo · Marktdaten",
darunter der Modus-Satz als Rahmenzeile (intern invertiert, damit er auf
jeder Kopie ins Auge fällt), dann die Metazeilen als zweispaltige
Definitionsliste. Je Strom ein Datenblatt mit Trennlinie, Titel = Akteur,
rechts Art und Materialart/Produkt, darunter die neun Gruppen des
Exportmodells dreispaltig. Benannte Zustände („entfällt", „nicht erfasst",
„nicht zur externen Verwendung freigegeben") stehen kursiv in Sekundärfarbe,
Zahlen tabular mit Einheit am Wert. Keine Karte, keine Farbe als Rang.

## Preiskorridor am Einzelstrom (E38, 28.09.2026)

Im Detail unter „preis.": eine Skala (sunken Track) mit zwei Stufen — das
Band der Vergleichsgruppe in Navy-200 (Dark: Weiß 16 %) mit Strich am
Mittel, darüber der Strom als Navy-900-Balken min–max mit Lime-Punkt am
Mittel (Output: nur der Punkt). Achse mit kleinstem und größtem Wert und der
Einheit; gestrichelte Nulllinie, wenn Annahmeentgelte die Skala unter 0
ziehen. Darunter die Legende (Gruppe mit n Vergleichswerten, dieser Strom)
und die Wertung als fetter Satz aus der Sicht bhyo. Ohne Band steht kursiv
der benannte Zustand („zu wenig Vergleichswerte"). Keine Ampelfarben; die
Richtung steht in Worten.
