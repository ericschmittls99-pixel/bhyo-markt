# AP2.5 PR c — Kalibrierung der Dubletten-Schwellen (E66)

Stand 01.10.2026 (zweite Fassung nach Erics Abnahme: Ortsbezug = gleiche PLZ
oder Sitz-Abstand ≤ 2 km, Kalibrier-Paare in der geteilten Fixture-Liste).
Gerechnet ohne Datenbank (lokal oder in der CI, nie gegen die gemeinsame
Preview) mit `apps/web/scripts/dubletten-kalibrierung.ts`:

```
pnpm --filter web exec tsx scripts/dubletten-kalibrierung.ts            # Bericht
pnpm --filter web exec tsx scripts/dubletten-kalibrierung.ts --fixtures # Fixture-Zeilen
```

Das Skript normalisiert mit dem TypeScript-Spiegelbild von `akteur_name_norm`
und rechnet die pg_trgm-Ähnlichkeit nach (Trigramme wie pg_trgm). Die
Parität SQL ↔ TypeScript prüft `dubletten-check` in der CI über die geteilte
Fixture-Liste `packages/db/src/dubletten-fixtures.ts` — Namen, Ähnlichkeits-
Referenzen und die Kalibrier-Paare mit ihrer nachgerechneten Ähnlichkeit.
`scripts/dubletten-kalibrierung.test.ts` hält das Ergebnis je Klasse fest.

## Schwellen (Konstanten in `apps/web/lib/akteur-norm.ts`)

- **stark**: Ähnlichkeit ≥ `DUBLETTE_STARK = 0,60` **und** (gleiche PLZ **oder**
  Sitz-Abstand ≤ `DUBLETTE_ORT_METER = 2000` über `sitz_geom`). Der gleiche
  Kreis allein reicht nicht (Entscheidung Eric 01.10.2026: kommunale Akteure
  desselben Kreises erschienen sonst massenhaft als stark).
- **schwach**: Ähnlichkeit ≥ `DUBLETTE_SCHWACH = 0,75` ohne Ortsbezug.
- Normalisierung: Abkürzung **„SW" → „stadtwerke"** (eigenes Wort) in SQL
  und TypeScript; **„Gem." wird nicht aufgelöst**, weil „gem. GmbH"
  gemeinnützig bedeutet — „Gem. X" ↔ „Gemeinde X" wird am selben Ort
  dennoch stark gefunden (0,632), ohne Ortsbezug nicht (siehe unten).

## Kalibrier-Paare je Klasse (geteilte Fixture-Liste)

### Seed-Kandidaten stark: 3 von 3 gefunden

| Paar | normalisiert | Ähnlichkeit | Ortsbezug | Ergebnis |
|---|---|---|---|---|
| Müller Agrar GmbH · Mueller Agrar | mueller agrar · mueller agrar | 1.000 | ja | stark |
| Stadtwerke Speyer GmbH · Stadtwerke Speyer | stadtwerke speyer · stadtwerke speyer | 1.000 | ja | stark |
| Biogas Kraichgau GmbH & Co. KG · Biogas Kraichgau KG | biogas kraichgau · biogas kraichgau | 1.000 | ja | stark |


### Seed-Kandidaten schwach: 2 von 2 gefunden

| Paar | normalisiert | Ähnlichkeit | Ortsbezug | Ergebnis |
|---|---|---|---|---|
| Forstbetrieb Rheinhessen e.K. · Forstbetrieb Rheinhessen | forstbetrieb rheinhessen · forstbetrieb rheinhessen | 1.000 | – | schwach |
| Papierfabrik Neckartal AG · Papierfabrik Neckartal | papierfabrik neckartal · papierfabrik neckartal | 1.000 | – | schwach |


### echte Varianten (sollen gefunden werden): 14 von 18 gefunden

