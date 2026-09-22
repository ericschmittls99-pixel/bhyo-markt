# AP1j — Verfügbarkeit, Vergabe und Zeitbezug der Auswertung

Handoff für das Verfügbarkeits-/Vergabe-Modell und den KPI-Zeitbezug.
Beschlossen im Dialog mit Eric am 21.09.2026 (Punkt E aus AP1i PR 7 plus
Erweiterungen). Dieses Dokument ist die verbindliche Fachreferenz für die
PRs ① – ⑤ unten.

## Ausgangsproblem

Alle KPI-Kacheln und Module der auswertung. summieren bisher zeitraumlos
über alle gefilterten Belege: Ein 2025 ausgelaufener Beleg zählt genauso
wie ein laufender Vertrag, und die Mengen-KPI (t atro/a) widerspricht der
Jahresscheibe des Moduls „verfügbarer feedstock je jahr.". Außerdem fehlt
die Marktdimension: Ströme, die an Dritte vergeben sind (z. B. verlorene
Ausschreibung), sind von freien Strömen nicht unterscheidbar.

## Datenmodell

### Bestehend (unverändert)

`zeitraum_von` / `zeitraum_bis` am `biomassestrom` und `output_bedarf`
sind der **Verfügbarkeitszeitraum**: Wann fällt die Biomasse physisch an
bzw. wann besteht der Bedarf? Monatsgenau, beide Pflicht.

### Neu: Tabelle `vergabe_zeitraum` (0..n je Strom)

Ein Abschnitt innerhalb des Verfügbarkeitszeitraums, in dem der Strom
vergeben ist. Beide Stromarten nutzen dieselbe Tabelle — genau ein
Elternbezug ist gesetzt (CHECK).

| Spalte | Typ | Bedeutung |
| --- | --- | --- |
| `id` | uuid PK | |
| `biomassestrom_id` | uuid FK, nullable | genau eins von beiden |
| `output_bedarf_id` | uuid FK, nullable | genau eins von beiden |
| `vergeben_von` | date, nullable | leer = ab Verfügbarkeitsbeginn |
| `vergeben_bis` | date, nullable | leer = unbefristet (bis Verfügbarkeitsende) |
| `vergeben_an` | text, nullable | Empfänger, Freitext |
| `an_bhyo` | boolean, default false | Vergabe an bhyo (gewonnene Ausschreibung) |

