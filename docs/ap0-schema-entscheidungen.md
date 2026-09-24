# AP0 – Schema-Entscheidungen

Vier schema-relevante Festlegungen, freigegeben am 26.08.2026. Sie gehören in die
**erste Migration**, nicht in ein Nachzieh-Skript: Postgres-Enum-Werte lassen sich
anhängen, aber nicht umbenennen, entfernen oder umsortieren, ohne einen neuen Typ,
eine Spaltenkonvertierung und ein Backfill über alle Zeilen.

## 1. Status-Enum – vier Zustände

| DB-Wert | Anzeige | Bedeutung |
| --- | --- | --- |
| `entwurf` | Entwurf | Angelegt, noch nicht belegt oder unvollständig |
| `in_pruefung` | in Prüfung | Beleg vorhanden, Verifizierung läuft |
| `geprueft` | geprüft | Beleg geprüft, Datensatz belastbar |
| `verworfen` | verworfen | Bewusst aussortiert, bleibt zur Nachvollziehbarkeit erhalten |

- Postgres-Enum `datensatz_status`, in Drizzle als `pgEnum`
- Gilt einheitlich für Biomassestrom, Output-Bedarf, Akteur und Akteur-Interesse –
  ein Enum, nicht vier parallele
- Übergänge frei in beide Richtungen, `verworfen` aus jedem Zustand erreichbar
- Kein Löschen: verworfene Datensätze bleiben in der Datenbank
- **Auswahlregel in der Bewertung:** In den Schritten b und d sind `in_pruefung` und
  `geprueft` auswählbar, `entwurf` nur mit sichtbarem Warnhinweis, `verworfen` gar
  nicht. Gilt für die Auswahl, nicht für die Anzeige – im Register und auf der Karte
  bleiben alle Status sichtbar.
- Ein eingefrorener Lauf hält den Status zum Zeitpunkt des Einfrierens als Snapshot

## 2. Kommunale Bereitschaft – Feld an der Region

Die kommunale Bereitschaft hängt an der **Region**, nicht am Analyselauf: Die Haltung
einer Kommune ändert sich nicht je Baureihen-Variante.

| Feld | Typ | Zweck |
| --- | --- | --- |
| `bereitschaft_stufe` | Enum | `kein_kontakt` · `erstgespraech` · `positives_signal` · `absichtserklaerung` |
| `bereitschaft_beleg_id` | FK → Beleg, nullable | Gesprächsnotiz oder Absichtserklärung |
| `bereitschaft_notiz` | Text | Freitext, worauf die Einschätzung beruht |
| `bereitschaft_stand` | Datum | Grundlage der Verifizierungserinnerung |

- Qualität wird abgeleitet, nie gewählt: ohne schriftliche Absichtserklärung maximal
  `D`, mit Absichtserklärung `B`
- Teilscore-Mapping (Vorschlag, im Formel-Workshop zu bestätigen): kein_kontakt 0 ·
  erstgespraech 40 · positives_signal 70 · absichtserklaerung 100
- **Snapshot im Lauf:** Stufe, Score-Wert und Qualität werden beim Einfrieren in den
  Analyse-Lauf kopiert. Sonst ändert sich das Ergebnis eines alten Laufs rückwirkend.

## 3. Beleg-Typ „Absichtserklärung"

Enum `beleg_typ`: `dokument_link` · `gespraech` · `angebot` · `absichtserklaerung` · `vertrag`

| Beleg-Typ | Verbindlichkeit | Gültigkeit | Qualität vollständig | Qualität unvollständig |
| --- | --- | --- | --- | --- |
| `vertrag` | höchste | Vertragslaufzeit | **A** | B |
| `absichtserklaerung` | hoch | 12 Monate | B | C |
| `angebot` | mittel | 6 Monate bzw. Angebotsfrist | C | D |
| `dokument_link` | variabel | 24 Monate | B bei amtlicher Quelle/Betreiberdaten, sonst C | D |
| `gespraech` | niedrig | 12 Monate | C | D |

**Verbindlich seit 31.08.2026** (Eric): Ein vollständig belegter, rechtsverbindlicher
Vertrag erreicht ebenfalls A – gleichwertig zu gemessenen Betriebsdaten. `A` ist damit
über zwei Wege erreichbar. Details: `docs/` Second-Brain-Note „AP1 – Struktur und
Qualitäts-Ableitungsmatrix“.

## 4. Lauf-ID – `BW-JJJJ-NNN`

> **E29 — Nummernkreise (23.09.2026):** Eine Nummer, die das Haus verlässt,
> wird **nach Jahr gezählt**, mit eigener Zählertabelle und Sperre, weil ein
> externer Leser eine lückenlose Jahreszählung erwartet (Lauf-ID
> `BW-JJJJ-NNN`, steht im PDF für die Kommune). Eine rein **interne
> Referenz** bekommt eine **Datenbank-Sequenz ohne Jahresbezug**, Lücken
> sind dort hinnehmbar (`beleg_nr` = `B-000123`). **Kein `count(*) + 1`, in
> keinem der beiden Fälle.**
>
> **Die Sequenz ist umgebungslokal.** Production beginnt bei 1, die Preview
> steht bei 126 — dieselbe Sache trägt also je Umgebung eine andere Nummer.
> Eine B-Nummer ist nur **innerhalb ihrer Umgebung** eindeutig und
> aussagekräftig und wird **nie zwischen Umgebungen abgeglichen**.

