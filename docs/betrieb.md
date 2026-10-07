# Betrieb — Einstellungen außerhalb des Repos, die der Code voraussetzt

Hier stehen Konfigurationen in Cloudflare und Neon, die nicht im Repo
leben, von denen der Code aber abhängt. Jeder Eintrag nennt Grund, Datum
und den Wächter, der die Einstellung im Deploy prüft. Was keinen Wächter
hat, steht als solches dabei.

## Hyperdrive: Abfrage-Cache aus (Production-Fehler, 29.09.2026)

**Einstellung:** `caching.disabled = true` an beiden Hyperdrive-Configs:

| Umgebung   | Hyperdrive-Config                 | ID                                 |
|------------|-----------------------------------|------------------------------------|
| Production | `bhyo-markt-db`                   | `2a873aa18f654dc4897b145cb24db7d7` |
| Preview    | `bhyo-markt-db-preview`           | `7bf0712cc8224c32a061ef0abea561f9` |

**Grund.** Hyperdrive cacht standardmäßig Ergebnisse lesender Abfragen
(`caching.disabled = false`, Voreinstellung beim Anlegen). Für dieses
Werkzeug ist das falsch: Jede Server-Aktion liest den aktuellen Stand und
schreibt dann. Mit Cache las die Benutzerverwaltung nach dem Anlegen einen
veralteten Stand — der neue Eintrag fehlte in der sofort neu gerenderten
Liste, und ein zweiter Versuch mit derselben Adresse ging an der
Vorprüfung vorbei ins INSERT: Unique-Verletzung (SQLSTATE 23505), beim
Nutzer ein 500er. Beobachtet auf Production am 28./29.09.2026 („neuer
Eintrag erst nach dem nächsten Seitenaufruf da").

**Umstellung** per `wrangler hyperdrive update <id> --caching-disabled true`
(Eric, OAuth-Login, PR #116):

- Preview: 29.09.2026 08:47 UTC (`modified_on` 08:47:46Z)
- Production: 29.09.2026 08:51 UTC (`modified_on` 08:51:12Z), Freigabe Eric
  nach dem Preview-Beleg

**Messung auf der Preview** (Benutzer anlegen in einstellungen., Code-Stand
12d60f2 ohne 23505-Behandlung, Screenshots in
`docs/screenshots/hyperdrive-cache/`):

| | Anlegen, sofort Liste lesen | Gleiche Adresse sofort noch einmal |
|---|---|---|
| Cache an (vorher) | Formular zurückgesetzt, **Zeile fehlt** | **Fehlerseite** „etwas ist schiefgelaufen" (Kennung 1871839046), Unique-Verletzung ungefangen |
| Cache aus (nachher) | **Zeile sofort da** | Vorprüfung greift: „Diese Adresse ist bereits eingetragen — dort die Rolle ändern." |

Damit ist der Cache als Ursache der Beobachtung „neuer Eintrag erst nach
dem nächsten Seitenaufruf da" belegt.

**Wächter.** Schritt „Hyperdrive-Waechter (Abfrage-Cache aus)" im Job
`deploy` von `.github/workflows/deploy.yml`: liest die Konfiguration der
Zielumgebung (PR → Preview, main → Production) über die Cloudflare-API
mit dem vorhandenen Deploy-Token und bricht ab, wenn `caching.disabled`
nicht `true` ist oder die Konfiguration nicht lesbar ist. Die geprüfte ID
muss in `apps/web/wrangler.jsonc` stehen, damit Wächter und Bindung nicht
auseinanderlaufen. Der Token braucht dafür das Recht **Hyperdrive: Read**
(Account-Ebene) — ohne das Recht ist der Wächter rot, nicht grün.

**Code-Seite.** Die Datenbank-Constraints bleiben die Wahrheit über
Eindeutigkeit. Schreibpfade, die vor dem INSERT/UPDATE per SELECT auf
Eindeutigkeit prüfen, fangen 23505 ab (`apps/web/lib/db-fehler.ts`) und
melden klar. Bestandsaufnahme 29.09.2026 aller Schreibpfade gegen
Unique-Constraints:

| Pfad | Unique-Constraint | Vorprüfung per SELECT? | Behandlung |
|------|-------------------|------------------------|------------|
| `lib/benutzer-actions.ts` `benutzerAnlegen` | `benutzer.email` (PK) | ja (`pruefeNeuanlage`) | 23505 → „Diese Adresse ist bereits eingetragen …" (Test) |
| `lib/beleg-server.ts` `erstelleBeleg` | `beleg.beleg_nr` | nein — Nummer aus DB-Sequenz (E29) | keine nötig |
| `lib/bewertung.ts` `naechsteLaufId` | `analyse_lauf.lauf_id`, `lauf_nummernkreis.jahr` | nein — Zähler in Transaktion mit `FOR UPDATE`, `ON CONFLICT DO NOTHING` | keine nötig |
| `lib/sperre-actions.ts` `stromZuweisen` | `strom_zuweisung_*_nutzer_uidx` | nein — `ON CONFLICT DO NOTHING` | `RETURNING` leer → „… ist bereits zugewiesen.", kein Protokolleintrag (Test); vorher stiller Erfolg mit falschem Protokoll |
| `app/api/materialarten` POST | `materialart.code` (PK) | — | Route am 29.09.2026 entfernt (AP2.2 PR a, kein Aufrufer) |
| `app/api/akteure` POST | keine Unique-Constraint auf `akteur` | — | — |
| `akteur_interesse (akteur_id, region_id)` | unique | kein Schreibpfad im Code | — |

Die Prüfungen auf den „letzten aktiven Admin" (`rolleSetzen`,
`aktivSetzen`) sind keine Eindeutigkeitsprüfungen, lesen aber ebenfalls
den aktuellen Stand vor dem Schreiben — auch sie sind auf einen Cache-
freien Lesepfad angewiesen. Das ist der zweite Grund, den Cache ganz
abzuschalten statt einzelne Abfragen zu markieren.

## GitHub-Environments: Aufteilung und Regel „nur main" (Härtung, 30.09.2026)

| Environment | Secrets (nur Namen, Zielstand nach Schritt 6 der Härtung) | Nutzer |
|---|---|---|
| `production` | DATABASE_URL_PRODUCTION | migrate-production.yml (schreibend, nur von main; ziel-wache davor) |
| `production-lesend` | DATABASE_URL_PRODUCTION_LESEND (Rolle bhyo_leser, nur SELECT) | lese-diagnose.yml (manuell), Job lese-diagnose in deploy.yml (nach jedem main-Deploy), job-wache.yml (mehrfach täglich, AP2.4 PR b / Betrieb 04.10.2026) |
| `neon-restore` | NEON_API_KEY, NEON_PROJECT_ID, NEON_PARENT_BRANCH_ID | restore-woechentlich.yml (montags 03:41 UTC und manuell) |

**Regel „nur main" auf allen dreien** (custom branch policy `main`, per
API gesetzt 30.09.2026; Rot-Nachweis: Dispatch von einem Wegwerf-Branch
ohne Runner abgewiesen). **Folge:** Production-Messungen laufen nur von
main; eine neue Messung wird erst gemergt (nur lesend), dann gestartet. Ein
Diagnose-Workflow ohne dauerhafte Wirkung wird nicht angelegt (Entscheidung
Eric). Wer Schreibrechte am Repo hat, kommt über einen Merge nach main an
die Secrets — das ist die bewusst verbleibende Grenze; Merges laufen über
`scripts/merge-sicher.sh` nach Freigabe.