| Paar | normalisiert | Ähnlichkeit | Ortsbezug | Ergebnis |
|---|---|---|---|---|
| Stadtwerke Speyer · Stadwerke Speyer | stadtwerke speyer · stadwerke speyer | 0.737 | ja | stark |
| Müller Agrar · Müler Agrar | mueller agrar · mueler agrar | 0.800 | ja | stark |
| Kompostwerk Vorderpfalz · Kompostwerk Vorderpflaz | kompostwerk vorderpfalz · kompostwerk vorderpflaz | 0.714 | – | – **(nicht gefunden)** |
| Raiffeisen Mosbach eG · Raifeisen Mosbach | raiffeisen mosbach · raifeisen mosbach | 0.850 | – | schwach |
| SW Speyer · Stadtwerke Speyer | stadtwerke speyer · stadtwerke speyer | 1.000 | ja | stark |
| SW Speyer GmbH · Stadtwerke Speyer | stadtwerke speyer · stadtwerke speyer | 1.000 | – | schwach |
| Gem. Haßloch · Gemeinde Haßloch | gem hassloch · gemeinde hassloch | 0.632 | ja | stark |
| Gem. Haßloch · Gemeinde Haßloch | gem hassloch · gemeinde hassloch | 0.632 | – | – **(nicht gefunden)** |
| Hof Sonnenberg GbR · Sonnenberg Hof | hof sonnenberg · sonnenberg hof | 1.000 | – | schwach |
| Biogas Kraichgau · Kraichgau Biogas GmbH | biogas kraichgau · kraichgau biogas | 1.000 | – | schwach |
| Biogas Müller GmbH & Co. KG · Müller Biogas | biogas mueller · mueller biogas | 1.000 | ja | stark |
| Stadtwerke Speyer · Stadtwerke Speyer Energie | stadtwerke speyer · stadtwerke speyer energie | 0.680 | ja | stark |
| Stadtwerke Speyer · Stadtwerke Speyer Energie | stadtwerke speyer · stadtwerke speyer energie | 0.680 | – | – **(nicht gefunden)** |
| Biogas Kraichgau · Biogasanlage Kraichgau | biogas kraichgau · biogasanlage kraichgau | 0.667 | ja | stark |
| Forstbetrieb Rheinhessen · Forstbetrieb Rheinhessen Nord | forstbetrieb rheinhessen · forstbetrieb rheinhessen nord | 0.833 | – | schwach |
| Chemiepark Ludwigshafen GmbH · Chemiepark Ludwigshafen Nord | chemiepark ludwigshafen · chemiepark ludwigshafen nord | 0.828 | – | schwach |
| Entsorgung Mannheim GmbH · Entsorgungsbetrieb Mannheim | entsorgung mannheim · entsorgungsbetrieb mannheim | 0.655 | ja | stark |
| AVR Abfallverwertung Rhein-Neckar · AVR Rhein-Neckar | avr abfallverwertung rhein neckar · avr rhein neckar | 0.515 | ja | – **(nicht gefunden)** |

Nicht gefunden: „Kompostwerk Vorderpfalz" · „Kompostwerk Vorderpflaz" (ohne Ortsbezug); „Gem. Haßloch" · „Gemeinde Haßloch" (ohne Ortsbezug); „Stadtwerke Speyer" · „Stadtwerke Speyer Energie" (ohne Ortsbezug); „AVR Abfallverwertung Rhein-Neckar" · „AVR Rhein-Neckar".

### kommunale falsche Treffer (sollen nicht erscheinen): 3 von 11 Fehlalarme

