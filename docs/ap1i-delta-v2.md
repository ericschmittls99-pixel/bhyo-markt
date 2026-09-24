# AP1i — Delta-Bericht V2-Redesign (Claude-Design-Mockup → Code)

Stand: 2026-09-11 · **Von Eric freigegeben am 2026-09-11** — alle offenen
Punkte sind entschieden, siehe Abschnitt 8 (Entscheidungslog). Die früheren
Formulierungen „Entscheidung nötig" in den Abschnitten 3–5 sind damit durch
das Log in Abschnitt 8 aufgelöst.

Quellen, in Vorrangreihenfolge:

1. **Mockup** `bhyogenics Tool.dc.html` aus dem Handoff-Projekt „Bhyo
   Biomasse-Dokumentationstool" (Projekt `c27d23be-…`, vollständig gelesen:
   Template + Logik/Props + Beispieldaten). Das Projekt enthält außerdem zwei
   ältere Iterationen (`Tool Shell.dc.html`, `Tool Shell v1.dc.html`) — laut
   Ansage zählt nur `bhyogenics Tool.dc.html`. Einen separaten Chatverlauf oder
   eine Bundle-README gibt es im Projekt **nicht** als Datei; die fachlichen
   Uploads (`uploads/AP1a…AP1f-a*.md`) sind die bekannten Handoff-Dokumente.
2. **Design System bhyo_2.0 (v3)** aus `_ds/bhyo-2-0-…`: README, `styles.css`,
   10 Token-Dateien, `_ds_bundle.js` (31 Komponenten, Namespace `Bhyo_e456e0`).
3. `docs/design-system.md` (Repo, wird nachgezogen).

---

## 0. Gesamtbild — was das Mockup wirklich ist

Das Mockup ist **keine Umgestaltung der fünf heutigen Seiten**, sondern eine
komplette Anwendungs-Shell mit eigener Informationsarchitektur:

- **Eine App-Shell** (Sidebar + Kopfzeile) mit sechs Bereichen:
  `ströme.` (mit Unterpunkten Feedstock / Outputs), `karte.`, `auswertung.`,
  `planer.` (mit Projekt-Unterpunkten), `import.`, unten `einstellungen.`
- Das heutige **Register wird zu `ströme.`** — mit Grid-Ansicht (Foto-Karten)
  als Default, Listen-Ansicht (DataTable), Sortiermenü, Facetten-Chips.
- Die heutige **Neu-anlegen-Seite entfällt als Route-Konzept**: Anlegen und
  Bearbeiten laufen im Mockup als **rechtes Slide-in-Panel** über der Liste
  (gleicher Container wie das Detail-Panel), nicht als eigene Seite.
- **karte.** wird full-bleed mit Glas-Overlays, Orb-Markern mit
  Mengen-Skalierung, Marker-Aggregation mit Fächer-Aufklappen, ziehbarer
  Legende und Fokusregion-Zeichnen inkl. Bestätigungs-/Benennungs-Dialog.
- **auswertung.** wird ein Bento-Dashboard (Modulraster) mit klickbaren,
  filternden Diagramm-Zeilen; Filter werden mit der Karte **geteilt**.
- Die heutige **Bewertung heißt `planer.`** und zeigt RegionTiles statt Tabelle.
- **Dark Mode** ist vollständig ausgearbeitet (Umschalter im Konto-Menü).

Die Ansage (4d) erwartete eine **Belegdokumentation** mit Grid/Liste-Umschalter.
**Das Mockup enthält keinen solchen Screen.** Der Grid/Liste-Umschalter sitzt im
Mockup auf `ströme.` (Foto-Grid ↔ DataTable). Behandlung siehe Abschnitt 5.1.

---

## 1. Delta-Tabellen je Screen

Aufwand: S ≈ Stunden, M ≈ halber–ganzer Tag, L ≈ mehrere Tage.

### 1.1 Shell (Layout, Navigation, Kopfzeile) — heute `app/layout.tsx` + `NavLinks`

