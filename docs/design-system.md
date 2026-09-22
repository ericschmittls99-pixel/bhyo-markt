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

Nebentag: Die Reservierung erscheint immer zusätzlich als kleiner
**Stempel mit der Bildmarke** (`res-stempel`, 22 px, quiet-Ton, Tooltip
„Für bhyo reserviert"), sobald sie nicht selbst der Haupttag ist — bewusst
keine zweite große Pille, damit die Zeile einspurig bleibt.
Die zwei auswertung.-Switches (Einzeljahr ↔ Zeitraum, ø ↔ Summe) folgen
mit AP1j PR 4.

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
  Vorzeichen-Konvention („− = Annahmeentgelt") — stehen **in der Caption**,
  nie hinter einem ⓘ-Popover und nie als Stat-Mehrfachwerte in einer
  Kachel.
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
- **Balken** tragen die Flachfarbe des Clusters bzw. der Output-Gruppe.
  **Spannenbänder** (Min–ø–Max) sind 8-px-Pillen mit Farbfüllung (`0.6`)
  und ø-Punkt in `--status-active`. Die Skala ist **für alle Zeilen des
  Moduls gemeinsam** und läuft exakt vom kleinsten Min bis zum größten Max
  aller Positionen — kein 0-Anker, volle Bandbreite (E18).
- **Zweigeteilte Listen** (energetisch/stofflich, E13) trennen Sektionen
  durch eine Caption-Zeile („energetisch · MWh/a"), nicht durch Rahmen.

## Akkordeon-Muster (Materialarten/Produkte)

- Der Aufklapp-Pfeil ist ein **eigener Knopf** (`aria-expanded`, Phosphor
  `caret-down/up`), absolut oben rechts in der Zeile positioniert —
  Zeilenklick togglet die Facette, Caret klappt auf. Beides nie auf
  demselben Element. Die Kopfzeile reserviert dafür rechts 26 px
  Innenabstand, sodass Werte mit und ohne Caret bündig enden.
- Unterzeilen: Kopfzeile 24 px eingerückt, Caption-Typo, der Balken läuft
  aber in **voller Modulbreite auf derselben Spur und Skala wie die
  Elternzeilen**; klickbar auf ihre eigene Facette (materialart/produkt),
  ohne Code nicht klickbar. Zustand rein clientseitig, nicht in der URL.

## Mini-Switch (Modul-Umschalter)

Pillen-SegmentedControl im Modulkopf (z. B. „energie ↔ CO₂ & Asche"):
sunken Track (`--surface-sunken`, Pill-Radius), aktive Option als Karte
(`--surface-card` + Kartenschatten), Caption-Typo. CO₂ mit tiefgestellter
2. Schaltet nur die Datenreihe des Moduls, nie die URL.

## Jahresachse (E16/E17)

- Achse **dynamisch aus den Belegzeiträumen**, lückenlos vom frühesten bis
  zum spätesten Jahr; Jahre ohne Belege als **0-Balken**, nie als Lücke.
  Offene Zeiträume beginnen ab dem aktuellen Jahr (E17).
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

## Haltung (gilt unverändert seit V1)

- Führung über Farbe, Schriftgewicht und Weißraum, nicht über Linien.
- Minimalistisch und elegant – daher auch der 20-px-Boden.
- Noise reduzieren: keine doppelte Kodierung, keine dekorativen Icons, keine
  Ampelfarben.
- Kacheln gruppieren Inhalte; nicht jede Zeile wird eingerahmt.
- Freiflächen zulassen: Text und Diagramme dürfen ohne Kasten stehen.
- Navigation: benannte, selbsterklärende Ziele, kein Icon ohne Label.
