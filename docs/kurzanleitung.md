# Kurzanleitung Marktdokumentation (eine Seite)

Stand 26.09.2026. Für die ersten Nutzerinnen und Nutzer. Das Werkzeug ist
intern: Kommunen bekommen nur das fertige PDF, nie einen Zugang.

## 1. Anmelden

Adresse: `https://bhyo-markt.bhyo.workers.dev`. Die Anmeldung läuft über
Cloudflare Access mit der bhyo-Adresse; es gibt kein eigenes Passwort im
Werkzeug. Wer sich anmeldet, aber noch nicht eingetragen ist, sieht „kein
zugang eingerichtet" mit der Kontaktadresse des Admins. Rollen: **Betrachter**
liest, **Bearbeiter** erfasst und bearbeitet, **Admin** verwaltet zusätzlich
die Benutzer (Menü „einstellungen").

## 2. Strom anlegen

„ströme." → Tab **Feedstock** oder **Outputs** → Knopf **Feedstock anlegen**
bzw. **Output anlegen**. Ein Strom ist eine Quelle × Materialart × Zeitraum.

- **Akteur** wählen oder neu anlegen (Name, Sektor aus der Liste).
- **Ort**: Adresssuche, dann Pin auf der Karte prüfen. Landkreis und
  Bundesland leitet das Werkzeug aus dem Pin ab, sie werden nicht getippt.
- **Mengen und Preise**: Komma als Dezimaltrenner, keine Tausenderpunkte.
  Feedstock-Preise sind der Zahlungsstrom aus Sicht bhyo: positiv = bhyo
  zahlt (Einkaufspreis), negativ = bhyo erhält (Annahmeentgelt). Min ≤ Mittel
  ≤ Max.
- **Zeitraum** in Monaten, **Saisonalität** als Verteilung über das Jahr.
- Speichern legt den Strom im Status **Entwurf** an. Statuswechsel (in
  Prüfung, geprüft) im Detail; verworfene Ströme werden nicht gelöscht,
  sondern ausgeblendet.

## 3. Beleg anhängen

Im selben Formular, Abschnitt **beleg.**: Belegtyp wählen (Betriebsdaten,
Vertrag, Absichtserklärung, Angebot, Gespräch, Dokument, Webrecherche).

- Pflicht immer: **Quellenangabe** und **Erhebungsdatum**.
- Bei Betriebsdaten, Vertrag, Absichtserklärung, Angebot zusätzlich das
  Enddatum (z. B. „Vertrag läuft bis").
- Bei Webrecherche ist der **Link** Pflicht.
- Datei oder Link heben die Stufe; ohne Nachweis zeigt die Qualitäts-Box, was
  der Beleg dann noch erreicht. Die **Qualitätsstufe A–D** wird berechnet,
  nie gewählt. D ist die niedrigste belegte Stufe; „unbelegt" heißt: kein
  Beleg.
- **Freigabe zur externen Verwendung**: nur setzen, wenn Quellenangabe, Datei,
  Link und Belegnummer nach außen dürfen. Auf die Stufe hat das keinen
  Einfluss.

## 4. Filtern

Filterleiste in ströme., karte. und auswertung. Die Filter sind überall
dieselben; einer, der in einer Ansicht nicht gilt, bleibt gemerkt und wird
ausgewiesen. Facetten: Region, Cluster/Materialart, Bundesland/Landkreis/Ort,
Sektor/Akteur, Verfügbarkeit, Qualität, Status, Verifizierung
(aktiv/ausgelaufen/keine Frist), Belegtyp; unter „+" weitere (Mengen,
Preise, Vergaben, Vollständigkeit). Freitext findet auch Belegnummern
(`B-000123`, `123`).

## 5. Exportieren

Knopf **Export** (Toolbar auswertung.) bzw. Download-Icon (Filterzeile
ströme.) öffnet ein Menü.

- **Voreinstellung ist „extern"**: Belegangaben nicht freigegebener Belege
  (Quellenangabe, Datei, Link, Belegnummer) und Abnehmernamen bei Vergaben
  werden zurückgehalten; Mengen und Preise stehen drin. Für Weitergabe an
  Kommunen und Dritte.
- **„intern"** enthält alles und trägt das in der Datei sichtbar. Nicht
  weitergeben.
- **CSV herunterladen**: für deutsches Excel (Semikolon, Komma), oben
  Metazeilen mit Modus, Stand, Ansicht, aktiven Filtern. Dateiname
  `markt-<sicht>-<modus>-<datum>.csv`.
- **Drucken / PDF**: öffnet den Druck-Abzug; im Browser „Drucken" → „Als PDF
  sichern". Modus steht in Kopf und Fußzeile.

Der Export enthält genau das, was die Liste mit den aktuellen Filtern zeigt.