CHECK: mindestens eines von `vergeben_von` / `vergeben_bis` ist gesetzt —
**eine Zeile ganz ohne Datum ist keine Vergabe** (Eric: „wenn vergeben ab
und bis leer ist, dann ist es verfügbar"). Den Fall „vergeben, Zeitraum
völlig unbekannt" gibt es bewusst nicht; wer ihn erfassen will, setzt
vergeben-von auf den Erfassungsmonat und begründet es am Beleg.

### Neu: `reserviert_bhyo` (boolean, default false, beide Stromtabellen)

Weiche Markierung **ohne** Zeitraum: Die Kommune hat verfügbare Biomasse,
bhyo nimmt sie noch nicht ab (Projekt steht noch nicht), sie gilt aber
als reserviert. Unabhängig von den Vergabezeiträumen.

### Neu: `reserviert_seit` (date, nullable, beide Stromtabellen — Migration 0010)

Eine Reservierung ist eine Zusage mit Halbwertszeit; ein reines Häkchen
veraltet lautlos (Review 22.09.2026). Deshalb ein Datumsstempel:

- Wird beim **Setzen** der Checkbox automatisch gefüllt, bleibt beim
  Editieren stehen (kein Neustempeln — sonst verjüngt jedes Speichern die
  Zusage), wird beim Abwählen genullt. `null` = nicht reserviert.
- Anzeige: „reserviert (bhyo), seit MM/JJJJ".
- **Veraltung läuft über die Verifikations-Fälligkeit (PR ⑤), nicht über
  eine eigene Schwelle**: 12 Monate sind die Gültigkeitsdauer des Typs
  „Reservierung" in derselben Tabelle wie die übrigen Beleg-Typen — ein
  Mechanismus, kein Sonderweg. Migration 0010 liefert nur Spalte und
  „seit"-Anzeige, keine Veraltungs-Optik; die kommt ausschließlich über
  die Fälligkeit in PR ⑤ (sonst zwei Wahrheiten darüber, wann eine
  Reservierung alt ist).

## Abgeleiteter Verfügbarkeitsstatus

Der Status wird **nie gespeichert, immer abgeleitet** (dasselbe Prinzip
wie Qualität A–D) — deterministisch aus heutigem Datum, den beiden
Zeiträumen und der Checkbox. Prüfreihenfolge, die erste zutreffende Regel
gewinnt; jeder Beleg hat damit genau einen Tag:

1. **abgelaufen.** — heute > verfügbar-bis
2. **noch nicht verfügbar.** — heute < verfügbar-ab
3. **vergeben (extern).** / **vergeben (bhyo).** — heute liegt in einem
   Vergabezeitraum; dessen `an_bhyo` entscheidet die Variante
4. **reserviert (bhyo).** — `reserviert_bhyo` gesetzt
5. **verfügbar.** — sonst

„Verfügbar" ist nie automatisch, sondern immer das Ergebnis dieser
Hierarchie: Nach dem Vergabe-Ende fällt der Strom auf den Zustand zurück,
der dann gilt (verfügbar, oder abgelaufen, oder reserviert …).

Nebentag-Regel (präzisiert 22.09.2026): `reserviert_bhyo` erzeugt
**immer** den Nebentag als kleinen **Stempel mit der Bildmarke** (nicht als
große Pille — Review 22.09.2026, passt in dieselbe Zeile wie die
Verfügbarkeits-Pille; Tooltip „Für bhyo reserviert"), sobald es
nicht selbst der Haupttag ist — nicht nur bei aktiver externer Vergabe.
Regeln 1–3 bestimmen den Haupttag. Test: Strom mit Reservierung +
Verfügbarkeit ab 2028, heute 2026 → Haupttag „noch nicht verfügbar.",
Nebentag „reserviert (bhyo).".

### Label-Sätze je Stromart (Beschluss 22.09.2026, Umsetzung PR ③)

Dieselbe Hierarchie und dasselbe Datenmodell für beide Stromarten, aber
zwei Label-Sätze, gesteuert über `art`: Ein „vergebener" Output-Bedarf
wird in Wirklichkeit bereits von jemand anderem **gedeckt** — die
Feedstock-Formulierung läse sich falsch herum, als hätte bhyo etwas
weggegeben.

| Regel | Feedstock | Output |
| --- | --- | --- |
| 3 extern | vergeben (extern). | gedeckt (extern). |
| 3 bhyo | vergeben (bhyo). | gedeckt (bhyo). |
| 4 | reserviert (bhyo). | reserviert (bhyo). |
| 5 | verfügbar. | offen. |

Regeln 1–2 (abgelaufen., noch nicht verfügbar.) sind für beide Arten
gleich. Reine Beschriftung — Enum-Werte, Ableitung und Persistenz bleiben
identisch.

### Konvention offener Enden

- vergeben-von leer → Vergabe gilt ab Verfügbarkeitsbeginn
  („vergeben bis 06/2028" = alles bis dahin weg, danach frei)
- vergeben-bis leer → unbefristet vergeben (zulässig)
- beide leer → keine Vergabe (Zeile wird nicht gespeichert)

Für Hierarchie, Überlappungsprüfung und Rechnung werden leere Enden
intern durch Verfügbarkeitsbeginn/-ende ersetzt — danach ist jeder Monat
wieder exakt einmal zugeordnet.

Klarstellung (Review 22.09.2026): „unbefristet" heißt immer **bis zum
Verfügbarkeitsende** — `zeitraum_bis` ist Pflichtfeld, ein beidseitig
offener Fall existiert im Modell nicht (zusätzlich abgesichert durch den
CHECK „mindestens ein Datum"). Nach dem Verfügbarkeitsende greift ohnehin
Regel 1 (abgelaufen); ein unbefristet vergebener Strom verschwindet also
nicht aus allen künftigen Jahren, sondern genau bis zu seinem Ende.

### Validierung (Formular)

- vergeben-von ≤ vergeben-bis (sofern beide gesetzt)
- Vergabezeiträume liegen vollständig im Verfügbarkeitszeitraum
- Vergabezeiträume untereinander überlappungsfrei; höchstens einer darf
  ein offenes Ende in dieselbe Richtung haben
- Leerzeilen (beide Daten leer) werden beim Speichern nicht angelegt

## Monatsscharfe Mengenrechnung

Mengen sind Jahresraten (t atro/a bzw. Bedarfsrate). Neu wird
**monatsscharf mit Saisonalität** gerechnet:

- Jeder Monat im Betrachtungsfenster ist entweder **frei** oder
  **vergeben** (durch die Zeiträume eindeutig, keine Doppelzählung).
- Wert eines Jahres = Rate × Σ(Saisonanteile der zählenden Monate).
  Ein Beleg ab 07/2026 zählt 2026 also nicht voll, sondern mit den
  Saisonanteilen Jul–Dez.
- Belege ohne Saisonprofil rechnen mit Gleichverteilung (n Monate ÷ 12).
- Gilt identisch für Output-Bedarfe.

Ein Strom kann im selben Fenster teils vergeben, teils frei sein
(verfügbar 2026–2035, vergeben bis 06/2028, Fenster 2026–2030): Die
Monate bis 06/2028 zählen zur vergebenen Menge, ab 07/2028 zur freien.

## auswertung.: Zeitbezug und Filter

- **Jahr-Filter**: Jahre an-/abwählbar.
- **Switch Einzeljahr ↔ Zeitraum**: Einzeljahr (Default: aktuelles Jahr)
  zeigt genau eine Jahresscheibe; Zeitraum rechnet über die gewählten
  Jahre.
- **Switch ø pro Jahr ↔ Summe im Zeitraum**: Durchschnitt (t/a, = Mittel
  der Jahresbalken im Fenster) oder Kumulation (t im Fenster). Beim
  Einzeljahr sind beide identisch.
- **Status-Filter**: verfügbar / vergeben (extern) / vergeben (bhyo) /
  reserviert (bhyo) / noch nicht verfügbar / abgelaufen.
  **Ohne Vorauswahl** (Nachtrag 22.09.2026 — der frühere Default „alles
  außer abgelaufen" ist gestrichen): Bezugsjahr (E18) und monatsscharfe
  Rechnung (E19) entscheiden bereits, was zählt — ein Beleg außerhalb
  des Bezugsjahres fällt mit 0 Monatsanteilen heraus. Zwei Mechanismen
  für dieselbe Aufgabe, einer davon unsichtbar, wären einer zu viel.
  Der Status-Filter bleibt manuelles Werkzeug, nicht Default.
- Offene Beobachtung, **keine Entscheidung** (22.09.2026): Ein Beleg mit
  Verfügbarkeit bis 06/2026 ist heute „abgelaufen", trägt aber für
  Bezugsjahr 2026 seine Jan–Jun-Anteile bei. Rechnerisch korrekt, für
  eine vorausschauende Bewertung möglicherweise zu viel. Falls das mit
  echten Daten stört: „ab Monat"-Bezug innerhalb des Bezugsjahres, kein
  Status-Vorfilter. Erst beobachten.
- Der Status-Filter wirkt in auswertung. **fensterbezogen**, nicht auf
  heute: „verfügbar" + Fenster ab 07/2028 zeigt einen bis 06/2028
  vergebenen Strom mit seiner freien Menge; im Fenster 2026–2027
  erscheint er nur unter „vergeben (extern)". Übergreifende Fenster
  zeigen ihn anteilig in beiden Kategorien.
- Alle KPIs und Module (auch Preis/Potenzial: Preis × fensterbezogene
  Menge) nutzen dieselbe Fenster-Menge.
- **E16-Deckel** (Review 22.09.2026): Die Jahresachse endet bei
  min(spätestes Zeitraumende, aktuelles Jahr + 10), Überlauf an der
  letzten Säule markieren („+ bis JJJJ"). Grund: `zeitraum_bis` ist
  Pflichtfeld ohne „unbefristet"-Option, Erfasser werden für dauerhafte
  Ströme (Kläranlage, Grünschnitt) Fernjahre eintragen — eine einzelne
  2099-Eingabe erzeugt sonst 74 Säulen. Test: Beleg bis 2099 → Achse
  endet bei aktuellem Jahr + 10, Überlauf-Marker vorhanden. Umsetzung
  in PR ④.

In **ströme.** und **karte.** (kein Jahresfenster) wirkt der
Status-Filter auf heute — deckungsgleich mit der Pille am Beleg. Der Tag
ist dort in Grid-Karten, Tabelle, Detail und Karten-Panel sichtbar und
überall filterbar. Zwei Festlegungen für PR ③ (22.09.2026):

- Der Status-Filter startet **ohne Vorauswahl** (alle Status sichtbar) —
  wie überall: seit dem Nachtrag oben gilt das auch in auswertung.
- **Aggregierte Kartenmarker werden nicht nach Status eingefärbt** — die
  Mengen-Codierung (Größe) bleibt unverändert; der Status erscheint je
  Strom im Popover.
- **Exklusiv filtern** (Karten-Review 22.09.2026): In der Sicht „alle"
  blendet ein aktiver Cluster-Filter die Outputs vollständig aus, ein
  Gruppe-Filter spiegelbildlich die Feedstocks. Bisher wirkte cluster nur
  auf die eigene Art und alle Output-Marker (z. B. CO₂) blieben stehen —
  fühlte sich wie ein wirkungsloser Filter an.
- **Pool-Prinzip auch auf der Karte**: Facetten-Optionen aus dem
  UNGEFILTERTEN Pool (wie ströme., nicht wie bisher aus dem gefilterten);
  in der Sicht „alle" speisen BEIDE Arten die Optionslisten (bisher nur
  Feedstock). Die Legende zählt aus dem Pool — aktive Auswahl wird
  markiert, nicht auf 0 genullt — und der Kopf sagt
  „x von y Strömen" (ohne Pin-Zusatz, Review 22.09.2026; der Hinweis auf
  Ströme ohne Karten-Pin bleibt im Legenden-Text).
- **Regionsdarstellung**: Umrisse deutlicher; das Regions-Label wandert
  hinter die Marker (z-Index) — es überlappte die Orbs.
- **Grid-Karten ströme.**: Die Verfügbarkeits-Pille steht in der letzten
  Zeile VOR dem „Verfügbar …"-Datum.
- Das karte.-Detail (Sidebar) erhält mit PR ③ dieselben Props wie das
  Register-Detail: Verfügbarkeits-Pille und Sektion vergabe. inkl.
  „vergeben an" (in PR ② bewusst nur im Register verdrahtet).

## Beleg-ID sichtbar und suchbar (eigenes kleines Paket, 22.09.2026)

Jeder Beleg hat bereits eine UUID (`beleg.id`) — sie wird nutzbar
gemacht, kein Schema-Change:

- Detail (Popup/Sidebar): Beleg-ID unterhalb des Kopfes anzeigen,
  kopierbar (Monospace-Caption).
- Die ströme.-Suche matcht zusätzlich die Beleg-ID (Prefix reicht).

## Verifikations-Kopplung

Läuft die Verfügbarkeit oder ein Vergabezeitraum ab, wird der Beleg
verifikationsfällig: Fälligkeit = das frühere von bisheriger
Verifikationsfrist und Ablaufdatum (verfügbar-bis bzw. vergeben-bis).
Zweck: Beim Freiwerden nachfassen.

Zusätzlich (Review 22.09.2026): **Reservierungen** laufen über denselben
Mechanismus — der Typ „Reservierung" bekommt 12 Monate Gültigkeitsdauer
(ab `reserviert_seit`) in derselben Tabelle wie die übrigen Beleg-Typen.
Aus der Veraltet-Optik wird damit ein Nachfass-Prozess.

## Score-Spezifikation (Notiz für den Rechenkern, hier nicht implementieren)

Die fünf Status sind eine UI-Aussage. Für die Bewertung zählen **drei
getrennte, jeweils erklärbare Größen** — keine Gewichtungsfaktoren vor
echten Daten (Review 22.09.2026, Vorzeichen-Argument analog E14:
„vergeben" ist je nach Gegenpartei das Beste oder das Schlechteste):

- Mengenpotenzial = gesichert + frei (fremdvergeben zählt nicht mit)
- Sicherungsgrad = gesichert / (gesichert + frei), 0–1
- Wettbewerbsdruck = fremdvergeben / (gesichert + frei + fremdvergeben), 0–1

mit gesichert = vergeben (bhyo) + reserviert (bhyo), frei = verfügbar /
noch nicht verfügbar, fremdvergeben = vergeben (extern); jeweils in
t atro/a und €/a. Fremdvergebenes ist so Mengenabzug **und** Warnsignal,
ohne doppelt gezählt zu werden. Die Gewichtungsfrage stellt sich erst bei
der Gesamtscore-Aggregation — dort als sichtbare, begründete Entscheidung.

## Backlog (bewusst nicht jetzt)

- **Optimistic Locking für das Stromformular**: `updated_at` als
  Hidden-Field mitschicken, Server vergleicht, bei Abweichung Fehler
  „wurde zwischenzeitlich geändert, bitte neu laden". Begründung: Das
  Ersetz-Modell der Vergabezeilen löscht bei parallelem Edit fremde
  Zeilen spurlos — qualitativ mehr als das Feld-Überschreiben des
  übrigen Formulars. Umsetzen, sobald Mehrbenutzerbetrieb real wird.
- **Materialart-Taxonomie als Admin-Pflege** (Beschluss 22.09.2026): Ab
  der dritten Stammdaten-Migration nach dem Muster von 0008/0011 gehört
  die Materialart-Pflege in eine Admin-Oberfläche im Tool statt in die
  Migrationskette. Nicht frei editierbar — die Taxonomie steuert die
  Cluster-Zuordnung und später den Eignungsscore.

## Handoff-Delta zu F5 (Filter vs. Erfassung, 22.09.2026)

Facetten-Filter blenden Optionen mit Anzahl 0 aus. Die
Materialart-Combobox im **Erfassungsformular** zeigt dagegen IMMER die
vollständige Taxonomie, auch ungenutzte Arten — sonst kann man sie nie
erfassen. Anlass: Migration 0011 fügt vier Materialarten hinzu, die in
Production zunächst leer sind; als Filteroptionen wären sie Rauschen,
als Erfassungsoptionen sind sie notwendig.

## Sonstiges

- CSV-Export nimmt die neuen Felder mit.
- design-system.md wird um Status-Pillen und die zwei Switches ergänzt.
- „vergeben an" ist Freitext; die Begründungs-/Historienpflicht beim
  Bearbeiten gilt unverändert.

## PR-Schnitt

| PR | Inhalt |
| --- | --- |
| ① | Migration: `vergabe_zeitraum`, `reserviert_bhyo` (#34, gemerged) |
| ② | Formular/Detail: Zeitraum-Liste mit „+", Validierung, Status-Pille (#35) |
| 0010 | Migration: `reserviert_seit` (eigener PR, kein Feature-Code) |
| ②b | Stempel-Logik + Anzeige „reserviert (bhyo), seit MM/JJJJ" (nach 0010) |
| ③ | ströme./karte.: Tag + Status-Filter (heute-bezogen); dabei Rename `heute` → `stichtag` in `leiteVerfuegbarkeitAb` |
| ④ | auswertung.: monatsscharfe Rechnung, Jahr-Filter, beide Switches, fensterbezogener Status-Filter, E16-Deckel |
| ⑤ | Verifikations-Kopplung inkl. Reservierungs-Gültigkeit (12 Monate) |

Guardrail (22.09.2026): Der Preview-Deploy wendet Migrationen **vor** dem
Merge auf die Preview-DB an. Eine dort angewendete Migration verpflichtet
zum zeitnahen Merge oder zum expliziten Rollback — sonst trägt die
Preview-DB einen Zustand, der in der Migrationskette von main nicht
existiert, und der nächste Migrations-PR baut auf etwas auf, das niemand
mehr rekonstruieren kann.

## E21 — Produktions-Schema-Guardrail (22.09.2026)

**Regel: Eine Migration wird IMMER angewendet, BEVOR der Code deployt
wird, der sie braucht — nie danach.** Additive, nullable Migrationen
vertragen sich mit altem Code; umgekehrt gilt das nicht. E21 ist das
Spiegelbild des Preview-Guardrails oben: dort muss das Schema dem Merge
vorauslaufen, hier darf der Code dem Schema nie vorauslaufen.

Absicherung — die Freigabe läuft über einen manuell ausgelösten
Migrationsjob, der blockierende Vorab-Check verhindert das Vergessen
(Required Reviewers stehen im GitHub-Free-Plan für private Repos nicht
zur Verfügung):

- **`schema-gate` im Deploy-Workflow (tragende Prüfung):** Bei jedem
  main-Push liest der erste Job mit `DATABASE_URL_PRODUCTION` (read-only
  Query auf `drizzle.__drizzle_migrations`) den angewendeten Stand und
  vergleicht ihn mit dem Journal im Build. Liegt die DB zurück, schlägt
  er fehl („Migration 00XX ausstehend — zuerst Workflow Migrate
  Production ausführen") und der Code-Deploy läuft NICHT. Der alte
  Worker läuft mit dem alten Schema weiter — das ist der funktionierende
  Zustand, exakt umgekehrt zum Vorfall vom 22.09.
- **Workflow `Migrate Production` (`migrate-production.yml`), nur
  manuell:** Pflicht-Eingabe „bestaetigung" muss wörtlich `production`
  lauten; erster Schritt ist die Host-Prüfung (DATABASE_URL muss auf
  `ep-purple-glade-b2tra1g7` zeigen, siehe Tabelle unten); dann
  `pnpm --filter @bhyo/db migrate`, Ausgabe des angewendeten Stands,
  abschließend automatisches Auslösen des Deploy-Workflows für main.
  Das manuelle Auslösen ist die ausdrückliche Freigabe aus der
  Leitplanke „Produktion braucht Freigabe".
- **`/api/health`** vergleicht die im Build enthaltenen Migrationen mit
  den in der DB angewendeten und antwortet bei Rückstand mit HTTP 503
  und `schema: behind`; die Namen der fehlenden Migrationen erscheinen
  in Production nur für Access-authentifizierte Aufrufer. Der
  Health-Check nach dem Rollout ist nur zusätzliche Bestätigung — die
  tragende Prüfung ist das schema-gate; fehlt das Access-Service-Token,
  wird er ohne Lücke übersprungen.

**Ablauf im Alltag:**

- Merge MIT Migration → Deploy bricht im schema-gate mit „Migration
  ausstehend" ab → Actions → „Migrate Production" ausführen,
  `production` eintippen → Migration läuft, der Deploy folgt
  automatisch.
- Merge OHNE Migration → schema-gate grün → Deploy wie bisher.
- „Produktions-DB nicht erreichbar" ist eine EIGENE Fehlerklasse (Exit 2,
  eigene Meldung nach 3 Versuchen mit Wartezeit gegen den Neon-Kaltstart)
  und bedeutet NICHT „Migration ausstehend" — Migrate Production hilft
  dann nicht, sondern Neustart des Laufs bzw. Neon-Status prüfen.
- Notausgang (Break-Glass): Blockiert ein defektes Gate seine eigene
  Reparatur, lässt sich der Deploy-Workflow manuell mit dem Eingabefeld
  `gate_umgehen` = wörtlich `ja` starten — nur auf dem dispatch-Pfad,
  nie bei einem Push, mit lauter Warnung im Log. Danach Schema-Stand von
  Hand prüfen und den Gate-Defekt sofort beheben.

**Neon-Endpoints (vor JEDER manuellen Migration den Host der
DATABASE_URL gegen diese Tabelle prüfen):**

| Umgebung | Hyperdrive | Neon-Host |
| --- | --- | --- |
| Production | `bhyo-markt-db` | `ep-purple-glade-b2tra1g7.c-6.eu-central-1.aws.neon.tech` |
| Preview | `bhyo-markt-db-preview` | `ep-rough-term-b29rvd6c.c-6.eu-central-1.aws.neon.tech` |

Post-Mortem: Am 22.09.2026 waren ströme./karte./auswertung. in
Production mehrere Stunden ohne Funktion (Merge von PR #35 um 09:47 UTC
bis zur Migration am Abend), weil 0009/0010 nie auf der Produktions-DB
lagen und der erste Behebungsversuch den Snapshot- statt den
Production-Branch migrierte. Künftig verhindert durch die Regel
Schema-vor-Code samt Workflow-Erzwingung, den Schema-Check in
/api/health und die Endpoint-Tabelle oben.
