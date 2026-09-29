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

## 11. Zahleneingabe (E31, 24.09.2026)

**Dezimaltrenner ist das Komma.** Tausenderpunkte werden weder getippt noch
unterstützt.

**Eine Eingabe, die zwei Deutungen zulässt, wird als mehrdeutig abgewiesen,
nie geraten.** Punkt-Dreiergruppen ohne Komma sind genau so ein Fall:
`10.000` kann zehntausend sein, `33.333` ein TS-Anteil in Prozent. Beide
Deutungen wären still falsch — `Number("10.000")` ergibt **10**, drei
Größenordnungen verschwinden lautlos. Das Formular meldet solche Eingaben
und bittet um ein Komma.

**Zahlen- und Monatsfelder sind eigene Textfelder mit eigener Umrechnung**,
keine nativen `type="number"` oder `type="month"`. Deren Verhalten hängt an
Engine und Sprache des Browsers und verwirft Eingaben stillschweigend:
gemessen war `navigator.language` `en-US`, damit setzte ein Zahlenfeld den
Wert „1,5" auf leer zurück, bevor der Server ihn sehen konnte; `type="month"`
kennen Safari und Firefox gar nicht. Monate werden als `MM/JJJJ` erfasst.

**Normalisiert wird einmal, in der Server-Action.** Danach rechnen und
schreiben alle mit demselben Wert (`lib/eingabe-format.ts`, reine
Funktionen). Ein Test verbietet `type="number"` in den Formularen.

## 12. Ein Filtermodell (E32, 25.09.2026)

**Filter sind an genau einer Stelle definiert** (`apps/web/lib/filter-modell.ts`):
Schlüssel, Beschriftung, Werttyp, Wertebereich, Hierarchie und in welchen
Ansichten und für welche Stromart sie gelten. Alle Ansichten leiten ihre
Leiste daraus ab; handgeschriebene Listen je Ansicht gibt es nicht.

**Die Zugehörigkeit ist ausdrücklich, nicht zufällig.** Dass ein Filter in
einer Ansicht fehlt, ist eine Festlegung im Modell — kein Nebeneffekt davon,
wo ihn jemand zuerst gebraucht hat. Genau dieser Unterschied hatte den
`landkreis`-Fall erzeugt: für Outputs eingeführt, für Feedstock nie
angewandt, lautlos.

**Ein Filter, der wirkt, ist sichtbar und rücksetzbar.** Ein Filter, der in
der aktuellen Ansicht oder Stromart nicht gilt, bleibt gemerkt, wirkt aber
nicht, und die Leiste zeigt an, dass zurückgehaltene Filter bestehen; beim
Zurückwechseln greifen sie wieder. **Stillschweigendes Wirken oder
stillschweigendes Verwerfen gibt es nicht.** Ausnahmen sind im Modell
benannt (`beiNichtgeltung: "verwerfen"`) — heute genau eine: der Freitext in
auswertung., weil er dort kein Eingabefeld hat und deshalb nicht korrigierbar
wäre.

**Stromart heißt überall `sicht=feedstock|outputs|alle`** — `tab=biomasse|output`
ist abgelöst. „Feedstock" statt „Biomasse", weil der Bestand auch Polymere
umfasst. Ein unbekannter Wert wird auf den Standard gesetzt **und die URL
umgeschrieben**, statt still auf etwas anderes auszuweichen. Der interne
Diskriminator `Strom.art` behält die Werte `biomasse`/`output`, weil sie als
Literale aus den SQL-Abfragen kommen; umgerechnet wird an einer Stelle
(`artAusSicht`/`sichtAusArt`).

## 13. Belegtypen, Rangfolge, Qualität (E34, 25.09.2026)

**Sieben Typen in dieser Reihenfolge** — überall so angezeigt und sortiert;
sie ist zugleich die Rangfolge der Beweiskraft. Die Stufe gilt für den
vollständigen Beleg, ein unvollständiger liegt eine Stufe darunter. **D ist
die Untergrenze.** „Unbelegt" bleibt dem Fall vorbehalten, dass gar kein
Beleg existiert (E24) — der Zustand wird nicht überladen.

| # | Belegtyp | vollständig | unvollständig | Was entscheidet |
| --- | --- | --- | --- | --- |
| 1 | Betriebsdaten | **A** | B | Datei oder Link |
| 2 | Vertrag | **A** | B | Datei |
| 3 | Absichtserklärung | **B** | C | Datei |
| 4 | Angebot | **B** | C | Datei oder Link |
| 5 | Gespräch | **C** | C | nichts — glatt C |
| 6 | Dokument | **C** | D | Datei oder Link |
| 7 | Webrecherche | **D** | D | nichts — glatt D |

**Gespräch und Webrecherche sind bewusst glatt.** Für sie hat die
Vollständigkeitsrechnung keine Wirkung auf die Stufe. Das ist gewollt und
steht hier, damit niemand später einen Defekt darin sucht. Typspezifische
Pflichten, die keine Stufe mehr bewegen (etwa der Link bei Webrecherche),
sind **Formularpflichten**, keine Stufenbedingungen — das Formular macht den
Unterschied erkennbar.

