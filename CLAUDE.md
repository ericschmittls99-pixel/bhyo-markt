# CLAUDE.md

Leitfaden für Claude Code in diesem Repository.

## Was das hier ist

Internes Marktdokumentations- und Analysewerkzeug für bhyo: eine Plattform, die
regionale Biomasse- und Outputströme dokumentiert, trackt und über eine
nachvollziehbare Logik zu einer Standort-Eignungsbewertung für dezentrale
H2/CO2-Anlagen verrechnet. Ergebnis eines Laufs ist ein PDF für die Kommune.

Nutzerkreis sind 5–10 interne Mitarbeitende. Es gibt **keinen** externen Zugang,
keine Selbstregistrierung, keine Mandantentrennung — Kommunen erhalten
ausschließlich das fertige PDF per E-Mail. Das ist eine bewusste
Architekturentscheidung, keine Lücke.

Das Werkzeug besteht aus zwei eigenständig nutzbaren Teilen: dem
Dokumentationsregister mit Karte und Auswertung (Teil 1) und dem darauf
aufbauenden Bewertungstool mit den Schritten a–h (Teil 2).

## Sprache und Benennung

- Kommunikation, Kommentare, Commit-Messages und UI-Texte auf **Deutsch**
- **Technische Bezeichner englisch** (`fetchUser`, `parseResponse`, `retryCount`)
- **Domänenbegriffe deutsch** — Tabellen, Spalten, Enum-Werte und Domänentypen
  folgen der Fachsprache: `biomassestrom`, `akteur`, `analyse_lauf`,
  `bereitschaft_stufe`. Das ist gesetzt und wird nicht eingedeutscht oder
  übersetzt.
