# F6 — Kommunen-PDF und Export: Handoff

**Stand: 25.09.2026.** Dieses Dokument ist noch kein vollständiger Handoff —
es hält bis dahin die Festlegungen fest, die aus anderen Paketen hierher
zeigen, damit sie nicht nur im Gesprächsverlauf stehen.

## Vorgemerkt aus E34: die Freigabe zur externen Verwendung

Mit E34 (25.09.2026) ist `beleg.extern_nachvollziehbar` **keine Aussage über
die Nachweiskraft mehr** und geht nicht in die Qualitätsstufe ein. Es ist
eine **Freigabe zur externen Verwendung**: Ein Beleg kann sachlich gut sein
und trotzdem nicht nach außen verwendet werden dürfen.

**Der Ort, an dem die Freigabe wirkt, ist F6.** PDF-Abzug und CSV-Export
berücksichtigen sie: Nicht freigegebene Belege erscheinen dort **nicht** oder
sind **sichtbar als intern gekennzeichnet**. Welche der beiden Varianten
gilt, entscheidet Eric, wenn F6 ansteht — bis dahin ist das eine Vormerkung,
kein offener Punkt.

**Warum das hier steht:** Der alte Hilfetext des Feldes versprach genau diese
Wirkung („die Quelle darf im Kommunen-PDF erscheinen"), ohne dass irgendwo im
Code etwas davon umgesetzt war. Der Fehlerbericht aus dem Praxistest vom
24.09.2026 ging darauf zurück. Mit F6 wird das Versprechen eingelöst; bis
dahin sagt der Hilfetext ausdrücklich, dass die Freigabe die Qualitätsstufe
nicht beeinflusst.

## Was sonst schon feststeht

- Der PDF-Export hat ein **eigenes Print-Layout ohne Glaseffekte**
  (`docs/design-system.md`).
- Die Formatierung erbt F6 über dieselben zentralen Funktionen aus
  `lib/format.ts` (E20) — keine eigenen Rundungen im PDF-Pfad.
