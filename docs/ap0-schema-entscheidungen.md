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
**„Status im gewählten Zeitraum"** (seit 29.09.2026: „Verfügbarkeit" mit
Hinweis zur Bezugszeit, E52, Abschnitt 27) — und wird gegen das gewählte Jahr bzw.
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

## 25. Inbox-Kern (AP2.2 PR b, 29.09.2026)

**Name der Ansicht: inbox.** — benannte Ausnahme von „Domänenbegriffe deutsch"
(wie feedstock). Navigation: Eintrag über einstellungen. mit Zähler-Badge
(ungelesen), dazu das Tray-Icon der Kopfzeile (vorher Platzhalter). Keine
Live-Aktualisierung: der Zähler aktualisiert sich beim nächsten Seitenaufruf.

**Datenmodell** (Migration 0027, Expand): Enums `inbox_typ` (vorerst
`aenderung_eintrag`) und `inbox_zustand` (`offen`, `erledigt`, `verworfen`);
Tabelle `inbox_eintrag` mit Empfänger und Auslöser (FK `benutzer(id)`, NOT
NULL), Typ, genau einem Strom (CHECK), `ereignis_id` (FK Protokoll, letztes
Ereignis), `anzahl` (CHECK ≥ 1), Zeitstempeln, `gelesen_am`, Zustand mit
`zustand_seit`, `notiz` (PR c). **Bündelung per DB:** partielle
Unique-Indizes je Strom-Typ auf (Empfänger, Strom) WHERE offen AND
aenderung_eintrag; die Zustellung ist ein Upsert (anzahl + 1, Auslöser,
Ereignis und aktualisiert_am neu, gelesen_am NULL). Nach „erledigt" entsteht
bei der nächsten Änderung ein neuer Eintrag. Zähler-Index (Empfänger) WHERE
offen AND ungelesen.