- Enum-Werte und Spaltennamen in `snake_case`, **ohne Umlaute** (`in_pruefung`,
  `geprueft`, `absichtserklaerung`). Deutsche Anzeige-Labels („in Prüfung") leben
  ausschließlich im Frontend.

## Stack und Struktur

```
apps/web/              Next.js (App Router) auf Cloudflare Workers via OpenNext
packages/rechenkern/   reines TypeScript: Scoring, Baureihen-Sweep, Logistik
docs/                  Handoff- und Entscheidungsdokumente
```

- Laufzeit: Cloudflare Workers, Zugang über Cloudflare Access
- Datenbank: Neon PostgreSQL + PostGIS (EU Frankfurt), Zugriff über Hyperdrive
- ORM/Migrationen: Drizzle
- Dateien: Cloudflare R2 · PDF: Cloudflare Browser Rendering · KI: Anthropic API
- Paketmanager: pnpm, Workspace-Monorepo

## Leitplanken

Diese Punkte gelten ohne Ausnahme:

- **Keine Secrets im Repo.** Weder API-Token noch Verbindungsstrings, auch nicht
  in Beispieldateien. Secrets leben als Wrangler-Secrets und GitHub-Repo-Secrets.
  `.dev.vars` ist in `.gitignore` und bleibt es.
- **Keine manuellen Eingriffe in die Datenbank.** Schemaänderungen entstehen
  ausschließlich als Drizzle-Migration im Repo. Eine bereits angewendete
  Migration wird nie nachträglich editiert — es kommt eine neue dazu.
- **Produktion braucht Freigabe.** Deployments nach Production und alles, was
  Produktionsdaten verändert, nur nach ausdrücklicher Zustimmung von Eric.
- **Keine Daten löschen.** Verworfene Datensätze bekommen den Status `verworfen`
  und verschwinden aus Auswahllisten, werden aber nicht entfernt.
- **Offene Fachfragen nicht raten** — siehe unten.

## Fachliche Prinzipien, die den Code prägen

- **Deterministisch und reproduzierbar.** Ein eingefrorener Analyse-Lauf muss sich
  mit denselben Eingaben identisch nachrechnen lassen. Er speichert die
  referenzierten IDs, die Parametersatz-Version und die Rechenkern-Version.
- **Jede Zahl hat eine Quelle.** Kein Wert ohne Beleg, Begründung und
  Qualitätsstufe. Geschätzte und KI-vorgeschlagene Werte werden als solche
  gekennzeichnet, nie stillschweigend als gesichert dargestellt.
- **Qualität A–D wird abgeleitet, nie gewählt.** Die Stufe ergibt sich aus
  Beleg-Typ und Vollständigkeit; es gibt kein Formularfeld dafür.
- **Zwei getrennte Konfidenz-Begriffe.** Qualität (A–D, dauerhaft, aus dem Beleg)
  und Konfidenz (Selbsteinschätzung der KI, nur im Anreicherungsprotokoll)
  dürfen nicht vermischt werden.
- **Volle Präzision intern, Rundung nur an der Ausgabegrenze.** Zwischenergebnisse
  werden nie gerundet weitergereicht.
- **Luftlinie plus kalibrierter Umwegfaktor.** Kein Straßenrouting im
  Laufzeitpfad, keine Routing-API zur Laufzeit.
- **KI schlägt vor, Menschen übernehmen.** Kein automatisches Schreiben von
  KI-Werten in Datensätze; jeder Vorschlag trägt Fundstelle und Konfidenz.

## Rechenkern

`packages/rechenkern` ist ein reines TypeScript-Package **ohne Datenbank-,
Netzwerk- oder Umgebungszugriff**. Konkret:

- Nur pure Funktionen: Eingaben rein, Ergebnis raus
- Kein `Date.now()`, kein Zufall — Zeitpunkte und Parameter werden übergeben
- Exportiert eine `RECHENKERN_VERSION`, die jeder eingefrorene Lauf mitspeichert
- Wird mit Vitest getestet, ohne Infrastruktur lauffähig

Die drei bestätigten Formeln (Trockenmasse, Logistikkosten, Eignungsscore) stehen
in `docs/ap0-schema-entscheidungen.md` und im Konzept. Die im Mockup-Review
nachgerechneten Beispiele gehören als Test-Fixtures in den Rechenkern — sie sind
die Referenz dafür, dass eine Änderung nichts kaputt macht.

## Authentifizierung

Cloudflare Access übernimmt den Login (Team-Domain `bhyo.cloudflareaccess.com`,
Policy „Access with bhyo"). Die App implementiert **kein** eigenes
Sessionmanagement, keine Passwörter, keinen Passwort-Reset.

- Access liefert die verifizierte Identität als JWT im Header
  `Cf-Access-Jwt-Assertion`
- Der Header wird **immer** serverseitig gegen
  `https://bhyo.cloudflareaccess.com/cdn-cgi/access/certs` validiert. Ihm
  ungeprüft zu vertrauen ist die klassische Lücke.
- **Rollen liegen in der App**, nicht in Access: die `benutzer`-Tabelle mappt die
  E-Mail auf genau eine von vier Rollen (E30/E42) — `betrachter` liest,
  `bearbeiter` erfasst und bearbeitet, `pruefer` sperrt Ströme und weist sie zu
  (E44), `admin` verwaltet zusätzlich die Benutzer. Hierarchie admin ⊇ pruefer
  ⊇ bearbeiter ⊇ betrachter, ausgeschrieben in `apps/web/lib/rechte/matrix.ts`.
- **Rechte sind Daten** (E42): `apps/web/lib/rechte/` hält Rollen, die
  Aktions-Matrix und die Wache. Jeder Schreibpfad nennt seine Aktion und ruft
  die Wache auf; `scripts/rechte-check.ts` erzwingt das in der CI. Eine Aktion
  entsteht erst mit ihrem Schreibpfad, eine Rolle erst mit ihrer Wirkung.
- **Sperren sind Objektregeln derselben Matrix** (E44): Ein gesperrter Strom
  bleibt lesbar; ändern dürfen ihn Sperrinhaber, Zugewiesene und Admins. Die
  Prüfung liest die Sperre in der Transaktion des Schreibpfads (Zeilensperre),
  nie nur in der Oberfläche.
- **Fail closed**: Eine E-Mail ohne Eintrag in `benutzer` oder mit
  `aktiv = false` bekommt keinen Zugang — kein stilles Zurückfallen auf
  Lesezugriff. Jede Rechteprüfung sitzt serverseitig; die Oberfläche blendet
  nur zusätzlich aus.

## Design

**`docs/design-system.md` ist die verbindliche Referenz für alle UI-Arbeiten und
vor jeder Design-Änderung zu lesen.**

Markenidentität bestimmt Farbe und Form, der Glaseffekt liefert nur die
Tiefenstaffelung: Navy `#1F2E38`, Waldgrün `#3A5412`, Lime `#8CC63F`, Hellgrau
`#EFEFEE`. Pillen für Badges, Werte und Status. Dark Mode auf Marken-Navy, kein
Schwarz. Qualitäts- und Konfidenzstufen als abgestufte Pillen Navy → Hellgrau —
**bewusst keine Ampelfarben**. Der PDF-Export hat ein eigenes Print-Layout ohne
Glaseffekte.

## Offene Fachfragen — nicht raten, nachfragen

Diese Punkte sind Geschäftsentscheidungen und noch nicht getroffen. Wenn eine
Aufgabe sie berührt: nachfragen statt eine plausible Regel zu erfinden.

- Kapazitätsauslastung bei Mehrvektor-Output (Baureihen-Sweep)
- Limitierungsregel biomasse- vs. outputlimitiert
- Einheitliche Herleitung der Teilscore-Konfidenz
- Vergleichslauf-Referenzwerte in Schritt h
- Umrechnungsfaktor Biomasse ↔ Output
- Teilscore-Mapping der Bereitschaftsstufen

## Arbeitsweise

- Kleine, abgeschlossene Pull Requests statt großer Sammel-Änderungen
- Gemergt wird ausschließlich über `scripts/merge-sicher.sh <pr> <head-sha> "<betreff>"`:
  wartet auf MERGEABLE/CLEAN, prüft Head-SHA und grüne Läufe, merged mit
  `--match-head-commit`. Kein Ergebnis ist kein Ergebnis.
- Jeder PR deployt automatisch eine Preview; `/api/health` muss dort grün sein
- Migrationen und Schemaänderungen bekommen einen eigenen PR, nie zusammen mit
  Feature-Code
- Kommentare erklären das Warum, nicht das Was
- Bei Unklarheit: eine präzise Rückfrage ist besser als eine geratene Annahme

## Weiterführende Dokumente

- `docs/ap0-schema-entscheidungen.md` — Enums, Felder, Lauf-ID, verbindlich
- `docs/ap0a-worker-skeleton.md` — Handoff für das Grundgerüst
- `docs/ap0b-handoff-datenbank-grundgeruest.md` — Handoff für Neon/Hyperdrive und die erste Migration
- `docs/ap0c-handoff-backup-restore.md` — Handoff für den täglichen Backup-Job und den Restore-Test
- `docs/ap1a-handoff-datenmodell.md` — Handoff für die Kernentitäten-Migration (Region, Akteur, Beleg, Biomassestrom, Output-Bedarf, Akteur-Interesse, Analyse-Lauf, Entfernung)
- `docs/ap1b-handoff-erfassung.md` — Handoff für Erfassungs-UI, Schema-Ergänzung Migration 0002, Qualitäts-Ableitung als Code, Beleg-Upload nach R2
- `docs/betrieb.md` — Einstellungen außerhalb des Repos, die der Code voraussetzt (Hyperdrive-Abfrage-Cache aus, mit Wächter)

Die Konzept- und Planungsebene (Hub-Note, Arbeitspakete, To-do-Liste) liegt
außerhalb dieses Repos im Obsidian-Vault und ist die Quelle der Wahrheit für
Fachlogik und Reihenfolge.