**Neon-Key:** `NEON_API_KEY` in neon-restore ist ein Organisations-Key,
projektbezogen auf das Projekt bhyogenics (Eric, 30.09.2026). Der frühere
persönliche Account-Key wird nach dem grünen Nachweislauf von Eric
widerrufen. Was der Key können muss, belegt der
Nachweislauf von restore-woechentlich (Branch anlegen, Endpoints und Rollen
lesen, Connection-URI, Branch löschen). `RESTORE_DATABASE_URL` ist mit
restore-test.yml entfallen. `packages/db/src/workflow-wachen.test.ts` hält
die Zuordnung Workflow → Environment → Secret fest.

## Täglicher Verifikations-Job (Cloudflare Cron) und Job-Wache (AP2.4 PR b, 01.10.2026)

**Im Repo, keine Einstellung außerhalb:** Die Cron-Trigger stehen in
`apps/web/wrangler.jsonc` (`triggers.crons`: 03:00 und 04:00 UTC,
inheritable — gilt auch für `env.preview`) und werden mit jedem
`wrangler deploy` gesetzt. Der Worker-Einstieg ist `apps/web/worker.ts`
(OpenNext-Handler plus `scheduled`); der Job läuft nur um 05:00 Berlin
weiter, protokolliert sich in `job_lauf` und schreibt Hinweise in
`inbox_eintrag` (nur lib/inbox). Preview und Production laufen beide täglich
— die Preview gegen die Preview-DB.

