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

## Noch offen – nicht raten

Qualitäts-Ableitungsmatrix A–D und Gültigkeitsdauern je Beleg-Typ sind seit
31.08.2026 verbindlich (siehe Abschnitt 3). Weiterhin offen: Teilscore-Mapping der
Bereitschaftsstufen – Geschäftsentscheidung, wird von Eric entschieden, nicht im
Code festgelegt.