| Element | heute | V2 (Mockup) | Art der Änderung | Aufwand |
| --- | --- | --- | --- | --- |
| Navigation | Horizontaler Header mit 4 Textlinks (Register, Karte, Auswertung, Bewertung) | Sidebar 264 px, einklappbar auf 72 px, Toggle-Button oben (erscheint eingeklappt beim Hover statt Logo), Punkte mit Phosphor-Icon + Label, aktiver Punkt = weiße Fläche + Schatten + gefülltes Icon in Waldgrün | neue Funktion | L |
| Nav-Punkte | Register/Karte/Auswertung/Bewertung | `ströme.` (Akkordeon: Feedstock, Outputs) · `karte.` · `auswertung.` · `planer.` (Akkordeon: je Fokusregion ein Kind + „Projekt starten") · `import.` · unten abgetrennt `einstellungen.` | neue Funktion + neue Screens | (in Sidebar enthalten) |
| Akkordeon-Caret | — | Separater `<button>` mit `aria-expanded`, Caret rotiert 0→90° | neue Funktion | S |
| Logo | Textmarke „bhyo Markttool" mit Punkt-Ornament | Bildmarke SVG 32 px + Wortmarke SVG 18 px (Navy/Weiß je Theme), eingeklappt nur Bildmarke | nur Styling (Assets neu) | S |
| Kopfzeile | Brand + Nav + E-Mail-Text | 72 px: Seitentitel links (`ströme.` bzw. Projektname), rechts Inbox-Button (mit Ungelesen-Punkt) + Avatar | neue Funktion | M |
| Inbox | — | Glas-Popover 360 px: Titel `inbox.`, „Alle als gelesen markieren", Einträge (Avatar oder System-Icon, Titel, Meta, Ungelesen-Punkt, Trennlinien), EmptyState `keine nachrichten.` | neue Funktion, **braucht Daten die es nicht gibt** (→ 5.2) | M |
| Konto-Menü | E-Mail als Text | Avatar-Button → Glas-Popover: Avatar, Name, E-Mail, Rollen-Pille (`admin.` / `bearbeiter.` / `betrachter.`), Menü: Profil · Dunkles Design (Toggle) · Abmelden | neue Funktion (Rolle existiert in `benutzer`-Tabelle; Profil/Abmelden als Platzhalter-Toast) | M |
| Theme | nur Light (Dark-Werte in globals.css vorhanden, `prefers-color-scheme`) | Light + Dark via `data-theme="dark"`, Umschalter im Konto-Menü | neue Funktion | M |
| Seitentitel `<h1>` | pro Seite im Inhalt | in der Kopfzeile der Shell | nur Styling | S |

### 1.2 `/register` → `ströme.`

| Element | heute | V2 (Mockup) | Art der Änderung | Aufwand |
| --- | --- | --- | --- | --- |
| Tabs | 2 Textlinks „Biomasse / Output" | SegmentedControl „Feedstock / Outputs" (sunken Track), zusätzlich als Sidebar-Kinder | nur Styling + Umbenennung | S |
| Suche | Feld „Suche" in der Filterkarte | Eigenes SearchField in der Toolbar (`Quelle, Ort, Materialart suchen` bzw. `Abnehmer, Ort, Output suchen`), mit Clear | nur Styling | S |
| Primäraktion | „+ Neu anlegen" | Button `Feedstock anlegen` / `Output anlegen` (Lime, Icon plus), nur für Rollen mit Schreibrecht | nur Styling + Rollenlogik | S |
| KPI-Zeile | 3 KPI-Karten (Anzahl, Summe, A+B-Anteil) | **entfällt** auf ströme. — stattdessen Zähltext `n Ströme (gefiltert)` links in der Filterzeile; KPIs leben in `auswertung.` | entfällt | S |
| Filter | Immer sichtbare GET-Formular-Karte (Region, Suche, Materialart/Gruppe, Cluster, Qualität, Datenjahr, Landkreis, Status, „Filtern"-Button) | Ausklappbare Chip-Leiste: FilterChip `Filter` (mit Zähl-Count, `aria-controls`) öffnet Facetten-Chips Region · Cluster · Materialart · Qualität · Status · Belegtyp (Outputs: Region · Landkreis/Ort · Output-Kategorie · Output · Qualität · Status · Belegtyp); jeder Chip öffnet Glas-Popover mit Facetten-Suche + Checkbox-Menü + „Auswahl aufheben"; Chip `Weitere Filter` (Menge min/max, Preis min/max, Verfügbar ab, Erstellt am) als Formular-Popover; X-Button „Filter zurücksetzen"; **Mehrfachauswahl je Facette** | neue Funktion | L |
| Responsive Filterzeile | — | Bei Platzmangel: „Weitere Filter" → „+"-Icon-Chip, Sortier-Button → Icon-only (im Mockup per ResizeObserver) | neue Funktion | M |
| Sortierung | feste Sortierung | Button `Sortieren:` + Menü mit 12–13 Kriterien (Titel, Region, Cluster/Landkreis, Materialart/Output, Qualität, Status, Belegtyp, Menge, Preis, Verfügbar ab/bis, Erstellungsdatum), auf-/absteigend; in der Liste zusätzlich klickbare Spaltenköpfe mit Pfeil + `aria-sort` | neue Funktion | M |
| Ansicht | nur Tabelle | SegmentedControl `Grid / Liste` (Icons squares-four / list) — **Grid ist Default** | neue Funktion | (siehe unten) |
| Grid-Karte | — | Foto-Karte: 4:3-Foto (Materialart-/Output-Foto, Fallback Cluster-Foto), Glas-Pille mit Materialart lowercase+Punkt, Cluster-Orb 24 px oben rechts auf weißem Ring, **Vollständigkeits-Ring** 28 px unten links, Titel = Akteur, Untertitel = Ort/Landkreis, Mengen-Pille (`1.850 t FM/a`), t-atro-Text, ConfidencePill + StatusPill + Preis, Zeile `Verfügbar 01/2026 – 12/2028` | neue Funktion + neues Datenfeld (Vollständigkeit berechenbar, Fotos vorhanden) | L |
| Liste | 7 Spalten (Quelle/Akteur, Materialart/Vektor, Zeitraum, Menge, Qualität, Beleg, Status) | DataTable: Quelle/Abnehmer (zweizeilig), Materialart mit Orb 16 px + Cluster-Untertitel (bzw. Output + Gruppe·Kategorie), Region, Menge (t FM/a), **t atro/a** (fett), Preis, Verfügbar, Qualität, Status, Beleg — sortierbare Köpfe, aktive Zeile markiert | nur Styling + neue Spalten | M |
| Leerzustand | Textzeile in Tabelle | EmptyState `keine treffer.` mit Icon funnel, Beschreibung, Aktion „Filter zurücksetzen" | nur Styling | S |
| Detail | Rechtes Drawer-Panel (read-only), URL `?detail=` | Zwei Modi: aus Grid **Modal** (680 px, Scrim mit Blur), aus Liste/Karte **Panel** (520 px, Slide-in). Kopf: Orb 44 px, Titel, Untertitel, Pillen (Qualität, Status, Belegtyp, `n % vollständig.`), Aktionen `Bearbeiten` / Papierkorb / X. Abschnitte: `quelle.` (+ Standort-Box mit Koordinaten + „Auf der Karte"), `materialart & zeitraum.`, `mengen.` (**ConversionChain** Rohmenge→TS→Asche→t atro), `saisonalität.` (SeasonBars), `preis.`, `beleg.`, `begründung.`, `änderungshistorie.` | nur Styling + neue Funktion (Bearbeiten, Modal-Modus, ConversionChain, Standort-Box) | L |
| Löschen | — (bewusst: Status `verworfen`) | Papierkorb-Button → Modal `strom löschen.` → entfernt Datensatz | **Konflikt mit Leitplanke** → 5.3 | — |

### 1.3 `/register/[art]/neu` → Formular-Panel

| Element | heute | V2 (Mockup) | Art der Änderung | Aufwand |
| --- | --- | --- | --- | --- |
| Container | Eigene Seite | Slide-in-Panel 520 px rechts (gleicher Rahmen wie Detail), Titel `feedstock anlegen.` / `output anlegen.` / `strom bearbeiten.`, Untertitel `Ein Strom je Quelle × Materialart × Zeitraum.`, Fußleiste Abbrechen / Anlegen bzw. Speichern | neue Funktion (Route bleibt als Einstieg bestehen → 5.4) | L |
| Bearbeiten | — (nur Anlegen) | Voll ausgebautes Edit desselben Formulars aus dem Detail | neue Funktion | M |
| Quelle | AkteurCombobox, Bezeichnung, Ort, Landkreis (Text), Kontaktperson | Akteur (Select, Pflicht), Bezeichnung (mit Beispiel-Platzhalter), Ort + **Landkreis als Select**, Kontaktperson (optional-Label), Hinweis-Box `Karten-Pin setzen folgt …` | nur Styling (+ Landkreis-Select: neue Datenquelle nötig → 5.2) | M |
| Kategorie | MaterialartCombobox bzw. Produkt-Select mit optgroups | Feedstock: **Cluster-Select + Materialart-Select gekoppelt** (Clusterwechsel leert Materialart); Output: Output-Gruppe + Output gekoppelt, Hinweis `Kategorie: Target Output / Add-On` | nur Styling/Verhalten | M |
| Zeitraum | 2 × `type=date` | 2 × `type=month` `Verfügbar ab` / `Verfügbar bis` | nur Styling (Datenmodell hat Datum; Monat wird auf Monatsersten/-letzten gemappt) | S |
| Mengen | Rohmenge/TS/Asche + read-only atro-Feld | Gleiche 3 Felder mit Einheiten-Suffix im Feld, darunter **ConversionChain als Live-Vorschau** (Richtung row); Output: Bedarfsmenge + Einheit-Select (`t/a`, `MWh/a`, `Nm³/a`) | nur Styling | M |
| Saisonalität | SaisonEditor (12 Felder) | SeasonBars-Anzeige + Buttons `KI-Vorschlag laden` (**disabled**, Platzhalter für AP2) und `Gleichverteilung`; Hinweis `Ziehbare Balken folgen mit der Umsetzung.` — d. h. Mockup selbst verschiebt das Editieren; wir behalten die 12 Eingabefelder zusätzlich zur Bar-Vorschau (→ 5.4) | nur Styling + Platzhalter | M |
| Preis | Min/Mittel/Max + Herkunft (nur Biomasse) | Feedstock identisch (mit €/t-Suffix, Herkunft-Hinweis `Eigener Wert setzt die Herkunft auf Schätzung.`); **Outputs neu: Preis + Preis-Einheit** (`€/t`, `€/MWh`, `€/kg`) | neues Datenfeld (Output-Preis → 5.2) | M |
| Beleg | Pill-Toggles (6 Typen), Felder je Typ, Datei-Upload nach R2 | FilterChips als Radiogroup, Quellenangabe (Pflicht, Beispiel-Platzhalter), `Datei oder Link` + Button `Datei wählen` (Toast-Platzhalter im Mockup — **R2-Upload bleibt**), Erhebungsdatum, `Angebot gültig bis` / `Gesprächsdatum` + `Gesprächspartner` + Kernnotiz (Textarea), Toggles `Extern nachvollziehbar` (mit dynamischer Beschreibung) und `Amtliche Quelle oder Betreiberdaten` | nur Styling | M |
| Qualität | Pille im Kopf | Sunken-Box: `Qualität (abgeleitet)` + A–D-Pillenreihe (aktive Stufe opak, Rest 30 %), Text `Aus Belegtyp und Nachvollziehbarkeit berechnet, nicht editierbar. Nächste Verifizierung: <Datum>` | nur Styling (**Verifizierungsdatum = offene Fachfrage** → 5.3) | S |
| Begründung | Textarea + Status-Select | Textarea `Warum dieser Wert, warum diese Quelle?` — **kein Status-Feld im Formular** (Neuanlage → immer `entwurf`; Statuswechsel außerhalb) | entfällt (Feld) → 5.4 | S |
| Validierung | HTML `required` + Server-Fehlerbox | Inline-Fehler je Feld (`Pflichtfeld`, `Datei oder Link erforderlich`) erst nach Speichern-Versuch; Toast `Strom angelegt – Status Entwurf` | neue Funktion | M |

### 1.4 `/karte` → `karte.`

| Element | heute | V2 (Mockup) | Art der Änderung | Aufwand |
| --- | --- | --- | --- | --- |
| Layout | Karte als Karte-im-Inhalt (Card), FilterBar oben, Legende darunter | **Full-bleed** unter der Kopfzeile, alle Bedienelemente als Glas-Overlays auf der Karte | nur Styling (großer Umbau) | L |
| Basemap | MapLibre GL + OSM-Raster, unbearbeitet | OSM-Raster **entsättigt** (grayscale/saturate-Filter), Dark Mode invertiert; Mockup nutzt Leaflet — **wir bleiben bei MapLibre** (→ 5.4) | nur Styling | M |
| Toolbar | — | Glas-Leiste oben links: SearchField `Ort, Region, Quelle, Materialart …` mit Treffer-Popover (Orte mit Pin-Icon, Fokusregionen mit Rahmen-Icon, Ströme mit Orb; Kategorie-Label rechts; `keine treffer.`), SegmentedControl `Alle / Feedstock / Outputs`, FilterChip `Filter` mit Count | neue Funktion | L |
| Filterleiste | FilterBar-Karte oben | Ausklappbare zweite Glas-Leiste: Facetten-Chips Region · Cluster/Gruppe · Materialart/Output · Qualität · Status · Belegtyp + `Weitere Filter` (Verfügbar ab, Erstellt am) + Reset-X | neue Funktion (teilt Code mit ströme.-Chips) | M |
| Karten-Controls | MapLibre-Default-Zoom | Glas-Spalte rechts: + / − / Trenner / `Alle sichtbaren Ströme zeigen` (corners-out); zweite Glas-Box: `Fokusregion zeichnen` (selection-plus, aktiv = Lime) | nur Styling | M |
| Marker | Flache Kreise (Biomasse) / Rauten (Output), Größe ~ Menge, Qualitäts-Ring | **Orb-Marker** (PNG-Verlauf) in Glas-Halo, Fläche ∝ Menge (Feedstock t atro/a, Outputs je Einheit getrennt), Qualitäts-Ring A solid 2,5 / B solid 2 / C dashed / D dotted, Hover-Scale, aktiv = Lime-Ring; Tooltip als Glas-Karte (Akteur, Materialart · Menge · Ort, Qualität · Status) | neue Funktion | L |
| Aggregation | — | Nachbar-Marker im Pixelradius (80 px, Prop) verschmelzen: gleicher Cluster → ein Orb mit Zähler; gemischt → Stapel, Hover fächert Neben-Orbs 120° auf (Richtung = freie Seite), Klick zoomt hinein | neue Funktion | L |
| Fokusregion zeichnen | Button über der Karte, Rechteck, Prompt-Formular | Armed-Modus mit Crosshair + Navy-Hinweis-Pille unten (`Rechteck über die Karte ziehen · Esc bricht ab`), nach dem Ziehen: Spotlight-Maske + Glas-Dialog `fokusregion.` (Meta `n Ströme im Ausschnitt · a × b km`, ClusterStack) → Schritt 2 Name (Pflicht, Beispiel `z. B. Südpfalz West`) → `Anlegen` bzw. `Projekt starten` | nur Styling + neue Funktion (2-Schritt-Dialog) | L |
| Regionsumrisse | Polygone + Toggle in Legende | Abgerundete gestrichelte Rechtecke (custom: Lime solid), Glas-Label-Pille mit Namen + Zähler (Klick zoomt), Master-Toggle `regionsumrisse.` in der Legende | nur Styling | M |
| Legende | Card unter der Karte, statisch | Glas-Panel unten links 288 px, **per Griff ziehbar** (Apple-Sheet; Doppelklick = ganz auf/zu, Pfeiltasten, unter 96 px kollabiert auf Kopfzeile `legende.` + Zähler `n von m`), Abschnitte: `cluster.` (klickbare Zeilen mit Orb 18 px + Count = Filter), `qualität & größe.` (Ring-Beispiele + Erklärtext), `regionsumrisse.` (Toggle) | neue Funktion (Ansage 4c: ausklappbar; Mockup konkretisiert als ziehbar) | L |
| Detail | DetailPanel per `?detail=` | Panel-Modus wie ströme.; Marker-Klick öffnet, `Auf der Karte` im Detail fliegt zum Punkt (Karte verschiebt Zentrum um Panelbreite) | nur Styling | S |
| Zählzeile | „n Standorte" in Toolbar | in Legende (`n von m`) | nur Styling | S |

### 1.5 `/auswertung` → `auswertung.`

| Element | heute | V2 (Mockup) | Art der Änderung | Aufwand |
| --- | --- | --- | --- | --- |
| Filter | FilterBar-Karte | Toolbar: SegmentedControl `Alle / Feedstock / Outputs` + Trennstrich + dieselben Facetten-Chips wie karte. (**geteilter Filterzustand mit der Karte**) + `Weitere Filter` + Reset | neue Funktion (geteilter Zustand → 5.4 Querystring) | M |
| Layout | Vertikale Card-Liste | **Bento-Grid**: 4 Spalten × Modulhöhe 168 px, responsiv 2/1-spaltig | nur Styling | M |
| KPIs | 4 Karten (Gesamtmenge, Anzahl, A+B, Landkreise) | 4 MetricStat-Karten: `in der auswahl.` (n Belege, Feedstock/Outputs-Split) · `trockenmasse.` (t atro/a, aus t FM/a; bei Outputs-Sicht: `energiebedarf.` MWh/a) · `belege geprüft.` (%, x von y · z in Prüfung) · `ø erfassungsgrad.` (%, n Belege unter 50 %) | nur Styling + neue Kennzahlen (Erfassungsgrad berechnet) | M |
| Menge nach Cluster | Balkenliste | `biomasse je cluster.` (2×2-Modul): klickbare Zeilen (Orb 20 px, Label, Meta `n Belege · x %`, Balken in Clusterfarbe, Wert rechts; Klick = Filter, Tooltip mit Qualitätssplit); Outputs-Sicht: `belege je output-gruppe.`; Fußzeile `Outputs in der Auswahl: …` | nur Styling + neue Funktion (klick-filtert) | M |
| Menge nach Materialart | Doppelbalken atro/FM je Materialart | **entfällt** als eigener Block (nicht im Mockup) | entfällt | — |
| Qualität | Segment-Balken + Tabelle | `qualität der belege.` (1×2-Modul): **Donut** (Navy-Rampe A–D, Zentrum `x %` A+B) + klickbare Zeilen (ConfidencePill, Beschreibungstext, Count) | nur Styling | M |
| Status | — (nur im Register-KPI angedeutet) | `status.` (1×2-Modul): je Status StatusPill + Count + `x %` + Balken, klick-filtert | neue Funktion | S |
| Saisonalität | — | `saisonalität.` (2×2-Modul): SeasonBars `angebot · feedstock, gewichtet nach t atro/a` + `bedarf · outputs, gleichgewichtet`, Peak hervorgehoben, Fußnote `Angebotsspitze im … · Bedarfsspitze im …` | neue Funktion | M |
| Belegtypen | — | `belegtypen.` (2×1): 6 Typen zweispaltig mit Mini-Balken + Count, klick-filtert | neue Funktion | S |
| Jahre | „Zeitliche Entwicklung" (Datenjahr/Erhebungsjahr je Jahr) | `verfügbare biomasse je jahr.` 2026–2031 (t atro/a; Outputs: aktive Belege), aktuelles Jahr in Lime | nur Styling (andere Kennzahl) | M |
| Preis | — | `preiskorridor · feedstock.` (2×1): ø-Preis gewichtet + Min-Max-Skala mit Lime-Punkt; Outputs: ø je Preis-Einheit | neue Funktion | M |
| Verifizierung | — | `nächste verifizierung.` (2×1): 3 fälligste Belege (Orb, Akteur · Materialart · Belegtyp, Pille `fällig.`, Datum), Klick öffnet Detail | neue Funktion (**Gültigkeitsdauer = offene Fachfrage** → 5.3) | M |
| Abdeckung nach Landkreis | Tabelle | **entfällt** (nicht im Mockup) | entfällt | — |
| Zuletzt aktualisiert | Log-Liste | **entfällt** (nicht im Mockup) | entfällt | — |
| CSV-Export | Button `Export CSV` | **nicht im Mockup** — Vorschlag: behalten, als Sekundär-Button in der Toolbar (Abweichung, braucht Freigabe) | Konflikt → 5.4 | S |
| Leerzustand | „Keine Daten." je Card | EmptyState `keine belege.` zentriert mit Reset-Aktion | nur Styling | S |

### 1.6 `/bewertung` → `planer.`

| Element | heute | V2 (Mockup) | Art der Änderung | Aufwand |
| --- | --- | --- | --- | --- |
| Titel/Route | „Bewertung", `/bewertung` | Label `planer.` — **Route bleibt `/bewertung`** (Ansage 7) | Umbenennung | S |
| Kopf | h1 + „Projekt starten" | Toolbar: Zähltext `n Fokusregionen · m nicht gestartet`, rechts Button `Projekt starten` (Icon play + caret) → Menü: `Projekt auswählen` (Untermenü mit Regionen + Status als Shortcut-Text, `Zurück`) · `Region definieren` (springt in karte.-Zeichenmodus mit `drawFor=project`) | nur Styling + neue Funktion | M |
| Liste | Tabelle (Fokusregion, Cluster-Stack, Lauf-ID, Status, Aktion) | Kicker `fokusregionen.` + Erklärtext `Jede Fokusregion ist die Basis eines Projekts. Ohne Lauf gilt sie als nicht gestartet.` + Grid aus **RegionTile**-Karten (Name, Status, Strom-Anzahl, ClusterStack) | nur Styling (Lauf-ID-Spalte entfällt aus der Liste → im Projekt-Detail) | M |
| Projekt-Seiten | — | Je Region eine Unterseite (Sidebar-Kind): ohne Lauf EmptyState `noch nicht gestartet.` (+ Beschreibung `Fokusregion mit n Strömen. Der Start legt eine Arbeitsfassung an.` + Aktion `Projekt starten`); mit Lauf EmptyState `noch keine kalkulation.` (+ `Arbeitsfassung seit <Datum>. Der Kalkulations-Assistent folgt im nächsten Schritt.` + Aktion `Kalkulation starten` als Toast-Platzhalter) | neue Screens | M |
| Region definieren | Karte inline in Card | über karte. (siehe 1.4), `Projekt starten` als Primär-Label im Namens-Schritt, Erfolgs-Toast | nur Styling | S |

### 1.7 Neue Screens (heute nicht vorhanden)

| Screen | V2 (Mockup) | Aufwand |
| --- | --- | --- |
| `import.` | EmptyState `noch kein import.` — `Lade eine CSV- oder Excel-Datei hoch, um viele Ströme auf einmal anzulegen.` + Button `Datei auswählen` (Platzhalter-Toast; echter Import ist nicht Teil von AP1i) | S |
| `einstellungen.` | EmptyState `einstellungen.` — `Konto, Team und Rechte folgen im nächsten Schritt.` | S |
| Projekt-Unterseiten | siehe 1.6 | M |

---

## 2. Neu gegenüber der Ansage

Angesagt waren: Sidebar mit Akkordeons, ausklappbare Filterleiste, ausklappbare
Legende, Grid/Liste-Umschalter, Fotos, neue Labels. **Darüber hinaus** steckt im
Mockup:

**Informationsarchitektur & Screens**
1. Zwei komplett neue Nav-Bereiche: `import.` und `einstellungen.` (je EmptyState).
2. `planer.` mit Projekt-**Unterseiten** je Fokusregion inkl. zweier Zustände
   (nicht gestartet / Arbeitsfassung ohne Kalkulation) und Projekt-Start-Menü.
3. **Inbox** in der Kopfzeile (Einladungen, Import-Berichte, Rollenänderungen).
4. **Konto-Menü** mit Avatar, Rollen-Pille, Profil, Abmelden.
5. **Dark Mode inkl. Umschalter** („Dunkles Design" im Konto-Menü).
6. Detail als **Modal** (aus dem Grid) zusätzlich zum Panel; Formular als Panel
   statt eigener Seite; **Bearbeiten**-Funktion im Detail.
7. **Lösch-Flow** mit Bestätigungsmodal (Konflikt, siehe 5.3).

**Bedienelemente**
8. Facetten-Filter mit **Mehrfachauswahl**, Facetten-Suche, Zähl-Chips,
   „Weitere Filter"-Formular-Popover — deutlich mehr als „Filterleiste
   ausklappbar".
9. **Sortier-Menü** + sortierbare Tabellenköpfe.
10. Responsive Verdichtung der Filterzeile (Chips/Buttons werden Icon-only).
11. Karten-**Suche mit Treffer-Popover** (Orte, Regionen, Ströme).
12. Marker-**Aggregation mit Fächer-Aufklappen** und Mengen-Skalierung.
13. Legende **ziehbar** (Drag-Griff, Doppelklick, Tastatur) statt nur auf/zu.
14. Fokusregion-Zeichnen als **Zwei-Schritt-Glas-Dialog** mit Spotlight-Maske,
    Strom-Zähler und km-Angabe.
15. **Vollständigkeits-Ring** (Erfassungsgrad je Datensatz) in Grid-Karte und
    Detail-Pille; `ø erfassungsgrad.`-KPI.
16. Klick-filternde Diagramme im Dashboard (Cluster, Qualität, Status,
    Belegtyp), geteilter Filterzustand zwischen karte. und auswertung.
17. Toast-System (Glas-Pille) für Erfolgs-/Platzhaltermeldungen.
18. `KI-Vorschlag laden` (disabled) im Saisonalitäts-Block — Platzhalter für AP2.

**Design-Tokens & Sprache (bhyo_2.0 v3 ≠ heutiger Stand)**
19. **Font Geist** (variable, 300–800) statt Manrope/Inter — eine Familie für
    alles, tabulare Ziffern.
20. **Icon-Set Phosphor** (Regular/Bold/Fill) — heute gibt es keine Icons.
21. **Lime neu `#7DB535`** (heute `#8CC63F`) als Aktionsfarbe: Primär-Button,
    aktive Zustände, Fokus-Ring; Waldgrün wird Link-/Kicker-/Kategorie-Farbe.
22. Neue Flächenlogik: Seite `#F5F5F4`, Karten weiß **ohne Rahmen** mit
    zweistufigem Navy-Schatten (heute: Rahmen 1,5 px Waldgrün), sunken-Flächen
    Hellgrau; Glas nur für schwebendes Chrome.
23. Radius-Skala 6/8/12/16/24/32/pill mit Verschachtelungsregel (heute ein
    Radius 14 px).
24. **Kleinschreibung mit Schlusspunkt** für Titel, Kicker, Pillen (`ströme.`,
    `keine treffer.`, `in prüfung.`) — heute normale Orthographie.
25. Dark Mode auf `#1F2E38` mit Karten `#283A45` (heute `#16222A`).
26. Qualitäts-Pillen-Rampe aus Navy-Stufen (`navy-900/700/300/100`) statt der
    heutigen Grauwerte; Status-Töne `active`(Lime)/`running`(Waldgrün)/
    `quiet`/`inactive`.
27. Motion-Tokens (120/200/320/420 ms, Spring-Ease, Press-Scale 0.97).
28. Bento-**Modulraster** (4 Spalten × 168 px) als Layoutprinzip.
29. Beschriftungswechsel überall: `Feedstock`/`Outputs` statt Biomasse/Output,
    „Abnehmer" statt Akteur (Outputs-Tabelle), `Verfügbar ab/bis` statt
    Zeitraum von/bis, „Output" statt „Vektor", `planer.` statt Bewertung.

---

## 3. Braucht Daten, die es nicht gibt

Wird als **deaktivierter Platzhalter** bzw. mit vorhandenen Daten gebaut, nie
mit erfundenen Feldern:

| Mockup-Element | Fehlende Daten | Behandlung in AP1i |
| --- | --- | --- |
| Inbox (Einladungen, Import-Berichte, Rollenänderungen) | Kein Benachrichtigungs-Modell im Schema | Button + Popover mit EmptyState `keine nachrichten.`; keine Fake-Einträge |
| Rollen-Pille + Schreibrechte (`canEdit`) | ~~`benutzer.rolle` existiert~~ **falsch, siehe Korrektur unten**; `/api/me` liefert Identität | vertagt auf F8 (E30) |
| Avatar mit Foto (`avatarSrc`) | keine Avatar-Quelle | Initialen-Avatar aus E-Mail/Name |
| `Profil`, `Abmelden` | kein Profil; Logout ist Cloudflare-Access-Sache | Menüpunkte mit Toast wie im Mockup (`… folgt im nächsten Schritt.`) |
| `import.`-Funktion | kein Import-Backend | EmptyState + Button mit Toast (exakt so zeigt es das Mockup) |
| `einstellungen.` | — | EmptyState (exakt Mockup) |
| `KI-Vorschlag laden` (Saisonalität) | AP2-Anreicherung | Button disabled (exakt Mockup) |
| Kalkulation im Projekt | Rechenkern-Anbindung späteres AP | EmptyState + Toast (exakt Mockup) |
| Output-**Preis + Preis-Einheit** | `output_bedarf` hat kein Preisfeld | Formularfelder + Detailzeile **weglassen oder disabled**? Mockup zeigt sie mit Daten. **Entscheidung nötig**: Platzhalter (disabled) in AP1i, Schema in eigenem AP |
| Landkreis als Select | keine Landkreis-Lookup-Tabelle | Select aus `DISTINCT landkreis` der Bestandsdaten + Freitext-Fallback — oder Textfeld behalten. **Entscheidung nötig** |
| Nächste Verifizierung (Detail, Dashboard, Formular) | Gültigkeitsdauer je Belegtyp ist offene Fachfrage; Mockup nimmt 36/12/12/3/12/6 Monate an („Annahme" im Code) | `gueltig_bis` (Angebot) existiert; für andere Typen **nur anzeigen, wenn Regel freigegeben** — sonst Zeile/Kachel mit `–`/ausgeblendet. **Entscheidung nötig** (→ 5.3) |
| Vollständigkeits-Ring / `ø erfassungsgrad.` | kein Schema-Feld, aber aus vorhandenen Feldern berechenbar (Mockup-Checkliste: Bezeichnung, Kontakt, Ort, Landkreis, Zeitraum, Mengen, Preis, Saison ≠ flat, Beleg-Felder, Begründung, Status ≠ entwurf) | als reine Ableitung im Web-Code umsetzbar; Feldliste übernehme ich 1:1 aus dem Mockup |
| Koordinaten-Anzeige + `Auf der Karte` | `standort_geom` existiert | umsetzbar |
| Karten-Pin im Formular | Geocoding/Pin-Setzen fehlt | Hinweis-Box exakt wie Mockup (`Karten-Pin setzen folgt …`) |

### Korrektur 24.09.2026: `benutzer.rolle` existierte nie

Die Zeile zur Rollen-Pille stützte sich auf die Angabe „`benutzer.rolle`
existiert" und schloss daraus „umsetzbar — kein Platzhalter nötig". **Die
Angabe war falsch.** Es gab zu keinem Zeitpunkt eine `benutzer`-Tabelle; die
Handoffs AP0b und AP1a führen „Rollenkonzept/`benutzer`-Tabelle" ausdrücklich
unter „Nicht in diesem Paket". Gebaut wurde die Pille folgerichtig auch nicht
— die Falschaussage blieb aber als vermeintliche Umsetzungsgrundlage stehen.

Der Zugang war bis F8 **binär**: Cloudflare Access lässt herein, danach darf
jede eingeloggte Person alles (`canEdit = true`, hart verdrahtet). Rollen
kommen mit **F8 / E30** — drei Stück (`betrachter.`, `bearbeiter.`, `admin.`),
Tabelle `benutzer`, Durchsetzung serverseitig. Diese Korrektur steht hier,
damit die alte Zeile nicht erneut als Beleg dafür gelesen wird, dass etwas
schon da sei.

---

## 4. Konflikte Mockup ↔ Design System (Vorrangregel: Mockup gewinnt)

1. **Karten-Bibliothek**: Mockup lädt Leaflet 1.9.4 vom CDN. Repo nutzt
   MapLibre GL (vorhanden, kein CDN zur Laufzeit). Leaflet wäre eine neue
   Laufzeit-Abhängigkeit (Leitplanke 10). → **Vorschlag: MapLibre behalten**,
   Optik/Verhalten (Filter-Basemap, Orb-DivMarker, Aggregation, Zeichnen)
   nachbauen. Abweichung vom Mockup nur in der Technik, nicht im Bild.
2. **Fonts**: DS lädt Geist **von Google Fonts** und Phosphor **von unpkg**.
   Leitplanke: nur next/font, nichts extern. Geist gibt es in
   `next/font/google` (Build-Zeit-Self-Hosting) → konform. **Phosphor**: kein
   Font-Loader; Optionen (a) `@phosphor-icons/web` als npm-Paket + lokale
   Font-Dateien, (b) benötigte Icons als Inline-SVG kopieren (~35 Icons im
   Mockup). → **Entscheidung nötig**; mein Vorschlag: (a), ein kleines
   devDependency-artiges Asset-Paket, keine Laufzeit-Requests.
3. **Foto-Pfade**: Mockup: `assets/materialarten/<code>.webp` (eine Größe) mit
   Bild-Probe + Cluster-Foto-Fallback. Repo (Ansage 6): `public/fotos/
   feedstock|output/{lg,sm}/<code>.webp` + Orb-/Flachfarben-Fallback. → Repo-
   Pfade + Ansage-Fallback gelten; die Cluster-Stimmungsfotos des Mockups
   (soil.jpg …) existieren im Repo nicht → Fallback ist Orb/Flachfarbe.
4. **Foto-Größe im Grid**: Karten sind ≥ 248 px breit. Ansage: „Grids
   ausschließlich sm" **und** „lg ab ~240 px Anzeigebreite". → **Entscheidung
   nötig**; mein Vorschlag: Grid-Karten nutzen **lg** (Anzeigebreite > 320 px
   wäre mit sm sichtbar unscharf; sm bleibt für Tabellenzeilen, Comboboxen,
   Marker-Panels).
5. **Lime-Wert**: DS v3 `#7DB535` vs. Repo/CI bisher `#8CC63F`. Mockup nutzt
   durchgehend die v3-Tokens → `#7DB535` wird übernommen, `#8CC63F` bleibt nur
   noch im Orb-Verlauf-Asset. (Nur zur Kenntnis.)
6. **DataTable-Komponente**: DS liefert React-Komponenten als Bundle für den
   Mockup-Kontext; wir bauen die Optik nativ in Next/CSS nach (kein Import des
   `_ds_bundle.js`). Tokens kommen 1:1 in `globals.css`.

## 5. Konflikte Mockup ↔ Leitplanken/Fachlichkeit — Entscheidung vor dem Bau

### 5.1 Belegdokumentation fehlt im Mockup
Die Ansage (4d) beschreibt einen neuen Screen „Belegdokumentation" mit
Grid/Liste-Umschalter; das Mockup kennt ihn nicht — der Umschalter sitzt auf
`ströme.`. Ich habe **nicht** geraten und keinen Screen erfunden.
**Optionen:** (a) AP1i baut exakt das Mockup, Belegdokumentation wird ein
eigenes Paket mit eigenem Mockup; (b) Eric liefert ein Artboard nach und PR 4
baut es. → **Vorschlag: (a)**, `ansicht=grid|liste` wandert als
Querystring-Parameter auf `/register` (ströme.).

### 5.2 Lösch-Flow verletzt „Keine Daten löschen"
Mockup: Papierkorb → Modal `strom löschen.` → Datensatz weg. CLAUDE.md:
verworfen statt löschen. **Vorschlag:** Button und Modal 1:1 bauen, die
Aktion setzt aber `status = verworfen` (Modaltext entsprechend anpassen —
kleine, begründete Textabweichung) — oder den Papierkorb weglassen.
→ **Entscheidung nötig.**

### 5.3 Verifizierungs-Fristen sind eine offene Fachfrage
`BELEG_MONATE` (Vertrag 36 M, Betriebsdaten 12, LOI 12, Angebot 3,
Dokument 12, Gespräch 6) ist im Mockup ausdrücklich als Annahme markiert;
CLAUDE.md listet „Gültigkeitsdauern je Beleg-Typ" als offen. Betroffen:
Detail-Zeile, Formular-Hinweis, Dashboard-Kachel `nächste verifizierung.`.
**Optionen:** (a) Eric gibt die Mockup-Werte als vorläufige Regel frei
(nur Anzeige, kein Schema); (b) Elemente zeigen nur `gueltig_bis` von
Angeboten, sonst `–`. → **Entscheidung nötig.**

### 5.4 Kleinere beabsichtigte Abweichungen (bitte einzeln freigeben)
- **Route `/register/[art]/neu` bleibt** als Deeplink und rendert das neue
  Formular-Panel über der Liste (Ansage 7: Routen unverändert).
- **Status-Feld** entfällt im Formular (wie Mockup). Statuswechsel: im Detail
  gibt es im Mockup keinen expliziten Kontrollpunkt — Vorschlag: kleines
  Status-Menü im Detail-Kopf als bewusste Ergänzung, oder Statuswechsel
  vorerst nur wie bisher. → Entscheidung.
- **Saisonalität editieren**: Mockup zeigt nur Anzeige (+ „Ziehbare Balken
  folgen"). Vorschlag: SeasonBars + die 12 Zahlenfelder des heutigen
  SaisonEditors darunter (sonst verlöre das Formular eine Funktion).
- **CSV-Export** der Auswertung ist im Mockup nicht vorhanden — behalten
  (Sekundär-Button) oder streichen? Vorschlag: behalten.
- **Blöcke, die ersatzlos entfallen** (nicht im Mockup): „Menge nach
  Materialart", „Abdeckung nach Landkreis", „Zuletzt aktualisiert",
  Jahres-Chart „Datenjahr/Erhebungsjahr". Bitte bestätigen.
- **Geteilter Filterzustand karte./auswertung.**: Ansage 5 reserviert den
  Querystring für Datenfilter. Facetten sind mehrwertig → Format
  `?status=a,b&cluster=x` (kommagetrennt). Beide Routen lesen dieselben
  Parameter; „geteilt" heißt: gleiche Parameter, Links zwischen den Views
  erhalten sie. Kein Cookie für Filter.
- **`mapKind` (Alle/Feedstock/Outputs)** wird Querystring-Parameter (neuer
  Name `sicht=alle|feedstock|outputs`), da Datenfilter.
- **Mockup-Beispieldaten** (14 Feedstock-, 8 Output-Ströme, 3 Regionen,
  Lena Hoffmann etc.) werden **nicht** übernommen — echte DB-Daten (Leitplanke
  „keine Platzhalter-Optik"). Der Seed enthält keine Ströme; leere Zustände
  erscheinen dann mit den Mockup-EmptyStates.
- **Tabulare Ziffern / de-DE-Formate** übernehme ich aus dem Mockup
  (`Intl.NumberFormat("de-DE")`, `MM/JJJJ`, `TT.MM.JJJJ`).

---

## 6. Zustandshaltung (bestätigt Ansage 5, konkretisiert)

- Querystring (Datenfilter): `region, q, cluster, materialart, outputgruppe,
  qualitaet, jahr, landkreis, status, tab, detail` + neu `belegtyp, produkt,
  kategorie, mengeMin/Max, preisMin/Max, vonAb, erstellt, sort, richtung,
  sicht, ansicht` (mehrwertig kommagetrennt).
- Cookie `bhyo_ui` (JSON, SameSite=Lax, 1 Jahr): `sidebar` (auf/zu),
  `akkordeons` (offene Keys), `filterleiste` je View (auf/zu), `legende`
  (auf/zu + Höhe), `theme` (light/dark/system). Serverseitig in `layout.tsx`
  gelesen, als Default an Client-Komponenten — kein Mount-Flackern.
- Kein neues State-Paket.

## 7. PR-Schnitt (freigegeben, angepasst gegenüber Ansage 9)

Der Umfang von „PR 3" der Ansage ist real 4 große Screens + Formular — als ein
PR nicht reviewbar. Freigegebener Schnitt (inkl. Migrations-PR aus
Entscheidung E6):

| PR | Inhalt | Hinweis |
| --- | --- | --- |
| **PR 1** | Seed-Fix Erntereste (Ansage 8) | vorgezogen: winzig, unabhängig, entsperrt Foto-Code `erntereste.webp` |
| **PR 2** | Tokens & Shell: globals.css auf bhyo_2.0-Tokens (Farben, Type-Scale, Radius, Schatten, Glas, Motion), Geist via next/font, Phosphor via npm-Paket self-hosted, Sidebar mit Akkordeons, Kopfzeile mit Titel + Inbox-Platzhalter + Konto-Menü, Theme-Umschalter, Cookie `bhyo_ui`, Screens `import.`/`einstellungen.`, Labels | die 5 Bestands-Screens laufen währenddessen im Übergangslook weiter |
| **PR 3** | ströme. (= „Belegdokumentation" der Ansage): Toolbar, Facetten-Filter (ausklappbar, Zählpille), Sortierung, Grid/Liste (`ansicht=`), Foto-Karten inkl. Fallbacks, DataTable, EmptyStates, Detail (Panel+Modal) mit ConversionChain, Status-Menü, Verwerfen-Flow | größter PR; Filter-Chip-System entsteht hier wiederverwendbar |
| **PR 4** | Migration 0007: `output_bedarf.preis` + `preis_einheit` | eigener Schema-PR laut Arbeitsweise, kein Feature-Code |
| **PR 5** | Formular-Panel (Anlegen/Bearbeiten) inkl. Validierung, Qualitäts-Box, ziehbare Saison-Balken, Output-Preisfelder, R2-Upload-Anbindung wie bisher | baut auf PR 3 (Panel-Container) und PR 4 |
| **PR 6** | karte.: Full-bleed, Glas-Toolbar + Suche, Filterleiste, Orb-Marker + Aggregation, ziehbare Legende, Zeichnen-Dialog, Regionsumrisse | MapLibre |
| **PR 7** | auswertung.: Bento-Dashboard, geteilte Filter, klick-filternde Module, CSV-Export-Button | teilt Chips aus PR 3 |
| **PR 8** | planer.: RegionTiles, Projekt-Menü, Projekt-Unterseiten | |
| **PR 9** | docs/design-system.md auf bhyo_2.0 nachziehen + Restpunkte aus den Abweichungslisten | |

Jeder PR grün + deploybar, je Screen die Prüfschleife aus Ansage 2 (Inventar →
Bau → Screenshot Light/Dark gegen lokal gerendertes Artboard → Abweichungsliste
in den PR-Text).

## 8. Entscheidungslog (Eric, 2026-09-11)

| # | Frage | Entscheidung |
| --- | --- | --- |
| E1 | Belegdokumentation (5.1) | **ströme. IST die Belegdokumentation** — der Screen wurde nur umbenannt. Kein zusätzlicher Screen; `ansicht=grid\|liste` liegt auf `/register`. |
| E2 | Lösch-Flow (5.2) | UI 1:1 aus dem Mockup (Papierkorb + Modal), die Aktion setzt aber `status = verworfen`; Modaltext entsprechend angepasst. Kein physisches Löschen. |
| E3 | Verifizierungs-Fristen (5.3) | Mockup-Werte (Vertrag 36 · Betriebsdaten 12 · LOI 12 · Angebot 3 · Dokument 12 · Gespräch 6 Monate) als **vorläufige reine Anzeige-Regel** freigegeben — Konstante im Web-Code, klar kommentiert, kein Schema. |
| E4 | Phosphor-Icons (4.2) | `@phosphor-icons/web` als npm-Abhängigkeit, Fonts self-hosted ausgeliefert (kein CDN zur Laufzeit). |
| E5 | Grid-Fotos (4.4) | Foto-Grid auf ströme. nutzt **lg**; sm bleibt für Tabellen, Comboboxen, Marker-Panels. Kleinquellen-Fotos nie über native Breite skalieren. |
| E6 | Output-Preis (3) | Wird **ergänzt**: Migration 0007 (`output_bedarf.preis`, `preis_einheit`) als eigener PR 4; das Formular baut die Felder danach echt. |
| E7 | Landkreis (3) | Combobox aus `DISTINCT landkreis` der Bestandsdaten + Freitext-Eingabe (Muster AkteurCombobox). Keine Lookup-Tabelle. |
| E8 | Statuswechsel (5.4) | StatusPill im Detail-Kopf wird klickbar → Menü mit erlaubten Übergängen (dokumentierte Ergänzung zum Mockup). Formular hat kein Status-Feld, Neuanlage = `entwurf`. |
| E9 | Auswertungs-Blöcke (5.4) | **CSV-Export bleibt** (Sekundär-Button in der Toolbar). „Menge nach Materialart", „Abdeckung nach Landkreis" und „Zuletzt aktualisiert" **entfallen ersatzlos**. |
| E10 | Saisonalität (5.4) | **Ziehbare Balken werden gebaut**: SeasonBars im Formular sind per Maus (Drag) und Tastatur (Pfeiltasten) editierbar, `Gleichverteilung`-Button wie Mockup, `KI-Vorschlag laden` disabled. Ersetzt die 12 Zahlenfelder. |
| E11 | PR-Schnitt (7) | 9 PRs laut Tabelle oben (8 aus dem Bericht + Migrations-PR). |
| E20 | Darstellungsregel Zahlenformate (2026-09-22) | **Keine Nachkommastellen in der Darstellung.** Passt eine Größe damit nicht, wechselt die **Einheit**, nicht die Regel: Feedstock-Preis **€/t atro** (78 · −124) · stofflicher Output-Preis **€/t** (250, vorher €/kg) · energetischer Output-Preis **€/MWh** (185, vorher ct/kWh) · Mengen **t/a · MWh/a** ganzzahlig · Quoten und Anteile **%** ganzzahlig · Saisonanteile **%** ganzzahlig per **Largest-Remainder** mit Summe exakt 100 (zentral in `rundeAnteile100` — keine lokalen Rundungslogiken wie „Restdifferenz auf den letzten Monat"). Umsetzung als zentrale Formatierungsfunktion **je Größenart** in `lib/format.ts` (`fmtMenge`, `fmtPreis`, `fmtQuote`, `fmtAnteil`, `fmtGeldGross`, `fmtFaktor`); keine `toFixed`-Aufrufe und keine punktuellen Formatierungen in Komponenten — der künftige PDF-Abzug der Auswertung (F6) erbt die Formatierung, indem er über dieselben Funktionen rendert. Das Beleg-Detail zeigt die erfasste Einheit nicht mehr roh, sondern rechnet in die Anzeigeeinheit um (`fmtOutputPreis`). Referenz-Heizwerte aus E13 bleiben unverändert (Mengenumrechnung, nicht Preisanzeige). **Genau zwei Ausnahmen, beide mit Kriterium:** a) Mio.-Darstellung ab 1 Mio €/a: **eine** Nachkommastelle — sie entspricht 100.000 € und ist kein Rauschen; b) Werte, die in einer **sichtbar dargestellten Rechenkette als Faktor** auftreten (TS-Gehalt, Aschegehalt, Umwegfaktor, km-Satz, Nutzlast): erfasste Genauigkeit, sonst ist die Kette nicht mehr nachrechenbar. |
| E18 | Feedstock-Potenzial statt Saldo (2026-09-21, revidiert E14 teilweise) | **Beleg-Ebene unverändert** (E14: preis_* = signierter Zahlungsstrom, negativ = bhyo erhält Annahmeentgelt; Labels „Einkaufspreis/Annahmeentgelt", Formular-Validierung). **Aggregations-Ebene gedreht**: Die KPI heißt wieder **„feedstock-potenzial."** und flippt das Vorzeichen — Potenzial = −Σ(Preis × Menge): **positiv = Nettoerlös aus Verwertung** (Entsorgungskosten der Kommune = Verwertungserlös für bhyo), negativ = Nettobeschaffungskosten. Kachel zeigt nur den einen Wert mit Caption „Verwertungserlöse − Beschaffungskosten" — Spannen-Text und ⓘ-Popover entfernt (zu intransparent). **ø-Preis wieder EINE Zahl** (atro-gewichtet über alle Belege, signiert, Caption-Legende „− = Annahmeentgelt") statt der getrennten Einkaufs-/Annahme-Stats. Modul „feedstock-potenzial je cluster." analog geflippt (Min/Max tauschen beim Flip die Seiten, gemeinsame Skala läuft exakt vom kleinsten Min bis zum größten Max aller Cluster — kein 0-Anker, volle Bandbreite). Outputs-„erlöspotenzial." war bereits in Erlös-Konvention und bleibt. |
| E17 | Offene Zeiträume ab aktuellem Jahr (2026-09-21) | Belege ohne `zeitraum_von` zählen in der Jahresachse erst **ab dem aktuellen Jahr** — nie rückwirkend in historische Jahre, die nur durch fremde Belege auf der Achse sind (ohne `zeitraum_bis` weiter bis zum Achsenende; existieren offene Belege, gehört das aktuelle Jahr immer auf die Achse). **Infra-Notiz Production-Deploy PR 7:** Der push-Trigger blieb aus, weil GitHub für den Squash-Merge-Commit `4b3d874` **kein PushEvent erzeugt** hat (Events-API: kein Eintrag; der Trigger-Commit `fc7e20b` mit demselben User-OAuth-Token `gho_…`/workflow-Scope triggerte normal). Kein `paths:`-Filter im Workflow, kein GITHUB_TOKEN-/App-Commit (Committer = GitHub web-flow, identisch zu PR 6, der auslöste) → Einzelfall-Event-Drop auf GitHub-Seite. `workflow_dispatch` als Notausgang ergänzt, ersetzt den push-Trigger nicht. |
| E16 | Dynamische Jahresachse (PR 7, 2026-09-21) | „bedarfe/verfügbarer feedstock je jahr." spannt die Achse **dynamisch aus den Belegzeiträumen** (lückenlos vom frühesten bis zum spätesten Jahr; ohne Zeiträume Rückfall aufs aktuelle Jahr; Outputs: eine gemeinsame Achse für Energie- und Stofflich-Reihe, damit der Switch sie nicht verschiebt). **Jahresraten-Semantik bleibt** (t atro/a bzw. MWh/a je aktivem Jahr — keine Proratierung). Ab ~8 Balken scrollt das Modul horizontal (Mindest-Säulenbreite 52px). **Vergangene Jahre** (< aktuelles Jahr) werden gedimmt und mit gestrichelter Hairline von der Zukunft abgegrenzt. Ersetzt die feste Achse 2026–2031; damit erscheinen auch die 2025er-Testbelege (als Vergangenheit) und die Zeitraum-Anpassung aus E15 entfällt. |
| E15 | Jahres-Bucketing verifiziert (PR 7, 2026-09-21) | Die Nullen in „verfügbarer feedstock je jahr." sind **datenbedingt**, kein Aggregationsfehler: mehrere Testbelege (u. a. beide Bioabfall) trugen Zeiträume 2025 und lagen damit komplett **vor der festen Achse 2026–2031**. Per Test belegt (auswertung-modell.test.ts): Jahresgrenzen sind beidseitig inklusiv (Jahreswechsel-Beleg 31.12.→01.01. zählt in beiden Grenzjahren, nie darüber hinaus), Teiljahre landen genau in ihrem Kalenderjahr, ein Jahr ohne Belege bleibt als **0-Balken** in der durchgängigen Achse (wie von Eric erwartet), Überlappungen summieren sich je Jahr. Testbelege-Zeiträume angepasst, damit die Preview-Grafik nicht dauerhaft leer wirkt. **Offene Fachfrage (nicht umgesetzt, gemeldet):** Erics Testerwartungen aus dem Prüfauftrag implizieren eine andere Semantik — Gesamtmenge tagesanteilig auf die Jahre proratiert plus dynamische Achse aus den Belegzeiträumen. Implementiert ist die **Jahresraten-Semantik** (t atro/**a**: ein Beleg zählt in jedem aktiven Jahr mit voller Rate) auf fester Achse 2026–2031 — konsistent mit der Einheit im gesamten Tool. Umstellung wäre eine Fachentscheidung (beträfe Einheitendeutung von menge_atro). |
| E14 | Vorzeichen-Konvention Feedstock (PR 7, 2026-09-21) | `preis_min/mittel/max` (€/t atro) ist der **signierte Zahlungsstrom aus Sicht bhyo**: positiv = bhyo zahlt (Einkaufspreis), negativ = bhyo erhält (Annahme-/Entsorgungsentgelt). Ein einziges signiertes Feld, keine zwei Felder, keine XOR-Constraint — dasselbe Material kann je Region/Marktlage das Vorzeichen wechseln; das Vorzeichen steuert später die Richtung des Eignungsscores. UI leitet Labels aus dem Vorzeichen ab („Einkaufspreis X €/t" / „Annahmeentgelt X €/t", `fmtZahlungsstrom`); ein roher negativer Wert wird nie als „Preis" gerendert. Folgen: KPI „Regionenpotenzial" → **„Feedstock-Saldo"** (signiert, negativ = Nettoerlös aus Annahme, Erläuterung im ⓘ-Popover), Modul „feedstock-saldo je cluster."; Outputs-Potenzial → **„Erlöspotenzial"**. ø-Preis getrennt nach Vorzeichen: „ø Einkaufspreis (n=…)" und „ø Annahmeentgelt (n=…)", beide atro-mengengewichtet (gemischter ø läge nahe null). Spannen vereinheitlicht: ø_min/ø_max = Σ(min/max × m)/Σm (Korridor) bzw. saldo_min/max = Σ(min/max × m) (Saldo) — „Min/Max je Position, mengengewichtet", kein Konfidenzintervall; Spannen-Skala läuft bei negativen Werten über 0 hinaus. **Klarstellung Perspektive (Eric, 21.09.):** Erfasst wird durchgängig aus **Sicht bhyo in Kosten-Konvention** — nicht aus Kommunensicht: positiv = Beschaffungskosten für bhyo, negativ = Erlös für bhyo (betragsgleich dem Entsorgungspreis, den die Region/Kommune zahlt). Der Saldo ist entsprechend ein Kostensaldo: positiv = Nettobeschaffungskosten, negativ = Nettoerlös aus Annahme — der Erlös aus Annahmeentgelten geht also vorzeichenrichtig ins Potenzial/den Saldo ein. Formular validiert Min ≤ Mittel ≤ Max (auch über das Vorzeichen hinweg; Spannen mit Vorzeichenwechsel sind zulässig — die Zuordnung Einkauf/Annahme in der ø-Kachel entscheidet das Mittel). |
| E13 | Outputs-Board (PR 7, 2026-09-21) | Umbau analog E12: Auswahlzeile; KPIs = Prüfquote, Energiebedarf (MWh/a nach Hu), ø Preis (€/MWh, MWh-gewichtet über Target-Outputs) — **korrigiert 2026-09-22 mit E20**: ursprünglich stand hier „ct/kWh, kWh-gewichtet über Targets & Wärme"; die Einheit ist seit E20 €/MWh, und gewichtet wird seit 2026-09-21 nur über Target-Outputs, nicht über Wärme, Regionenpotenzial (€/a, energetisch × Hu + stofflich × €/kg). Module: „bedarf je gruppe." zweigeteilt energetisch (MWh/a) / stofflich (t/a) mit Produkt-Akkordeon; Saisonalität und „bedarfe je jahr." (Target-MWh/a **ohne Wärme**) je mit Switch Energie ↔ CO2 & Asche; „regionenpotenzial je gruppe." und „preise je gruppe." (seit E20 €/MWh bzw. €/t; ursprünglich ct/kWh bzw. €/kg). **Referenz-Heizwerte** statt „ohne Heizwert": Synthesegas 12 MJ/Nm³ / 13,3 MJ/kg (DFB-Dampfvergasung, Literaturspanne 10–16 MJ/Nm³, Referenz Güssing), BioFuels 37,0 MJ/kg (FAME, RED II Anhang III — korrigiert von zunächst 37,5 IEA-AMF) — Industriestandard-Referenzen, nicht belegspezifisch. |
| E12 | Feedstock-Board (PR 7, 2026-09-21) | Umbau abweichend vom Mockup: Belegzahl + Erfassungsgrad als schmale Auswahlzeile über den Kacheln; KPI-Reihe = Prüfquote, Trockenmasse, ø Preis (atro-gewichtet), **Regionenpotenzial** (Σ preisMittel × t atro in €/a, Spanne aus preisMin/Max mit Rückfall auf preisMittel, Anzeige ab 1 Mio als Mio. €/a). Neue Module „regionenpotenzial je cluster." und „preiskorridor je cluster." (Bandbreiten-Zeile je Cluster auf 0..Max-Skala) ersetzen das Preis-Modul der Feedstock-Sicht; Saisonalität bleibt Monatsindex. Kein hartes Sektions-Raster, logischer Fluss Menge → Wert → Belastbarkeit, „nächste verifizierung." unten rechts. Outputs-Sicht unverändert. |

Damit ist der Bericht freigegeben; die Umsetzung beginnt mit PR 1.
