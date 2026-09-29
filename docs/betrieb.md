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
| `app/api/materialarten` POST | `materialart.code` (PK) | nein — `ON CONFLICT DO NOTHING`, dann Lesen | gibt den bestehenden Eintrag zurück; kein Aufrufer in der Oberfläche |
| `app/api/akteure` POST | keine Unique-Constraint auf `akteur` | — | — |
| `akteur_interesse (akteur_id, region_id)` | unique | kein Schreibpfad im Code | — |

Die Prüfungen auf den „letzten aktiven Admin" (`rolleSetzen`,
`aktivSetzen`) sind keine Eindeutigkeitsprüfungen, lesen aber ebenfalls
den aktuellen Stand vor dem Schreiben — auch sie sind auf einen Cache-
freien Lesepfad angewiesen. Das ist der zweite Grund, den Cache ganz
abzuschalten statt einzelne Abfragen zu markieren.