**Zustellung:** Register `apps/web/lib/inbox/register.ts` (je Typ Text,
Empfängerregel, Bündelungsschlüssel, erlaubte Aktionen, „reiner Hinweis").
`protokolliere()` ruft `zustellen(tx, ereignis)` in derselben Transaktion
auf — Rollback = keine Zustellung. **Empfängerregel aenderung_eintrag** bei
geaendert, status_gesetzt, verworfen: alle Beteiligten des Stroms
(`beteiligteAus`, E23) außer dem Auslöser, Deaktivierten und Betrachtern;
Sperren und Zuweisen zählen nicht. Einzige Schreibstelle für `inbox_eintrag`
ist `lib/inbox`; CI-Wächter `inbox-check` (kein INSERT/UPDATE außerhalb),
DB-Check `inbox-check` (Unique-Index greift, Bündelung per Upsert, neuer
Eintrag nach erledigt, CHECK genau ein Strom).

**Rechte:** Aktionen `inbox.gelesen`, `inbox.ungelesen`, `inbox.erledigen`,
`inbox.verwerfen`, `inbox.alle_erledigen` in der Matrix (jede Rolle — die
Inbox gehört der Person), Objektregel „nur Empfänger" (`empfaenger_id =
nutzer.id`, auch admin nicht fremde) mit Zeilensperre in der Transaktion
(`pruefeInboxEmpfaenger`). Fremde und unbekannte Einträge werden gleich
abgewiesen. **E54 — Benannte Ausnahme im protokoll-check** (Entscheidung Eric,
29.09.2026): die fünf Inbox-Aktionen protokollieren nicht — der Lese-/
Erledigt-Zustand der eigenen Einträge ist ein persönlicher Arbeitsstand,
kein fachliches Ereignis. Jede Aktion steht namentlich in der Ausnahmeliste
(kein Platzhalter für Datei oder Ordner); eine neue Inbox-Aktion fällt
automatisch unter die Prüfung, bis sie ausdrücklich eingetragen ist.

**Bedienung:** Kopfzeile nach dem E39-Muster (Segment „Offen | Erledigt",
Erledigt zeigt auch Verworfene mit Pille, rechts „Alle erledigt" für reine
Hinweise). Zeile: Ungelesen-Punkt (Akzent), Avatar des Auslösers, Text
„<Name> hat <Belegnummer> <Bezeichnung> geändert" plus „(n Änderungen)",
relative Zeit. Aktionen Öffnen, Erledigt, Verwerfen, im Menü „Als ungelesen
markieren". Öffnen setzt gelesen und zeigt **dasselbe Detail-Panel wie
ströme.** auf der inbox.-Seite (Rechte wie dort; `lib/detail-daten.ts` ist
die eine Zusammenstellung für beide Seiten; Bearbeiten führt nach ströme.).
Leerzustand „Keine offenen Mitteilungen.". Keine Löschung, keine
Archivierung vorerst.

## 26. Zugriffsanfrage & Freischaltung (AP2.2 PR c, 29.09.2026)

**Datenmodell** (Migration 0028, Expand): `ereignis_art` + `zugriff_angefragt`,
`zugriff_abgelehnt`; `inbox_typ` + `zugriffsanfrage`, `freischaltung`,
`zugriff_abgelehnt`; je Strom-Typ ein partieller Unique-Index (Empfänger,
Strom, Anfragender) WHERE offen AND zugriffsanfrage — **zwei Anfragende = zwei
Einträge**, dieselbe Person bündelt. Die Prädikate vergleichen über die
IMMUTABLE-Hilfsfunktion `inbox_typ_text` (E53, Abschnitt 27), weil ein in
derselben Migrations-Transaktion angefügter Enum-Wert dort nicht als
Literal verwendbar und der nackte Cast nicht immutable ist.

**Anfragen:** Knopf „Zugriff anfragen" im Beleg-Kopf für fremde Bearbeiter,
Aktion `strom.zugriff_anfragen` (Rolle ≥ bearbeiter; Objektregel: Strom
gesperrt, weder Inhaber noch zugewiesen), optionale Notiz (max. 500 Zeichen,
geprüft im Code, gespeichert am Inbox-Eintrag). Läuft schon eine offene
Anfrage, zeigt der Kopf „Angefragt am …" — abgeleitet aus dem offenen
Eintrag. **Empfänger:** der Sperrinhaber; ist er kein Prüfer mehr oder
deaktiviert, alle aktiven Admins.

**Antworten am Eintrag:** „Zuweisen" ruft dieselbe Aktion `strom.zuweisen`
auf (gleiche Rechte); „Ablehnen" (`inbox.ablehnen`, nur Empfänger)
protokolliert `zugriff_abgelehnt` am Strom. Jede Zuweisung — mit oder ohne
Anfrage — erzeugt `freischaltung` für die zugewiesene Person; die Ablehnung
erzeugt `zugriff_abgelehnt` für den Anfragenden. Die betroffene Person
steht als `betrifftId` am Ereignis (Protokoll-Text, kein eigenes Feld).
**Abräumen bei allen Empfängern** (wer handelt, räumt bei allen ab):
Zuweisen und Ablehnen erledigen die offenen Anfragen dieser Person zum
Strom, **Entsperren erledigt alle offenen Anfragen zum Strom ohne weitere
Mitteilung**. Das Abräumen sitzt in der Zustellung (lib/inbox), nicht in
den Aktionen — eine Schreibstelle. Anfrage-Einträge sind keine reinen
Hinweise („Alle erledigt" lässt sie stehen), Freischaltung und Ablehnung
sind reine Hinweise.

## 27. Filter „Verfügbarkeit" (E52) und IMMUTABLE-Enum-Funktion (E53) (29.09.2026)

**E52 — Eine Beschriftung, Bezugszeit im Hinweis** (Rückmeldung aus dem
Echtbetrieb, PR #125): Der Verfügbarkeitsfilter heißt in ströme., karte. und
auswertung. „Verfügbarkeit" (E32: ein Filter, ein Name). Der Unterschied der
Bezugszeit steht im Hinweis am Filter — Tooltip am Chip und Zeile im Popover:
„bezogen auf heute" in ströme. und karte., „bezogen auf das gewählte Jahr
bzw. den gewählten Zeitraum" in auswertung. Die Beschriftung „Status im
gewählten Zeitraum" (E41) entfällt; `labelJeAnsicht` ist durch
`hinweis`/`hinweisJeAnsicht` ersetzt. Die Export-Spalten bleiben:
„Verfügbarkeit" und „Verfügbarkeit bezogen auf" (E41) tragen die Bezugszeit
bereits selbst; die Filterzeile im Export-Kopf nennt den Filter jetzt
ebenfalls „Verfügbarkeit".

**E53 — IMMUTABLE-Funktion `inbox_typ_text`** (Migration 0028, PR #124/#125): Postgres verlangt
in Index-Prädikaten unveränderliche Ausdrücke; der Enum→Text-Cast gilt nur
als STABLE, und ein in derselben Transaktion angefügter Enum-Wert ist dort
nicht als Literal verwendbar. Die Funktion erklärt den Cast für
unveränderlich. **Bedingung:** Die Werte von `inbox_typ` (und der Typ
selbst) werden nie umbenannt — ein `ALTER TYPE … RENAME VALUE` würde
Index-Prädikat und ON CONFLICT still verfälschen. **Wächter**
`packages/db/src/enum-rename-check.ts` (CI, typen-und-tests) weist jede
Migration ab, die einen gelisteten Enum oder den Typ umbenennt; die Liste
der in IMMUTABLE-Funktionen verwendeten Enums steht im Wächter. **Ein Wert
wird stattdessen ersetzt:** neuen Wert anlegen (ADD VALUE), Daten
migrieren, alten Wert nicht mehr verwenden (Code und Register), Altzeilen
bleiben lesbar.

## 28. Filter „Für mich" (E56, 29.09.2026)

**Segment-Schalter „Alle | Für mich"** oben in ströme. und karte., Standard
„Alle", Zustand in der URL (`fuer=mich`) wie jeder andere Filter (E32,
Filtertyp `schalter`: kein Chip, steht in der Kopfzeile; Zurücksetzen leert
ihn, in auswertung. bleibt er gemerkt und wird als zurückgehalten
ausgewiesen). **„Für mich"** = der Strom ist von mir gesperrt ODER mir
zugewiesen ODER ich bin beteiligt — beteiligt im Sinne von `beteiligte()`
aus AP2.2 (Protokoll-Arten angelegt, geaendert, status_gesetzt, verworfen).
Sperre und Zuweisungen stehen am geladenen Strom; die Beteiligung kommt als
**eine Menge** aus dem Protokoll (`ladeBeteiligungen`, SELECT DISTINCT je
Art), das Flag wird einmal je Request am Pool angereichert — kein Nachladen
je Zeile. **Messung vor der Umsetzung** (EXPLAIN ANALYZE auf der Preview,
73 Feedstock, 29 Protokollzeilen): Seq Scan mit gehashten Subplans, 1,9 ms;
kein Index nötig. Erneut messen, wenn `aenderung` über etwa 10.000 Zeilen
wächst (Kandidat: Index auf `benutzer_id`).

**Betrachter** können nicht beteiligt sein (sie schreiben nichts, werden
nicht zugewiesen, sperren nicht): Für sie gibt es den Schalter nicht, und
der Parameter wirkt nicht — ein Filter ohne Wirkung wird nicht angezeigt.
**Leerzustand** benannt: „Keine Einträge, an denen du beteiligt bist." (in
ströme. als Leerzustand, in karte. als Hinweiszeile). Der Export nennt in
der aktiven Filterzeile „Für mich".

## 29. AP2.3 Admin-Inputdatenbank: Umfang, Ort (E59) und Wirksamkeit von Parametern (E60), 30.09.2026

**E59 — Umfang und Ort.** v1 umfasst Parameter mit Verlauf (erster
Verbraucher: die Verifikationsfristen je Belegtyp aus E33, dazu die
Reservierungsgültigkeit, die denselben Mechanismus nutzt) und die
Sektorliste (PR b). Materialarten bleiben bei Migrationen; GET
/api/materialarten wird in PR b entfernt. Ort: einstellungen. mit den
Reitern Nutzer · Referenzlisten · Parameter (PR a: Nutzer · Parameter);
Referenzlisten und Parameter sieht und bedient nur admin, serverseitig
abgesichert (Aktionen `parameter.setzen`, `parameter.zuruecknehmen` in
der Matrix, VERWALTEN).

**E60 — Wirksamkeit.** Eine Parameteränderung gilt **ab einem Datum**
(heute oder künftig), **nie rückwirkend**; der alte Wert bleibt im Verlauf.
Datenmodell (Migration 0029, Expand): `parameter_definition` (Schlüssel
als Text, kein Enum — E53; neue Schlüssel nur per Migration zusammen mit
ihrem Verbraucher) und `parameter_wert` (Wert, `gueltig_ab`, Begründung
Pflicht, Urheber, UNIQUE je Schlüssel und Datum). In der DB: CHECK
`gueltig_ab = '-infinity' OR gueltig_ab >= Erfassungstag (Europe/Berlin)`;
Trigger: UPDATE immer abgewiesen, DELETE nur für `gueltig_ab >
current_date` (Zurücknehmen einer geplanten Änderung); Bereichs-Trigger
gegen min/max der Definition. **Startwerte** mit `gueltig_ab = '-infinity'`
= benannter Zustand „seit Einführung": gespraech 3, dokument 6,
webrecherche 3, reservierung 12 Monate — die bisherigen Konstanten
`BELEG_MONATE` aus `lib/verifizierung.ts` (E33; Reservierung Beschluss
22.09.2026). **Lesen an genau einer Stelle:** SQL-Funktion
`parameter_wert(schluessel, stichtag)` (STABLE) liefert den Wert der Zeile
mit dem größten `gueltig_ab <= stichtag`; kein Treffer ist ein Fehler, es
gibt keinen Standardwert. Der TS-Wrapper `parameterWertAm` und der Loader
(`lib/stroeme.ts`: `belegFristMonate` am Erhebungsdatum,
`reservierungMonate` an `reserviert_seit`) nutzen dieselbe Funktion; die
Fälligkeit (`lib/verifizierung.ts`) rechnet mit dem am Datensatz
gelieferten Wert und hat keine Konstante mehr. Basisdatum bleibt das
bisherige (Erhebungsdatum = `beleg.erstellt_am::date`, bzw.
`reserviert_seit`), damit eine spätere Änderung nur Einträge ab ihrem
Stichtag betrifft. Wächter: `packages/db/src/parameter-check.ts` (CI)
prüft Funktion, CHECK, beide Trigger, Bereich und die Wirksamkeit ab Datum
gegen die Preview; Beweis „Fälligkeit vor und nach der Umstellung
identisch" im PR.

**PR b (30.09.2026) — Basisdatum, Sektorliste, Reiter.**

*Basisdatum als Kalendertag Europe/Berlin.* Jede Stelle, an der
`beleg.erstellt_am` bzw. „heute" zum Datum wird, misst am Kalendertag
Europe/Berlin (`lib/datum.ts`: `kalendertag`, `heuteBerlin`; in SQL
`erstellt_am at time zone 'Europe/Berlin'`), passend zum CHECK „nie
rückwirkend" in `parameter_wert`. Vorher lief ein Teil über die
UTC-Darstellung: zwischen 00:00 und 02:00 Berlin lag ein Beleg einen Tag zu
früh und bekam am Tag einer Friständerung die alte Frist. Gemessen vor der
Umstellung (Preview, 128 Ströme, 40 mit Typ-Frist): kein Beleg mit
abweichendem UTC-/Berlin-Tag, 0 Abweichungen der Fälligkeit; Probe 7 in
`parameter-check.ts` hält den Fall „Beleg um 00:30 Berlin am Tag der
Änderung" dauerhaft fest (neue Frist in Berlin, alte Frist in UTC).
`reserviert_seit` ist bereits ein Datum; sein Stempel kommt seit PR b aus
`heuteBerlin()`.

*Sektorliste pflegbar (Migration 0030, Expand).* `sektor` bekommt `id`
(uuid, Objektbezug fürs Protokoll — `aenderung.entitaet_id` ist uuid, der
Code bleibt Schlüssel und Fremdschlüssel-Ziel) und `aktiv` (Default true),
einen eindeutigen Index auf `lower(btrim(label))` (Dubletten vor der
Migration: keine) und die CHECKs `sektor_code_check` (snake_case ohne
Umlaute; `ohne_sektor` und `abnehmer` nie ein Sektor) und
`sektor_label_check`. Aktionen `sektor.anlegen`, `sektor.umbenennen`,
`sektor.deaktivieren`, `sektor.reaktivieren` (VERWALTEN, protokolliert mit
den Ereignisarten `sektor_angelegt`, `sektor_umbenannt`,
`sektor_deaktiviert`, `sektor_reaktiviert`). Der Code entsteht aus der
Bezeichnung (`codeAusLabel`) und bleibt beim Umbenennen. **Gelöscht wird
nicht:** Deaktivieren nimmt den Sektor aus der Auswahl (`/api/sektoren`
liefert alle mit `aktiv`, die Combobox zeigt nur aktive, POST /api/akteure
nimmt nur aktive an); Akteure behalten ihn, in Ströme-Ansichten und im
Filter steht er als „… (deaktiviert)", solange er verwendet wird (der
Filter baut sich aus dem Pool). „ohne Sektor" bleibt der benannte Zustand
für NULL. Der `sektor-check` prüft seit PR b die Struktur und die Regeln
(Index und CHECKs greifen, Fremdschlüssel greift, Akteur-Anlage mit/ohne
Sektor, Akteur an deaktiviertem Sektor bleibt gültig) statt einer festen
Werteliste — Rot-Nachweis ohne 0030 im PR.

*GET /api/materialarten* und `sucheMaterialarten` sind entfernt (kein
Aufrufer; Materialarten bleiben bei Migrationen, E59). Reiter in
einstellungen.: Nutzer · Referenzlisten · Parameter.

**E61 — Reservierte Werte der Sektorliste (30.09.2026).** `ohne_sektor`
und `abnehmer` sind als Code, „ohne Sektor" und „Abnehmer" als Bezeichnung
reserviert. Das ist eine **fachliche** Kopplung, keine technische: Kein
Programmpfad liest den Code `abnehmer` (Suche über apps/, packages/, docs/
am 30.09.2026: nur `lib/sektor.ts`, der `sektor-check` und dieser Log).
Grund ist die Entscheidung zu Migration 0020 (Abschnitt „Sektor als
Referenzdaten", Punkt 2): `abnehmer` war mit 50 Akteuren der häufigste
Freitext-„Sektor", ist aber eine **Rolle**, die sich vollständig aus den
Strömen ableitet (E23) — als Wert einer Auswahlliste bedeutete er etwas
anderes als alle übrigen Einträge und wurde deshalb geleert. Die
Reservierung verhindert, dass ein Admin ihn über die Referenzliste wieder
einführt. `ohne_sektor` ist der benannte Filterwert für NULL
(`lib/hierarchie-baeume.ts`, OHNE_SEKTOR); ein echter Sektor mit diesem
Code oder dieser Bezeichnung kollidierte mit dem Filter.

**Umsetzung (Migration 0031):** Die Vergleichsform der Bezeichnung ist
**eine** Funktion, `sektor_label_norm(label) = lower(btrim(label, Leer/
Tab/CR/LF))` (IMMUTABLE); sie trägt den eindeutigen Index
`sektor_label_norm_idx` (ersetzt `sektor_label_lower_idx` aus 0030, dessen
`btrim` ohne Zeichenliste nur Leerzeichen entfernte — Befund des
`sektor-check` in PR #136: ein Tabulator am Rand ging am Index vorbei) und
den CHECK `sektor_label_reserviert_check` (`not in ('abnehmer', 'ohne
sektor')`). Codes schützt weiterhin `sektor_code_check`. Die App rechnet
dieselbe Form (`labelSchluessel` in `lib/sektor.ts`, bewusst kein `trim()`,
das mehr Zeichen nimmt) und lehnt Dubletten und reservierte Bezeichnungen
beim Anlegen **und** beim Umbenennen mit Meldung ab; die Wahrheit sind Index
und CHECK. Vorprüfung in der Migration: Kollisionen unter der neuen
Vergleichsform und reservierte Bezeichnungen brechen sie mit der Liste ab
(gemessen vor der Migration: Production 8 Sektoren aus 0020, Preview 9 —
keine). Der `sektor-check` erzwingt beide Befunde als Proben (Tabulator/CR/
LF am Rand abgewiesen; „Abnehmer" und „ohne Sektor" in jeder Schreibweise
beim Anlegen und Umbenennen abgewiesen) — vor 0031 rot, danach grün.

## 30. AP2.4 Prüf- & Verifikationsprozess: Verifikationsmodell und Rechte (E62), Reservierung veraltet (E64), 30.09.2026

**Schritt 0 (gemessen, abgenommen):** Die E33-Fälligkeit hatte elf
Verbraucher (Detail, Karte, Register, Formular-Vorschau, Filter
„Verifizierung", Export „Verifizierung"/„Fälligkeit", Auswertungsmodul „drei
nächste", SQL-Zulieferung im Loader). Status setzte eine Stelle
(`wechsleStatus`, Übergänge in `lib/status.ts`), und jeder bearbeiter durfte
„geprüft" setzen. Qualität A–D entstand an zwei gespiegelten Stellen (SQL
`qualitaetsstufe()` als GENERATED-Spalte, TS `deriveQualitaet`, Paritätstest
im CI). Der Zielstatus stand nur im Freitext von `status_gesetzt`. Das
Veralten der Reservierung hing allein an der Gesamtfälligkeit.

**E62 — Rechte (D4).** „in Prüfung geben", „Zurückgeben" (in_pruefung →
entwurf) und „Reaktivieren" (verworfen → entwurf) ab bearbeiter
(`strom.status_setzen`, Übergänge ohne „geprüft"); **„geprüft" nur pruefer
und admin** über die eigene Aktion `strom.pruefen`, auch direkt aus entwurf.
Ablauf-Markierung (`beleg.abgelaufen_markieren`, `beleg.abgelaufen_aufheben`)
nur pruefer/admin. Objektregel wie das Bearbeiten (am gesperrten Strom nur
Inhaber, Zugewiesene, admin). Matrix-Tests je Rolle × Sperre; Rot-Nachweis
im PR.

**E62 — Ereignisarten (0.4).** Jeder Statuswechsel mit eigener Art,
strukturiert statt Freitext: `in_pruefung_gegeben` (entwurf → in_pruefung
und geprueft → in_pruefung von Hand), `geprueft`, `zurueckgegeben`,
`reaktiviert`, `verworfen` (bestehend), `zurueckgesetzt` (automatisch bei
fachlicher Änderung, Feldliste im Text); dazu `als_abgelaufen_markiert`,
`abgelaufen_aufgehoben`; `reverifiziert` folgt in PR b. `status_gesetzt`
bleibt nur für den Altbestand. Die Beteiligten-Ableitung (E51/E56) zählt die
fünf Statusarten mit.

**E62 — Verifikation, abgeleitet statt gespeichert (E23, D1).** Eine
SQL-Funktion `strom_verifikation(stichtag)` (Migration 0032, STABLE,
mengenbasiert) für Liste, Detail, Filter, Export und Job:
`verifiziert_am` = Zeitpunkt des letzten Ereignisses geprueft/reverifiziert,
solange der Strom geprüft ist; `verifiziert_bis` = `gueltig_bis` bei den
oberen vier Belegtypen, sonst Kalendertag Berlin von `verifiziert_am` +
`parameter_wert('verifikationsfrist.<typ>', dieser Tag)`. Zustände:
`ungeprueft` (entwurf, verworfen) · `in_pruefung` · `gueltig` ·
`laeuft_bald_ab` (PR b) · `abgelaufen` · `als_abgelaufen_markiert` ·
`pruefdatum_unbekannt` (geprüft ohne Prüfereignis, z. B. Altbestand, oder
geprüft ohne Beleg — gilt als fällig). **Gewollte Verhaltensänderung:** die
Frist zählt ab dem Prüftag, nicht mehr ab der Erhebung; die alte
Gesamtfälligkeit (`lib/verifizierung.ts`) ist entfernt, alle Verbraucher
lesen `strom.verifikation` aus dem Loader. Filter „Verifikation" mit den
benannten Zuständen (E32); Export „Verifikation" und „verifiziert bis";
Auswertungsmodul „nächste verifikation" (Abgelaufene zuerst).
Vorher/Nachher der Preview-Einträge im PR.

**E62 — „Abgelaufen" markieren (D3).** `beleg.abgelaufen_am date` — eine
Eingabe des Prüfers, nicht ableitbar, deshalb gespeichert; Setzen und
Aufheben protokolliert. Wirkung: Zustand `als_abgelaufen_markiert`, keine
Erinnerungen (PR b), Pille „abgelaufen.". Qualität: `qualitaetsstufe()`
bekommt `abgelaufen_am` und wertet **eine Stufe** ab (A→B, B→C, C→D, D
bleibt D); die GENERATED-Spalte `beleg.qualitaet` ist dafür neu angelegt,
`deriveQualitaet` spiegelt es, die Ankerfälle prüfen jede Stufe. Nur die
Markierung wertet ab, eine bloß überfällige Verifikation nicht.

**E62 — Rücksetzen bei fachlicher Änderung (E43, D6).** Feldeinstufung als
Daten in `lib/feldeinstufung.ts` (fachlich / redaktionell / technisch) für
jede Spalte von biomassestrom, output_bedarf, beleg, vergabe_zeitraum;
Entscheidung 0.5: kontaktperson und extern_nachvollziehbar redaktionell
(Kontakt wandert mit AP2.5 ins CRM; die Freigabe regelt Sichtbarkeit, nicht
Richtigkeit), Notizen redaktionell, technische Spalten ausdrücklich geführt.
Wächter `scripts/feld-check.ts`: eine Spalte ohne Einstufung ist rot
(Rot-Nachweis im PR). Speichert jemand eine fachliche Änderung an einem
geprüften Strom, setzt `stromSpeichern` in derselben Transaktion den Status
auf in_pruefung und schreibt `zurueckgesetzt` mit den Feldnamen.

**E62 — Inbox.** Neue Typen `pruefauftrag` (an alle aktiven Prüfer und
Admins, sobald ein Strom in in_pruefung kommt — manuell oder durch
Rücksetzen; Bündelung je Prüfer und Strom per Unique-Index; erledigt bei
allen, sobald jemand prüft, zurückgibt oder verwirft) und
`pruefung_erledigt` (an die Person, die in Prüfung gegeben bzw. die
Rücksetzung ausgelöst hat, nicht wenn sie selbst prüft). Ein Ereignis kann
mehrere Typen auslösen; **keine Doppel-Einträge (D6):** wer für dasselbe
Ereignis einen pruefauftrag oder pruefung_erledigt bekommt, bekommt keinen
aenderung_eintrag. **Empfänger des Prüfauftrags sind pruefer und admin**
(Rangfolge E42, admin ⊇ pruefer; bestätigt Eric 01.10.2026 bei der Abnahme
von PR a).

**E64 — Reservierung veraltet.** Das Veralten der Reservierung ist ein
Nebentag „Reservierung veraltet" in der Verfügbarkeit, abgeleitet aus
`reserviert_seit` + `parameter_wert('verifikationsfrist.reservierung',
Kalendertag Berlin von reserviert_seit)`, unabhängig von der Verifikation.
An den Zahlen ändert sich nichts: die Reservierung zählt weiter als
reserviert, der Nebentag heißt nur „bitte erneuern". Filterbar im
Verfügbarkeits-Filter als siebte Option (E32). Verfügbarkeitsende und
Vergabe-Enden deckt der Verfügbarkeits-Filter bereits ab (abgelaufen,
vergeben).

## 31. AP2.4 PR b: Beleg-Pflicht, täglicher Job, Ablauf-Hinweise, erneut verifizieren (E63), 01.10.2026

**Beleg-Pflicht beim Prüfen (Entscheidung Eric 01.10.2026).** `strom.pruefen`
und `strom.reverifizieren` setzen einen Beleg voraus; ohne Beleg weist der
Server am Eingang der Transaktion ab: „Ohne Beleg kann nicht geprüft
werden." (Test, einmal rot). Bestehende geprüfte Ströme ohne Beleg tragen
den **benannten Zustand `ohne_beleg`** in `strom_verifikation()` (E24) —
keine Frist, keine Ablauf-Hinweise, kein Rang in „nächste Verifikation"; der
Weg zurück führt über einen Beleg (fachliche Änderung → Rücksetzen →
Prüfung). „Prüfdatum unbekannt" meint seit PR b nur noch: geprüft mit Beleg,
aber ohne erkennbares Prüfereignis (Altbestand). **Vorher gemessen** (Leseweg,
01.10.2026): Preview 0 geprüfte Ströme ohne Beleg (86 ohne Prüfereignis),
Production 0 (keine Ströme).

**Parameter `verifikation.vorlauf_tage` = 7** (Migration 0033, Einheit Tage,
1–90, Startwert seit Einführung, Ursprung E63). `strom_verifikation()`
liefert `laeuft_bald_ab`, wenn verifiziert_bis − Vorlauf ≤ Stichtag ≤
verifiziert_bis; „abgelaufen" bleibt ab dem Folgetag von verifiziert_bis
(PR a, abgenommen) — der Ablauf-Hinweis kommt also am ersten Tag nach
verifiziert_bis.

**Erneut verifizieren (`strom.reverifizieren`, pruefer/admin, Objektregel wie
Bearbeiten).** Nur an geprüften Strömen mit Beleg; kein Statuswechsel, das
Ereignis `reverifiziert` ist der neue Prüftag (zählt als Beteiligung, löst
aenderung_eintrag aus). D3-Regeln serverseitig: Beleg als abgelaufen
markiert → erst Markierung aufheben; bei den gueltig_bis-Typen mit
erreichtem Datum (gueltig_bis ≤ heute) → nur neues gueltig_bis nach heute,
Belegtypwechsel (fachliche Änderung → Rücksetzen → Prüfweg) oder Markierung.
Knopf im Beleg-Block des Details und am Hinweis in der Inbox.

**Täglicher Job (Cloudflare Cron).** `wrangler.jsonc`: Cron 03:00 und 04:00
UTC; eigener Worker-Einstieg `apps/web/worker.ts` um den OpenNext-Handler
(`fetch` unverändert, `scheduled` neu). Weiter geht es nur um **05:00
Berlin** (`lib/jobs/zeit.ts`, Test um beide Umstellungstage, genau ein
Treffer je Tag). Tabelle `job_lauf` (job, stichtag Berlin, gestartet_am,
beendet_am, ergebnis laeuft|ok|fehler, anzahl, fehler) mit UNIQUE(job,
stichtag): der Start ist idempotent, ein zweiter Aufruf desselben Tages
findet den Lauf vor und tut nichts. Der Job hat keinen Request-Kontext und
keine Identität — er bekommt Datenbank und Zeitpunkt hereingereicht.

**Ablauf-Hinweise, zustandsbasiert (lib/inbox/hinweise.ts).** Der Job sieht
am Stichtag auf `strom_verifikation()`: `laeuft_bald_ab` →
`verifikation_laeuft_ab` (Bezugsdatum = verifiziert_bis), `abgelaufen` →
`verifikation_abgelaufen` (Bezugsdatum = verifiziert_bis),
`pruefdatum_unbekannt` → `verifikation_abgelaufen` ohne Bezugsdatum, an alle
Prüfer. `als_abgelaufen_markiert` (D3) und `ohne_beleg` bekommen nichts.
Empfänger: der Prüfer des letzten geprueft/reverifiziert; ist er kein
Prüfer/Admin mehr oder deaktiviert, alle aktiven Prüfer und Admins.
**Idempotenz in der Datenbank:** je Empfänger, Typ, Strom und Bezugsdatum
genau ein Eintrag, über alle Zustände (Unique-Index NULLS NOT DISTINCT; ON
CONFLICT DO NOTHING) — ein zweiter Lauf erzeugt nichts, ausgefallene Tage
holen sich ohne Sonderlogik nach, eine neue Verifikation ergibt ein neues
Bezugsdatum. Der Index trägt den Empfänger (Abweichung vom Auftragstext
„typ, strom, bezugsdatum"): sonst blockierte der Hinweis eines später
deaktivierten Prüfers den Fallback an die übrigen. Mit dem Ablauf-Hinweis
wird der Vorab-Hinweis desselben Bezugsdatums erledigt (nicht „läuft am X
ab" neben „seit X abgelaufen"). Die Hinweise haben **keinen Urheber und kein
Ereignis**: `inbox_eintrag.ausloeser_id` und `ereignis_id` sind NULL-fähig,
der CHECK `inbox_eintrag_urheber_check` verlangt beides für jeden anderen
Typ; die Liste zeigt statt Avatar ein Kalender-Zeichen. Hinweise sind
Aufgaben (nicht in „Alle erledigt"), Aktionen gelesen/ungelesen/erledigt/
verwerfen und „Erneut verifizieren" (Prüfer). Abgeräumt bei allen nach
geprueft, reverifiziert, in_pruefung_gegeben, zurueckgesetzt, verworfen,
als_abgelaufen_markiert (Zustellung, dieselbe Transaktion).

**Job-Wache (`job-wache.yml`).** Seit Betrieb 04.10.2026 (Entscheidung Eric):
mehrfach täglich auf krummen Minuten (04:17, 06:43, 10:29, 15:11 UTC), jeder
Lauf prüft — ab 05:30 Berlin den heutigen Stichtag, davor den gestrigen
(reine Funktion `faelligerStichtag`, Tests über Sommer-/Winterzeit und die
Umstellung 25.10.2026). Die frühere Stundensperre (Prüfung nur in der
Berliner Stunde 6) ist ersatzlos weg: GitHub startete die geplanten Läufe
fünf bis sechs Stunden zu spät, die Wache endete grün ohne Prüfung. Kein
Ausgang „prüft nicht" mit Grün; nicht prüfbar ist rot. Environment
production-lesend (nur main), nur SELECT; manuell mit Stichtag (Rot-Nachweis). `job_lauf` ist für bhyo_leser
über die Standardrechte von neondb_owner lesbar (Leseweg, STANDARDRECHTE).

**Freigegebene Abweichungen (Abnahme PR b, Eric 01.10.2026; werden später
unter E62/E63 geführt, keine eigene Nummer):** `ohne_beleg` ist **nicht
fällig** und hat **keinen Rang** in „nächste Verifikation" — der Weg führt
über einen Beleg, nicht über eine Verifikation. **Erneut verifizieren wird
abgewiesen, solange die Markierung „abgelaufen" besteht** (erst Markierung
aufheben). Ebenso freigegeben: Empfänger im Idempotenz-Index, „abgelaufen"
ab dem Folgetag von verifiziert_bis, Vorab-Hinweis wird mit dem Ablauf
erledigt, Hinweise sind Aufgaben (nicht in „Alle erledigt").

**Nachweise im CI:** `verifikation-check` (ohne_beleg, reverifiziert als
Prüftag, Vorlauf innen/außen/am Tag/Folgetag, Hinweis-Unique mit und ohne
Bezugsdatum, Urheber-CHECK, job_lauf-Unique und -CHECK) und `job-probe`
(zweiter Lauf erzeugt nichts, Nachholen am späteren Stichtag, Empfänger-
Fallback, D3/ohne Beleg ohne Hinweis) — beide gegen die Preview, jede Probe
zurückgerollt.

## 32. AP2.4 PR c: Weitergeben als Aufgabe (E63, D5), 01.10.2026

**Weitergeben** (`inbox.weitergeben`, ERFASSEN = ab bearbeiter, Objektregel
nurEmpfaenger): Der Empfänger eines Prüfauftrags oder Ablauf-Hinweises
(`pruefauftrag`, `verifikation_laeuft_ab`, `verifikation_abgelaufen`) gibt
ihn als Aufgabe an eine Person weiter — aktiv, Rolle ≥ bearbeiter
(`darfZugewiesenWerden`), **nie an sich selbst**. **E65 (Eric 04.10.2026):
Der eigene Eintrag des Absenders bleibt offen** (nur gelesen), bis die Sache
selbst erledigt ist — geprüft, erneut verifiziert oder verworfen räumen
Hinweis/Prüfauftrag und Aufgabe bei allen Empfängern ab. Verwirft der
Empfänger die Aufgabe, bleibt der Absender-Eintrag offen. Tests:
`lib/inbox/weitergeben.test.ts` („E65: der eigene Eintrag bleibt OFFEN"),
`lib/inbox/zustellung.test.ts` („E65: geprueft erledigt den offenen
Absender-Hinweis UND die weitergegebene Aufgabe"), `lib/inbox/actions.test.ts`
(„E65: Verwerfen der weitergegebenen Aufgabe aendert nur den eigenen Eintrag"). **Aufgabentext** vorbefüllt „Bitte aktualisieren", frei änderbar,
nicht leer, höchstens 500 Zeichen — serverseitig (`lib/inbox/aufgabe.ts`,
Meldung) **und** als DB-CHECK `inbox_eintrag_aufgabe_check` (Migration 0034:
Text nur beim Typ aufgabe, dort Pflicht; Rot-Nachweis leerer Text im Server
und in der DB).

**Ereignis `weitergegeben`** über `protokolliere(tx)` in derselben
Transaktion wie die Zustellung — Objektbezug Strom, betroffene Person
(`betrifftId`), Text „Weitergegeben an <Name>: <Aufgabe>"; das neue Feld
`aufgabe` des Ereignisses geht als `inbox_eintrag.aufgabe` an den Empfänger.
Keine Beteiligung, kein aenderung_eintrag.

**Inbox-Typ `aufgabe`** (Register): Empfänger = betroffene Person, keine
Bündelung (jede Weitergabe ein Eintrag mit eigenem Text), Aufgabe (nicht in
„Alle erledigt"). Erledigt bei allen, sobald der Strom geprüft, erneut
verifiziert oder verworfen ist (`AUFGABE_ABRAEUMEN_BEI`) — oder wenn der
Empfänger sie erledigt. Kreislauf ohne Prüfer-Rolle: der Empfänger bearbeitet,
die fachliche Änderung setzt zurück → in_pruefung → pruefauftrag an alle
Prüfer → geprüft erledigt die Aufgabe (Test in zustellung.test.ts).

**Enum-Erweiterungen** (`inbox_typ` + aufgabe, `ereignis_art` + weitergegeben)
fallen unter das Rename-Verbot E53; `inbox-check` (Typen 9, Spalte, CHECK mit
Proben leer/501/fremder Typ) und `protokoll-check` decken den neuen Pfad ab.
Im selben PR: Kopfkommentar in `lese-diagnose.yml` korrigiert
(production-lesend erlaubt nur main, wie docs/betrieb.md).

## 33. AP2.5 CRM Akteure: Stammdaten, Sitz, Verwaist-Hinweis (E66, Präzisierung F0a), 01.10.2026

**Bestandsaufnahme (abgenommen 01.10.2026):** Der Sektor liegt seit 0020 am
Akteur (FK auf `sektor.code`), nicht am Strom — kein Sektor-Umzug. Adresse
und Pin liegen laut F0a (§7) am Strom; VG250 kennt nur Land und Kreis; die
Felder rollen, kontakt_email, kontakt_telefon, ansprechperson sind nirgends
gefüllt und `rollen` wird nirgends gelesen („Abnehmer" ist abgeleitet, E61);
`akteur_interesse` (AP1a) hat weder Schreibpfad noch Oberfläche und ist
leer; Seed-Akteure haben kein Anlage-Ereignis; pg_trgm fehlt (PR c).

**E66 (Fassung nach Abnahme a1, Eric 01.10.2026).** Pflicht am Akteur:
Name, Sektor (NOT NULL inkl. Systemzeile `ohne_sektor`, ab a2), Sitz mit
PLZ, Ort und Pin (aus Adresssuche, vom Strom übernommen oder von Hand in der
Karte gesetzt — dasselbe Bauteil wie beim Strom-Standort, der AdresseBlock)
und der daraus bestimmte Kreis-ARS. **„Unvollständig" heißt: keine
Adresse** (keine Straße am Sitz). Der Regionsfilter in akteure. wirkt auf
den Sitz und heißt dort „Sitz in Region" (einzige Ausnahme von E32 „eine
Beschriftung", weil die Facette ein anderes Objekt trifft); Karte, ströme.
und auswertung. bleiben am Strom-Standort. Verwaist = kein Strom verweist auf den Akteur (E48; auch kein
verworfener); Hinweis an die Admins nach `akteur.verwaist_hinweis_monate`
(Startwert 6, seit Einführung). „Ohne Sektor" ist eine bewusste Auswahl als
Systemzeile, nicht NULL (ersetzt E35). Keine Branche. Stammdaten bearbeiten
ab bearbeiter ohne Sperre (E44); löschen nur Admin und nur verwaist;
Zusammenführen (PR c) nur Prüfer und Admin. Kontaktpersonen (PR b): lesen
alle, anlegen/bearbeiten ab bearbeiter, löschen Prüfer/Admin,
Auskunfts-Export Admin; jede gehört zu genau einem Akteur, kein Umhängen.

**Systemzeile ohne_sektor (a1, Migration 0035).** Zeile `ohne_sektor` /
„ohne Sektor", aktiv, Sortierung am Ende. Der CHECK `sektor_code_check`
verbietet nur noch `abnehmer`; der Trigger `sektor_systemzeile_wache`
verbietet einen zweiten INSERT des Codes, jedes Umbenennen/Deaktivieren/
Löschen der Systemzeile und das Umbenennen eines anderen Codes darauf. Die
reservierte Bezeichnung „ohne Sektor" (E61) bleibt für alle anderen Zeilen
gesperrt (CHECK mit Ausnahme der Systemzeile). Bestehende NULL wurden zu
`ohne_sektor` — keine erfundene Fachangabe, NULL hieß laut E35 bereits „ohne
Sektor". Der `sektor-check` ist umgekehrt (Zeile genau einmal, geschützt;
Rot-Nachweis #155). Admin-Oberfläche: Systemzeile ohne Umbenennen/
Deaktivieren; Server weist es ebenfalls ab.

**Sitz des Akteurs — Präzisierung von F0a (§7), ein Ort je Bedeutung.** Der
Akteur bekommt einen **Sitz** (`sitz_strasse`, `sitz_hausnummer`, `sitz_plz`,
`sitz_ort`, `sitz_geom`): Adresse frei, PLZ und Ort Pflicht (NOT NULL ab a2),
Pin über den Geocoder. Der Strom behält seinen **Standort**; kein Abgleich,
kein Vererben. Karte, Regionsfilter, auswertung. und Logistik bleiben am
Strom-Standort; der Sitz wirkt nur in akteure., beim Dublettenabgleich (PR c)
und im Kontakt (PR b). Beschriftungen „Sitz" am Akteur, „Standort" am Strom.
Beim Anlegen im Beleg ist der Sitz mit dem Strom-Standort vorbefüllt und
änderbar; die Detailansicht zeigt Sitz-Pin (Waldgrün) und Strom-Standorte
(Navy) unterscheidbar.

**Kreis-ARS über den E25-Weg — die Pflicht-Eingabe ist die Koordinate.** Die
View `akteur_verwaltung` bestimmt den Kreis wie `strom_verwaltung` (0016)
per `ST_Covers` aus `sitz_geom`; PLZ und Ort als Text bestimmen keinen ARS.
Deshalb verlangt der Server beim Anlegen und Bearbeiten PLZ, Ort **und** den
Pin (lat/lng) und rollt zurück, wenn kein Kreis den Pin deckt („Der Ort ist
nicht bestimmbar …"). Der Pin kommt aus der Adresssuche (Photon) oder vom
Strom-Standort; „Pin frei" meint: nicht von Hand zu setzen. Kein Gemeinde-
Import (für AP5 vorgemerkt).

**Rechte und Protokoll.** `akteur.bearbeiten` = ERFASSEN ohne Objektregel
(keine Sperre, E44); `akteur.loeschen` = VERWALTEN, Server prüft „kein Strom
verweist" in der Transaktion, die DB weist per Fremdschlüssel jeden
Strom-Bezug ab. Ereignisse `akteur_angelegt` (Freitext jetzt ohne Namen),
`akteur_geaendert` (Feldnamen), `akteur_geloescht` — nur IDs und Feldnamen
im Freitext (E57). Beim Umhängen eines Stroms bekommt der **alte** Akteur
ein `akteur_geaendert` („Strom <id> umgehängt"), damit „seit wann verwaist"
aus dem Protokoll lesbar bleibt (E23). `akteur_interesse` wird beim Löschen
eines verwaisten Akteurs in derselben Transaktion mitgelöscht (im
Ereignistext gezählt); beim Zusammenführen (PR c) wandert es mit, Duplikate
derselben Region werden zusammengelegt.

**Verwaist-Hinweis (Job).** Inbox-Typ `akteur_verwaist` mit Objektbezug
`inbox_eintrag.akteur_id` (ON DELETE CASCADE), Idempotenz-Index (Empfänger,
Typ, Akteur, Bezugsdatum) NULLS NOT DISTINCT, Urheber-CHECK um den Typ
erweitert, CHECK „genau ein Objekt" um den Akteur. Seit wann: letztes
Ereignis am Akteur (angelegt/geändert), für **Altbestand ohne Anlage-
Ereignis** `created_at` — namentliche Ausnahme im Code (lib/akteure.ts,
lib/inbox/hinweise.ts). Nach N Monaten Hinweis an alle aktiven Admins;
hat der Akteur wieder einen Strom, werden offene Hinweise erledigt. Gelöscht
wird nur von Hand. Job-Probe: alt → Hinweis, jung → nichts, zweiter Lauf →
nichts, Strom → erledigt.

**akteure.** Liste mit dem Filtermodell (E32, Ansicht `akteure`: „Sitz in
Region" (ST_Contains auf `sitz_geom`, dieselbe Ableitung wie beim Strom),
Hierarchie Sektor/Akteur, Facette Zustand); benannte Zustände abgeleitet
(E23/E24): `unvollstaendig` (keine Adresse), `ohne_beleg` (Ströme, aber
keiner mit Beleg), `verwaist`. Detail mit Stammdaten (AdresseBlock),
Belegen/Strömen und Karte; Reiter Kontaktpersonen folgt mit PR b.

**Bestand 117 → 110:** Die Bestandsaufnahme zählte 117 `Seed:`-Akteure, der
Generator (seed-daten.ts) erzeugt 110. Die sieben übrigen stammten aus einer
älteren Seed-Fassung; ihre Marker-Ströme werden beim Neuaufbau nicht mehr
erzeugt, danach waren sie ohne Strom und der Strom-Seed entfernt verwaiste
Seed-Akteure. Kein Datenverlust an Fachdaten.

**Preview-Testdaten** (`scripts/seed-akteure.ts`, Workflow Seed Preview,
zweiter Schritt): Sitz des Bestands aus dem Standort des ältesten Stroms
(bei mehreren Orten wird die Wahl ausgegeben), 40+ Akteure `Seed-A25:` über
alle Sektoren und Orte mit Belegen aller sieben Typen, Dubletten stark/
schwach, Verwaiste (teils älter als 6 Monate), Unvollständige, ohne Sektor,
ohne Beleg. Idempotent, markiert, nur gegen die Preview (Schutz einmal rot:
Production-Host und fehlende Variable).
**Prüf-Ereignisse (Eric 04.10.2026):** Der erste Job-Lauf stellte auf der
Preview 254 Hinweise „Prüfdatum unbekannt" zu, weil kein geprüfter
Seed-Strom ein Prüf-Ereignis hatte. Der Seed schreibt deshalb für die
geprüften Ströme beider Seeds Ereignisse `geprueft` mit Streuung
(deterministisch aus der Strom-ID: gültig, läuft in 5 Tagen ab, abgelaufen,
ein Zehntel bewusst ohne Prüfdatum als Altfall) und entfernt die alten
Job-Hinweise der Seed-Ströme; der nächste Lauf stellt sie zustandsbasiert
neu zu. Die bestehenden Hinweise erledigen sich **nicht** selbst: der Job
erledigt nur Vorab-Hinweise, die ein Ablauf-Hinweis ersetzt, und
Verwaist-Hinweise; „Prüfdatum unbekannt" räumt nur ein Ereignis über
`protokolliere()` ab, und der Seed schreibt bewusst roh. „Prüfdatum
unbekannt" bleibt eine Aufgabe, nicht abräumbar. Platzhalter für unbekannte
Inbox-Typen (aus #153) loggt serverseitig `console.error` mit Typ und
Eintrags-ID.

**a2 (Contract, eigener PR):** NOT NULL auf `akteur.sektor`, `sitz_plz`,
`sitz_ort` — nach dem Seed auf der Preview und der Messung auf Production
(Akteure ohne Sitz → stopp und melden). Umgesetzt als Migration 0039,
Abschnitt 36. **PR b** löst rollen, kontakt_email,
kontakt_telefon, ansprechperson und `strom.kontaktperson` durch die Tabelle
kontaktperson ab (Contract nach Messung, dass alle Spalten auf Production
leer sind; die fünf Preview-Texte sind Testdaten und werden verworfen).

## 34. AP2.5 PR b: Kontaktpersonen und DSGVO (E66/E57/E47), 01.10.2026

**Tabelle `kontaktperson`** (Migration 0036): akteur_id NOT NULL — jede Person
gehört zu genau einem Akteur, **kein Umhängen** (Server setzt akteur_id nie,
Trigger `kontaktperson_kein_umhaengen` weist jedes UPDATE ab; wechselt jemand
den Arbeitgeber, wird eine neue Person angelegt); name NOT NULL; Längengrenzen
per CHECK (Name 1–200, Funktion 120, Mail 200, Telefon 60, Notiz 1000); am
Notizfeld „Keine privaten oder sensiblen Angaben". Die alten Felder am Akteur
(rollen, kontakt_email, kontakt_telefon, ansprechperson) und `strom.kontakt-
person` werden abgelöst; der **Contract folgt als eigener PR** nach der Messung,
dass die Spalten auf Production leer sind (Freitext-Namen am Strom würden das
echte Löschen aushebeln). Umgesetzt als Migration 0040, Abschnitt 37.

**Rechte (E66, Matrix):** lesen alle mit Zugang (auch Betrachter);
`kontaktperson.anlegen`/`.bearbeiten` ab bearbeiter; `.loeschen` Prüfer und
Admin; `.auskunft` (Art. 15) nur Admin. Rot gezeigt: Betrachter schreibt eine
Kontaktperson (Matrix testweise offen → Test rot).

**Echtes Löschen inklusive Kopien (E57):** Protokoll und Inbox speichern nur
IDs — Ereignisse `kontaktperson_angelegt/_geaendert/_geloescht` tragen im
Freitext nur Akteur-ID und Feldnamen; der Loeschpruefungs-Hinweis trägt nur
`kontaktperson_id`. `protokoll-check` (c) meldet jede Interpolation im Freitext
eines Kontaktperson-Ereignisses, die keine ID und keine Feldliste ist (rot
gezeigt mit `${alt.name}`); `inbox-check` meldet einen Loeschpruefungs-INSERT
mit notiz/aufgabe. `kontaktperson-check` (DB, CI) legt eine Person mit
Sentinel-Namen an, schreibt Ereignis und Hinweis, löscht sie und sucht den
Namen in allen Text-/JSON-Spalten: null Treffer, Hinweis per CASCADE weg.
Exporte werden nicht gespeichert; Backups halten gelöschte Daten 30 Tage
(docs/betrieb.md).

**Externer Export (E36/E47):** neue Einstufung `intern` — die Spalte
„Kontaktpersonen" existiert nur im internen Modus, extern fehlt sie ganz (kein
Kopf, keine Zelle); der Export-Wächter prüft die Einstufung und die externe
Datei (rot gezeigt: Spalte ohne `intern` → Name in der externen Datei).

**Auskunft (Art. 15):** Aktion **„Auskunft erstellen"**
(`kontaktperson.auskunft`, nur Admin über darf()) schreibt das Ereignis
`auskunft_erstellt` (nur IDs) über protokolliere() und öffnet danach die
Druckansicht `/akteure/<id>/kontaktpersonen/<pid>/auskunft?ereignis=<id>`;
die Seite prüft das Ereignis (zu dieser Person, von dieser Person, jünger
als eine Stunde) und ist ohne die Aktion nicht erreichbar (404). Inhalt: alle
gespeicherten Felder und alle Protokollereignisse zur Person; gedruckt wird
aus dem Browser (F6). Migration 0037 ergänzt den Enum-Wert (Rename-Verbot).

**Löschprüfung (E57, Job):** Parameter `kontaktperson.loeschpruefung_monate` =
24 (seit Einführung). Aktivität = jüngste Änderung an der Person
(Zeitstempel oder Protokoll) oder an einem Beleg (Strom-Eintrag, E48) ihres
Akteurs. Nach M Monaten Inbox-Typ `kontaktperson_loeschpruefung` an alle
aktiven Admins, Bezugsdatum = letzte Aktivität, idempotent (Index NULLS NOT
DISTINCT); neue Aktivität erledigt offene Hinweise. Gelöscht wird nur von
Hand. Job-Probe: alt → Hinweis, zweiter Lauf → nichts, Beleg-Aktivität →
erledigt, jung → nichts.

**Seed:** 14 Kontaktpersonen `Seed-A25 …` an Regel- und Dubletten-Akteuren,
zwei Löschprüfungs-Fälle (25/30 Monate ohne Aktivität an verwaisten
Akteuren), eine junge Person.

## 35. AP2.5 PR c: Dubletten und Zusammenführen (E66), 01.10.2026

**Normalisierung** (Migration 0038): `akteur_name_norm(text)` in SQL und
dasselbe Spiegelbild in `apps/web/lib/akteur-norm.ts` — Kleinschreibung,
Umlaute (ae/oe/ue/ss), e.K./e.V. als Wörter, alles Nicht-Alphanumerische zu
Leerzeichen, Abkürzung **„SW" → „stadtwerke"** (eigenes Wort; „Gem." wird
bewusst nicht aufgelöst, weil „gem. GmbH" gemeinnützig heißt und „Gem. X" ↔
„Gemeinde X" am selben Ort ohnehin stark gefunden wird), Rechtsform-Wörter
entfernt (gmbh, mbh, gbr, kg, kgaa, ag, ohg, ug, se, eg, ek, ev, co,
haftungsbeschraenkt, ltd, inc), Leerraum zusammengezogen. **Eine
Fixture-Liste** (`packages/db/src/dubletten-fixtures.ts`) für beide Seiten:
Namen, Ähnlichkeits-Referenzen und die **Kalibrier-Paare** (echte Varianten:
Tippfehler, Abkürzungen, Wortreihenfolge, Zusatzwörter; kommunale falsche
Treffer derselben Stadt; Seed-Kandidaten) mit nachgerechneter Ähnlichkeit und
Ergebnis — `akteur-norm.test.ts` und `dubletten-kalibrierung.test.ts` prüfen
TypeScript, `dubletten-check` (CI, Preview) prüft SQL und `similarity()`
dagegen. Die Ähnlichkeit kommt aus **pg_trgm** (Extension per
Migration). Ein GIN-Index war vorgesehen und ist mit der Zusatzregel
Wort-Teilmenge (9d77451) entfallen: die Abfrage „Ähnlichkeit ODER Teilmenge
mit Ortsbezug" nutzt ihn nicht, die Mengen sind klein. **Ab etwa 10.000
Akteuren** wird die Laufzeit des Dubletten-Vorschlags gemessen und ein Index
erneut erwogen (Eric, 05.10.2026). Die Combobox zeigt
höchstens drei Vorschläge, „neu anlegen" bleibt sticky am unteren Rand des
Menüs (Eric 05.10.2026, PR a2).

**Schwellen** (Konstanten, Kalibrierung in `docs/ap25-dubletten-kalibrierung.md`):
`DUBLETTE_STARK = 0,60` mit **Ortsbezug = gleiche PLZ oder Sitz-Abstand ≤
`DUBLETTE_ORT_METER = 2 km`** (ST_DWithin über `sitz_geom` als geography;
Entscheidung Eric 01.10.2026 — der gleiche Kreis allein reicht nicht, sonst
erschienen kommunale Akteure desselben Kreises massenhaft als stark; 2 km
decken dieselbe Stadt bei verschiedenen PLZ und lassen Nachbargemeinden
draußen), `DUBLETTE_SCHWACH = 0,75` ohne Ortsbezug. **Zusatzregel „Wort-Teilmenge"**
(Entscheidung Eric 01.10.2026, durch Messung entschieden): hat der kürzere
normalisierte Name mindestens zwei Wörter, sind alle im längeren enthalten
und besteht Ortsbezug, ist das Paar stark, unabhängig von der Ähnlichkeit —
gleiche Form in SQL (`akteur_name_wortteilmenge`) und App (`wortTeilmenge`).
Messung: ein Treffer mehr („AVR Abfallverwertung Rhein-Neckar" ↔ „AVR
Rhein-Neckar" 0,515), kein neuer Fehlalarm, kein Seed-Paar neu stark.
Ergebnis bei diesen Schwellen: alle Seed-Kandidaten gefunden; 15 von 18
echten Varianten gefunden (nicht gefunden: drei ohne Ortsbezug knapp unter
0,75); 3 von 11 kommunalen Paaren derselben Stadt als Fehlalarm stark (Stadt
· Stadtwerke, Gemeinde · Gemeindewerke), keines schwach. Die Abfragen
materialisieren die normalisierten Namen einmal und vergleichen paarweise
(Ähnlichkeit ODER Teilmenge) — kein Trigramm-Index, weil das ODER keinen
Index nutzen könnte und die Mengen klein sind. Begründung: Die Seed-Kandidaten liegen nach der Normalisierung alle bei
1,000 (sie unterscheiden sich nur in Rechtsform/Umlaut), die Schwelle wird
von den falschen Freunden bestimmt — am selben Ort bis 0,70 („Stadt X" ·
„Stadtwerke X"), an verschiedenen Orten bis 0,69 (gleiche Betriebsart);
echte Varianten (Tippfehler, Zusatzwort) liegen bei 0,65–0,83. Mit Ortsbezug
zählt die Trefferquote, ohne die Genauigkeit. `dubletten-kalibrierung.test.ts`
hält die Trennung gegen den Seed fest.

**„Meinten Sie …?"** beim Anlegen im Beleg (`/api/akteure/aehnlich`, Lesen
reicht): starke und schwache Treffer zum eingegebenen Namen, Ortsbezug über
die PLZ oder den Abstand des Sitz-Pins (≤ 2 km); Anlegen bleibt möglich.

**Liste `akteure./dubletten`:** Paare ab der Schwelle, stark vor schwach,
ohne die als **„keine Dublette"** markierten (Tabelle `akteur_keine_dublette`,
akteur_a < akteur_b, UNIQUE, zwei FKs ON DELETE CASCADE). Markieren
(`akteur.keine_dublette`) und **Aufheben** (`akteur.keine_dublette_aufheben`,
Abschnitt „als keine Dublette markiert" unter der Liste) nur Prüfer und Admin
über darf() (Entscheidung Eric 01.10.2026); Ereignisse
`keine_dublette_markiert` / `keine_dublette_aufgehoben` an beiden Akteuren,
Text nur IDs. Rot gezeigt: Bearbeiter markiert → abgewiesen.

**Zusammenführen** (`akteur.zusammenfuehren`, nur Prüfer und Admin,
endgültig): Ziel wählen (voreingestellt der Akteur mit mehr Strömen),
Feldkonflikte Name/Sektor/Sitz entscheidet der Nutzer, voreingestellt gewinnt
das Ziel (der Sitz als Ganzes, weil der Pin den Kreis bestimmt). In **einer
Transaktion**: beide Akteure gesperrt (FOR UPDATE), **Leitplanke Belege**
— jeder Strom der Quelle wird mit der Objektregel von `strom.bearbeiten`
(E44) geprüft; ist einer für den Handelnden gesperrt, Abweisung mit Meldung
„Zusammenführen abgewiesen: Strom „…" ist von … gesperrt." (Admins dürfen
laut E44 über fremde Sperren — dieselbe Regel wie beim Bearbeiten, keine
zweite). Dann Ereignis `akteur_zusammengefuehrt` an der Quelle („Quelle <id>
→ Ziel <id>; n Ströme; Felder aus Quelle: …") **zuerst**, `akteur_geaendert`
am Ziel, Ströme umgehängt mit `geaendert` je Strom (→ die übliche gebündelte
Änderungs-Mitteilung an die Beteiligten **einschließlich des Sperrinhabers**:
das Ereignis trägt ihn als `betrifftId`, die Zustellung von `aenderung_eintrag`
nimmt die benannte betroffene Person zu den Beteiligten dazu — Test in
`zustellung.test.ts`), Kontaktpersonen umgehängt mit
`kontaktperson_geaendert` (nur IDs), Interessen umgezogen (Duplikate
derselben Region zusammengelegt), Quelle gelöscht (keine-Dublette-Paare und
Verwaist-Hinweise per CASCADE). **Trigger-Ausnahme:** `kontaktperson_kein_
umhaengen` lässt das Umhängen nur zu, wenn das Ereignis
`akteur_zusammengefuehrt` der Quelle mit „Ziel <id>" in **derselben
Transaktion** steht (`zeitpunkt = now()`); sonst bleibt jedes UPDATE von
akteur_id abgewiesen. **Alte Links** `/akteure/<quelle>` leiten über dieses
Ereignis aufs Ziel (Kette bis 10 Stufen).

**Rot gezeigt:** Zusammenführen als bearbeiter (Matrix testweise offen →
matrix.test und dubletten-actions.test rot); über eine fremde Sperre
(Sperrprüfung testweise entfernt → Test rot); `dubletten-check` (CI) weist
nach: Löschen eines Akteurs mit Strom scheitert am Fremdschlüssel,
Umhängen ohne Ereignis am Trigger, Paar ungeordnet/doppelt an CHECK/UNIQUE.

## Noch offen – nicht raten

Qualitäts-Ableitungsmatrix A–D und Gültigkeitsdauern je Beleg-Typ sind seit
31.08.2026 verbindlich (siehe Abschnitt 3). Weiterhin offen: Teilscore-Mapping der
Bereitschaftsstufen – Geschäftsentscheidung, wird von Eric entschieden, nicht im
Code festgelegt.

## 36. AP2.5 PR a2: Pflichtfelder am Akteur (E66, Contract), 05.10.2026

**Migration 0039:** `akteur.sektor`, `akteur.sitz_plz` und `akteur.sitz_ort`
werden NOT NULL. Fachlich gilt das seit a1 (0035): NULL im Sektor wurde dort
zur Systemzeile `ohne_sektor`, PLZ und Ort verlangt die Anlage seit a1 —
hier zieht das Schema nach (Contract nach E21). Die Migration erfindet
nichts: Vor dem ALTER zählt sie die Zeilen mit NULL je Spalte und bricht mit
der Zählung ab, wenn eine Zeile betroffen ist (nachtragen in der Anwendung,
nie in der Migration). Zählbeweis im selben Lauf: drei NOT-NULL-Spalten,
Zeilenzahl.

**Messung vor dem Lauf:** Production 0 Akteure (Leseweg 05.10.2026, Lauf
37276168234); Preview mit Seed-A25 (42 Akteure, PLZ und Ort immer gesetzt,
„unvollständig" heißt dort: Straße oder Pin fehlt, nie PLZ/Ort).

**Schreibpfade (E21):** `api/akteure` setzt Sektor, PLZ und Ort seit a1;
`scripts/seed-akteure.ts` ebenso; `scripts/seed-preview.ts` setzt den Sitz
des Bestands jetzt beim Einfügen (erster Strom mit Ort, PLZ aus der
Ortsliste), statt ihn wie bisher nachträglich per UPDATE zu setzen — eine
Stelle statt zwei; die Probe-Inserts in `job-probe.ts` und
`sektor-check.ts` tragen jetzt PLZ/Ort. `sektor-check` (Deploy-CI) prüft die
drei NOT-NULL-Spalten und weist die Anlage mit NULL in Sektor, PLZ oder Ort
nach (je ein abgewiesener INSERT in zurückgerollter Transaktion); die
Systemzeile `ohne_sektor` bleibt anlegbar.

## 37. AP2.5 Contract: alte Kontaktfelder entfallen (E66/E57), 05.10.2026

**Migration 0040:** `akteur.rollen`, `akteur.kontakt_email`,
`akteur.kontakt_telefon`, `akteur.ansprechperson` sowie
`biomassestrom.kontaktperson` und `output_bedarf.kontaktperson` (Freitext)
werden gelöscht. Seit PR b (0036) lebt der Kontakt in der Tabelle
`kontaktperson`; Freitext-Namen am Strom würden das echte Löschen (E57)
aushebeln.

**Messung und Wächter (E21):** Production vor dem Lauf: 0 Akteure, kein Strom
mit Kontaktperson-Text (Leseweg 05.10.2026, Lauf 37276168234). Der
Vor-DROP-Wächter `pre-drop-check` (migrate-production.yml) zählt alle sechs
Spalten unmittelbar vor der Migration und bricht bei einem Wert > 0 ohne DROP
ab. Auf der Preview stehen Testtexte (Entscheidung 01.10.2026: Testdaten,
werden verworfen); die Migration protokolliert die Zählung dort
(`PR_CONTRACT verworfen …`) und bricht nicht ab. Zählbeweis danach: keine
Altspalte mehr, Tabelle kontaktperson vorhanden.

**Anwendung:** Das Feld „Kontaktperson" verschwindet aus dem Strom-Formular,
der Detailansicht und dem Erfassungsgrad (`vollstaendigkeit`: ein
Prüfpunkt weniger, der Grad bestehender Ströme kann sich dadurch ändern —
Ableitung, kein gespeicherter Wert). `feldeinstufung` führt die Spalte
nicht mehr (der Feld-Wächter vergleicht gegen das Schema). Die
Leseweg-Messung AKTEUR zählt statt der alten Felder die Kontaktpersonen und
die Systemzeile `ohne_sektor`.

## 38. AP2.7 Excel-Import: Datenmodell und Schreibweg (E67), 06.10.2026

**E67 (Eric, Auftrag 05./06.10.2026, Nachtbericht abgenommen 06.10.2026).**
Importiert werden Ströme (Feedstock oder Bedarf, die Art wird je Lauf
gewählt) samt Akteur — keine Akteure allein, keine Kontaktpersonen.
Importierte Ströme sind `entwurf`, Verifikationszustand „ungeprüft"; kein
neuer Status-Enum-Wert, kein Prüfauftrag je Zeile. Ein gebündelter
Inbox-Eintrag je Lauf (`import_abgeschlossen`, mit Zählern) an alle aktiven
Prüfer und Admins. Import nur Prüfer und Admin (`import.ausfuehren`),
Zurücknehmen nur Admin (`import.zuruecknehmen`, kommt mit seinem
Schreibpfad in PR d).

**Personen-Spalten (DSGVO):** Spalten wie Ansprechpartner, Kontakt, E-Mail,
Telefon, Mobil, Personenname werden erkannt oder in der Zuordnung als
„Person – wird nicht übernommen" markiert; ihre Inhalte werden nie
gespeichert, auch nicht in Zwischenständen oder Logs. Der Akteur bekommt ein
Ereignis `kontaktdaten_uebersprungen` ohne Namen, mit Lauf-ID; sichtbar im
neuen Abschnitt „Verlauf" der Akteur-Seite (PR c). Die Originaldatei kann
Personen-Spalten enthalten: am Beleg hängt eine serverseitig bereinigte
Kopie ohne Personen- und ignorierte Spalten; der Roh-Upload in R2 wird nach
der Zuordnung gelöscht, spätestens nach 24 h durch den täglichen Job (PR b).
Zusicherung der Datenbank: `import_zeile.felder` trägt nur zugeordnete
Zielfelder, der CHECK `import_zeile_felder_check` weist Personen-Schlüssel
ab (Liste `IMPORT_PERSONEN_SCHLUESSEL` im Schema, dieselbe im Mapper).

**Beleg, Quelle, Hash:** Belegtyp je Lauf Pflicht, eine Spalte überschreibt
ihn je Zeile. Ein geteilter Beleg je (Lauf, Belegtyp) (E48). Quelle =
Dateiname + Lauf-ID (Quellen-CHECK E34). `extern_nachvollziehbar = nein`.
Gleicher Datei-Hash (SHA-256) wie ein früherer Lauf: Warnung vor dem Start.

**Akteure:** Auflösung je eindeutigem Akteur (Normname + PLZ), nicht je
Zeile, auch innerhalb des Laufs. Neue Klasse „identisch" (Normname + PLZ
gleich) im Matcher-Modul aus AP2.5c, eine Funktion für Import (automatisch)
und Formular (oberster Vorschlag); stark → Vorschlag, den der Nutzer
bestätigt (auch gesammelt); schwach oder kein Treffer → neuer Akteur.
Sektor neuer Akteure aus einer Spalte (Werte-Zuordnung), sonst Standard je
Lauf (Pflichtauswahl, `ohne_sektor` erlaubt). Sitz per Adresssuche; ohne
Treffer Nacharbeit. Strom-Standort nur aus Spalten, kein Erben vom Sitz
(F0a/E66).

**Mengen und Spannen:** nur t FM/a; eine Einheitenspalte darf t oder kg und
pro Jahr oder pro Monat enthalten (ohne Annahme umrechenbar); alles andere,
insbesondere TM/atro, ist ein Zeilenfehler. Spannen nur zeitraum_von/bis.
v1 legt nur neu an; „möglicherweise vorhanden" (gleicher Akteur + Materialart
+ Art) je Zeile entscheiden, Vorgabe „überspringen". Teilimport: fehlerfreie
Zeilen werden importiert, der Rest landet in der Nacharbeit.

**Ablauf (nach Nachtbericht):** Upload und Parsen → Spalten- und
Werte-Zuordnung → Zeilen speichern (nur zugeordnete Felder) → Akteure
auflösen (je Akteur) → Adressen auflösen (je Adresse, Photon gedrosselt,
Zwischenspeicher, fortsetzbar) → Probelauf → Ausführen → Nacharbeit.
Probelauf und Ausführen browser-gesteuert in Stapeln von ~100 Zeilen je
Request, fortsetzbar über `import_zeile.status`; Probelauf mit Rollback je
Stapel, Ausführen mit Savepoint je Zeile. Grenze 5.000 Zeilen / 5 MB
(Konstante mit Begründung). Keine Queue, kein Workflow in v1. Messung
06.10.2026: SheetJS in workerd 5.000 Zeilen ≈ 0,7 s; Insert + Protokoll +
Savepoint 33 ms je Zeile; Photon 0,5 bis 1,3 s je Anfrage.

**Rücknahme:** ganzer Lauf durch einen Admin, solange kein Strom des Laufs
danach geändert, geprüft oder weitergegeben wurde; entfernt Ströme,
Lauf-Belege und die vom Lauf neu angelegten, dadurch verwaisten Akteure,
alles protokolliert (PR d).

**Migration 0043 (PR a, additiv mit Verbraucher, E21; 0042 ist die Job-Laufzeitmessung):** `import_vorlage`,
`import_lauf`, `import_zeile`; `aenderung.import_lauf_id` und
`inbox_eintrag.import_lauf_id` (FK); partieller Unique-Index
`inbox_eintrag_import_uidx` (Empfänger, Typ, Lauf, Prädikat über
`inbox_typ_text`); Enum-Werte `kontaktdaten_uebersprungen` (ereignis_art)
und `import_abgeschlossen` (inbox_typ) unter Rename-Verbot (E53).
Schreibweg: PR a0 hat „Strom anlegen" zu einem Baustein mit reinen
Eingabe-Objekten gemacht (`lib/strom-schreibweg.ts`), den Formular und
Import teilen. Erster Import-Schreibpfad: `importLaufAnlegen`
(`lib/import-actions.ts`, Aktion `import.ausfuehren`, Ereignis `angelegt` an
`import_lauf` mit Lauf-ID). Aufbewahrung: `import_zeile` wird 30 Tage nach
Abschluss des Laufs gelöscht (Parameter per Migration mit Verbraucher, PR c).

**Rot gezeigt (PR a):** Bearbeiter startet einen Import → abgewiesen, kein
Schreibversuch (`lib/import-actions.test.ts`); Schema-Probe: keine Spalte mit
Personen-Bezug in den Import-Tabellen (`packages/db/src/import-schema.test.ts`);
`import-check` gegen die Preview: CHECK weist `felder` mit Schlüssel `email`
ab.

**PR b (06.10.2026): Bausteine, Upload, Zuordnung, Vorlagen, Akteure,
Adressen, Probelauf.** Vorab (Testlücken aus #180): die Akteur-Anlage ist ein
Baustein (`lib/akteur-schreibweg.ts`, `akteurAnlegenInTx`), den
`POST /api/akteure` und der Import teilen; die Beleg-Regeln sind am
Schreibpfad getestet (`beleg-server.test.ts`, Belegtyp → Stufe über alle
Ankerfälle). Import: Datei lesen mit SheetJS (`lib/import-datei.ts`, Grenze
5.000 Zeilen / 5 MB, Zahlen als Text mit Komma — E31 gilt wie im Formular,
CSV UTF-8/BOM/Windows-1252), Roh-Upload in R2 unter `import/<env>/<lauf>/`,
nach der Zuordnung gelöscht, Rest durch den Job nach 24 h
(`lib/jobs/import-aufraeumen.ts`). **Zuordnung:** Zielfelder sind die
FormData-Schlüssel des Formulars (`akteur_*` für den Akteur-Baustein); der
Probelauf schickt jede Zeile durch dieselben Bausteine. Personen-Spalten
werden erkannt oder markiert und liefern dem Browser keinen Wert;
Pflichtfelder ohne Spalte weisen die Zuordnung ab (sonst scheitert jede
Zeile — Frage an Eric: blockieren oder warnen). Einheiten nur t/kg je
Jahr/Monat, TM/atro Zeilenfehler; Werte → Codes, nicht zugeordneter Wert
ist Zeilenfehler. Die bereinigte Kopie (nur Spalten mit Zielfeld) liegt
unter `belege/<env>/import/<lauf>/bereinigt.csv` und ist die Datei des
Lauf-Belegs. **Vorlagen** (`import_vorlage`, Upsert nach Name, Ereignis an
der neuen Protokoll-Entität `import_vorlage`, `entitaet_typ` ist Text).
**Akteure:** Klasse „identisch" (Normname + PLZ) im Matcher, eine Funktion
für Import und Formular-Vorschlag; Auflösung je Gruppe (ein Matcher-Aufruf
je eindeutigem Akteur), identisch → übernommen, stark → Vorschlag mit
Bestätigung (einzeln oder gesammelt), sonst neu; Stand in
`import_zeile.felder` (`akteur_id`, `akteur_vorschlag_*`, `akteur_neu`,
`akteur_gruppe`). **Adressen:** Sitz neuer Akteure per Photon
(`lib/photon-server.ts`, auch der Proxy nutzt ihn), je Adresse einmal, acht
je Request, Treffer ohne Raten (PLZ muss stimmen; mit Straße nur
Adress-Treffer); offen mit Grund → Nacharbeit. **Probelauf:** Migration 0044
(`import_lauf.beleg_erhebungsdatum`, `beleg_gueltig_bis`) — E67 legt
Erhebungsdatum und Gültig-bis (E33) des Lauf-Belegs nicht fest, der
Probelauf fragt sie ab (Frage an Eric: Pflichtfeld am Lauf, kein Standard).
Je Request ≤ 100 Zeilen in einer Transaktion mit Savepoint je Beleg (einer
je Belegtyp, Quelle = Dateiname · Lauf-ID), je neuem Akteur (einmal je
Gruppe) und je Zeile; am Ende absichtlicher Rollback — angelegt wird nichts;
Ergebnisse je Zeile (ok | fehler mit Grund) in einer zweiten Transaktion.
`StromEingabe.belegId` (geteilter Beleg) und `BelegEingabe.dateiKey`
(vorhandene Datei) sind die beiden Erweiterungen der Bausteine.

**Entscheidungen Eric (06.10.2026, PR b):** (1) Ein Pflichtfeld, das weder
einer Spalte zugeordnet noch per Lauf-Standard belegt ist, blockiert die
Zuordnung — „Weiter" ist gesperrt, die fehlenden Felder werden genannt, kein
bloßes Warnen. (2) Erhebungsdatum und Gültig-bis des Lauf-Belegs sind
ausdrücklich einzugeben, kein Standardwert (kein „heute"); Gültig-bis nur
Pflicht für die Belegtypen nach E33; eine zugeordnete Spalte
(`beleg_erhebungsdatum`, `beleg_gueltig_bis`, auch `beleg_typ`) geht dem
Lauf-Wert je Zeile vor — der geteilte Beleg gilt damit je (Lauf, Belegtyp,
Erhebungsdatum, Gültig-bis). (3) Akteure auflösen läuft browser-gesteuert in
Stapeln von 200 eindeutigen Akteuren je Request, fortsetzbar wie Adressen und
Probelauf; der Matcher läuft je Stapel mengenbasiert
(`sucheAehnlicheMenge`: eine Abfrage für alle Kandidaten des Stapels), nicht
als Schleife mit einer Abfrage je Akteur. Messung je Stapel mit dem
Preview-Seed im PR.

**PR c (06.10.2026): Ausführen, Nacharbeit, Verlauf, Aufbewahrung.**
`importAusfuehren` nur nach durchgelaufenem Probelauf: höchstens 100 offene
Zeilen je Request, Savepoint je Zeile, COMMIT je Stapel; Akteure je Gruppe
einmal (akteur_id in alle Zeilen der Gruppe zurückgeschrieben, Folge-Stapel
kennen ihn), Belege je (Typ, Erhebungsdatum, Gültig-bis) einmal je Lauf
(Wiederverwendung über die Quellenangabe, E48); das Ereignis „angelegt" des
Stroms trägt die Lauf-ID. Importierte Zeilen verweisen auf den Strom,
gescheiterte bleiben mit Grund in der Nacharbeit. Nach dem letzten Stapel:
Lauf `ausgefuehrt` mit `abgeschlossen_am`, Ereignis `kontaktdaten_uebersprungen`
je Akteur einmal je Lauf (nur wenn die Datei Personen-Spalten hatte),
Inbox `import_abgeschlossen` gebündelt an alle aktiven Prüfer und Admins
(`lib/inbox/zustellung.ts` `stelleImportAbschlussZu`, Index
`inbox_eintrag_import_uidx`). **Nacharbeit:** `importZeileBearbeiten` (nur
Zielfelder der Art, nie Personen-Schlüssel; Akteur-Änderung löst die
Auflösung auf, Zeile wird „offen" und geht erneut durch Probelauf und
Ausführen — beides auch aus `ausgefuehrt` heraus) und
`importZeileUeberspringen` (`uebersprungen`, nichts wird gelöscht).
**Verlauf am Akteur:** Abschnitt „verlauf." aus dem Protokoll, Einträge mit
Lauf-ID verlinken den Lauf. **Aufbewahrung:** Migration 0045, Parameter
`import.zeilen_aufbewahrung_tage` = 30 (1–365); der 05:00-Job löscht die
Zeilen abgeschlossener Läufe (`ausgefuehrt`/`zurueckgenommen`) ab
`abgeschlossen_am` + Frist, Zähler und Protokoll bleiben am Lauf. Rücknahme
folgt in PR d.

**PR d (07.10.2026): Rücknahme.** Aktion `import.zuruecknehmen` (nur
`admin`, Matrix und Matrix-Test), Server-Action `importZuruecknehmen(laufId)`
in einer Transaktion: nur aus `ausgefuehrt`; Ströme des Laufs = Zeilen mit
Strom-Bezug ∪ Protokoll „angelegt" mit `import_lauf_id`; **Vorbedingung**
kein Ereignis an diesen Strömen mit anderer oder ohne Lauf-ID (bearbeitet,
geprüft, gesperrt, zugewiesen, kommentiert …) — sonst Abweisung mit Art und
Zeilennummern, nichts geschrieben. Reihenfolge: Zuweisungen, Vergabezeiträume
und Inbox-Einträge der Ströme → Zeilen verlieren den Strom-Bezug und werden
„offen" (Probelauf-Felder entfernt, Fehlerzeilen bleiben Fehler) → je Strom
Protokoll `verworfen` mit Lauf-ID → Ströme gelöscht → Lauf-Belege
(Quellenangabe des Laufs) nur, wenn kein anderer Strom sie nutzt → vom Lauf
angelegte Akteure (Protokoll `akteur_angelegt` mit Lauf-ID) nur, wenn jetzt
verwaist, samt Interessen und Kontaktpersonen, Protokoll `akteur_geloescht`
→ Lauf `zurueckgenommen`, `zurueckgenommen_am`, Zähler
`zurueckgenommen_stroeme/_belege/_akteure`, Protokoll `status_gesetzt`. Die
Rücknahme ist die einzige echte Löschung im Import; sie gilt, weil der Lauf
Entwürfe erzeugt, die noch niemand angefasst hat — die Protokolleinträge
überdauern die Objekte. Nach der Rücknahme gibt es keine Nacharbeit mehr
(Server weist ab, Oberfläche blendet aus).

**Rot gezeigt (PR d):** Prüfer und Bearbeiter abgewiesen ohne Schreibversuch;
Lauf im Probelauf nicht rücknehmbar; **Strom nach dem Import geprüft →
„Rücknahme abgewiesen … Zeilen: 3", keine Löschung, kein Update, kein
Ereignis**; Erfolgsfall löscht in der genannten Reihenfolge und schreibt
vier Protokolleinträge mit Lauf-ID.

**Rot gezeigt (PR b):** Akteur-Baustein fehlte (Modul); Quellenangabe-Pflicht
entfernt → 7 von 43 Beleg-Tests rot; CSV ohne Dekodierung → „Straße" als
Fremdzeichen; Personen-Ziel vor „unbekannt"; Bearbeiter an jeder
Import-Action abgewiesen ohne Schreibversuch; Matcher je Gruppe (zwei
Aufrufe für drei Zeilen); Photon nicht erreichbar → nichts geschrieben;
Probelauf ohne Belegdaten oder mit offenen Vorschlägen startet nicht.


## 39. AP2.7 PR e: Import — Blattwahl, Kopfzeile, fehlende Pflichtwerte (E67), 07.10.2026

**Anlass:** Durchlauf mit der Testdatei `docs/beispiele/import-testdatei-ap27.xlsx`
(Eric, fiktiv): Kopfzeile in Zeile 4 wurde nicht erkannt, kein Blatt wählbar,
Zuordnung gesperrt, weil TS-Anteil und Aschegehalt in der Datei fehlen.
Entscheidungen Eric (07.10.2026), hier umgesetzt:

**Blattwahl (B2):** Nach dem Upload zeigt die Zuordnung alle Blätter mit
Zeilenzahl; Blätter ohne erkennbare Tabelle sind markiert („keine Tabelle
erkannt"), nicht verboten — wer sie wählt, bekommt die Meldung „keine
Kopfzeile erkennbar — Kopfzeile von Hand wählen". Ohne Wahl nimmt der Parser
das erste Blatt mit Tabelle. Die Wahl reist als `?blatt=&kopf=`, wird mit der
Zuordnung gespeichert (`import_lauf.blatt`, `import_lauf.kopfzeile`,
Migration 0047) und steht im Protokolltext.

**Kopfzeile (B1):** `erkenneKopfzeile`: die erste Zeile mit mindestens zwei
nicht-leeren Zellen, davon überwiegend Text, auf die innerhalb von drei
Zeilen ein Datenblock (eine Zeile mit mindestens zwei Zellen) folgt; sonst
der erste Kandidat ohne Datenblock (dann „keine Datenzeile"). Feld
„Kopfzeile ist Zeile n" mit Vorschau (bis vier Rohzeilen ab der Kopfzeile).
Zeilen darüber werden ignoriert; darunter werden Leerzeilen, eine
Summenzeile (Formel in der Zeile oder erste Textzelle „Summe"/„Gesamt"/
„Total") und Fußzeilen (höchstens eine Zelle bei mindestens drei Spalten)
übersprungen und gezählt (`zaehler.uebersprungen_oben/_leer/_summe/_fuss`,
Oberfläche, Protokoll). Zeilennummern sind die echten Excel-Zeilen, damit
Nacharbeit und Datei zusammenpassen. Die Personen-Erkennung greift danach
über die echten Spaltennamen.

**Fehlende Pflichtwerte (W1):** Die Materialart-Referenz trägt **keine**
TS- und Aschewerte (nur Code, Label, Cluster) — es gibt keinen Typwert.
Also gilt: TS-Anteil und Aschegehalt dürfen fehlen (Spalte oder Zelle);
`biomassestrom.ts_anteil_pct` und `aschegehalt_pct` sind nullable
(Migration 0047), NULL heißt „unbekannt", nie ein erfundener Wert. Der
Strom ist dann unvollständig (Vollständigkeit zählt beide Felder) und kann
nicht „geprüft" werden: `stromPruefen` weist ab („TS-Anteil und Aschegehalt
fehlen — erst ergänzen, dann prüfen."), der DB-CHECK
`biomassestrom_geprueft_vollstaendig_check` ist das Sicherheitsnetz (E21:
vorher gab es keine NULL-Werte, Zählbeweis `PR_E geprueft_unvollstaendig=0`).
**Eine Logik für Formular und Import:** das Formular verlangt die Felder
nicht mehr („leer = unbekannt"), Detail und Register zeigen „unbekannt".

**Zeitraum:** Ohne Spalte oder mit leerer Zelle gilt der Zeitraum des
Laufs: „Zeitraum von" **und** „Zeitraum bis" (MM/JJJJ) sind Pflichtangaben
bei den Belegdaten, sobald eine Zeile keinen eigenen Zeitraum trägt, ohne
Vorbelegung (`import_lauf.zeitraum_von/_bis`). **Gemeldet:** `zeitraum_bis`
ist im Modell NOT NULL — „unbefristet" gibt es nicht, deshalb ist auch
„Zeitraum bis" am Lauf Pflicht (Erics Vorbehalt „falls das Modell es
zulässt"). Eine zugeordnete Spalte geht dem Lauf-Wert je Zeile vor.

**Rot gezeigt (Vitest):** Legende ohne Kopfzeile abgewiesen mit Hinweis auf
die Handwahl; unbekanntes Blatt abgewiesen; Zeilen ohne Zeitraum und ohne
Lauf-Zeitraum → Feldfehler, nichts gespeichert; bis vor von → Fehler;
fehlende Materialart bleibt Pflichtverletzung, fehlender Aschegehalt nicht
mehr; `stromPruefen` ohne TS/Asche (Fixture mit Werten grün, Vorbedingung
im Code).

## 40. E68 Adressprüfung statt Vorschläge beim Tippen — PR 1: PLZ-Gebiete lokal, 07.10.2026

**E68 (Eric, 06.10.2026):** Adressprüfung statt Autocomplete. Kein
Bezahldienst; ein gehosteter Dienst (Geofabrik/Geoapify) bleibt als spätere
Optimierung AP6 vorgemerkt. Ziel: Straße, Hausnummer, PLZ, Ort eingeben →
„Adresse prüfen" → Pin oder Fehlermeldung mit „Meinten Sie …?". Eine externe
Anfrage je Klick, keine je Tastendruck. Drei PRs: 1 PLZ-Gebiete lokal,
2 Prüfen-Knopf und Genauigkeit, 3 Import anpassen. Übergangsweise bleiben
Abbruch laufender Anfragen und Entprellung im AdresseBlock.

**Quelle (Recherche 06./07.10.2026, Weggabelung — siehe unten):** Die im
Auftrag genannte Quelle suche-postleitzahl.org liefert keine Downloads mehr
(Downloadseite 404, Wayback-Snapshot Januar 2026 ebenfalls 404). Einzige
geprüfte Quelle mit fester, versionierter URL, ODbL und aktuellem Stand:
GitHub-Release **yetzt/postleitzahlen 2026.02** (20.02.2026, OSM via
Overpass; 8.176 Features, 8.175 verschiedene PLZ, 75378 doppelt; 24,4 MB
Brotli, 502 MB GeoJSON; SHA-256 im Workflow). Sie enthält **keine**
PLZ↔Ort-Zuordnung. postleitzahl.net hätte eine (13.128 Zeilen), aber mit
tokenisierten URLs, widersprüchlicher Lizenz (Impressum verbietet
Weitergabe) und älterem Stand; opendatasoft ist abgeschaltet; BKG/Deutsche
Post sind Vertrag bzw. Bezahlung. Der Entwurf leitet die Orte deshalb aus
dem **Flächenschnitt PLZ-Gebiet × VG250-Gemeinde** (BKG, dl-de/by-2-0,
dieselbe Lieferung wie `import-vg250.yml`) ab: eine Gemeinde gehört zur
PLZ, wenn der Schnitt mindestens 10 % der Gemeinde- oder der PLZ-Fläche
ausmacht. Ortsnamen sind damit **amtliche Gemeindenamen**, keine
Ortsteile; „Oggersheim" passt nicht, „Ludwigshafen" schon (Kurzform).

**Entscheidung Eric (07.10.2026):** Quelle übernommen — yetzt/postleitzahlen
2026.02 (ODbL, SHA-256 fixiert) und die Orte aus dem Schnitt mit den
VG250-Gemeinden. Quellenhinweise „© OpenStreetMap-Mitwirkende, ODbL" und
„© GeoBasis-DE / BKG, dl-de/by-2-0" (Gemeinden). Ortsteile führen zu
„Meinten Sie <Gemeinde>?" (Mannheim-Neckarau → Mannheim) — gewollt.
**Speicher:** Neon Free hat eine harte Grenze (laut Preisseite 1 GB je
Projekt, 20 GB je Konto; Production am 07.10.2026: 31 MB, davon
verwaltungsgebiet 14 MB). Vor jeder Production-Migration gilt deshalb:
`plz_ort` ohne Geometrie, `plz_gebiet` vereinfacht, Ziel deutlich unter
25 MB zusammen; Messung im Wegwerf-Lauf, Entscheidung bei Eric.

**Datenmodell (Migration 0048):** `plz_gebiet(plz PK, geom MultiPolygon
4326, stichtag)` mit CHECK fünfstellig und GIST; `plz_ort(plz FK cascade,
ort, ort_norm, ars 12-stellig)` mit PK (plz, ars) und Index auf `ort_norm`
— **ohne Geometrie**. Der Schnitt PLZ × Gemeinde wird nur beim Import
gerechnet (rohe Union, Schwelle 10 %). Folge: Ein Pin liefert die PLZ und
die Liste ihrer Orte; bei genau einem Ort ist er eindeutig, sonst trägt der
Mensch den Ort ein (Hinweis „PLZ 54636 hat 39 Orte — Ort bitte eintragen:
…"). Geometrie: ST_MakeValid je Feature vor der Union, Rohflächen nur
temporär, Bestand mit ST_SimplifyPreserveTopology `SIMPLIFY_TOLERANZ` =
0,00015° (≈ 17 m N–S, ≈ 11 m O–W), Rundung 1e-6. Der Wegwerf-Lauf misst
Größe vorher/nachher und den Anteil zufälliger Punkte mit anderer PLZ
(PLZVERGLEICH); Größen stehen in PLZNACH, die Preview-Größe druckt
`import-check` (GROESSE), Production `lese-diagnose`.

**Funktionen (SQL, Spiegel in TS):** `plz_ort_norm(text)` (Kleinbuchstaben,
ä/ö/ü/ß ausgeschrieben, alles außer Buchstaben/Ziffern ein Leerzeichen),
`plz_ort_passt(eingabe, ort_norm)` (Gleichheit oder Kurzform als ganzes
Wortpräfix: „halle" → „halle saale", „ludwigs" nicht), `plz_pruefung(plz,
ort) → (plz_bekannt, ort_passt, orte[])`, `plz_fuer_punkt(geom) → (plz,
orte[])` (kleinste Fläche zuerst), `punkt_in_plz(plz, geom) → bool|null`.
TS-Spiegel `normalisiereOrt`/`ortPasst` in `packages/db/src/plz.ts`; die
gemeinsamen Fälle prüft Vitest (TS) und `plz-check.ts` (SQL gegen TS) —
eine Regel, zwei Laufzeiten.

**App:** `/api/geocode?lat&lon` („PLZ aus Pin", Kartenklick, „vom Standort
übernehmen") fragt nur noch die lokale Funktion, kein externer Dienst mehr;
Photon-Rückwärtssuche und Treffer-Auswahl entfernt. Der Pin überschreibt
nur PLZ und Ort, Straße und Hausnummer bleiben (der lokale Treffer kennt
keine Straße; PR 2 prüft sie). Neue Route `/api/plz?plz&ort` für PR 2 und
PR 3. Solange der Bestand leer ist, antworten beide Routen mit 503 und
Klartext („PLZ-Gebiete sind noch nicht importiert …") statt still nichts zu
finden. Quellenhinweis „PLZ-Gebiete © OpenStreetMap-Mitwirkende, ODbL" in
der Attribution beider Karten.

**Betrieb:** Workflow `import-plz.yml` wie VG250 (wörtliche Bestätigung,
Host-Prüfung, SHA-256 beider Quellen, Staging per ogr2ogr, Ersetzung in
einer Transaktion, Sollwert 8.175 PLZ, Gemeinden 10.500–11.500 als
Plausibilität bis zum gemessenen Soll) mit dritter Zielumgebung
**`wegwerf`** (PostGIS 18 im Runner, alle Migrationen auf leer, Messung von
Dauer und Größe). Neuer CI-Job `wegwerf-db` im Deploy: Migrationen auf eine
leere PostGIS, Staging-Fixture (zwei PLZ, fünf Gemeinden, Splitter,
Doppel-PLZ), Import ohne Sollwerte, `plz-check`. Reihenfolge nach dem Merge:
Migration läuft über das Label, danach `import-plz.yml` auf preview, auf
production nur nach Freigabe.

**Rot gezeigt (PR 1):** unbekannte PLZ → `plz_bekannt false`, keine Orte,
Text „PLZ 00000 ist unbekannt — bitte prüfen."; Ort passt nicht → Vorschlag
der Orte der PLZ (höchstens drei im Text); Tippfehler („Speier") passt nicht;
Kurzform „Gross" passt zu „Groß Köris"; Splitter-Gemeinde mit 1 % Schnitt
fällt heraus; Doppel-PLZ 75378 wird eine Zeile; Grenzpunkt trifft beide
Seiten mit deterministischer erster Zeile; Punkt außerhalb → keine Zeile,
`punkt_in_plz` false, unbekannte PLZ null.

**Entscheidung Eric (07.10.2026, nach Messung):** Toleranz **0,00015°**
(Standard im Code). Gemessen auf `wegwerf`: Rohflächen 6,4 Mio.
Stützpunkte / 98 MB → 1,7 Mio. / 27 MB, Tabelle 30 MB, mit `plz_ort`
32 MB; 7 von 12.838 Zufallspunkten mit anderer PLZ, keiner ohne PLZ.
0,0005° hätte 17 MB gebracht, aber 44 abweichende und 6 PLZ-lose Punkte.
Neon Free hat 1 GB je Projekt, Production liegt bei 31 MB — 32 MB
zusätzlich sind unkritisch; das frühere 25-MB-Ziel beruhte auf einer
falschen Annahme (0,5 GB).

**Offene Weggabelungen (nicht entschieden):** (1) Schwelle 10 % für die
Ortszuordnung. (2) Exklaven außerhalb Deutschlands
(87491, 87567–69, 78266) bleiben als PLZ ohne Ort. (3) ODbL-Share-alike für
die abgeleitete Tabelle `plz_ort` (juristisch offen). Entschieden (Eric
07.10.2026): Quelle und Ableitung der Orte, siehe oben.

## 41. E68 PR 2: Prüfen-Knopf und Genauigkeit, 07.10.2026

**Ablauf (ein Klick, höchstens eine externe Anfrage):** `lib/adresse-pruefung-server.ts`
1. lokal PLZ↔Ort (`plz_pruefung`, PR 1): unbekannte PLZ oder Ort passt nicht
   → sofort „Meinten Sie …?" mit den Orten der PLZ, **keine** externe Anfrage;
2. **eine** strukturierte Anfrage an den Adressdienst („Straße Hausnummer,
   PLZ Ort", Photon wie heute, Zeitlimit 12 s, Diagnose wie bisher);
3. Entscheidung in `lib/adresse-pruefung.ts` (pure, getestet): Treffer mit
   Pin im PLZ-Gebiet (`punkt_in_plz`) und gleicher Straße → Pin, Genauigkeit
   `hausnummer` (Hausnummer gefunden) oder `strasse`; Abweichung → höchstens
   drei Kandidaten im PLZ-Gebiet zum Übernehmen; kein Treffer oder Zeitlimit
   → Pin auf `ST_PointOnSurface(plz_gebiet)` mit Genauigkeit `plz_gebiet` und
   Hinweis „ungefährer Standort, bitte auf der Karte verschieben". Liegt die
   PLZ über einer Kreisgrenze (≥ 2 Kreise mit ≥ 5 % Flächenanteil,
   `plzKreise`), sagt der Hinweis es — der Kreis folgt dem Pin (E25).
   Straßenvergleich mit `normalisiereStrasse` („Str." = „Straße").

**Oberfläche:** Autocomplete entfernt. Felder Straße, Hausnummer, PLZ, Ort,
Knopf „Adresse prüfen", daneben die Genauigkeits-Pille und „freie Suche"
(„Kläranlage Mannheim", bis fünf Treffer, eine Anfrage je Klick, derselbe
Weg `/api/adresse?q=`). Klick oder Ziehen des Pins → `manuell`, PLZ und Ort
aus dem PLZ-Gebiet (PR 1). Übernahme eines bestehenden Standorts → die
Genauigkeit ist `unbekannt` (der Standort trägt sie nicht mit; nichts wird
erfunden). Route `/api/adresse` ist ein lesender GET wie `/api/geocode`
(Firmenadressen, keine Personendaten).

**Genauigkeit (Migration 0050):** Enum `standort_genauigkeit` (hausnummer ·
strasse · plz_gebiet · manuell · unbekannt, E53: nie umbenennen), Spalten
`biomassestrom.standort_genauigkeit`, `output_bedarf.standort_genauigkeit`,
`akteur.sitz_genauigkeit`, NOT NULL DEFAULT `unbekannt` — der Altbestand
bleibt `unbekannt`, keine erfundenen Werte. Feldeinstufung: redaktionell
(beschreibt die Qualität des Pins, ändert die Aussage nicht). Schreibwege:
Hidden-Input `genauigkeit` aus dem AdresseBlock; nur ein gültiger Wert wird
gespeichert, sonst `unbekannt` (`genauigkeitFuerPin`); ohne Pin immer
`unbekannt`. Beim Bearbeiten geht der gespeicherte Wert unverändert zurück,
solange der Pin nicht angefasst wird. Sichtbar als Pille am Standort
(Strom-Detail) und am Sitz (Akteur-Stammdaten).

**Dienst-URL:** Worker-Variable `GEOCODE_URL` (wrangler.jsonc, Standard
Photon); außerhalb des Workers gilt der Standard. Nutzungsregeln bleiben:
User-Agent mit Kontakt, eine Anfrage je Klick, nur Einzelabfragen.

**Rot gezeigt (PR 2, Vitest):** Zeitlimit/Ausfall → Pin auf das PLZ-Gebiet
mit `plz_gebiet`; Tippfehler in der Straße („Igelheimer Str") → „Meinten Sie
…?" mit höchstens drei Kandidaten ohne Server-Interna; Treffer außerhalb des
PLZ-Gebiets zählt nicht; Straße gefunden, Hausnummer nicht → `strasse` mit
Hinweis; ohne PLZ-Gebiet und ohne Treffer → Pin von Hand.

**Offen (nicht entschieden):** Nominatim als Ausweich für die strukturierte
Suche (Photon kennt nur Freitext; die Felder werden zu einem Text gefügt);
Genauigkeit in der Karten-Popup („am Pin") — im Entwurf nur Detail und
Stammdaten; Import setzt die Genauigkeit erst mit PR 3.

## 42. E68 PR 3: Import — Adressen lokal, genaue Pins optional, 07.10.2026

**Adressen zuordnen (lokal, sofort):** `importAdressenAufloesen` fragt keinen
Dienst mehr. Alle eindeutigen Adressen neuer Akteure gehen in **einer**
Abfrage an `plz_pruefung` + `ST_PointOnSurface(plz_gebiet)`
(`pruefePlzOrtStapel`, jsonb-gebunden): PLZ bekannt und Ort passt → Pin im
PLZ-Gebiet, Felder `akteur_sitz_quelle = plz_gebiet`,
`akteur_sitz_genauigkeit = plz_gebiet`; fehlt der Ort, gilt der einzige Ort
der PLZ, bei mehreren bleibt die Zeile offen mit der Liste. Befunde sind
Sätze für die Nacharbeit („PLZ 00000 ist unbekannt — bitte prüfen.", „Ort
passt nicht zur PLZ 54636 — meinten Sie A, B, C …?", „Ohne PLZ keine
Zuordnung — PLZ in der Zeile ergänzen."). Ein Aufruf statt Stapel; die Dauer
steht im Lauf-Zähler `adressen_lokal_ms` und im Protokolltext. Die Zeile
ohne PLZ, die bisher über Photon aus Straße + Ort einen Sitz bekam, bleibt
jetzt offen — bewusst: ohne PLZ keine lokale Zuordnung (Weggabelung unten).

**Genaue Pins ermitteln (optional):** `importPinsErmitteln` für Adressen mit
`quelle = plz_gebiet` ohne `akteur_sitz_genau_versucht`: je eindeutiger
Adresse eine Anfrage über denselben Ablauf wie der Prüfen-Knopf
(`pruefeAdresse`, PR 2), **eine Anfrage je Sekunde** (Abstand im Stapel),
vier je Aufruf, der Browser setzt fort, Fortschritt sichtbar. Treffer →
`quelle = photon`, Genauigkeit hausnummer/strasse; sonst bleibt der
ungefähre Pin, die Adresse gilt als versucht (keine Endlosschleife). Die
Genauigkeit läuft beim Ausführen in `akteurAnlegenInTx` (`genauigkeit` der
Eingabe) in `akteur.sitz_genauigkeit`.

**Messung:** `plz-check` misst mit Bestand 5.000 (PLZ, Ort) in einer Abfrage
(jede zehnte mit falschem Ort) und druckt `PLZMESSUNG` — läuft im
Wegwerf-Lauf von `import-plz.yml`; Wert im PR-Kommentar.

**Rot gezeigt (PR 3, Vitest):** unbekannte PLZ und falscher Ort bleiben mit
Satz stehen (drei Gruppen, eine Abfrage, zwei offen); Bearbeiter abgewiesen
ohne Abfrage; genaue Suche fragt versuchte Adressen nicht erneut, Treffer
hebt die Genauigkeit, kein Treffer markiert nur „versucht".

**Offen (nicht entschieden):** Zeilen ohne PLZ (nur Straße + Ort) — lokal
nicht zuordenbar; Option: genaue Suche auch für sie zulassen. Die Testdatei
`import-testdatei-ap27.xlsx` (Prüfstein) lag in der Nacht nicht vor.

**Nachtrag 08.10.2026 (Zeile 39 der Testdatei, Eric):** Bei vorhandenem
Akteur wird die Zeilen-Sitzadresse verworfen; in den Strom gehen nur die
Spalten der Gruppe „Standort" (`plz`, `ort`, Straße, Hausnummer) — und die
waren ungeprüft. Jetzt prüft der Adressschritt auch sie lokal
(`standortGruppen`, `standortBefund`), je eindeutigem (PLZ, Ort) einmal,
unabhängig vom Akteur; ein Befund steht als Zeilenfehler am Feld Standort ·
PLZ und führt in die Nacharbeit, eine Korrektur dort wird sofort erneut
geprüft. Zähler `standort_befunde` am Lauf. Tests in
`lib/import-adressen.test.ts` („Standort-Spalten").

## 43. E69 Preis-Bezug, liegengebliebene Läufe, Konfliktmarker-Wächter (AP2.7 PR g), 07.10.2026

**Anlass (Testlauf 07.10.2026):** `biomassestrom.preis_min/mittel/max` waren
nackte Zahlen ohne Einheit im Schema; die Auswertung rechnete `preis ×
menge_atro` und der Export beschriftete „€/t atro", Formular, Detail und
Import sagten nur „€/t". Wer einen Angebotspreis je Tonne Frischmasse
eintrug, bekam in der Auswertung einen atro-bezogenen Betrag — bei 30 % TS um
den Faktor drei zu hoch.

**Entscheidung Eric (E69, 07.10.2026): Der Preis wird mit seinem Bezug erfasst.**
- Neue Spalte `preis_bezug` (Enum `fm | atro | unbekannt`, Migration 0049).
  Standard bei neuer Erfassung `fm`; `unbekannt` nur für den Altbestand, nicht
  wählbar. Migration additiv: bestehende Zeilen mit Preis bekommen
  `unbekannt` (Production hat keine Ströme; auf der Preview trifft es die
  Testdaten), Zeilen ohne Preis bleiben ohne Bezug. CHECK
  `biomassestrom_preis_bezug_check`: ist ein Preis gesetzt, ist auch der
  Bezug gesetzt — dieselbe Regel prüft `validiereFormular` vor dem Schreiben.
- Ein Bezug gilt für Min, Mittel und Max gemeinsam; das Vorzeichen bleibt
  wie in E14 (positiv = bhyo zahlt).
- Formular: Auswahl „€/t FM" / „€/t atro" neben Min · Mittel · Max; Detail
  zeigt den Bezug immer (Korridor-Einheit, Zeile „Bezug").
- Import: Zielfeld „Preis-Bezug" (Werte-Zuordnung fm/atro); ohne Spalte gilt
  der Lauf-Standard `import_lauf.preis_bezug_standard` (vorbelegt fm,
  Auswahl in „spalten zuordnen."). Eine Preis-Kopfzeile mit „atro" oder
  „TM" schlägt atro vor, zur Bestätigung (`preisBezugVorschlag`).
- Auswertung (Potenzial, Preiskorridor E38, KPI-Kachel): gerechnet wird mit
  dem **abgeleiteten Preis €/t atro** (`lib/preis-bezug.ts`), nie gespeichert
  (E23): atro → unverändert; fm mit TS-Anteil → Preis ÷ TS-Anteil (als
  Anteil); fm ohne TS-Anteil oder unbekannt → **„nicht vergleichbar"**: der
  Strom wird **aus den preisbezogenen Größen ausgeschlossen** (ø Preis,
  Preiskorridor, Feedstock-Potenzial in €/a, Export „Preis €/t atro
  (abgeleitet)" und „Potenzial [€/a]"), seine Zahl steht am Band
  („· n nicht vergleichbar") und in der Kachel-Caption. **Mengengrößen
  hängen nicht am Preis-Bezug** (Präzisierung Eric 07.10.2026): Trockenmasse,
  Cluster-Anteile, verfügbarer Feedstock je Jahr, Export „Menge [t atro/a]"
  zählen jeden Strom unabhängig vom Preis (Test in `lib/preis-bezug.test.ts`).
  Nichts rechnet stillschweigend mit dem Rohwert; am Einzelstrom (E38) heißt
  der Zustand „Preis nicht vergleichbar (Preis-Bezug FM ohne TS-Anteil oder
  unbekannt)". Der Rohpreis selbst bleibt überall sichtbar, immer mit seinem
  Bezug (Formular, Detail, Grid, Tabelle, Export).
- Export: „Preis min/mittel/max [€/t]" (Rohwert), „Preis-Bezug (FM / atro)",
  „Preis mittel [€/t atro] (abgeleitet, E69)"; die bisherige Beschriftung
  „€/t atro" am Rohpreis entfällt.
- Feldeinstufung `preis_bezug`: fachlich — eine Änderung setzt die Prüfung
  zurück wie beim Preis.
- Tests (`lib/preis-bezug.test.ts`): 30 €/t FM bei 30 % TS → 100 €/t atro;
  50 €/t atro → 50; FM ohne TS → nicht vergleichbar, nicht im Korridor.
  Rot-Nachweis: vor E69 rechnete `potenzialEuroFeedstock` mit dem Rohwert
  (30 statt 100). Testdatei Zeile 32 („Preis €/t", 85) wird als fm erwartet.

**Liegengebliebene Läufe (Eric 07.10.2026):** Aktion „Lauf verwerfen"
(`import.verwerfen`: Ersteller, Prüfer, Admin — Ersteller sind immer Prüfer
oder Admin) für Läufe, die nie ausgeführt wurden (angelegt … probelauf,
fehler): Zeilen gelöscht (Zwischendaten, keine Ströme), Status `verworfen`,
`verworfen_am`, Ereignis `status_gesetzt` am Lauf, Roh-Upload und
bereinigte Kopie in R2 weg. Derselbe Weg (`verwirfLauf`) im täglichen Job
nach `import.lauf_inaktiv_tage` (Startwert 30) ohne Aktivität
(`updated_at`); eigener Parameter statt `import.zeilen_aufbewahrung_tage`,
weil er das Ende eines nie abgeschlossenen Laufs regelt, nicht die
Aufbewahrung von Zwischendaten abgeschlossener Läufe — zwei Fristen,
unabhängig justierbar, gleicher Startwert. Der Job protokolliert im Namen
des Erstellers mit ausdrücklichem Text („vom täglichen Job nach n Tagen
ohne Aktivität"). Status-CHECK um `verworfen` erweitert (Migration 0049).

**Konfliktmarker-Wächter (Eric 07.10.2026):** `scripts/konfliktmarker-check.sh`
prüft alle versionierten Dateien auf `<<<<<<< `, `=======`, `>>>>>>> ` am
Zeilenanfang und macht `typen-und-tests` rot; Rot-Nachweis in
`scripts/tests/konfliktmarker-test.sh`. Anlass: beim Angleichen von E68 PR 1
blieben Marker in zwei Doku-Dateien stehen (siehe Memory 07.10.2026).

**Vormerkungen:** AP6 — stark-Vorschläge unter neuen Akteuren desselben Laufs
(Testdatei Zeile 37); Zeile 11 ist regelkonform (kein Ortsbezug, Präfix
senkt die Ähnlichkeit).

## 44. AP2.8 „Biomasse wird frei" (E70), 07.10.2026

**Entscheidungen Eric (E70):** frei_ab = Ende der Vergabekette eines
Angebots (`vergeben_bis`), wenn keine Anschlussvergabe spätestens am Folgetag
beginnt; gilt auch bei `an_bhyo` („Unsere Vergabe endet am …"); nur Angebote,
nicht das Ende des Verfügbarkeitszeitraums; `vergeben_bis` NULL → kein
Hinweis. Staffel 180/60/30/0 Tage, aktive Stufe = kleinste Stufe ≥ Resttage
(Europe/Berlin), ≤ 0 → Stufe 0, > 180 → nichts. Je Stufe ein Inbox-Eintrag
mit Schlüssel (Strom, frei_ab, Stufe); Stufenwechsel räumt die Vorstufe ab,
höchstens ein offener Eintrag je Strom; verpasste Stufen werden nicht
nachgeholt; ein erledigter Eintrag entsteht für denselben Schlüssel nie neu.
Stufe 0 „frei seit" bleibt, bis eine neue Vergabe kommt oder der Strom
verworfen ist. Ändert sich frei_ab, werden alle Einträge zum alten frei_ab
abgeräumt und neu bewertet. Reiner Hinweis, Empfänger wie die
Ablauf-Hinweise (letzter Prüfer, sonst alle Prüfer/Admins). Pille „frei ab /
frei seit TT.MM.JJJJ" in Liste und Detail, Filterwert „Wird frei" in der
Verfügbarkeits-Facette, keine Karte.

**Umsetzung (Migration 0052; ursprünglich 0051, umnummeriert am 08.10.2026, weil 0051 an E72 ging — neues Journal-`when`):** Enum-Wert `biomasse_wird_frei`, Spalte
`inbox_eintrag.stufe` (CHECK: genau bei diesem Typ gesetzt), Index
`inbox_eintrag_wird_frei_uidx` (Empfänger, Strom, frei_ab, Stufe) über alle
Zustände, Urheber-CHECK erweitert. Regel in `lib/wird-frei.ts` (freiAbAus,
stufeFuer, wirdFreiStand, Pille, Hinweistext), gespiegelt in SQL im
täglichen Job (`lib/inbox/hinweise.ts`, Schritte `wird_frei` und
`wird_frei_abraeumen`, zustandsbasiert wie E63). Welche Kette zählt: deckt
der Stichtag eine Vergabe, deren Kettenende; sonst das jüngste Ende vor dem
Stichtag („frei seit"); sonst das nächste künftige. Anschluss heißt wörtlich
„Beginn spätestens am Folgetag" — ein freier Tag dazwischen ist keine Kette.
Tests: `lib/wird-frei.test.ts` (Regel) und `scripts/wird-frei-probe.ts`
(Job-SQL gegen die Wegwerf-DB im CI, zurückgerollt).

**Entschieden (Eric 08.10.2026):** (a) Die Staffel liegt als vier
Schlüssel `hinweis.wird_frei_stufe_1…4` (180/60/30/0). Die Logik sortiert
die Werte absteigend und fasst gleiche zusammen (`normalisiereStufen` in
`lib/wird-frei.ts`, `distinct … where s >= 0` in der SQL-Spiegelung) — die
Reihenfolge der Schlüssel ist egal; negative Werte weist die
Parameter-Prüfung ab (min 0, `pruefeParameterEingabe` und Trigger). Pille
und Facette lesen dieselben Parameter (`ladeWirdFreiStufen`, einmal je
Request), nicht die Standardkonstante. Tests: `lib/wird-frei.test.ts` („E70
Staffel aus vier Parametern"), `lib/parameter.test.ts`. (b) Kein Index ohne
Messung: `scripts/wird-frei-probe.ts` misst die Bewertungs-CTE mit EXPLAIN
(ANALYZE, BUFFERS) auf synthetischer Menge (Standard 3000 Angebote mit je
zwei Vergaben ≈ zehnfache Preview-Menge; `job-probe` druckt den Bestand der
Preview als BESTAND-Zeile); der Plan steht im CI-Log und bis zur Freigabe im
PR-Text. (c) Verwerfen des Stroms beendet Stufe 0 wie ein Erledigen.

## 45. AP2.6 Kommentare — PR a: Datenmodell, Schreibweg, Rechte (E71), 07.10.2026

**Entscheidungen Eric (E71, 07.10.2026):** Eigene Tabelle `kommentar` —
der Inhalt ist Marktdokumentation, kein Protokoll; das Protokoll erhält nur
die Ereignisse erstellt/bearbeitet/gelöscht ohne Text. Bezug auf Strom oder
Akteur mit CHECK „genau ein Bezug" (wie Inbox); Beleg später als weitere
Spalte. Löschverhalten nach dem Bestand (Ströme werden nie gelöscht, ein
verwaister Akteur schon). Schreibweg `kommentar-schreibweg.ts` analog
Strom/Akteur: darf() → Schreiben → protokolliere(tx) → zustellen, eine
Transaktion. Tabelle `kommentar_erwaehnung` (kommentar_id, nutzer_id), PK aus
beiden; der Server leitet sie aus den Markern `@[nutzer:<uuid>]` ab, einer
Client-Liste wird nicht vertraut. Kommentare werden nicht automatisch
gelöscht. Erwähnbar nur App-Nutzer, nie Kontaktpersonen (E57); Betrachter
lesen, kommentieren nicht, sind nicht erwähnbar (wie `ladeZuweisbare`).
Aktionen `kommentar.erstellen` / `.bearbeiten` / `.loeschen`. Eigene
Kommentare bearbeiten (Marker „bearbeitet", kein Versionsverlauf) und
löschen; Löschen weich (Text NULL, `geloescht_am`), Admin darf fremde
löschen; beim Bearbeiten neu hinzugekommene Erwähnungen werden zugestellt,
entfernte nicht zurückgenommen. Kommentieren am gesperrten Strom ist
erlaubt (E44 nennt nur fachliche Änderungen am Strom — kein Widerspruch im
Bestand). Feldeinstufung intern; nicht im Export, nicht im Import.

**Umsetzung (Migration 0053; ursprünglich 0052, umnummeriert am 08.10.2026 nach dem Merge von #199, neues Journal-`when`):** `kommentar` (biomassestrom_id,
output_bedarf_id, akteur_id — „Strom" heißt im Bestand Angebot oder Bedarf,
deshalb zwei Strom-Spalten wie in `inbox_eintrag`; autor_id, text,
erstellt_am, bearbeitet_am, geloescht_am), CHECKs
`kommentar_genau_ein_bezug_check` und `kommentar_text_check` (1–2000
Zeichen nach btrim, NULL genau bei gesetztem `geloescht_am`), Index je
Bezugsspalte; akteur_id mit ON DELETE CASCADE (wie `inbox_eintrag.akteur_id`
und das Musterpaar), Strom-Spalten ohne. `kommentar_erwaehnung` mit PK und
CASCADE zum Kommentar. Enum `ereignis_art` + `kommentar_erstellt`,
`kommentar_bearbeitet`, `kommentar_geloescht`; Protokoll-Entität
`kommentar`. Matrix: die drei Aktionen ab bearbeiter; Objektregeln
`nurAutor` (bearbeiten — auch admin keinen fremden) und `autorOderAdmin`
(löschen) am neuen Objekt `{ autorId }`. Baustein
`lib/kommentar-schreibweg.ts` (`kommentarErstellenInTx`,
`pruefeKommentarObjekt` mit FOR UPDATE, `kommentarBearbeitenInTx`,
`kommentarLoeschenInTx`, `pruefeErwaehnbare`), Marker-Parsing in
`lib/kommentar-marker.ts`, Actions in `lib/kommentar-actions.ts`. Ein Marker
auf einen nicht erwähnbaren Nutzer (unbekannt, deaktiviert, Betrachter)
weist den Kommentar ab (fail closed) statt ihn stumm zu verschlucken.
Weiches Löschen entfernt die Erwähnungszeilen mit dem Text.
`akteurLoeschen` zählt die mitgelöschten Kommentare im Ereignistext,
`akteurZusammenfuehren` hängt sie an das Ziel um. Wächter: rechte-check
erkennt `pruefeKommentarObjekt(` als Objektstufe und sieht dafür auch den
Rumpf des importierten Bausteins (eine Ebene, wie protokoll-check);
protokoll-check prüft bei Entität `kommentar` die Interpolationen wie bei
Kontaktpersonen (nur IDs, Bezugsart, Zähler). Tests:
`lib/rechte/matrix.test.ts` (Rolle × Aktion, Objektregel Autor),
`lib/kommentar-marker.test.ts`, `lib/kommentar-schreibweg.test.ts`,
`lib/kommentar-actions.test.ts`, `scripts/kommentar-probe.ts` (Wegwerf-DB:
CHECKs, PK/FK, Rechte am echten Baustein, weiches Löschen, kein Text im
Protokoll mit Rot-Nachweis, CASCADE).

**Schnitt:** PR a (dieser) Datenmodell + Schreibweg + Rechte + Tests; PR b
UI Kommentarverlauf ohne @; PR c Erwähnungen + Inbox-Zustellung (Enum-Werte
`kommentar`/`erwaehnung`, `inbox_eintrag.kommentar_id`); PR d
Inbox-Aufbewahrung (D14).

**Entschieden (Eric 08.10.2026):** (a) Migrationen so wie
gebaut (AP2.8 jetzt 0052, PR a 0053, PR c 0054, PR d 0055 — Umnummerierung 08.10.2026, weil 0051 an E72 ging). (b) Textgrenze 2000 Zeichen; ein Marker
**PR b (UI, 08.10.2026, keine Migration):** Loader `lib/kommentare.ts`
(SELECT, Autor und Erwähnte zur Lesezeit aus `benutzer`), Anzeige-Modell
`lib/kommentar-modell.ts`, Komponente `components/kommentare/Kommentare.tsx`
im Strom-Detail (über `lib/detail-daten.ts`, damit ströme. und inbox.
dasselbe Panel zeigen) und im Akteur-Detail. Marker → aktueller Name
(`kommentarSegmente`), deaktiviert/unbekannt → „ehemaliger Nutzer".
Rechte zum Ausblenden aus derselben Matrix (`darf`), durchgesetzt bleibt
serverseitig. Hinweis unter dem Feld und Kontaktdaten-Warnung (Muster aus
dem Import, warnt, blockiert nicht) sind hier schon enthalten, weil sie am
Eingabefeld hängen; die @-Auswahl und die Zustellung kommen mit PR c.
Gestaltung in `docs/design-system.md` („Kommentare"). Tests:
`components/kommentare/Kommentare.test.tsx`, Segmente in
`lib/kommentar-marker.test.ts`.

**PR c (Erwähnungen + Inbox, 08.10.2026, Migration 0054; ursprünglich 0053, umnummeriert am 09.10.2026, neues Journal-`when`):** Enum
`inbox_typ` + `kommentar`, `erwaehnung` (nur erweitert, E53); Spalte
`inbox_eintrag.kommentar_id` (FK, CASCADE — greift nur, wenn ein verwaister
Akteur mitsamt Kommentaren gelöscht wird) im genau-ein-CHECK, Index. Keine
Bündelung: je Kommentar und Empfänger ein Eintrag (kein Upsert, kein
Unique-Index). Zustellung in `lib/inbox/zustellung.ts`
(`zustelleKommentar`, Register-Reihenfolge erwaehnung vor kommentar, D6):
Erwähnte bekommen nur `erwaehnung`; `kommentar` geht an die
**Verantwortlichen des Objekts** — Strom: Beteiligte laut Protokoll (E23),
Sperrinhaber und Zugewiesene (E44); Akteur: Urheber seiner
Protokollereignisse — plus bisherige Kommentatoren des Verlaufs; ohne Autor,
Betrachter, Deaktivierte. Beim Bearbeiten nur `erwaehnung` für die neu
Erwähnten (Register: `kommentar` nur bei `kommentar_erstellt`); Löschen
stellt nichts zu. Der Schreibweg gibt die Erwähnten über
`protokolliere({ erwaehnteIds })` mit — dieselbe Transaktion. Inbox-Zeile
löst Strom bzw. Akteur aus dem Kommentar auf (`coalesce` in
`lib/inbox/server.ts`), der Link springt zum Kommentar (`#kommentar-<id>`,
hervorgehoben). @-Auswahl in der Komponente per Tastatur
(`lib/kommentar-eingabe.ts`: im Feld „@Name", gespeichert der Marker; nur
Tokens aus der Auswahl werden Marker, ein getippter „@Name" bleibt Text;
gleicher Name → E-Mail im Token). Erwähnbare = `ladeZuweisbare`. Tests:
`lib/inbox/zustellung.kommentar.test.ts`, `lib/inbox/register.test.ts`,
`lib/kommentar-eingabe.test.ts`, Probe Fälle 9a–9d und 8 (Inbox-CASCADE),
DB-Check `packages/db/src/inbox-check.ts` (14 Indizes, 15 Typen,
Spalte/CHECK).

**Entschieden (PR c, Eric 08.10.2026):** (e) Verantwortliche = Beteiligte
im Sinne von E56 — Strom: Beteiligte laut Protokoll, Sperrinhaber und
Zugewiesene; Akteur: Urheber seiner Protokollereignisse. Deaktivierte Nutzer
erhalten nichts (Test „Deaktivierte nichts" in
`lib/inbox/zustellung.kommentar.test.ts`). (f) Nummer 0053 wie gebaut. (g)
Marker deaktivierter Nutzer bleiben gespeichert, die Anzeige zeigt
„ehemaliger Nutzer" (Tests in `lib/kommentar-marker.test.ts` und
`components/kommentare/Kommentare.test.tsx`). Inbox-Einträge zu einem
gelöschten Kommentar bleiben und zeigen „Kommentar gelöscht" statt des
Zustelltexts (`kommentarGeloescht` in der Zeile, Probe 6f).

**Entschieden (Eric 08.10.2026):** (a) Migrationen 0051–0054 so wie
gebaut (AP2.8, PR a, PR c, PR d). (b) Textgrenze 2000 Zeichen; ein Marker
auf einen nicht erwähnbaren Nutzer (fremde UUID, Betrachter, deaktiviert)
weist den ganzen Kommentar mit Meldung ab, nichts wird gespeichert. (c)
Zwei Strom-Spalten (`biomassestrom_id`, `output_bedarf_id`) neben
`akteur_id`, CHECK „genau ein Bezug" über alle drei (Probe 1a–1d). (d)
Weiches Löschen entfernt auch die Erwähnungszeilen — sie leiten sich aus dem
Text ab; Inbox-Einträge zum gelöschten Kommentar bleiben und zeigen
„Kommentar gelöscht" (PR c). Tests: `lib/kommentar-schreibweg.test.ts`
(„Erwaehnungszeilen weg"), Probe 6c.

**Doppeltes Absenden (Eric 09.10.2026, Befund Preview #201):** Das
unkontrollierte Textfeld aus PR b behielt den Text nach dem Speichern, ein
zweiter Klick hätte den Kommentar doppelt angelegt (in PR b per
`form.reset()` behoben). PR c führt den Text als React-Zustand und leert ihn
nach Erfolg (`setText("")`); der Speichern-Knopf ist während des Speicherns
gesperrt (`disabled={pending}`, `useTransition`). **Vormerkung AP6:**
jsdom/Testing Library für Komponententests mit Interaktion — die heutigen
Komponententests sind statische Renders (`react-dom/server`) und können
weder das Leeren des Feldes noch die Sperre während des Speicherns prüfen;
Nachweis bis dahin nur auf der Preview.

**PR d (Inbox-Aufbewahrung D14, 08.10.2026, Migration 0055; ursprünglich 0054, umnummeriert am 09.10.2026, neues Journal-`when`):** Parameter
`inbox.aufbewahrung_erledigt_tage` = 14 und `inbox.aufbewahrung_gelesen_tage`
= 60 (Startwerte, Verlauf E60, Gruppe „Inbox" in einstellungen.). Der
tägliche Job (`worker.ts`, nach dem Verifikations-Job) löscht in
`lib/inbox/aufbewahrung.ts` (einzige Löschstelle, ein Statement, Stichtag
hereingereicht): Einträge im Zustand erledigt oder verworfen, deren
`zustand_seit` plus Frist den Stichtag erreicht (tagesgenau Europe/Berlin),
und offene gelesene Einträge, deren `gelesen_am` plus Frist den Stichtag
erreicht. Ungelesene bleiben. Bestand gewinnt: der Zustand „erledigt"
existiert (Enum `inbox_zustand`), „verworfen" (vom Empfänger weggeklickt)
wird wie erledigt behandelt. Log-Zeile `JOB inbox-aufbewahrung <env>
{"erledigt","gelesen"}`. Tests: `lib/inbox/aufbewahrung.test.ts`,
`scripts/inbox-aufbewahrung-probe.ts` (Wegwerf-DB: 13/14 und 59/60 Tage,
ungelesen bleibt, Wird-frei bleibt, idempotent, Parameter wirkt),
`parameter-check` 15 Schlüssel.

**Entschieden (PR d, Eric 08.10.2026):** (h) Abweichung angenommen:
die Aufbewahrung gilt für alle Typen **außer den zustandsbasierten
Job-Hinweisen** (`verifikation_laeuft_ab`, `verifikation_abgelaufen`,
`akteur_verwaist`, `kontaktperson_loeschpruefung`, `biomasse_wird_frei`) —
der Eintrag ist dort das Gedächtnis der Idempotenz (Indizes über alle
Zustände). (i) „verworfen" wird wie erledigt behandelt (14 Tage). (j)
„Löschungen auf Production macht ein Mensch" gilt für Eingriffe
(Migrationen, Handaktionen), nicht für fachlich entschiedene
Aufbewahrungsregeln im Job (Präzedenz E67, Import-Zwischenstände 30 Tage).
Bedingung: die Anzahl gelöschter Einträge je Lauf steht in
`job_lauf.schritte` (`inbox_aufbewahrung_erledigt`,
`inbox_aufbewahrung_gelesen`, am Lauf des Stichtags) und ist im Leseweg
sichtbar (Zeile JOB_LAUF `letzte_schritte`). (k) Nummer wie gebaut — nach der Umnummerierung 0055.
## 46. E73 Repo öffentlich während der Bauphase — Log-Hygiene, 08.10.2026

**Entscheidung Eric (E73):** Wegen der GitHub-Abrechnungssperre wird das Repo
während der Bauphase öffentlich; vor dem ersten echten Datensatz in
Production wird es wieder privat (Go-live-Kriterium). Den Wechsel macht Eric
nach dem Prüfbericht; die App ändert keine Repo-Einstellungen.

**Prüfbericht (nur lesend):** Secret-Scan der gesamten Historie aller
Branches ohne Fund (nur Platzhalter-URLs und die beiden Neon-Hostnamen im
Seed-Wächter, keine Tokens, Schlüssel oder Passwörter); kein Workflow nutzt
`pull_request_target`; Environments nur `main`. Personendaten in Logs:
`protokoll-messung` druckte die häufigsten Protokoll-Freitexte
(Zugriffsanfragen, Aufgaben), `beleg-abweichung` die Quellenangabe
genannter Belege — beides durch Arten bzw. ja/nein ersetzt. Alle Jobs mit
DB-Secret maskieren Host und Datenbanknutzer (E73-Schritt). Regeln in
`docs/betrieb.md` („Öffentliches Repo während der Bauphase").


## 47. E72 „PLZ aus Ort" und Ortsteil-Toleranz (AP2.7h), 08.10.2026

Entscheidung Eric 08.10.2026 nach dem Testlauf von E68 PR 3 (Zeilen 18, 21
und 39 der Testdatei `docs/beispiele/import-testdatei-ap27.xlsx`). Eigener
PR nach #195, Migration 0051.

**a) PLZ aus Ort (Import):** Fehlt die Sitz-PLZ einer Zeile und ist der Ort
(normalisiert wie `plz_ort`, Kurzform und Ortsteil erlaubt — dieselbe
Passt-Regel wie die Prüfung) genau **einer** PLZ **einer** Gemeinde
zugeordnet, wird die PLZ übernommen. Die Zeile trägt den Hinweis „PLZ aus
Ort ergänzt (Mosbach → 74821)" am Feld Sitz-PLZ, der Sitz bekommt wie jede
PLZ den Punkt im PLZ-Gebiet (Genauigkeit `plz_gebiet`), die Zeile ist
importierbar. Der Schritt sitzt **vor** dem Akteur-Abgleich in
`importAkteureAufloesen`, weil die Gruppe aus Name + PLZ besteht — der
Matcher sieht die ergänzte PLZ. Alle Orte eines Laufs in **einer** Abfrage
(`plzFuerOrtStapel` → SQL `plz_fuer_ort`, jsonb-gebunden).

**b) Mehrere PLZ oder mehrere gleichnamige Orte:** Befund am Feld Sitz-PLZ,
Zeile in die Nacharbeit (Status `fehler`): „Ort „Freiburg" ist ohne PLZ nicht
eindeutig (mehrere Orte dieses Namens) — Kandidaten: Freiburg (Elbe),
Landkreis Stade, Niedersachsen: 21729; Freiburg im Breisgau, Stadtkreis
Freiburg im Breisgau, Baden-Württemberg: 79098, 79100 … — PLZ in der Zeile
ergänzen." Je Gemeinde Ort mit Kreis und Land (über den ARS aus
`verwaltungsgebiet`, NULL ohne VG250 — nichts wird erfunden), höchstens
**zehn PLZ** insgesamt, danach „…". Unbekannter Ort: „Ort „X" ist nicht
bekannt — PLZ in der Zeile ergänzen." (konservativ wie b, nicht
entschieden — vorher blieb die Zeile im Adressschritt mit „Ohne PLZ keine
Zuordnung" offen).

**c) Dubletten-Logik unverändert.** Nach einer PLZ-Ergänzung oder -Wahl
läuft der Akteur-Abgleich mit dieser PLZ; in der Nacharbeit stößt eine
Änderung von Name, PLZ **oder** (neu) Ort bei leerer PLZ die Auflösung neu
an (`AKTEUR_AUFLOESUNG` fällt, der eigene Befund und Hinweis am Feld
Sitz-PLZ ebenfalls — ein Formatfehler bleibt). Erwartung Zeile 21: nach Wahl
von 79098 schlägt der Matcher „Test: Kompostwerk Breisgau" stark vor.

**d) Testdatei:** Blatt „Testfälle" Zeilen 18, 21 und 39 tragen die neue
Erwartung (in der Datei geändert, Zellen D16/D19/D37; Daten unverändert).

**e) Ortsteil-Toleranz (eine Funktion für Formular und Import):** Die
Passt-Regel steht einmal auf Normalformen — SQL `plz_ort_norm_passt(norm,
ort_norm)`, `plz_ort_passt` ist die Hülle mit Normalisierung; Spiegel
`ortNormPasst`/`ortPasst` in `@bhyo/db/plz`, Parität in `plz-check`. Drei
Fälle: gleich; Kurzform (Eingabe ist Wortpräfix des Orts); **Ortsteil** —
die Eingabe beginnt mit dem amtlichen Ort und einem Wortende („-" und
Leerzeichen sind in der Normalform dasselbe). Indexfähige Form (Messung
Eric 08.10.2026): gleich und Ortsteil als `ort_norm = ANY(Wortpräfixe der
Eingabe)` (`plz_ort_norm_praefixe`, Spiegel `ortNormPraefixe`), Kurzform
als Bereich `[n||' ', n||'!')` über die `text_pattern_ops`-Operatoren, dazu
Index `plz_ort_norm_muster_idx`. Die Funktionen sind **nicht STRICT**, weil
Postgres eine STRICT-SQL-Funktion mit AND/OR im Körper nicht inlined — ohne
Inlining blieb der Aufruf je Zeile stehen (Seq Scan). „Mannheim-Neckarau"/68199
passt, der Ort wird unverändert gespeichert, keine Meldung;
„Mannheimer Str."/68199 ist ein Befund; „Heidelberg-Rohrbach"/68159 →
„meinten Sie Mannheim?". Formular (`pruefeAdresse` → `plz_pruefung`) und
Import (`pruefePlzOrtStapel` → `plz_pruefung`) gehen durch dieselbe
SQL-Funktion.

**Zähler am Lauf:** `plz_aus_ort` (ergänzt), `plz_aus_ort_offen` (Zeilen in
der Nacharbeit); Protokolltext „… PLZ aus Ort: 1 ergänzt, 1 Zeile(n) in der
Nacharbeit".

**Rot gezeigt (Vitest):** Kandidaten-Abfrage nur für Zeilen ohne PLZ, ohne
Gruppe, ohne eigenen Befund (keine Wiederholung über Stapel); Matcher
bekommt die ergänzte PLZ, keine für den mehrdeutigen Ort; Befundtext mit
Kreis und Land, Grenze zehn PLZ; Ortsteil passt, Straßenname nicht, fremder
Ort nicht. `plz-check` (Wegwerf-DB, Fixture): eindeutiger Ort eine PLZ, Groß
Köris zwei, Kurzform und Ortsteil finden denselben Ort, unbekannt keine
Zeile, Kreis/Land null ohne VG250, Parität `plz_fuer_ort` = `plz_ort_passt`
über `plz_ort`; mit Bestand Messung `PLZMESSUNG_ORT` (200 Orte in einer
Abfrage) samt Plan `PLZEXPLAIN_ORT`: erste Fassung Seq Scan mit
Normalisierung je Zeile 6,5 s, mit Index aber STRICT 29 s (kein Inlining),
indexfähig und nicht STRICT **12 ms** (Bitmap-Index-Scans, Läufe
37801334789 / 37802875636 / 37803521292).

**Vormerkung AP6 (Eric 08.10.2026):** Formular-Adressprüfung bei
Ortsteil-Form („Mannheim-Neckarau"): nach bestandener lokaler Prüfung an den
Adressdienst den amtlichen Ort plus Ortsteil als Zusatz senden — mit Straße
lieferte der Dienst bisher keinen Treffer (Preview-Test 08.10.2026).

**Vormerkung geschlossen (Nachtauftrag 09.10.2026, B3): „Mehrdeutige
Ortsnamen nur mit Kreis/Land auswählbar"** — durch E68 und E72 abgedeckt:
Im Formular ist die PLZ Pflicht und löst gleichnamige Orte auf; passt der
Ort nicht, nennt „Meinten Sie …?" die amtlichen Orte der PLZ (E68 PR 2).
Im Import nennt der Befund bei einem Ort ohne PLZ jeden Kandidaten mit Kreis
und Land und der PLZ-Liste (E72 b, `kandidatenText`, Test „Rot b) mehrere
gleichnamige Orte -> Befund mit Kandidaten je Ort mit Kreis und Land",
Screenshot `e72/02`); gewählt wird durch Eintragen der PLZ, nie durch
Anklicken eines bloßen Ortsnamens. Kein weiterer PR nötig.

**Migrationsnummer:** 0051 geht an E72, weil der PR vor #199 gemergt wird
(Reihenfolge Eric). #199 (bisher 0051) und #200–#203 (0052–0054) müssen
beim Angleichen neu nummeriert werden **und** ein neues `when` im Journal
bekommen — der Drizzle-Migrator wendet nur Migrationen an, deren Zeitstempel
jünger ist als die letzte angewendete.

## 48. E74 Mail-Versand über Microsoft 365 (AP2.9), 09.10.2026

**Entschieden (Eric 09.10.2026):** Versand über das bestehende Microsoft 365
per Graph `sendMail`. Absender ist das bestehende Postfach `news@bhyo.de`
(Konto in Entra vorhanden). Entra-App mit Anwendungsberechtigung `Mail.Send`,
per `ApplicationAccessPolicy` (oder RBAC for Applications) auf `news@`
beschränkt. Client-Credentials mit Secret, keine Redirect-URI. Tenant-ID,
Client-ID und Secret trägt Eric als Worker-Secrets ein. Die Einrichtung in
M365 übernimmt die bhyo-IT; Eric meldet, wenn sie fertig ist. Kein neuer
Anbieter, keine DNS-Änderung. **Begründung:** Empfänger sind ausschließlich
`@bhyo.de`-Postfächer. Der Nebenbefund „M365-DKIM fehlt" ist an die IT
gegangen. Grundlage und Anbietervergleich: `docs/vorbereitung/ap29-mail.md`.

**Folgen für den Bau (AP2.9, Entwurf parallel, ohne Secrets):** `lib/mail/`
mit Graph-Adapter (Token per client_credentials, `sendMail` mit
`saveToSentItems=false`), Absender als Konfiguration `MAIL_ABSENDER`
(news@bhyo.de), eine Schreibstelle, Protokoll-Ereignis ohne Inhalt,
Probemodus `MAIL_MODUS=protokoll` als Standard (nur loggen, nicht senden),
Tests mit Mock, Logs ohne Token oder Secret (E73). Dazu ein Bericht zu den
Roundup-Weggabelungen (Uhrzeit, Wochenende, welche Zähler, Definition „nur
bei Neuem", Abmeldung, Link-Ziel, Verhalten bei Graph-Fehlern, Erkennen des
Secret-Ablaufs) mit Empfehlung je Punkt, und `docs/betrieb/m365-mail.md` als
Anleitung für die IT samt Namen der Worker-Secrets.

## 49. E75 Unbefristete Angebote und Bedarfe (`zeitraum_bis` NULL), 09.10.2026

**Entschieden (Eric 09.10.2026):** `zeitraum_bis NULL` bedeutet unbefristet,
für `biomassestrom` und `output_bedarf` gleichermaßen; CHECK
`zeitraum_bis IS NULL OR zeitraum_bis >= zeitraum_von`. Ein unbefristeter
Datensatz zählt in jedem Jahr ab seinem Beginn (Jahresfilter im Register,
Auswertung). Anzeige „ab MM/JJJJ, unbefristet". Export-Zelle „unbefristet"
(E24: keine leere Zelle, die etwas anderes bedeuten könnte). Import nur
ausdrücklich: die Werte „unbefristet", „offen" oder „unbegrenzt" in
„Zeitraum bis" oder der Lauf-Standard „unbefristet"; eine leere Zelle bleibt
Lauf-Zeitraum, keine stille Unbefristung. `validiereVergaben` prüft bei
offenem Ende nur gegen den Beginn. Alles Weitere wie in
`docs/vorbereitung/zeitraum-bis.md` Abschnitt 3 empfohlen.

**Umsetzung in zwei PRs:**
- **E75a Modell + Verfügbarkeit:** Migration (NOT NULL fallen lassen, CHECK
  ergänzen, additiv mit erstem Verbraucher, E21). Zuerst `verfuegbarkeit.ts`,
  `fenster.ts`, `vergabe-fenster.ts` mit Rot-Nachweis „verfügbar trotz
  Vergabe" bei `bis = NULL` (der Fallback `vergebenBis ?? zeitraumBis` wird
  NULL und blendet laufende Vergaben aus); dann Jahresfilter (`register.ts`)
  und Auswertung. Wegwerf-DB-Probe für CHECK und Jahresfilter mit NULL.
- **E75b Formular, Import, Anzeige:** Kästchen „unbefristet" im Formular,
  Import (Werte + Lauf-Standard), Anzeige Grid/Tabelle/Detail, Export,
  Vollständigkeit; Screenshots hell/dunkel.
