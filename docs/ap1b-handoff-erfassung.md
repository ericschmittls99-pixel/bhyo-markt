# AP1b – Handoff: Erfassung (Biomasse- und Output-Register)

UI und Backend zum Anlegen/Bearbeiten von Biomasseströmen und Output-Bedarfen,
auf dem Schema aus `docs/ap1a-handoff-datenmodell.md`. Feldstruktur ist gegen
die Claude-Design-Mockups abgeglichen (Doku Design.pdf, Screens 1a–2d).

## Definition of Done

Ein Biomassestrom und ein Output-Bedarf sind vollständig anlegbar (Akteur-
Verknüpfung, Beleg-Upload nach R2, Saisonalitäts-Editor, Preis-Korridor), die
Qualität A–D wird serverseitig korrekt automatisch abgeleitet (nicht editierbar
im Formular). Ein hochgeladener Beleg liegt nachweisbar in R2.

## 1. Schema-Ergänzung (Migration 0002, vor der UI)

Additive Änderungen gegenüber Migration 0001, korrigiert nach Erics
Rückmeldung (01.09.2026):

- `beleg_typ` Enum: sechster Wert `betriebsdaten` (Postgres-Enum-Erweiterung).
- `biomassestrom`/`output_bedarf`: fünf neue nullable Spalten `ort text null`,
  `landkreis text null`, `standort_geom geometry(Point,4326) null`,
  `bezeichnung text null`, `kontaktperson text null`. Standort gehört an den
  einzelnen Strom, nicht an den Akteur — ein Akteur kann mehrere Sites haben.
  `akteur` bekommt in dieser Migration keine neuen Spalten.
- `zeitraum_von`/`zeitraum_bis` bleiben unverändert wie in AP1a (date-Bereich,
  kein einzelnes Jahr).
- `beleg`: neue Spalten `extern_nachvollziehbar boolean not null default false`
  (bildet „vollständige Pflichtfelder" der Qualitätsmatrix ab) und
  `metadata jsonb null` (Typ-spezifische Zusatzfelder, siehe Abschnitt 4).

## 2. Qualitäts-Ableitung (Server, read-only im Formular)

```
betriebsdaten      → A (vollständig) / B (unvollständig)
vertrag             → A (vollständig) / B (unvollständig)
absichtserklaerung  → B (vollständig) / C (unvollständig)
angebot             → C (vollständig) / D (unvollständig)
dokument_link       → B bei amtlicher Quelle/Betreiberdaten, sonst C / D
gespraech           → C (vollständig) / D (unvollständig)
```

„vollständig" = `beleg.extern_nachvollziehbar = true` UND alle Pflichtfelder
des Beleg-Typs gesetzt. Wird bei jedem Speichern neu berechnet, nie manuell
gesetzt.

## 3. UI – Register-Übersicht (Tabs Biomasse / Output)

Region-Auswahl, Suche über Quelle/Akteur/Landkreis. KPI-Zeile (Summe erfasst,
Anzahl Ströme, Qualitätsanteil A+B, Neu-Button, Export). Tabelle mit Filtern
(Materialart, Qualität, Zeitraum, Landkreis, Status) und Spalten Quelle/Akteur
· Zeitraum · Menge · Qualität-Badge · Beleg · Status.

## 4. UI – Detail-Panel / Formular „Neu anlegen"

Reihenfolge: Kopf (Titel, Qualitäts-Badge read-only, Status) → Quelle
(Akteur-Auswahl mit Inline-Neuanlage; Ort/Landkreis/Karten-Pin je Strom
editierbar, da ein Akteur mehrere Sites haben kann — Vorbelegung optional aus
dem zuletzt erfassten Strom desselben Akteurs) → Materialart & Zeitraum →
Mengen (Biomasse:
Rohmenge, TS-Anteil %, Aschegehalt %, `menge_atro` read-only) bzw.
Bedarfsmenge (Output: Wert + Einheit) → Saisonalität (12-Balken-Editor,
„Gleichverteilung"-Button) → Preis (nur Biomasse: Min/Mittel/Max-Slider,
Herkunft) → Beleg → Begründung (Pflichtfeld) → Änderungshistorie (read-only
Log, eigene Tabelle `aenderung(id, entitaet_typ, entitaet_id, zeitpunkt, text)`).

**Beleg-Sektion**: sechs Typ-Pillen (`dokument_link` · `gespraech` ·
`angebot` · `absichtserklaerung` · `vertrag` · `betriebsdaten`). Gemeinsame
Felder: Quellenangabe, Datei-Upload/Link, Erhebungsdatum, Toggle „Extern
nachvollziehbar". Typ-spezifisch in `beleg.metadata`: `gespraech` →
Gesprächsdatum, Gesprächspartner, Kernnotiz; `angebot` → „gültig bis"
(vorbelegt aus der Matrix-Gültigkeitsdauer, editierbar); `dokument_link` →
Toggle „Amtliche Quelle oder Betreiberdaten" (ja/nein, bestimmt B vs. C bei
vollständigen Feldern — manuell gesetzt, keine automatische Domain-Erkennung).
„Nächste Verifizierung" = `beleg.gueltig_bis`, read-only berechnet.

**Pflichtfelder je Typ zum Speichern** (reine Formularvalidierung,
unabhängig von der Qualitätsableitung): Quellenangabe + Erhebungsdatum immer
Pflicht, dazu `betriebsdaten`/`dokument_link` → Datei oder Link,
`vertrag`/`absichtserklaerung` → Datei, `angebot` → Datei oder Link +
„gültig bis", `gespraech` → Gesprächsdatum + Gesprächspartner (Kernnotiz
empfohlen, nicht Pflicht). `betriebsdaten`-Gültigkeitsdauer: 12 Monate.

## 5. Akteur-Verknüpfung

Combobox mit Live-Suche (Name, Sektor). Kein Treffer → Inline-Neuanlage
(Name, Sektor optional) — Adresse gehört zum Strom, nicht zum Akteur, wird
im Quelle-Abschnitt erfasst. `standort_geom` zunächst leer, kein Geocoding
in AP1b.

## 6. Backend: Beleg-Upload nach R2

Bucket `bhyogenics-belege`, Jurisdiction **European Union**, Storage-Klasse
Standard (von Eric im Dashboard angelegt, kein Wrangler-Create nötig).

**Wichtiger Unterschied zu AP0c:** Der Worker liegt im selben Account wie
der Bucket → native R2-Bindung in wrangler.jsonc (Top-Level Production,
env.preview für Preview, gleiches Muster wie die Hyperdrive-Bindung). Kein
S3-API-Token, kein Access-Key-Secret, kein EU-spezifischer S3-Endpoint — die
Endpoint-Falle aus AP0c betraf nur den GitHub-Actions-Backup-Job außerhalb
von Cloudflare.

`beleg.datei_key` speichert nur den R2-Objektschlüssel. Anzeigen/Download
über eine eigene, Access-geschützte Worker-Route, die direkt über die
Bindung liest (`env.BELEGE.get(key)`) und ausliefert — keine signierte URL,
keine S3-Presign-Logik.

## Verifikation

Migration 0002 gegen Preview, dann Production. Je einen Biomassestrom und
Output-Bedarf pro Beleg-Typ anlegen, Qualitäts-Badge gegen die Matrix
prüfen (inkl. `betriebsdaten` → A), Testdatei-Upload nach R2 verifizieren.

## Nicht in diesem Paket

KI-Vorschlag Saisonalität (AP2), Geocoding, Karte (AP1c), Auswertung (AP1d),
Personen-von-Interesse-Formular (eigenes kleines Paket).