- Präfix `BW`, Jahr vierstellig, laufende Nummer dreistellig nullgefüllt; ab 1000
  vierstellig, kein Reset innerhalb des Jahres
- Nummernkreis **global über alle Regionen**, nicht je Region
- Vergabe **beim Anlegen der Arbeitsfassung**, nicht erst beim Einfrieren – die ID muss
  im Tool und im PDF identisch sein. Lücken durch verworfene Fassungen sind akzeptabel,
  eine sich ändernde ID nicht.
- Technisch: Tabelle `lauf_nummernkreis(jahr, letzte_nummer)` mit `SELECT … FOR UPDATE`,
  **kein** `count(*) + 1`
- Die Anzeige-ID ist ein eigenes, unveränderliches Feld neben dem UUID-Primärschlüssel
  und wird nie als Fremdschlüssel verwendet

## 5. Materialarten-Ergänzung 0011 – Cluster-Zuordnung als Setzung

Migration 0011 (22.09.2026) ergänzt vier Materialarten: `altholz_a1_a3`,
`rebholz` (→ lignozellulosische Reststoffe), `gaerreste_fest`,
`papierschlamm` (→ organische Rest-/Abfallstoffe). Die Cluster-Zuordnungen
sind eine **Setzung**, keine abgeleitete Wahrheit — insbesondere
Papierschlamm: chemisch lignozellulosisch, praktisch schlammartig;
zugeordnet nach Handhabung und Preisbildung, nicht nach Stoffchemie.
Falls später Faserschlamm und Deinking-Schlamm unterschieden werden, wird
aus `papierschlamm` ein Codepaar.

## 6. Pflanzenkohle ist kein bhyo-Output

Entschieden am 22.09.2026 (Eric): Pflanzenkohle wird nicht als
Output-Produkt geführt — der feste Rückstand des bhyo-Prozesses ist
**Asche**. Ein Stammdatum `pflanzenkohle` hat in `output_produkt` nie
existiert (die 15 Produkte aus 0006/0008 enthalten es nicht); die sechs
Pflanzenkohle-Positionen des Seed-v2-Auftrags wurden umverteilt auf
+3 CO2, +2 Synthesegas, +1 Asche. Die Frage ist damit abschließend
beantwortet und wird nicht erneut gestellt.

Ergänzung (22.09.2026): **Asche ist für bhyo ein Erlös, keine
Entsorgungsposition.** Preise durchgehend positiv, 10–40 €/t (Einheit
nach E20).

## 7. Adresse am Strom, nicht am Akteur

