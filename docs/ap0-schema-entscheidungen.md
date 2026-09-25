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

## Noch offen – nicht raten

Qualitäts-Ableitungsmatrix A–D und Gültigkeitsdauern je Beleg-Typ sind seit
31.08.2026 verbindlich (siehe Abschnitt 3). Weiterhin offen: Teilscore-Mapping der
Bereitschaftsstufen – Geschäftsentscheidung, wird von Eric entschieden, nicht im
Code festgelegt.