**Beobachten:** Workers-Logs (Observability ist an) mit Präfix
`JOB verifikation`; in der Datenbank `job_lauf` (nur lesend über den
Leseweg; die JOB_LAUF-Zeile der Protokoll-Messung nennt Stichtag, Ergebnis,
Anzahl, gestartet_am, beendet_am und Dauer des letzten Laufs).
`job-wache.yml` (Environment production-lesend, nur main) läuft mehrfach
täglich (Cron 04:17, 06:43, 10:29, 15:11 UTC — krumme Minuten, weil GitHub
volle Stunden am stärksten verzögert; am 02./03.10.2026 kamen die geplanten
Läufe fünf bis sechs Stunden zu spät) und prüft bei **jedem** Lauf, dass für
den fälligen Stichtag ein Lauf mit ergebnis = ok steht: ab 05:30 Berlin heute,
davor gestern (`packages/db/src/job-wache-stichtag.ts`, reine Funktion mit
Tests über Sommer-/Winterzeit). Es gibt keinen Ausgang „prüft nicht" mehr;
nicht prüfbar (keine Verbindung) ist rot. Doppelläufe sind lesend und
harmlos. Rot = GitHub benachrichtigt per Mail (bei geplanten Läufen das
Konto des letzten Commits an der Workflow-Datei, bei manuellen Läufen den
Auslöser). Manuell mit Stichtag startbar (Rot-Nachweis).
`bhyo_leser` liest `job_lauf` über die Standardrechte von neondb_owner
(Leseweg STANDARDRECHTE: `bhyo_leser=r/neondb_owner` auf public) — kein
zusätzlicher GRANT nötig.

**Wenn die Wache rot ist:** erst den Lauf ansehen (ergebnis `fehler` mit
Fehlertext, oder gar kein Lauf → Cron nicht gefeuert / Worker-Fehler vor
dem Insert in den Logs). Ein Nachholen braucht keine Sonderaktion: der
nächste Lauf stellt zustandsbasiert zu, was fällig ist. Kein manuelles
Ausführen gegen Production ohne Freigabe.

## Kontaktpersonen, echtes Löschen und Backups (AP2.5 PR b, E57, 01.10.2026)

Kontaktpersonen werden **wirklich gelöscht** (DSGVO): die Zeile verschwindet,
Inbox-Hinweise zur Person gehen per CASCADE mit, Protokoll und Inbox tragen
nur die ID der Person (Namen werden erst bei der Anzeige aufgelöst). Der
`kontaktperson-check` im Deploy-CI prüft nach einem Probe-Löschen, dass der
Name in keiner Text- oder JSON-Spalte des Schemas mehr auffindbar ist.
Exporte werden nicht gespeichert (CSV und Druckansicht entstehen je Aufruf).

**Backups halten gelöschte Daten noch 30 Tage:** Der tägliche Backup-Job
(backup.yml) bewahrt Dumps 30 Tage im R2-Bucket auf; danach sind gelöschte
Personen auch dort nicht mehr enthalten. Eine Wiederherstellung aus einem
Backup innerhalb dieser Frist bringt gelöschte Personen zurück — vor einem
Restore ist das zu bedenken. Die Auskunft nach Art. 15 (Druckansicht je
Person, nur Admin) nennt diese Frist.