Entschieden am 23.09.2026 (Eric, F0a): Die Adresse (Straße, Hausnummer,
PLZ, Ort, Bundesland, Landkreis, Koordinate) liegt **am Strom** —
`biomassestrom` und `output_bedarf`. Der Akteur bekommt **keine**
Adressfelder. Begründung: Der bestehende Schema-Kommentar („Standort
gehört an den einzelnen Strom, ein Akteur kann mehrere Sites haben") ist
besser begründet als eine Akteur-Adresse mit Vorbefüllung; zwei Ablagen
für dieselbe Information würden eine Konfliktregel brauchen und wären
eine Parallelwelt. Gegen die Tipparbeit gibt es im Formular stattdessen
„Adresse von bestehendem Standort übernehmen" — reines Kopieren
vorhandener Daten desselben Akteurs, kein neues Feld. Migration 0012
ergänzt dafür additiv `strasse`, `hausnummer`, `plz`, `bundesland`
(alle nullable) an beiden Stromtabellen; `ort`, `landkreis`,
`standort_geom` bleiben. `bundesland` kommt in F0a vorläufig aus dem
Geocoder und wird ab F0b räumlich abgeleitet.

## 8. Qualitätsstufe wird abgeleitet, nie gespeichert (E23, 23.09.2026)

Die Stufe A–D existiert nur noch als Ableitung aus der Beleg-Zeile:
Migration 0013 legt die `IMMUTABLE`-SQL-Funktion `qualitaetsstufe(...)` an
(Spiegel von `apps/web/lib/qualitaet.ts::deriveQualitaet`) und
`beleg.qualitaet` als `GENERATED ALWAYS AS … STORED`. Fallregel: hängt eine
Ableitung nur an Spalten **derselben** Zeile, ist sie eine Generated-Spalte
(Fall a, hier `beleg`); hängt sie an einer Fremdzeile, wird sie über den
Join gelesen und nicht dupliziert (Fall b, hier die Stromtabellen — deren
`qualitaet`-Spalten sind stillgelegt und fallen mit Migration 0014).
Kein Trigger. Die App schreibt nirgends eine Stufe; der Seed setzt nur
Belegfelder, ein Stufenwert im Seed-Input bricht laut ab. Ein Paritätstest
im Deploy-CI hält DB-Funktion und TS-Spiegel über gemeinsame Ankerfälle
(`lib/qualitaet-ankerfaelle.ts`) deckungsgleich — gegen die echte
Preview-DB, nicht gegen einen Mock. Ströme ohne Beleg haben ehrlich keine
Stufe (Anzeige „–"). Damit ist stille Qualitätsinflation (gespeicherte
Stufe passt nicht mehr zu den Belegfeldern — 68 Bestandsfälle) strukturell
unmöglich.

## 9. Belegnummer `B-000123` (E28/E29, 23.09.2026)

> **E29 — Nummernkreise (23.09.2026):** Eine Nummer, die das Haus verlässt,
> wird **nach Jahr gezählt**, mit eigener Zählertabelle und Sperre, weil ein
> externer Leser eine lückenlose Jahreszählung erwartet (Lauf-ID
> `BW-JJJJ-NNN`, steht im PDF für die Kommune). Eine rein **interne
> Referenz** bekommt eine **Datenbank-Sequenz ohne Jahresbezug**, Lücken
> sind dort hinnehmbar (`beleg_nr` = `B-000123`). **Kein `count(*) + 1`, in
> keinem der beiden Fälle.**
>
> **Die Sequenz ist umgebungslokal.** Production beginnt bei 1, die Preview
> steht bei 126 — dieselbe Sache trägt also je Umgebung eine andere Nummer.
> Eine B-Nummer ist nur **innerhalb ihrer Umgebung** eindeutig und
> aussagekräftig und wird **nie zwischen Umgebungen abgeglichen**.

Umsetzung: Spalte `beleg.beleg_nr` mit Default aus der Sequenz
`beleg_nr_seq` (`'B-' || lpad(nextval(...)::text, 6, '0')`). Die Nummer wird
**vergeben, nicht abgeleitet** — kein Fall für E23, aber sie hat trotzdem
genau einen Ursprung: die Sequenz. Kein Anwendungscode erzeugt sie, kein
Formular setzt sie. Unveränderlich: `NOT NULL`, `UNIQUE`, in der Datenbank
zusätzlich per Trigger gegen Änderung gesichert (hier ein **Schutz**, keine
Ableitung — die E23-Absage an Trigger betraf abgeleitete Werte). Der
Nachtrag für Bestandsbelege läuft deterministisch nach `erstellt_am`, bei
Gleichstand nach `id`, damit ein erneuter Lauf dieselben Nummern ergibt.

## 10. Rollen und Zugang (E30, 24.09.2026)

**Drei Rollen, nicht vier.** `betrachter` liest, `bearbeiter` erfasst und
bearbeitet, `admin` verwaltet zusätzlich die Benutzer. „Bewerten" ist **keine**
eigene Rolle — die Frage wird erst mit AP3 geprüft. Frühere Fassungen in
`CLAUDE.md` (vier Stufen) und `docs/ap1i-delta-v2.md` (Behauptung,
`benutzer.rolle` existiere bereits) sind damit überholt und an Ort und Stelle
korrigiert.

Die **Identität** kommt aus Cloudflare Access und wird serverseitig gegen den
JWKS geprüft (unverändert); die **Rolle** liegt in der Datenbank
(`benutzer.rolle`). Access entscheidet, wer hereinkommt — die Anwendung
entscheidet, was diese Person darf.

**Fail closed.** Eine E-Mail ohne Eintrag in `benutzer` oder mit
`aktiv = false` bekommt keinen Zugang und eine klare Seite („kein Zugang, bitte
beim Admin melden"). Kein stilles Zurückfallen auf Lesezugriff: Ein Zugang, der
sich bei fehlender Regel öffnet, ist keiner.

**Jede Rechteprüfung sitzt serverseitig**, an einer einzigen gebündelten Stelle
— nicht als Kopie je Datei. Die Oberfläche blendet zusätzlich aus, ersetzt die
Prüfung aber nie: Wer die Server-Action direkt aufruft, umgeht die Oberfläche.
Die Tests rufen deshalb die Aktionen direkt auf, nicht die Oberfläche.

**E-Mails nur in Kleinschreibung**, erzwungen per `CHECK (email = lower(email))`;
die Anwendung normalisiert beim Vergleich ebenso. Eine Größe, eine Schreibweise
(vgl. Abschnitt 8 und E23).

**Erster Admin per Migration**, sonst kann niemand Rollen vergeben — ein leeres
`benutzer` bedeutet bei Fail closed, dass sich alle aussperren.

Die Urheberschaft im Änderungsprotokoll wandert vom Textpräfix in die eigene
Spalte `aenderung.benutzer_email`. Altzeilen werden **nicht** durch
Textzerlegung nachgetragen: Sie bleiben leer und zeigen „unbekannt".

## Noch offen – nicht raten

Qualitäts-Ableitungsmatrix A–D und Gültigkeitsdauern je Beleg-Typ sind seit
31.08.2026 verbindlich (siehe Abschnitt 3). Weiterhin offen: Teilscore-Mapping der
Bereitschaftsstufen – Geschäftsentscheidung, wird von Eric entschieden, nicht im
Code festgelegt.
