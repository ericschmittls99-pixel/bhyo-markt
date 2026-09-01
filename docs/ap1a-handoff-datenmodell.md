# AP1a – Handoff: Datenmodell (Schema)

Erste Migration von AP1 („Register"), nach dem AP0-Muster. Legt die acht
Kernentitäten als Drizzle-Migration an, aufbauend auf den drei Enums aus
`docs/ap0-schema-entscheidungen.md`. Noch **keine** UI, kein Beleg-Upload,
keine Qualitäts-Ableitungslogik als Code – das folgt in AP1b.

## Definition of Done

Migration liegt versioniert im Repo (`packages/db`), läuft sauber gegen
Preview und Production (`drizzle-kit migrate`). Alle Fremdschlüssel-Beziehungen
(Akteur, Region, Beleg) sind gesetzt. **Production-Migration nur nach
ausdrücklicher Freigabe durch Eric**, gleiches Vorgehen wie bei AP0b.

## Bekannte Lücke

Eine vollständige Feldreferenz (`bhyo-handoff-spec.md`) ist an anderer Stelle
referenziert, aber weder im Vault noch im Repo auffindbar. Die Felder unten
sind aus der Projektzusammenfassung, dem ERD-Sketch und den Mockups
abgeleitet – für das Schema-Grundgerüst ausreichend. Vor dem Bau der
Erfassungs-UI (AP1b) gegenprüfen, falls die Datei doch noch auftaucht.

## Neue Enums (zusätzlich zu den drei aus AP0)

| Enum | Werte | Verwendung |
| --- | --- | --- |
| `qualitaets_stufe` | `A` · `B` · `C` · `D` | Biomassestrom, Output-Bedarf |
| `preis_herkunft` | `eigene_datenbank` · `marktdaten` · `schaetzung` | Preis-Korridor-Herkunft |
| `output_vektor` | `waerme` · `h2` · `co2` | Output-Bedarf |
| `lauf_status` | `arbeitsfassung` · `eingefroren` | Analyse-Lauf-Lebenszyklus |

`materialart` bewusst **kein** Enum, sondern Lookup-Tabelle
`materialart(code text pk, label text)` – wächst erfahrungsgemäß, ein
Enum-Wert lässt sich in Postgres nicht umbenennen/entfernen.

## Kernentitäten

**region** — `id uuid pk` · `name text` · `standort_geom geometry(Point,4326)`
· `bereitschaft_stufe bereitschaft_stufe default 'kein_kontakt'` ·
`bereitschaft_beleg_id uuid fk→beleg null` · `bereitschaft_notiz text null` ·
`bereitschaft_stand date null` · `created_at` · `updated_at`

**akteur** — `id uuid pk` · `name text` · `sektor text null` ·
`rollen text[]` · `kontakt_email text null` · `kontakt_telefon text null` ·
`ansprechperson text null` · `status datensatz_status` · `created_at` ·
`updated_at`

**beleg** — `id uuid pk` · `typ beleg_typ` · `datei_key text null` ·
`link_url text null` · `notiz text null` · `gueltig_bis date null` ·
`erstellt_am timestamp` · `created_at`

**biomassestrom** — `id uuid pk` · `akteur_id uuid fk→akteur` ·
`region_id uuid fk→region` · `materialart_code text fk→materialart` ·
`menge_roh_fm numeric` · `ts_anteil_pct numeric` · `aschegehalt_pct numeric` ·
`menge_atro numeric generated always as (menge_roh_fm * ts_anteil_pct/100 * (1 - aschegehalt_pct/100)) stored`
· `zeitraum_von date` · `zeitraum_bis date` · `saisonalitaet jsonb` ·
`preis_min numeric null` · `preis_mittel numeric null` ·
`preis_max numeric null` · `preis_herkunft preis_herkunft null` ·
`beleg_id uuid fk→beleg null` · `qualitaet qualitaets_stufe null` ·
`status datensatz_status` · `created_at` · `updated_at`

**output_bedarf** — `id uuid pk` · `akteur_id uuid fk→akteur` ·
`region_id uuid fk→region` · `vektor output_vektor` · `menge_wert numeric` ·
`menge_einheit text` · `zeitraum_von date` · `zeitraum_bis date` ·
`saisonalitaet jsonb` · `beleg_id uuid fk→beleg null` ·
`qualitaet qualitaets_stufe null` · `status datensatz_status` ·
`created_at` · `updated_at`

**akteur_interesse** — `id uuid pk` · `akteur_id uuid fk→akteur` ·
`region_id uuid fk→region` · `status datensatz_status` · `notiz text null` ·
`created_at` · `updated_at` · unique auf `(akteur_id, region_id)`

**analyse_lauf** (Grundgerüst) — `id uuid pk` · `region_id uuid fk→region` ·
`lauf_id text unique` (Format `BW-JJJJ-NNN`) ·
`status lauf_status default 'arbeitsfassung'` ·
`baureihe_gewaehlt text null` · `eingefroren_am timestamp null` ·
`parametersatz_version text null` · `rechenkern_version text null` ·
`created_at` · `updated_at`

Dazu `lauf_nummernkreis(jahr int pk, letzte_nummer int)` für die ID-Vergabe –
`SELECT … FOR UPDATE`, kein `count(*) + 1`.

**entfernung** (generisch) — `id uuid pk` · `lauf_id uuid fk→analyse_lauf` ·
`ziel_typ text check in ('biomassestrom','output_bedarf')` ·
`ziel_id uuid` (polymorph, bewusst ohne FK-Constraint) · `luftlinie_km numeric`
· `umwegfaktor numeric` · `created_at`. Platzhalter-Tabelle – die eigentliche
Distanzberechnung entsteht erst mit dem Bewertungstool (AP3).

## Migrationen

Neue Migration (`0001_...`) in `packages/db`, aufbauend auf `0000_init.sql`.
Reihenfolge nach FK-Abhängigkeiten: `materialart`, `beleg`, `region`,
`akteur`, `biomassestrom`, `output_bedarf`, `akteur_interesse`,
`lauf_nummernkreis`, `analyse_lauf`, `entfernung`.

## Verifikation

`drizzle-kit migrate` gegen Preview, danach gegen Production. Stichprobe:
einen Datensatz je Tabelle einfügen, FK-Verletzung provozieren (falsche
`akteur_id`) und prüfen, dass Postgres ablehnt.

## Nicht in diesem Paket

Erfassungs-UI, Beleg-Upload nach R2, automatische Qualitätsableitung als
Code, Saisonalitäts-Editor-UI, BKG-Verwaltungsgrenzen-Tabelle,
Rollenkonzept/`benutzer`-Tabelle.