| Paar | normalisiert | Ähnlichkeit | Ortsbezug | Ergebnis |
|---|---|---|---|---|
| Stadt Speyer · Stadtwerke Speyer | stadt speyer · stadtwerke speyer | 0.611 | ja | stark **(Fehlalarm)** |
| Stadt Speyer · Gemeindewerke Speyer | stadt speyer · gemeindewerke speyer | 0.269 | ja | – |
| Stadtwerke Speyer · Gemeindewerke Speyer | stadtwerke speyer · gemeindewerke speyer | 0.407 | ja | – |
| Stadt Speyer · Zweckverband Speyer | stadt speyer · zweckverband speyer | 0.280 | ja | – |
| Stadtwerke Speyer · Zweckverband Speyer | stadtwerke speyer · zweckverband speyer | 0.233 | ja | – |
| Gemeinde Haßloch · Gemeindewerke Haßloch | gemeinde hassloch · gemeindewerke hassloch | 0.708 | ja | stark **(Fehlalarm)** |
| Gemeinde Haßloch · Zweckverband Haßloch | gemeinde hassloch · zweckverband hassloch | 0.290 | ja | – |
| Stadt Hockenheim · Stadtwerke Hockenheim | stadt hockenheim · stadtwerke hockenheim | 0.696 | ja | stark **(Fehlalarm)** |
| Stadt Landau · Stadtwerke Landau in der Pfalz | stadt landau · stadtwerke landau in der pfalz | 0.375 | ja | – |
| Stadt Mannheim · Stadtentwässerung Mannheim | stadt mannheim · stadtentwaesserung mannheim | 0.483 | ja | – |
| Stadtwerke Mannheim · Stadtentwässerung Mannheim | stadtwerke mannheim · stadtentwaesserung mannheim | 0.412 | ja | – |

Fehlalarme: „Stadt Speyer" · „Stadtwerke Speyer" (stark); „Gemeinde Haßloch" · „Gemeindewerke Haßloch" (stark); „Stadt Hockenheim" · „Stadtwerke Hockenheim" (stark).