## Freigabe-Ablauf als ein Skript und Warteschlange statt Abbruch (Betriebs-PR, 05.10.2026)

Anlass: Am 05.10.2026 hatte eine Befehlskette mit Semikolon nach einem am
Skript gescheiterten Merge trotzdem migrate-production und einen Deploy
ausgelöst (beides wirkungslos, aber falsch). Außerdem brach `ready_for_review`
dreimal den Push-Lauf desselben Heads ab und hinterließ einen „cancelled"-Check,
an dem das Merge-Skript scheiterte.

**`scripts/freigabe.sh <pr> <head-sha> "<betreff>"`** (set -euo pipefail):
a) PR offen, Head = freigegebene SHA; ein abgebrochener Deploy-Lauf am Head
wird einmal neu gestartet und abgewartet; b) Merge über `merge-sicher.sh`
(MERGEABLE/CLEAN, grüne Checks, `--match-head-commit`); c) main steht auf dem
Squash-Commit; d) nur bei neuer Migrationsdatei im PR: migrate-production
starten, abwarten, Zählbeweis ausgeben; e) den Push-Deploy von main abwarten,
Jobs, Leseweg und Links ausgeben; bricht GitHub den Lauf ab (Job „cancelled",
z. B. kein Runner zugeteilt wie am 05.10.2026), wird er einmal neu gestartet,
wie in a); f) die in a) umgehängten gestapelten PRs angleichen: main (Squash)
hineinmergen, Patch-ID des PR-Diffs vorher (gegen den Basis-Baum, der dem
neuen main-Baum entsprechen muss) und nachher (`main...HEAD`) vergleichen;
gleich → pushen und neuen Head ausgeben, sonst melden und nicht pushen.
Jeder Fehlschlag bis einschließlich b) bricht sofort ab. Nach dem Merge
(Punkt ohne Wiederkehr) bricht nichts mehr ab: `merge-sicher.sh` merged ohne
`--delete-branch` und löscht Remote- und lokalen Branch anschließend nur
noch als Aufräumen mit Hinweis (am 06.10.2026 scheiterte gh am lokalen
Löschen eines in einem Worktree ausgecheckten Branches, und freigabe.sh
brach vor Migration und Deploy ab).

**Wächter-Tests** (`scripts/tests/freigabe-test.sh`, Schritt „freigabe-test"
im Job typen-und-tests): `gh` wird durch `scripts/tests/fake-gh.sh` ersetzt,
die den GitHub-Zustand aus Dateien beantwortet und den Squash-Merge echt in
einem lokalen Bare-Repo ausführt; freigabe.sh läuft unverändert in einem Klon.
Geprüft wird das Verhalten, nicht die Ausgabe allein: Neustarts werden in der
Aufrufliste gezählt, der Kind-Branch im Bare-Repo gemessen. Fälle: e) grün →
kein Neustart; von GitHub abgebrochen → genau ein Neustart (`rerun --failed`),
nach erneutem Abbruch kein zweiter, Abbruch; roter Job → kein Neustart;
roter Check am Head → kein Merge; Entwurf → Abbruch vor dem Umhängen (Befund
aus dem Probelauf mit #184: GitHub merged keinen Entwurf, (a) hatte den
Kind-PR schon umgehängt). f) gestapelter PR wird in a) umgehängt
(API-Aufruf), danach ist der neue Head ein Merge mit genau zwei Eltern (alter
Head, Squash) und Patch-ID vorher = nachher (unabhängig nachgerechnet);
Konflikt mechanisch zur Branch-Seite aufgelöst und gemeldet; abweichende
Patch-ID oder Squash-Baum ≠ Basis-Baum → kein Push, Head bleibt. Rot-Nachweis
06.10.2026: gegen die Skripte von main vor diesem PR
(`FREIGABE_SKRIPT_DIR=<alt>`) 17 von 47 Prüfungen rot, genau die neuen
Verhalten; gegen die neuen Skripte 47 grün. Läuft mit bash 3.2 (macOS) und 5
(CI), braucht `jq` und git ≥ 2.38 (`merge-tree --write-tree`).

