# Adresssuche: Photon-Fair-Use und Alternativen (Recherche 06.10.2026)

Anlass: `/api/geocode` lieferte am 06.10.2026 auf Production und Preview 502
(Diagnose in PR „Geocode: Diagnose des Photon-Fehlers"). Nutzung: Adress-
Autocomplete beim Tippen (350-ms-Debounce), Rückwärtssuche für den Pin, Excel-
Import mit bis zu 5.000 Zeilen (Spitzen von einigen hundert bis tausend
Geocodings je Lauf). Laufzeit Cloudflare Workers (geteilte Egress-IPs), Daten
nur Deutschland. Keine Entscheidung — die trifft Eric. Alle Angaben aus den
verlinkten Seiten, abgerufen am 06.10.2026; „nicht belegt" = nicht gefunden.

## Photon (komoot), öffentliche Instanz

- Landingpage: „please be fair — extensive usage will be throttled", keine
  Verfügbarkeitsgarantie. https://photon.komoot.io/
- README: „Extensive usage will be throttled or completely banned."
  https://github.com/komoot/photon
- Maintainer (Discussion #598): keine harte Grenze, gedrosselt „je nach
  Bedarf"; wer nach Limits fragt, fahre mit eigener Instanz besser; keine
  kommerzielle API. https://github.com/komoot/photon/discussions/598
- Discussion #848: eigene Instanz sei „dead simple" (Dump laden, JAR starten).
  https://github.com/komoot/photon/discussions/848
- Praxisfall: Betreiber meldete sich bei einer App, die ~60 % aller Anfragen
  verursachte. https://github.com/Freika/dawarich/issues/614
- Rate-Limit je Sekunde, User-Agent-Pflicht, Sperren für Cloudflare-Egress:
  nicht belegt. Eigene Messung 06.10.2026: Antwort mit `Server: nginx`,
  `Cache-Control: max-age=3600`, keine Rate-Limit-Header. Workers-Egress-IPs
  sind mit allen Cloudflare-Kunden geteilt — eine IP-Drosselung träfe uns,
  egal wer sie auslöst.

Fazit: Für Autocomplete plus Import-Spitzen ist die öffentliche Instanz
ausdrücklich nicht gedacht.

## Vergleich

| Option | Datenbasis / DE | Autocomplete | Hosting / DSGVO | Schlüssel, Preis bei ≤ 50k/Monat | Kostenlos (Grenzen) | Bulk/Batch | Rate-Limit/s |
|---|---|---|---|---|---|---|---|
| Photon öffentlich | OSM, minütlich | nur Fair Use | komoot (DE); kein AVV, keine SLA | kein Schlüssel, 0 € | undefiniert, Drosselung/Sperre möglich | nicht vorgesehen | nicht belegt |
| Geoapify | OSM (+ weitere) | ja, 1 Credit/Anfrage | Hetzner DE/FI, EU-Endpunkt api-eu.geoapify.com; DPA; Vertragspartner KEPTAGO LTD (Zypern) | Schlüssel; Free 3.000/Tag; API 10: 59 USD/Mon (10.000/Tag, 12 r/s) | ja, kommerziell, 3.000/Tag, 5 r/s | Batch ≤ 1.000/Job, async, „bis 50 % günstiger" | 5 (frei), 12–30 |
| MapTiler Geocoding | globale/lokale Quellen, OSM-Attribution | ja, Keystroke = Request | MapTiler AG (CH), Server FR/EWR, EU-Endpunkt nur bezahlt; DPA nur bei Dritten belegt | Schlüssel; Flex 30 USD/Mon, 3.000 Sessions inkl. | Free 1.000 Sessions, nur Test/nicht-kommerziell | kein Batch belegt | nicht belegt |
| Eigene Photon-Instanz (DE) | OSM via Nominatim; DE-Dump 7,4 GB, wöchentlich | ja, unbegrenzt | selbst gewählt; kein Dritter | kein Schlüssel; Serverkosten | – | unbegrenzt | selbst |
| OpenCage | OSM + weitere | nein (Geocoding-API); „Geosearch" nur Orte | OpenCage GmbH Berlin, Hetzner DE/FI; DPA automatisch | X-Small 45 €/Mon (10.000/Tag, 15 r/s) | Trial 2.500/Tag, 1 r/s | Tabellen-Upload im Dashboard | 15 |
| LocationIQ | OSM, OpenAddresses | ja | eu1-Endpunkt; Processor Unwired Labs (Indien), keine EU-only-Zusage | Developer 100 USD/Mon (25.000/Tag, 20 r/s) | 5.000/Tag, 2 r/s, Attribution | kein Batch belegt | 2 / 20 |
| Mapbox | OSM + Behörden + proprietär | ja | AWS USA, SCC | Permanent 5 USD/1k ohne Freikontingent | Temporary 100k/Mon — Ergebnisse nicht speicherbar | Batch ≤ 50/Call | 1.000/min |
| Geofabrik (Photon gehostet) | OSM, täglich | ja | Geofabrik GmbH Karlsruhe, EU-Rechenzentren; AVV nicht belegt | Small 40 €/Mon (100.000/Mon), Jahresvorauszahlung | kein Free | keine Angabe | nicht belegt |

## Je Anbieter (Kurzfassung, Quellen)

- **Geoapify:** 1 Credit je Geocoding/Reverse/Autocomplete; Free 3.000/Tag,
  5 r/s, kommerziell erlaubt; API 10 59 USD/Mon, 10.000/Tag, 12 r/s, SLA
  99,5 %; Batch async ≤ 1.000 Adressen. Subprozessoren Hetzner (DE/FI),
  Cloudflare (US/DE), BunnyCDN (SI); EU-Bindung über api-eu. Speichern der
  Ergebnisse: nicht belegt. https://www.geoapify.com/pricing/ ·
  https://apidocs.geoapify.com/docs/geocoding/batch/ ·
  https://www.geoapify.com/data-processing-agreement/ ·
  https://www.geoapify.com/terms-and-conditions/
- **MapTiler:** Free nur Test/nicht-kommerziell; Flex 30 USD/Mon mit 3.000
  Search-Sessions, 2,50 USD je weitere 1.000; wie serverseitige Aufrufe aus
  einem Worker zählen (Session vs. Request) ist nicht eindeutig belegt.
  https://www.maptiler.com/cloud/pricing/ ·
  https://docs.maptiler.com/guides/account/sessions-vs-requests/ ·
  https://docs.maptiler.com/cloud/api/geocoding/
- **Eigene Photon-Instanz:** GraphHopper-Dumps wöchentlich, DE 7,4 GB
  (tar.bz2, 29.09.2026); Java 21, OpenSearch eingebettet, SSD Pflicht; RAM-
  Bedarf für DE nicht belegt (Planet: ≥ 64 GB empfohlen); Update per Dump-
  Austausch oder Nominatim-Replikation (eigene PostgreSQL). Eigener Server
  außerhalb von Workers nötig.
  https://download1.graphhopper.com/public/europe/germany/index.html ·
  https://github.com/komoot/photon/releases
- **OpenCage:** deutsche GmbH, Hetzner DE/FI, DPA automatisch, `no_record`;
  X-Small 45 €/Mon; Geocoding-API ausdrücklich nicht für Autosuggest, Geosearch
  ohne Straßenadressen → für Autocomplete ungeeignet, für Reverse/Import
  geeignet. https://opencagedata.com/pricing · https://opencagedata.com/gdpr
- **LocationIQ:** Free 5.000/Tag, 2 r/s; Developer 100 USD/Mon; Processor in
  Indien ohne EU-Zusage. https://locationiq.com/pricing · https://locationiq.com/dpa
- **Mapbox:** Temporary-Ergebnisse dürfen nicht gespeichert werden (für ein
  Register ungeeignet); Permanent 5 USD/1k; Verarbeitung in den USA.
  https://www.mapbox.com/pricing · https://docs.mapbox.com/api/search/geocoding/
- **Geofabrik:** gehostetes Nominatim/Photon, täglich aktualisiert, Small 40
  €/Mon für 100.000/Mon, EU-Hosting; Rate-Limit, AVV, Batch nur per Rückfrage.
  https://www.geofabrik.de/data/geocoding.html

## Einschätzung (ohne Entscheidung)

1. **Geoapify (api-eu, API 10, 59 USD/Mon):** deckt Autocomplete, Reverse und
   Batch-Import mit einem Schlüssel, 12 r/s, Hetzner DE, DPA mit EU-Zusage.
   Vorbehalt: Vertragspartner in Zypern (EU), Speichererlaubnis nicht belegt.
2. **Eigene Photon-Instanz mit DE-Dump:** fachlich identisch (gleiche API und
   Daten), keine Limits, kein Dritter. Vorbehalt: eigener Server und
   Betriebsaufwand, RAM-Bedarf vorher messen.
3. **Geofabrik Photon gehostet (40 €/Mon):** deutscher Anbieter, EU-Hosting,
   Photon-API. Vorbehalt: Rate-Limit, AVV und Jahresvorauszahlung per Rückfrage.

OpenCage fällt für Autocomplete weg, Mapbox wegen Speicherverbot und
US-Verarbeitung, LocationIQ wegen Processor ohne EU-Zusage, die öffentliche
Photon-Instanz, weil die Maintainer genau diesen Fall ausschließen.

**Nachtrag E68 PR 1 (07.10.2026):** „PLZ aus Pin" läuft lokal über die
PLZ-Gebiete (Migration 0048), die Photon-Rückwärtssuche ist entfernt. Die
Vorwärtssuche (Autocomplete, Import) nutzt Photon bis PR 2 unverändert.
