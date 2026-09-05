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