**Warteschlange:** `deploy.yml` bricht nur noch überholte PR-Läufe ab
(`cancel-in-progress` nur bei `synchronize`); main-Deploys laufen nacheinander.
Das `schema-gate` wartet bis zu 20 Minuten auf die Production-Migration (alle
30 s), statt rot zu enden; nur „DB nicht erreichbar" bleibt sofort rot.
`migrate-production.yml` löst deshalb keinen zweiten Deploy mehr aus.

## Läufe-Wache, krumme Minuten, Label preview-migrieren, Migrations-Runner (Betriebs-PR 2, 05.10.2026)

- **Läufe-Wache:** `job-wache.yml` prüft zusätzlich über die GitHub-API (nur
  lesend, `actions: read`): letzter erfolgreicher Backup-Lauf höchstens 26 h,
  letzter erfolgreicher Restore-Test höchstens 8 Tage alt, sonst rot
  (`packages/db/src/laeufe-wache.ts`, reine Prüfung mit Test). Rot-Nachweis:
  Dispatch mit `restore_max_tage=0`.
- **Krumme Minuten:** Backup 02:23 UTC, Restore-Test montags 03:41 UTC —
  GitHub startet volle Stunden stark verzögert (05.10.2026: 02:00 lief 08:45).
- **Label `preview-migrieren`:** Der Schritt „Migrate Preview-DB" in `deploy.yml`
  läuft nur, wenn der PR das Label trägt (das Label löst den Lauf aus). Alle
  DB-Checks laufen ohne Label; ein PR mit neuer Migration ohne Label wird im
  Journal-Vergleich rot („Journal voraus"), bis er das Label bekommt. Damit
  migriert nur der nächste zu mergende PR die geteilte Preview.
- **Migrations-Runner:** `pnpm --filter @bhyo/db migrate` = `src/migrieren.ts`
  (drizzle-orm/postgres-js/migrator, gleiche Tabelle und Hashes wie drizzle-kit).
  NOTICE-Zeilen der Zählbeweise erscheinen als `NOTICE …`; ein Fehler endet mit
  Statement, Postgres-Code, Meldung, Detail und Exit 1 — `drizzle-kit migrate`
  verschluckte das.

## Hinweise zustandsbasiert abräumen (Betrieb, 05.10.2026)

Der tägliche Verifikations-Job räumt jeden offenen `verifikation_laeuft_ab`- und
`verifikation_abgelaufen`-Hinweis ab, dessen Bedingung zum Stichtag nicht mehr
gilt — abgeleitet aus `strom_verifikation(stichtag)` (Zustand und
`verifiziert_bis` müssen zum Hinweis passen), ohne Ereignisliste: fachliche
Änderung (in Prüfung), verschobene Frist, verworfener Strom. Idempotent, im
selben Lauf nach dem Zustellen (eine verschobene Frist liefert den neuen
Hinweis und räumt den alten). Gezählt in `job_lauf.abgeraeumt` (Migration 0041,
Leseweg-Zeile JOB_LAUF `letzte_abgeraeumt`). Job-Probe Fall 7 (a–e).
Messung vor der Regel (Preview, 05.10.2026): 30 offene Job-Hinweise, alle mit
gültiger Bedingung — kein Nachholbedarf im Bestand.

## Import-Roh-Uploads in R2 (AP2.7 PR b, 06.10.2026)

Der Roh-Upload eines Import-Laufs liegt im BELEGE-Bucket unter
`import/<env>/<lauf>/roh.<ext>` und kann Personen-Spalten enthalten (E67).
Die Zuordnung löscht ihn sofort nach dem Übernehmen der Zeilen; was liegen
bleibt (abgebrochener Lauf, Löschen gescheitert), räumt der Cron im
05:00-Berlin-Lauf nach dem Verifikations-Job weg
(`lib/jobs/import-aufraeumen.ts`, älter als 24 h, Log-Zeile
`JOB import-aufraeumen <env> {"gesehen","geloescht","fehler"}`). Die
bereinigte Kopie (ohne Personen-Spalten) liegt dauerhaft unter
`belege/<env>/import/<lauf>/bereinigt.csv` als Datei des Lauf-Belegs.

## Import-Zeilen: Aufbewahrung (AP2.7 PR c, 06.10.2026)

Zeilen abgeschlossener Import-Läufe (`import_zeile`, Zwischendaten) löscht der
05:00-Berlin-Lauf nach `import.zeilen_aufbewahrung_tage` Tagen (Parameter,
Startwert 30, einstellungen. → Parameter) ab `abgeschlossen_am`; nur Läufe
`ausgefuehrt` oder `zurueckgenommen`. Zähler und Protokoll bleiben am Lauf.
Log-Zeile `JOB import-zeilen <env> {"laeufe","zeilen"}` nach dem
Verifikations-Job (`lib/jobs/import-aufraeumen.ts`).

## PLZ-Gebiete lokal: Import-Workflow und Wegwerf-Postgres (E68 PR 1, 07.10.2026)

- **`import-plz.yml`** befüllt `plz_gebiet` und `plz_ort` (Migration 0048) aus
  yetzt/postleitzahlen 2026.02 (ODbL) und dem Schnitt mit den
  VG250-Gemeinden (dieselbe BKG-Lieferung wie `import-vg250.yml`). Nur
  manuell, Zielumgebung wörtlich bestätigen, Host-Prüfung, SHA-256 beider
  Quellen, Ersetzung in einer Transaktion, Sollwert 8.175 PLZ. Production
  nur nach Freigabe von Eric. Reihenfolge nach dem Merge: Label migriert
  die Preview → Workflow auf `preview` → Stichprobe „PLZ aus Pin" →
  später `production`. Bis der Import gelaufen ist, antworten
  `/api/geocode?lat&lon` und `/api/plz` mit 503 und Klartext.
- **Zielumgebung `wegwerf`:** PostGIS 18 als Service-Container im Runner,
  alle Migrationen auf leer, dann die echte Kette mit Messung (Dauer der
  ogr2ogr-Schritte, `PLZNACH` mit Größe beider Tabellen). Keine Secrets,
  nichts bleibt. Vor einem Preview-Lauf einmal `wegwerf` laufen lassen.
- **CI-Job `wegwerf-db`** (Deploy, vor `deploy`): Migrationen auf eine leere
  PostGIS, Staging-Fixture `packages/db/fixtures/plz-wegwerf-staging.sql`
  über `sql-datei`, Import ohne Sollwerte (`PLZ_SOLL_PRUEFEN=nein`),
  `plz-check` mit Fixture-Fällen (`PLZ_FIXTURE=ja`). Damit laufen
  DB-Tests der Entwürfe nicht mehr gegen die geteilte Preview. `sql-datei`
  weist Production-Hosts ab.
- **Speicher (Eric 07.10.2026):** Neon Free, harte Grenze laut Preisseite
  1 GB je Projekt. `lese-diagnose` druckt die Production-Größe (GROESSE),
  `import-check` im Deploy die Preview-Größe. Vor der Production-Migration
  von 0048: Wegwerf-Messung (PLZNACH, PLZVERGLEICH) vorlegen, Ziel deutlich
  unter 25 MB für `plz_gebiet` + `plz_ort`.
- **Neuer Stand der Quelle:** SHA-256 im Workflow, `PLZ_STICHTAG` und
  `SOLL_PLZ` in `packages/db/src/plz-import.ts` bewusst anpassen; den auf
  `wegwerf` gemessenen Gemeindewert als exaktes Soll eintragen.

## Adressdienst als Variable (E68 PR 2, 07.10.2026)

- `GEOCODE_URL` in `wrangler.jsonc` (Production und Preview), Standard
  `https://photon.komoot.io`. Nur https, ohne Schrägstrich am Ende; ein
  ungültiger Wert fällt auf Photon zurück. Nutzungsregeln (User-Agent mit
  Kontakt, eine Anfrage je Klick) gelten für jede Instanz.
- Migration 0049 (Enum `standort_genauigkeit`, drei Spalten mit Default)
  läuft über das Label; der Altbestand bleibt „unbekannt".
