# AP2.5 PR c — Kalibrierung der Dubletten-Schwellen (E66)

Stand 01.10.2026. Gerechnet ohne Datenbank (Eric: lokal oder in der CI,
nie gegen die gemeinsame Preview) mit `apps/web/scripts/dubletten-kalibrierung.ts`:

```
pnpm --filter web exec tsx scripts/dubletten-kalibrierung.ts
```

Das Skript normalisiert alle Seed-Namen (Seed-A25 aus
`scripts/seed-akteure-daten.ts`, Seed-Bestand aus `scripts/seed-daten.ts`)
mit dem TypeScript-Spiegelbild von `akteur_name_norm` und rechnet die
pg_trgm-Ähnlichkeit nach (Trigramme wie pg_trgm; Paritaet SQL ↔ TS prüft
`dubletten-check` in der CI über die geteilten Fixtures). Der Test
`scripts/dubletten-kalibrierung.test.ts` hält die Trennung fest.

## Ergebnis

Kandidaten des Seeds: 5 Paare, schwächster 1.000.
Nicht-Kandidaten ab 0,30: 356 Paare, stärkster 1.000 (Agrarbetrieb Heidelberg · Agrarbetrieb Heidelberg).
Schwellen: stark ≥ 0.6 mit gleicher PLZ oder gleichem Kreis-ARS, schwach ≥ 0.75.

**Befund 1 — die Seed-Kandidaten liegen alle bei 1,000.** Die fünf
beauftragten Kandidatenpaare (drei stark, zwei schwach) unterscheiden sich nur
in Rechtsform oder Umlaut („Müller Agrar GmbH" · „Mueller Agrar", „Biogas
Kraichgau GmbH & Co. KG" · „Biogas Kraichgau KG"). Die Normalisierung macht
sie identisch; die Schwelle wird deshalb nicht von den Kandidaten, sondern
von den falschen Freunden bestimmt.

**Befund 2 — falsche Freunde reichen bis 0,696.** Am selben Ort: „Stadt
Hockenheim" · „Stadtwerke Hockenheim" 0,696, „Forstbetrieb Neustadt a. d. W."
· „Agrarbetrieb Neustadt a. d. W." 0,618 (langer Ortsname). An verschiedenen
Orten mit gleicher Betriebsart: „Winzergenossenschaft Weinheim" · „… Sinsheim"
0,686, „Landschaftspflegeverband Eberbach" · „… Buchen" 0,632, „Sägewerk
Mannheim" · „Sägewerk Weinheim" 0,583. „Entsorgung Mannheim GmbH" ·
„Entsorgungsbetrieb Mannheim" 0,655 ist vermutlich eine echte Dublette.

**Befund 3 — realistische Varianten liegen bei 0,65–0,83** (nicht im Seed,
nachgerechnet):

| Variante | Ähnlichkeit |
|---|---|
| Stadtwerke Speyer · Stadtwerke Speyer Energie | 0,680 |
| Stadtwerke Speyer · Stadwerke Speyer (Tippfehler) | 0,737 |
| Müller Agrar · Müler Agrar (Tippfehler) | 0,800 |
| Biogas Kraichgau · Biogasanlage Kraichgau | 0,667 |
| Forstbetrieb Rheinhessen · Forstbetrieb Rheinhessen Nord | 0,833 |
| Papierfabrik Neckartal · Papierfabrik Neckartal Werk 2 | 0,767 |
| Raiffeisen Mosbach · Raiffeisen Mosbach Agrar | 0,760 |
| Hof Sonnenberg · Sonnenberg Hof | 1,000 |
| Kompostwerk Vorderpfalz · Kompostwerk Vorderpfalz Betriebs | 0,727 |
| Chemiepark Ludwigshafen · Chemiepark Ludwigshafen Nord | 0,828 |
| Gemeinde Haßloch · Gemeindeverwaltung Haßloch | 0,586 |
| AVR Abfallverwertung Rhein-Neckar · AVR Rhein-Neckar | 0,515 |

**Befund 4 — acht gleichnamige Paare im Seed-Bestand** (`seed-daten.ts`,
z. B. „Agrarbetrieb Heidelberg" zweimal) sind echte Namensdubletten und
werden auf der Preview als Vorschläge erscheinen; das ist richtig so.

## Entscheidung (Konstanten in `apps/web/lib/akteur-norm.ts`)

- `DUBLETTE_STARK = 0,60` — mit Ortsbezug (gleiche PLZ oder gleicher
  Kreis-ARS) zählt die Trefferquote: echte Varianten ab 0,65 werden
  gefunden, die falschen Freunde am selben Ort (0,62–0,70) bewusst mit
  vorgeschlagen — dafür gibt es „keine Dublette".
- `DUBLETTE_SCHWACH = 0,75` — ohne Ortsbezug zählt die Genauigkeit: gleiche
  Betriebsart an anderem Ort (bis 0,69) bleibt darunter, Tippfehler-
  und Zusatzwort-Varianten (0,74–0,83) meist darüber; was knapp darunter
  liegt, wird über den Ortsbezug (stark) gefunden, sobald die PLZ stimmt.
- Es gibt keine saubere Trennlinie zwischen 0,65 und 0,75 — die beiden
  Schwellen sind der Kompromiss aus den Befunden 2 und 3. Ändert sich die
  Normalisierung oder der Seed, zeigt `dubletten-kalibrierung.test.ts`, ob
  die Trennung noch hält.

## Paare ab 0,50 (vollständige Liste ab 0,30 über das Skript)

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
