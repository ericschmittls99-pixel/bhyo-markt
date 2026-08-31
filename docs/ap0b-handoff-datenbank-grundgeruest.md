# AP0b – Handoff: Datenbank-Grundgerüst

Übergabe für den zweiten Umsetzungsschritt in AP0, nach dem Worker-Skeleton
(`docs/ap0a-worker-skeleton.md`). Ziel: Neon-Datenbank über Hyperdrive angebunden,
Drizzle-Migrationsstruktur steht, die drei Enums aus
`docs/ap0-schema-entscheidungen.md` sind als erste Migration angelegt. Noch **keine**
Fachtabellen (Region, Akteur, Biomassestrom …) – die kommen mit AP1.

## Ziel und Definition of Done

Der Worker erreicht die Neon-Datenbank über Hyperdrive, in Production und Preview
getrennt. `/api/health` zeigt einen zusätzlichen DB-Status.

Fertig, wenn:

- die Migrationshistorie im Repo PostGIS-Aktivierung und die drei Enums enthält
- ein PR-Preview-Deploy `/api/health` mit `"db":"ok"` zeigt
- `drizzle-kit migrate` gegen beide Umgebungen sauber durchläuft

## Ergebnis: Neon-Projekt und Hyperdrive (28.08.2026)

- Neon-Projekt „bhyogenics", Region AWS Europe Central 1 (Frankfurt), Plan Free
- Zwei Branches: `production` (Hauptbranch) und `preview` (davon abgezweigt, kein
  Auto-delete – dauerhafte Umgebung, keine PR-Kurzlebige Branch)
- Zwei Hyperdrive-Configs angelegt, direkte (nicht gepoolte) Connection-Strings:
  - Production: `bhyo-markt-db`, Hyperdrive-ID `2a873aa18f654dc4897b145cb24db7d7`
  - Preview: `bhyo-markt-db-preview`, Hyperdrive-ID `7bf0712cc8224c32a061ef0abea561f9`
- Beide Neon-Passwörter wurden nach Erstellung zurückgesetzt (Connection-Strings
  waren zwischenzeitlich im Chat sichtbar); die beiden Hyperdrive-Configs oben
  spiegeln die zum Zeitpunkt der Erstellung gültigen Credentials

## Konfiguration

`apps/web/wrangler.jsonc`: Hyperdrive-Binding `HYPERDRIVE` ergänzen – Top-Level
(Production-ID) und in `env.preview` (Preview-ID), gleiches Muster wie die
AUD-Tags in `docs/ap0a-worker-skeleton.md`.

```jsonc
"hyperdrive": [
  { "binding": "HYPERDRIVE", "id": "2a873aa18f654dc4897b145cb24db7d7" }
],
"env": {
  "preview": {
    "hyperdrive": [
      { "binding": "HYPERDRIVE", "id": "7bf0712cc8224c32a061ef0abea561f9" }
    ]
  }
}
```

Keine Connection-Strings, keine Secrets im Repo – nur die beiden Hyperdrive-IDs, die
selbst kein Zugriffsgeheimnis sind.

## Struktur

Neues Package `packages/db` für Drizzle-Schema und Migrationen, von `apps/web` als
Workspace-Dependency eingebunden – analog zu `packages/rechenkern`. Hält Schema und
Migrationslogik unabhängig vom Next.js-Build testbar.

## Migrationen

Erste Migration(en), versioniert im Repo, keine manuelle Konsolenaktion in Neon:

1. `CREATE EXTENSION IF NOT EXISTS postgis;`
2. Drei Postgres-Enums exakt nach `docs/ap0-schema-entscheidungen.md`:
   `datensatz_status` (`entwurf` · `in_pruefung` · `geprueft` · `verworfen`),
   `beleg_typ` (inkl. `absichtserklaerung`), `bereitschaft_stufe` (`kein_kontakt` ·
   `erstgespraech` · `positives_signal` · `absichtserklaerung`). Werte snake_case
   ohne Umlaute, deutsche Labels nur im Frontend.

## Verifikation

`/api/health` um ein `db`-Feld erweitern, das über die Hyperdrive-Bindung
`SELECT postgis_version()` ausführt und `ok`/`error` zurückgibt – macht die
Anbindung ohne Datenbank-Client von außen sichtbar und passt ins bestehende
Health-Check-Muster.

## Nicht in diesem Paket

Fachtabellen (Region, Akteur, Biomassestrom, Analyse-Lauf …),
Rollenkonzept/`benutzer`-Tabelle, Backup nach R2 und Restore-Test – eigener
Folgeschritt, sobald das Grundgerüst steht.