**Zwei Folgen der Zuordnung**, ebenfalls gewollt:
- **A ist nur noch über Betriebsdaten und Vertrag erreichbar.**
- **C wird zum Sammelbecken**: Absichtserklärung und Angebot unvollständig,
  Gespräch immer, Dokument vollständig.
- **D heißt nicht mehr „lückenhaft"**: Ein *vollständiger* Recherche-Beleg
  landet auf D. Legende und Hilfetexte müssen das sagen, sonst erklärt sich
  die Stufe falsch.

**Zwei CHECKs sichern, was vorher Bedingungen waren:** Quellenangabe für alle
sieben Typen, `gueltig_bis` für die oberen vier. Ein Formular ist eine Bitte,
ein CHECK ist eine Zusicherung. Der Quellenangabe-CHECK prüft den JSON-Pfad
und weist auch leere und reine Leerzeichen-Werte ab — ein leerer String ist
keine Quellenangabe.

Die Ableitung bekommt damit nur noch `(typ, datei_key, link_url)`. Sie liegt
weiterhin doppelt vor (TypeScript und IMMUTABLE-SQL-Funktion hinter der
GENERATED-Spalte); der Paritätstest hält beide deckungsgleich.

### Durchsicht abgeschlossen am 25.09.2026 — keine Bedingung ohne Wirkung

Vier Bedingungen wurden entfernt, weil sie nichts mehr entschieden:

| Entfernt | Warum |
| --- | --- |
| `amtlich` | Mit Dokument fest auf C hatte der Haken keine Wirkung mehr |
| Erhebungsdatum gesetzt | `erstellt_am` ist `NOT NULL DEFAULT now()` — die Prüfung `IS NOT NULL` konnte nie falsch sein |
| Gesprächsdatum, Gesprächspartner | Dieselbe Information steht in der seit F7 pflichtigen Quellenangabe; zwei Orte werden unterschiedlich gefüllt |
| `extern_nachvollziehbar` | Nachweiskraft und Freigabe sind zwei Größen — siehe unten |

**`extern_nachvollziehbar` wurde nicht entfernt, sondern umgewidmet.** Es ist
jetzt eine **Freigabe zur externen Verwendung** und beeinflusst die
Qualitätsstufe nicht. Beschriftung und Hilfetext sagen das ausdrücklich.
Wirksam wird es in **F6**: PDF-Abzug und CSV-Export berücksichtigen die
Freigabe (siehe `docs/f6-handoff-pdf-export.md`). Damit löst das Feld genau
das Versprechen ein, das sein alter Hilfetext gegeben hatte, ohne es zu
halten — der Fehlerbericht aus dem Praxistest vom 24.09. ging darauf zurück.

Bestehende Werte von `amtlich`, Gesprächsdatum und Gesprächspartner bleiben
in der Datenbank unangetastet, werden aber nicht mehr gelesen. **Kein
Datenverlust**, nur ein stillgelegter Lesepfad.

### Umsetzung Schritt 1 (Migration 0021, 26.09.2026)

- **Enum:** `ALTER TYPE … RENAME VALUE 'dokument_link' TO 'dokument'` plus
  `ADD VALUE 'webrecherche'`, mit Zählbeweis vor und nach dem Umbenennen.
  Die DB-Reihenfolge des Enums ist Anhänge-Historie; die fachliche
  Reihenfolge lebt in `lib/qualitaet.ts` (`BELEG_TYPEN`).
- **Transaktionsgrenze:** drizzle wendet alle ausstehenden Migrationen in
  *einer* Transaktion an, und Postgres verbietet die Verwendung eines per
  `ADD VALUE` angehängten Enum-Werts in derselben Transaktion. Die
  SQL-Funktion vergleicht deshalb über `p_typ::text`, und 0021 schreibt
  nirgends `webrecherche`. Folge: **Die Umwidmung von B-000009 auf
  Webrecherche geschieht in der Anwendung**, nicht in der Migration —
  ohnehin schreibt keine Migration dieses Pakets einen Fachwert.