**Lesart.** Alle fünf Seed-Kandidaten werden gefunden. Von den 18 echten
Varianten werden 14 gefunden; **nicht gefunden** werden vier: drei ohne
Ortsbezug knapp unter 0,75 („Kompostwerk Vorderpflaz" 0,714, „Gem. Haßloch"
0,632, „Stadtwerke Speyer Energie" 0,680 — mit Ortsbezug werden dieselben
Paare stark gefunden) und eine Kürzung des Namens trotz Ortsbezug („AVR
Abfallverwertung Rhein-Neckar" ↔ „AVR Rhein-Neckar" 0,515, weil
„abfallverwertung" die Hälfte der Trigramme stellt). Von den elf kommunalen
Paaren derselben Stadt erzeugen **drei Fehlalarme** als stark (Stadt ·
Stadtwerke Speyer 0,611, Gemeinde · Gemeindewerke Haßloch 0,708, Stadt ·
Stadtwerke Hockenheim 0,696); keines erreicht die schwache Schwelle. Eine
starke Schwelle von 0,72 würde die drei Fehlalarme vermeiden, aber vier
echte Varianten mit Ortsbezug verlieren (0,632–0,680); eine von 0,50 würde
die AVR-Kürzung finden, aber weitere kommunale Paare hereinlassen
(Stadt · Stadtentwässerung Mannheim 0,483 bleibt knapp draußen). Die
Fehlalarme landen auf der Liste und werden dort als „keine Dublette"
markiert.

## Seed-Namen: alle Paare

Kandidaten des Seeds: 5 Paare, schwächster 1.000.
Nicht-Kandidaten ab 0,30: 356 Paare, stärkster 1.000 (Agrarbetrieb Heidelberg · Agrarbetrieb Heidelberg).
Schwellen: stark ≥ 0.6 mit gleicher PLZ oder gleichem Kreis-ARS, schwach ≥ 0.75.

**Befund 1** — die Seed-Kandidaten liegen alle bei 1,000: sie unterscheiden
sich nur in Rechtsform oder Umlaut, die Normalisierung macht sie identisch.
**Befund 2** — falsche Freunde reichen bis 0,696 am selben Ort und 0,686 an
verschiedenen Orten (gleiche Betriebsart: „Winzergenossenschaft Weinheim" ·
„… Sinsheim"). **Befund 3** — acht gleichnamige Paare im Seed-Bestand
(`seed-daten.ts`, z. B. „Agrarbetrieb Heidelberg" zweimal) sind echte
Namensdubletten; sie bleiben als Testfall für die Liste (Eric 01.10.2026).

### Paare ab 0,50 (vollständige Liste ab 0,30 über das Skript)

| Paar | normalisiert | Ähnlichkeit | Seed-Kandidat | gleiche PLZ | Vorschlag |
|---|---|---|---|---|---|
| Agrarbetrieb Heidelberg · Agrarbetrieb Heidelberg | agrarbetrieb heidelberg · agrarbetrieb heidelberg | 1.000 | – | – | schwach |
| Agrarbetrieb Mannheim · Agrarbetrieb Mannheim | agrarbetrieb mannheim · agrarbetrieb mannheim | 1.000 | – | – | schwach |
| Betonwerk Eberbach · Betonwerk Eberbach | betonwerk eberbach · betonwerk eberbach | 1.000 | – | – | schwach |
| Biogas Kraichgau GmbH & Co. KG · Biogas Kraichgau KG | biogas kraichgau · biogas kraichgau | 1.000 | stark | ja | stark |
| Forstbetrieb Rheinhessen e.K. · Forstbetrieb Rheinhessen | forstbetrieb rheinhessen · forstbetrieb rheinhessen | 1.000 | schwach | – | schwach |
| Getränkehersteller Hockenheim · Getränkehersteller Hockenheim | getraenkehersteller hockenheim · getraenkehersteller hockenheim | 1.000 | – | – | schwach |
| Gewächshaus Haßloch · Gewächshaus Haßloch | gewaechshaus hassloch · gewaechshaus hassloch | 1.000 | – | – | schwach |
| Gewächshaus Weinheim · Gewächshaus Weinheim | gewaechshaus weinheim · gewaechshaus weinheim | 1.000 | – | – | schwach |
| Müller Agrar GmbH · Mueller Agrar | mueller agrar · mueller agrar | 1.000 | stark | ja | stark |
| Papierfabrik Neckartal AG · Papierfabrik Neckartal | papierfabrik neckartal · papierfabrik neckartal | 1.000 | schwach | – | schwach |
| Stadtwerke Grünstadt · Stadtwerke Grünstadt | stadtwerke gruenstadt · stadtwerke gruenstadt | 1.000 | – | – | schwach |
| Stadtwerke Speyer GmbH · Stadtwerke Speyer | stadtwerke speyer · stadtwerke speyer | 1.000 | stark | ja | stark |
| Trockeneis-Service Bruchsal · Trockeneis-Service Bruchsal | trockeneis service bruchsal · trockeneis service bruchsal | 1.000 | – | – | schwach |
| Stadt Hockenheim · Stadtwerke Hockenheim | stadt hockenheim · stadtwerke hockenheim | 0.696 | – | – | – |
| Winzergenossenschaft Weinheim · Winzergenossenschaft Sinsheim | winzergenossenschaft weinheim · winzergenossenschaft sinsheim | 0.686 | – | – | – |
| Entsorgung Mannheim GmbH · Entsorgungsbetrieb Mannheim | entsorgung mannheim · entsorgungsbetrieb mannheim | 0.655 | – | – | – |
| Landschaftspflegeverband Eberbach · Landschaftspflegeverband Buchen | landschaftspflegeverband eberbach · landschaftspflegeverband buchen | 0.632 | – | – | – |
| Forstbetrieb Speyer · Forstbetrieb Speyer (Kreisgrenze) | forstbetrieb speyer · forstbetrieb speyer kreisgrenze | 0.625 | – | – | – |
| Forstbetrieb Neustadt a. d. W. · Agrarbetrieb Neustadt a. d. W. | forstbetrieb neustadt a d w · agrarbetrieb neustadt a d w | 0.618 | – | – | – |
| Biogasanlage Mosbach · Biogasanlage Eberbach | biogasanlage mosbach · biogasanlage eberbach | 0.593 | – | – | – |
| Papierfabrik Weinheim · Papierfabrik Hockenheim | papierfabrik weinheim · papierfabrik hockenheim | 0.586 | – | – | – |
| Landschaftspflegeverband Buchen · Landschaftspflegeverband Walldürn | landschaftspflegeverband buchen · landschaftspflegeverband wallduern | 0.585 | – | – | – |
| Landschaftspflegeverband Eberbach · Landschaftspflegeverband Walldürn | landschaftspflegeverband eberbach · landschaftspflegeverband wallduern | 0.585 | – | – | – |
| Sägewerk Mannheim · Sägewerk Weinheim | saegewerk mannheim · saegewerk weinheim | 0.583 | – | – | – |
| Winzergenossenschaft Weinheim · Winzergenossenschaft Wiesloch | winzergenossenschaft weinheim · winzergenossenschaft wiesloch | 0.583 | – | – | – |
| Straßenmeisterei Worms · Straßenmeisterei Landau | strassenmeisterei worms · strassenmeisterei landau | 0.581 | – | – | – |
| Entsorgungsbetrieb Speyer · Entsorgungsbetrieb Landau | entsorgungsbetrieb speyer · entsorgungsbetrieb landau | 0.576 | – | – | – |
| Landschaftspflegeverband Buchen · Landschaftspflegeverband Hockenheim | landschaftspflegeverband buchen · landschaftspflegeverband hockenheim | 0.571 | – | – | – |
| Landschaftspflegeverband Eberbach · Landschaftspflegeverband Hockenheim | landschaftspflegeverband eberbach · landschaftspflegeverband hockenheim | 0.571 | – | – | – |
| Winzergenossenschaft Sinsheim · Winzergenossenschaft Wiesloch | winzergenossenschaft sinsheim · winzergenossenschaft wiesloch | 0.568 | – | – | – |
| Entsorgungsbetrieb Hamburg · Entsorgungsbetrieb Landau | entsorgungsbetrieb hamburg · entsorgungsbetrieb landau | 0.559 | – | – | – |
| Entsorgungsbetrieb Speyer · Entsorgungsbetrieb Hamburg | entsorgungsbetrieb speyer · entsorgungsbetrieb hamburg | 0.559 | – | – | – |
| Forstbetrieb Ludwigshafen · ÖPNV-Betrieb Ludwigshafen | forstbetrieb ludwigshafen · oepnv betrieb ludwigshafen | 0.559 | – | – | – |
| Chemiepark Weinheim · Chemiepark Hockenheim | chemiepark weinheim · chemiepark hockenheim | 0.556 | – | – | – |
| Brauerei Bruchsal · Kelterei Bruchsal | brauerei bruchsal · kelterei bruchsal | 0.545 | – | – | – |
| Forstbetrieb Rheinhessen · Forstbetrieb Rheinufer BW | forstbetrieb rheinhessen · forstbetrieb rheinufer bw | 0.545 | – | – | – |
| Forstbetrieb Rheinhessen e.K. · Forstbetrieb Rheinufer BW | forstbetrieb rheinhessen · forstbetrieb rheinufer bw | 0.545 | – | – | – |
| Entsorgungsbetrieb Mannheim · Entsorgungsbetrieb Landau | entsorgungsbetrieb mannheim · entsorgungsbetrieb landau | 0.543 | – | – | – |
| Entsorgungsbetrieb Speyer · Entsorgungsbetrieb Mannheim | entsorgungsbetrieb speyer · entsorgungsbetrieb mannheim | 0.543 | – | – | – |
| Sägewerk Grünstadt · Stadtwerke Grünstadt | saegewerk gruenstadt · stadtwerke gruenstadt | 0.538 | – | – | – |
| Sägewerk Grünstadt · Stadtwerke Grünstadt | saegewerk gruenstadt · stadtwerke gruenstadt | 0.538 | – | – | – |
| Spedition Weinheim · Spedition Hockenheim | spedition weinheim · spedition hockenheim | 0.538 | – | – | – |
| Tankstellenbetreiber Bruchsal · Tankstellenbetreiber Haßloch | tankstellenbetreiber bruchsal · tankstellenbetreiber hassloch | 0.538 | – | – | – |
| Glasindustrie Bruchsal · Industriebetrieb Bruchsal | glasindustrie bruchsal · industriebetrieb bruchsal | 0.533 | – | – | – |
| Glasindustrie Haßloch · Industriebetrieb Haßloch | glasindustrie hassloch · industriebetrieb hassloch | 0.533 | – | – | – |
| Landschaftspflegeverband Walldürn · Landschaftspflegeverband Hockenheim | landschaftspflegeverband wallduern · landschaftspflegeverband hockenheim | 0.533 | – | – | – |
| Agrarbetrieb Grünstadt · ÖPNV-Betrieb Grünstadt | agrarbetrieb gruenstadt · oepnv betrieb gruenstadt | 0.531 | – | – | – |
| Entsorgungsbetrieb Mannheim · Entsorgungsbetrieb Hamburg | entsorgungsbetrieb mannheim · entsorgungsbetrieb hamburg | 0.528 | – | – | – |
| Agrarbetrieb Neustadt a. d. W. · Entsorgungsbetrieb Neustadt a. d. W. | agrarbetrieb neustadt a d w · entsorgungsbetrieb neustadt a d w | 0.525 | – | – | – |
| Stadt Schwetzingen · Bauhof Schwetzingen | stadt schwetzingen · bauhof schwetzingen | 0.520 | – | – | – |
| Stadtwerke Grünstadt · Zementwerk Grünstadt | stadtwerke gruenstadt · zementwerk gruenstadt | 0.519 | – | – | – |
| Stadtwerke Grünstadt · Zementwerk Grünstadt | stadtwerke gruenstadt · zementwerk gruenstadt | 0.519 | – | – | – |
| Entsorgungsbetrieb Frankenthal · Entsorgungsbetrieb Landau | entsorgungsbetrieb frankenthal · entsorgungsbetrieb landau | 0.514 | – | – | – |
| Entsorgungsbetrieb Speyer · Entsorgungsbetrieb Frankenthal | entsorgungsbetrieb speyer · entsorgungsbetrieb frankenthal | 0.514 | – | – | – |
| Forstbetrieb Neustadt a. d. W. · Entsorgungsbetrieb Neustadt a. d. W. | forstbetrieb neustadt a d w · entsorgungsbetrieb neustadt a d w | 0.512 | – | – | – |
| Agrarbetrieb Neustadt a. d. W. · Agrarbetrieb Grünstadt | agrarbetrieb neustadt a d w · agrarbetrieb gruenstadt | 0.500 | – | – | – |
| Baustoffhandel Landau · Baustoffhandel Weinheim | baustoffhandel landau · baustoffhandel weinheim | 0.500 | – | – | – |
| Entsorgungsbetrieb Frankenthal · Entsorgungsbetrieb Hamburg | entsorgungsbetrieb frankenthal · entsorgungsbetrieb hamburg | 0.500 | – | – | – |
| Glasindustrie Landau · Industriebetrieb Landau | glasindustrie landau · industriebetrieb landau | 0.500 | – | – | – |
| Straßenmeisterei Frankenthal · Straßenmeisterei Worms | strassenmeisterei frankenthal · strassenmeisterei worms | 0.500 | – | – | – |
| Wertstoffhof Wiesloch · Wertstoffhof Mosbach | wertstoffhof wiesloch · wertstoffhof mosbach | 0.500 | – | – | – |