- **Messung vor der Migration** (`beleg-abweichung`, nur lesen):
  Production 1 Beleg, 0 Wechsel, 0 ohne Quellenangabe, B-000001
  (Absichtserklärung) ohne `gueltig_bis`. Preview 126 Belege, 53 Wechsel
  (35 × Angebot C→B, 15 × Gespräch D→C, 1 × Angebot D→C, 1 × Betriebsdaten
  B→A, 1 × Dokument B→C = B-000007 mit `amtlich`), 0 ohne Quellenangabe,
  69 obere Typen ohne `gueltig_bis` (65 Seed, 4 von Hand: B-000006,
  B-000123, B-000125, B-000127). B-000007, B-000009, B-000124 liegen auf
  der Preview; B-000009 („Blog-Beitrag Hof") ist ein Seed-Beleg älterer
  Herkunft.
- **Altwert-Mapping:** `belegtyp=dokument_link` in gespeicherten Adressen
  wird beim Einlesen auf `dokument` abgebildet (`ALTWERTE` im Filtermodell).
- **Formular:** `gueltig_bis` Pflicht in der Oberfläche für die oberen vier
  Typen; der CHECK dafür folgt als eigene Migration in Schritt 3, nachdem
  die Daten nachgetragen sind.

### Umsetzung Schritt 3 (Migration 0022, 26.09.2026)

- `CHECK beleg_gueltig_bis_check`: `typ NOT IN (obere vier) OR gueltig_bis IS NOT NULL`.
  Die Migration schreibt keinen Fachwert; ein DO-Block bricht vorher mit der
  Liste der Belegnummern ab. Zusätzlich läuft `beleg-frist-check` als
  Vorprüfung vor jeder Migration (Preview im PR-Deploy, Production in
  `migrate-production`) und weist danach nach, dass der CHECK greift.
- Nachgetragen vor 0022: Production B-000001 (Eric, Anwendung, 31.12.2027);
  Preview per Re-Seed (Lauf 36233116223) und in der Anwendung B-000006,
  B-000127 (31.12.2027), B-000009 → Webrecherche.
- **Weg 1 (Eric, 26.09.2026):** B-000123 und B-000125 („E23-KOMPAT
  (temporaer)", an keinem Strom, keiner Region) sind Testreste einer
  früheren Kompatibilitätsprüfung und werden auf der Preview entfernt —
  Ausnahme von „keine Daten löschen", weil keine Fachdaten. Solange sie
  stehen, weist die Vorprüfung sie namentlich aus.
- Vorgemerkt: zehn Preview-Belege des v1-Seeds (Marker `true`) überleben
  jeden Re-Seed; spätere Bereinigung, damit Preview und Seed übereinstimmen.

### Kandidat für eine spätere Migration

**Die Quellenangabe gehört in eine eigene Spalte, nicht in `metadata`.** Ein
Pflichtfeld in einem JSON-Feld ist schwerer zu prüfen, zu indizieren und zu
lesen. Der saubere Umzug braucht Expand und Contract über zwei Runden; dieses
Paket ist groß genug. Nachzuholen, wenn ohnehin eine Migration ansteht.

## 14. Fälligkeit je Belegtyp (E33, 25.09.2026)

**Jeder Beleg hat genau eine Quelle für seine Fälligkeit.**

- **Obere vier Typen** (Betriebsdaten, Vertrag, Absichtserklärung, Angebot):
  `gueltig_bis` ist **Pflichtfeld** (CHECK). Für sie gibt es **keine
  Typ-Frist** mehr.
- **Untere drei Typen**: kein Enddatum im Dokument, deshalb gilt die
  Typ-Frist ab dem **Erhebungsdatum** — Gespräch **3 Monate**, Dokument
  **6 Monate**, Webrecherche **3 Monate**. Auch bei Webrecherche; ein eigenes
  Abrufdatum wird **nicht** eingeführt.

`BELEG_MONATE` schrumpft damit auf drei Einträge.

**Die alten Zahlen gelten nicht mehr.** Vor E33 widersprachen sich Code und
Abschnitt 3 dieses Dokuments: Angebot 3 gegen 6 Monate, Dokument/Link 12
gegen 24, Gespräch 6 gegen 12. Beide Fassungen sind überholt — wer sie
irgendwo findet, findet Altbestand.

Ein Feld, nicht vier: `gueltig_bis` bleibt das einzige Feld, bekommt aber
eine **typabhängige Beschriftung**, die die tatsächliche Bedeutung nennt —
„Vertrag läuft bis", „Angebot gültig bis", „Absichtserklärung gültig bis",
„Daten repräsentativ bis".

Die **Gesamtfälligkeit** bleibt das früheste Datum aus dieser Belegfrist, dem
Verfügbarkeitsende, befristeten Vergabeenden und der Reservierung.

**Verifikations-Filter (26.09.2026):** „aktiv" (Gesamtfälligkeit heute oder
später), „ausgelaufen" (davor), „keine Frist" (kein Kandidat — ohne Beleg und
ohne Zeitraum, oder ein oberer Typ ohne Datum vor Schritt 3). Der dritte
Zustand ist benannt und wählbar (E24-Haltung). Gemessen wird gegen das
Serverdatum, einmal je Request (`reichereVerifikationAn`), aus derselben
Funktion, die Detail und Auswertung nutzen. Gilt in allen drei Ansichten unter
„weitere Filter"; das Detail zeigt den Zustand neben dem Datum.

## 15. Sektor als Referenzdaten (F5 PR B, 25.09.2026)

`akteur.sektor` war ein **Freitextfeld**. Folge: Zwei Schreibweisen ergaben
zwei Filterwerte — gemessen am 25.09.2026 standen auf der Preview 14
Schreibweisen für 11 Werte, darunter `Energie`/`energie`,
`Forstwirtschaft`/`forstwirtschaft`, `Landwirtschaft`/`landwirtschaft`.

**Acht Werte** in der Referenztabelle `sektor`, Muster wie `materialart` und
`output_produkt`: `abfallwirtschaft`, `energie`, `forstwirtschaft`,
`holzwirtschaft`, `industrie`, `kommunal`, `landwirtschaft`, `lebensmittel`.

**Leer heißt „ohne Sektor", nicht „sonstige"** — fehlende Information ist
keine Restkategorie (dieselbe Haltung wie „unbelegt" in E24).

Vier Entscheidungen zur Zuordnung des Bestands:

1. **Schreibweisen zusammengeführt.** Der Vergleich läuft ohne Rücksicht auf
   Groß- und Kleinschreibung und ohne Randleerraum, damit künftige Varianten
   gar nicht erst entstehen.
2. **`abnehmer` ist kein Sektor, sondern eine Rolle** — und war mit 50 von
   117 Akteuren der häufigste Wert. Ein Wert, der in einer Auswahlliste etwas
   anderes bedeutet als alle übrigen, verdirbt die ganze Liste. Diese Akteure
   bekommen „ohne Sektor"; die Rolle wird dabei **nicht** nach `akteur.rollen`
   gerettet. **Gemessen am 25.09.2026:** Nichts liest `rollen` (die Spalte war
   bei allen 117 Akteuren leer und nur die Schema-Definition erwähnt sie), und
   die Rolle ist vollständig aus den Strömen ableitbar — 63 nur Anbieter, 50
   nur Abnehmer, 4 beides, 0 ohne Strom. Nach E23 wird nicht gespeichert, was
   sich ableiten lässt; die vier Akteure, die beides sind, zeigen zudem: Eine
   Rolle ist eine **Menge**, kein Wert.
3. **`akteur.rollen` bleibt als Spalte stehen**, wird aber heute weder gelesen
   noch geschrieben. **Vormerkung:** Sobald ein Akteur ohne Strom irgendwo
   sichtbar wird — etwa in einer Akteursliste —, fehlt die Rolle. Dann ist der
   Zeitpunkt, sie entweder zu füllen oder die Ableitung um einen benannten
   Zustand zu erweitern („Rolle noch offen"). Nicht jetzt, aber notiert.
4. **`Entsorgung` und `Entsorgungswirtschaft` → `abfallwirtschaft`.** Eine
   fachliche Zusammenlegung, keine Schreibweise: drei Namen für eine Sache.

**Einschränkung, bewusst in Kauf genommen:** Ein neuer Sektor braucht künftig
eine **Migration**, genau wie Materialarten und Produkte. Das ist mit dem
bestehenden Muster stimmig, wird aber Reibung erzeugen, sobald echte Daten
neue Branchen bringen. Wenn es so weit ist, wird eine **Verwaltung der
Referenzdaten durch Admins** ein eigenes Paket — jetzt nicht.

## 16. Freigabe und Export (E36, 26.09.2026)

Die Freigabe `extern_nachvollziehbar` schützt nur den Beleg: Ohne Freigabe
erscheinen Quellenangabe, Datei, Link und Belegnummer in externen Ausgaben
nicht, an ihrer Stelle steht benannt „nicht zur externen Verwendung
freigegeben" (E24). Mengen und Preise dürfen hinaus, einzeln wie in Summen.
Bei Vergaben wird extern der Abnehmername zurückgehalten (Zeitraum und
„bhyo"/„extern vergeben" bleiben) — als eigene Einstufung „gekürzt" im
Exportmodell, nicht als Sonderfall im Code. Der Modus (extern/intern) wird
beim Export gewählt, voreingestellt extern; keine Rollenbeschränkung für
intern. Jede Ausgabe nennt ihren Modus selbst (CSV-Metazeile, PDF-Fußzeile).
Umsetzung und Spaltenmodell: `docs/f6-handoff-pdf-export.md`.

**Produktionsfehler vorweg (26.09.2026, #90):** Der Export filterte immer im
Scope „auswertung"; aus ströme. fielen Freitext, Verfügbarkeit und
„Verfügbar ab" still weg. Der Scope kommt jetzt vom Aufrufer (`ansicht=`).

## 17. Backup und Restore (E37, 28.09.2026)

**Ein Backup gilt erst als Backup, wenn es regelmäßig zurückgespielt wird.**
Der erste Restore-Nachweis (28.09.2026) deckte auf, dass die täglichen Dumps
seit Migration 0013 (23.09.) nicht ohne Handarbeit zurückspielbar waren:
`pg_restore` setzt den Suchpfad leer, die Funktion `qualitaetsstufe()` nannte
den Typ `qualitaets_stufe` unqualifiziert, das Anlegen von `beleg` scheiterte
und alles daran Hängende fehlte. Migration 0023 gibt der Funktion einen festen
`search_path`; der Beleg-Check prüft das dauerhaft.

**Festgehalten:** Die Backups vom 24.09. bis zur Migration 0023 (28.09.,
09:20 UTC) sind nur mit Handarbeit (`pg_restore --use-list`, Funktion vorab
anlegen) zurückspielbar. **Hinnehmbar**, weil Production in dieser Zeit fast
leer war (ein Strom, ein Beleg, ein Akteur) und Neon zusätzlich
Point-in-Time-Recovery hält. Ab dem Dump vom 28.09. ist der Restore
nachgewiesen: 17 Tabellen, 0 Abweichungen, Migrationsstand 24 beidseitig
(Lauf 36403513802).

**Dauerhaft:** `restore-woechentlich.yml` spielt jeden Montag 03:00 UTC den
jüngsten Dump in einen eigens angelegten Neon-Branch, zählt jede Tabelle
gegen Production (streng: jede Abweichung rot) und löscht den Branch immer
wieder, auch bei Fehlern — der Free-Plan erlaubt höchstens 10 Branches je
Projekt. Nicht gesichert bleiben die Beleg-Dateien im R2-Bucket
`bhyogenics-belege`; das ist ein offener Punkt für später.

**Nachtrag 28.09.2026 — Zählprotokoll:** Der Vergleich „alter Dump gegen
heutige Production" würde mit echten Nutzern regelmäßig rot, ohne dass etwas
defekt ist. Deshalb schreibt `backup.yml` beim Erstellen des Dumps ein
Zählprotokoll (Zeilenzahlen je Tabelle, Migrationsstand) **aus demselben
Snapshot** (`REPEATABLE READ`, `pg_export_snapshot`, `pg_dump --snapshot`)
neben den Dump nach R2. Der Restore vergleicht gegen dieses Protokoll, nicht
gegen Production; fehlt es, ist der Lauf rot mit „kein Zählprotokoll".
Nachweis 28.09.2026: Probe mit um eine Zeile verfälschtem Protokoll rot
(Lauf 36415243312, „beleg: Protokoll 1, Restore 0"), unverfälscht grün
(Lauf 36415455431, 18 Tabellen, Migrationsstand 24).

**Nachtrag 28.09.2026 — `archiv_testdaten`:** Block B des Go-live-Skripts
hat diese Tabelle außerhalb der Migrationen angelegt (Archiv der
entfernten Testzeilen). Geprüft: Paritätstest, Beleg-Check, Fristen-Check
und schema-gate sehen sie nicht; `drizzle-kit generate` vergleicht Schema
gegen Snapshot, nicht gegen die Datenbank, und würde sie nicht anrühren.
Der Restore-Nachweis nimmt sie aus `information_schema` mit (18 Tabellen,
0 Abweichungen, Lauf 36411106035). **Ablaufdatum 28.10.2026:** dann per
Migration entfernen — vorgemerkt, nicht jetzt.

## 18. Preiskorridor am Einzelstrom (E38, 28.09.2026)

Das Detail zeigt unter „preis." den Korridor des Stroms im Verhältnis zum
Band seiner Vergleichsgruppe: Feedstock gegen den Cluster (atro-gewichtet,
derselbe Ursprung `preisKorridorRoh` wie „preiskorridor je cluster."),
Outputs als Punkt gegen Min/Mittel/Max der Produktgruppe in der Einheit des
Stroms (€/t stofflich, €/MWh energetisch, Heizwert nach E23, ungewichtet).
Drei Vorgaben, jede mit Test: **(1)** Der Strom rechnet nicht in sein
eigenes Band (`vergleichsStroeme` schließt ihn aus). **(2)** Mindestens zwei
Vergleichsströme mit Preis, sonst der benannte Zustand „zu wenig
Vergleichswerte" (E24); wer keinen Preis hat, zählt nicht als 0. **(3)**
Wertungsrichtung je Sicht, zwei getrennte Funktionen: Feedstock — niedriger
Preis ist „günstiger für bhyo" (E14, im Negativen „höheres Annahmeentgelt");
Outputs — höherer Erlös ist „besser für bhyo". Beide Richtungen wurden
einmal rot gezeigt. Production ist leer, „zu wenig Vergleichswerte" ist dort
bis zu echten Daten der Normalfall. Screenshots: `docs/screenshots/e38/`.

## 19. Navigationsleiste auswertung. (E39, 28.09.2026)

auswertung. bekommt dieselbe Bedienlogik wie ströme. **Zeile 1** trägt links
den Schalter Feedstock/Outputs und rechts Filter-Pille (mit Zähler),
Sortier-Pille und Export-Icon; ihre Höhe ist fest (`--toolbar-h`, kein
Umbruch) und ändert sich nie — vorher wuchs sie mit offenen Chips von 52 auf
88 px und verschob alles darunter (Produktionstest Eric, gemessen auf der
Preview). **Filter stehen ausschließlich in der Zeile darunter** (zu:
Zähltext, offen: Chips, „Weitere Filter" als „+"). Filter-Pille, Sortier-Pille
(`components/SortMenue.tsx`), Chips und Export sind dieselben Komponenten wie
in ströme., keine Kopien.

**Sortierung** (`awsort`): Menge absteigend (Standard = heutige
Modellreihenfolge, unverändert), Menge aufsteigend, Name A–Z — für die
Akkordeon-Einträge der Mengen-Module samt Unterzeilen
(`lib/auswertung-sortierung.ts`).

**Zeitbezug**: Der Schalter Einzeljahr/Zeitraum hat die Größe des
Feedstock/Outputs-Schalters; daneben eine Uhr-Pille mit der Auswahl („2026"
bzw. „2023–2026"). Klick öffnet einen Regler — ein Griff im Einzeljahr, zwei
im Zeitraum, Jahreszahl über jedem Griff, Schrittweite 1, Grenzen = frühestes
bis spätestes Jahr der gedeckelten Pool-Achse (mindestens das aktuelle Jahr),
per Tastatur bedienbar (native `range`, ARIA-Slider). Wechsel Zeitraum →
Einzeljahr nimmt das Endjahr, zurück wird es zum Zeitraum [Jahr, Jahr]. **Die
Jahres-Logik selbst ist unverändert** (Eric, 28.09.2026: „An der Logik darf
dies nichts ändern"): Achse, Rückfälle, Fensterrechnung und der Parameter
`jahre` (Kommaliste) bleiben; der Regler schreibt eine lückenlose Liste, alte
Adressen mit Lücken rechnen weiter wie bisher und zeigen min–max.

**Nachtrag:** Der damals offene E32-Widerspruch beim Verfügbarkeitsstatus
in auswertung. ist mit E41 (Weg A, Fenster-Semantik) entschieden.
Screenshots: `docs/screenshots/e39/`.

## 20. Zeiträume mit „bis" und Vergabespalten im Export (E40, 28.09.2026)

Zeiträume werden in der Anzeige wie Wertspannen mit „bis" geschrieben:
„01/2026 bis 12/2031" (`formatZeitspanne` in `lib/format.ts`, Schwester von
`formatSpanne`; `fmtZeitraum` und `vergabeLabel` bauen darauf auf). Ein
offenes Ende ist benannt („ab 01/2026", „bis 12/2031", bei Vergaben
„ab 07/2027 (unbefristet)"), fehlen beide Grenzen steht „nicht erfasst" (E24);
Beginn = Ende ergibt einen Monat. Kein Halbgeviertstrich mehr zwischen zwei
Werten — auch nicht in der Metazeile „aktive Filter" des Exports.

Im Export ersetzt „Vergeben ab" / „Vergeben bis" (je JJJJ-MM) die Satzspalte
„Vergaben"; mehrere Vergaben eines Stroms stehen mit „ | " getrennt in
derselben Reihenfolge. Offene Enden sind benannt („ab Verfügbarkeitsbeginn",
„unbefristet"), ohne Vergabe „keine" — nie eine leere Zelle. Beide Spalten
tragen die Einstufung „keine Belegangabe" (E36). Damit der Abnehmer intern
nicht verloren geht, gibt es zusätzlich „Vergeben an" mit Einstufung
„gekürzt": intern Name bzw. „bhyo", extern nur „bhyo" oder „extern" — der
Abnehmername bleibt extern zurückgehalten. Die Pflichtprüfung der
Einstufung je Spalte bleibt grün.

## 21. Verfügbarkeitsstatus in auswertung. gegen das Fenster (E41, 28.09.2026)

Weg A: Der Filter „Verfügbarkeit" gilt jetzt auch in auswertung. — dort als
**„Status im gewählten Zeitraum"** — und wird gegen das gewählte Jahr bzw.
den Zeitraum aus E39 ausgewertet, nicht gegen heute. Es gelten dieselben
Statuswerte und dieselbe Hierarchie wie in ströme./karte. und die
Überschneidungsregel aus E32: „vergeben" heißt, ein Vergabezeitraum
überschneidet das Fenster; „abgelaufen" heißt, die Verfügbarkeit endet vor dem
Fenster, „noch nicht verfügbar", sie beginnt erst danach.

**Eine Logik:** `leiteVerfuegbarkeitAb` nimmt einen Bezug entgegen — einen
Stichtag (ströme./karte.: Serverdatum) oder ein Fenster aus ISO-Daten; der
Stichtag ist das Fenster [Tag, Tag], die Heute-Semantik ist damit exakt die
alte. Die Seite reichert den Pool mit dem Fenster an und filtert über das
gemeinsame Modell (`filterStroemeMitBericht`); `wendeFensterAn` filtert keine
Ströme mehr, sondern skaliert nur noch die Mengen nach den gewählten
Monatskategorien. Der Hinweis „1 Filter gilt hier nicht" entfällt. Der Export
aus auswertung. rechnet gegen dasselbe Fenster (`lib/zeitbezug.ts`, dieselbe
Ableitung wie die Seite; die Toolbar reicht `zeitmodus` und `jahre` mit) und
nennt den Bezug in der Metazeile „Verfügbarkeit bezogen auf"; die Spalte
heißt nur noch „Verfügbarkeit". Tests: Vergabe vollständig im Fenster, nur
angeschnitten, außerhalb, Einzeljahr gegen Zeitraum, Stichtag = [Tag, Tag];
gegen die Heute-Semantik einmal rot gezeigt. Screenshots:
`docs/screenshots/e41/`.

**E32-Ergänzung:** Die Filtermatrix ändert sich: „Verfügbarkeit" gilt in allen
drei Ansichten; die Beschriftung darf je Ansicht abweichen
(`labelJeAnsicht`, `filterLabel`). Der Eintrag vom 25.09.2026, wonach die
Jahrespillen diese Rolle in auswertung. übernehmen, ist damit aufgehoben.

## 22. Rechte-Matrix als Daten (E42, AP2.1 PR a, 28.09.2026)

Rollen, Rechte und Durchsetzung leben in **einem Modul** `apps/web/lib/rechte/`
(seit PR b mit der vierten Rolle pruefer und objektbezogenen Regeln, Abschnitt 23):
`rollen.ts` (Rollen, Zugang, fail closed), `matrix.ts` (Typ `Aktion`, die
Matrix `MATRIX` als Daten, `darf(nutzer, aktion, objekt?)`), `wache.ts`
(serverseitige Durchsetzung: `verlange(aktion)`, `wacheFuerRoute(aktion)`,
`rechtFuerAction(aktion)`; Lesen über `verlangeZugang()`/`zugangFuerRoute()`).
Außerhalb des Moduls gibt es keine Rechte-Logik; die Oberfläche liest dieselbe
Matrix nur zum Ausblenden. **Eine Aktion steht in der Matrix erst, wenn es
ihren Schreibpfad gibt** (heute elf: strom.anlegen/bearbeiten/status_setzen/
verwerfen, akteur.anlegen, materialart.anlegen, region.anlegen,
projekt.starten, benutzer.anlegen/rolle_setzen/aktiv_setzen), eine Rolle
kommt erst mit ihrer ersten Wirkung (pruefer folgt mit PR b). `darf()` ist
fail closed: unbekannte Rolle, unbekannte Aktion, kein oder kein erlaubter
Zugang ergeben false. Das Verhalten gegenüber E30 ist unverändert (bearbeiter
erfasst, admin verwaltet zusätzlich); der Test hält jede Kombination Rolle ×
Aktion ausdrücklich fest. Der CI-Wächter `scripts/rechte-check.ts`
(vormals wache-abdeckung) verlangt in jedem Schreibpfad einen Wache-Aufruf
mit einer Aktion, die die Matrix kennt — als Literal, sonst rot.

## 23. Prüfer-Rolle, Sperren und Zuweisung (E42/E44, AP2.1 PR b, 28.09.2026)

**Vier Rollen** (E42): betrachter, bearbeiter, **pruefer**, admin — Hierarchie
admin ⊇ pruefer ⊇ bearbeiter ⊇ betrachter, in `lib/rechte/matrix.ts`
ausgeschrieben. Niemand wird automatisch Prüfer; die Vergabe läuft über die
Admin-Seite. Migration 0025 (Expand): Enum-Wert `pruefer`,
`biomassestrom.gesperrt_von`/`gesperrt_am` und dasselbe an `output_bedarf`
(FK auf `benutzer(id)`, CHECK „beide NULL oder beide gesetzt"), Tabelle
`strom_zuweisung` (genau ein Elternbezug per CHECK, typisierte FKs auf
`benutzer(id)`, partielle Unique-Indizes je Strom-Typ).

**Die Sperre sitzt am Strom** (E44, Präzisierung Eric 28.09.2026): Was die
Nutzer „Beleg" nennen, ist der Strom-Eintrag; dort liegt auch der Status.
Gesperrtes bleibt für alle lesbar, Export unverändert. Aktionen in der
Matrix, nicht verstreut: `strom.sperren` (pruefer, admin; nur ungesperrt),
`strom.entsperren`, `strom.zuweisen`, `strom.zuweisung_entfernen` (der
Sperrinhaber, solange er pruefer ist, oder admin). Zuweisen nur an aktive
Nutzer mit Rolle ≥ bearbeiter (Prüfung am Eingang). Entsperren löscht alle
Zuweisungen. Verliert der Inhaber die Rolle pruefer, bleibt die Sperre;
lösen kann sie dann nur admin.

**Objektstufe der Wache:** `darf(nutzer, aktion, sperre)` entscheidet
objektbezogen; die Wache am Eingang prüft die Rollenstufe (`darfRolle`),
der Schreibpfad liest die Sperre **in seiner Transaktion mit Zeilensperre**
(`pruefeStromSperre`, FOR UPDATE) und bricht mit „Gesperrt von <Name>" ab —
so kollidieren Sperren und gleichzeitiges Bearbeiten nicht. Betroffen sind
alle Pfade, die einen Strom fachlich ändern: `stromSpeichern` (inklusive
Beleg- und Vergabezeitraum-Schreibvorgängen und der Akteur-Zuordnung),
`statusSetzen`, `stromVerwerfen`. **Geteilte Belege** (fachlich möglich,
kein UNIQUE auf `beleg_id`): Ein Beleg darf nur geändert werden, wenn
keiner der referenzierenden Ströme für den Handelnden gesperrt ist
(`pruefeBelegSperre`, alle Referenzen gehalten). Der einzige Pfad, der in
`beleg` schreibt, ist `stromSpeichern` über `beleg-server.ts`; der
Regionspfad schreibt keine Beleg-Zeilen. Der CI-Wächter `rechte-check`
verlangt für jede Aktion mit Objektregel den Aufruf der Objektstufe im
Schreibpfad; `sperre-check` prüft in der CI, dass beide CHECKs greifen.

**UI:** Beleg-Kopf mit Schloss und Avatar-Stapel (Inhaber zuerst,
Tooltip mit Namen und „gesperrt seit"), Sperren/Entsperren/Zuweisen nur für
Berechtigte, Nicht-Berechtigte sehen „Gesperrt von <Name>" statt Bearbeiten;
Schloss-Indikator in Liste und Grid; Avatar (Initialen, Farbe deterministisch
aus der Nutzer-ID über Tokens, Größen s/m, kein Foto) auch in der
Benutzerliste. Kein „Zugriff anfragen" (AP2.2). Screenshots:
`docs/screenshots/e44/`.

## 24. Ereignisprotokoll (E23, AP2.2 PR a, 29.09.2026)

**`aenderung` wird zum Ereignisprotokoll** — keine neue Tabelle, keine
Umbenennung (das wäre ein Contract nach E21 ohne fachlichen Nutzen).
Migration 0026 (Expand): Enum `ereignis_art` mit genau den Arten, die ein
Schreibpfad erzeugt (`angelegt`, `geaendert`, `status_gesetzt`, `verworfen`,
`gesperrt`, `entsperrt`, `zugewiesen`, `zuweisung_entfernt`,
`benutzer_angelegt`, `rolle_gesetzt`, `benutzer_aktiviert`,
`benutzer_deaktiviert`, `region_angelegt`, `akteur_angelegt`,
`projekt_angelegt`) plus `altbestand`; Spalten `art` (NOT NULL, ohne
DEFAULT) und `benutzer_id` (FK `benutzer(id)`); CHECK
`art = 'altbestand' OR benutzer_id IS NOT NULL`; Index auf
(`entitaet_typ`, `entitaet_id`). Entitätstyp und -ID bleiben der polymorphe
Objektbezug (das Protokoll überdauert verworfene Objekte); Freitext und
Urheber-E-Mail bleiben vorerst.

**Altzeilen:** Art `altbestand` für alle — die Art ist aus dem Freitext nicht
eindeutig ableitbar, weil dieselbe Spalte Code-Texte („Status auf … gesetzt")
und freie Begründungen aus dem Formular trägt (Messung 29.09.2026: Production
2 Zeilen, Preview 32; kein Muster ist formal eindeutig). `benutzer_id` per
E-Mail-Join über die Spalte `benutzer_email` (Production 2/2, Preview 13/32);
der Textpräfix ist seit F8/E30 keine Quelle und bleibt es.

**Eine Schreibstelle:** `apps/web/lib/protokoll` — `protokolliere(tx,
{ art, entitaet, id, benutzerId, benutzerEmail, text? })` schreibt in der
Transaktion des Schreibpfads (Rollback = kein Ereignis). Jeder Schreibpfad
protokolliert; Pfade, die es bisher nicht taten (Benutzerverwaltung,
Akteur, Region, Projektstart), tun es jetzt in einer Transaktion mit ihrer
Änderung. CI-Wächter `protokoll-check`: (a) kein INSERT auf `aenderung`
außerhalb von `lib/protokoll`, (b) jeder Schreibpfad (dieselbe Ermittlung
wie `rechte-check`, `scripts/schreibpfade.ts`) ruft `protokolliere` mit
einer Art auf — auch über eine aus `@/lib` importierte Funktion (eine
Ebene), ohne Ausnahme. **Entfernt** (Entscheidung Eric, 29.09.2026, benannte
Ausnahme von „kein Verhaltensunterschied"): `POST /api/materialarten` und
die Aktion `materialart.anlegen` — kein Aufrufer, und Bearbeiter sollen
die Taxonomie nicht per API erweitern können; `materialart` hat zudem keinen
uuid-Schlüssel für den Objektbezug. AP2.3 baut bei Bedarf einen Admin-Pfad
mit eigenem Schlüsselkonzept. DB-Check `protokoll-check` in der CI: CHECK greift,
Rollback hinterlässt nichts.

**Ableitung, nichts gespeichert** (E23): `ersteller(strom)` = Urheber des
Ereignisses `angelegt`, sonst benannt „Ersteller unbekannt";
`beteiligte(strom)` = alle Urheber der Arten `angelegt`, `geaendert`,
`status_gesetzt`, `verworfen` (Sperren und Zuweisen zählen nicht,
Altbestand fällt heraus). Grundlage der Empfängerregel in PR b.

## Noch offen – nicht raten

Qualitäts-Ableitungsmatrix A–D und Gültigkeitsdauern je Beleg-Typ sind seit
31.08.2026 verbindlich (siehe Abschnitt 3). Weiterhin offen: Teilscore-Mapping der
Bereitschaftsstufen – Geschäftsentscheidung, wird von Eric entschieden, nicht im
Code festgelegt.
