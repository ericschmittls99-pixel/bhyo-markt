/**
 * AP2.5: die Testdaten des Seeds (seed-akteure.ts) ohne Datenbankzugriff —
 * damit die Dubletten-Kalibrierung (PR c, scripts/dubletten-kalibrierung.ts
 * und dubletten-kalibrierung.test.ts) dieselben Namen und Orte liest, ohne
 * das Seed-Skript zu starten (das bricht ohne SEED_DATABASE_URL_PREVIEW ab).
 */
export const A25_ORTE: { ort: string; plz: string; lng: number; lat: number }[] = [
  { ort: "Speyer", plz: "67346", lng: 8.43, lat: 49.32 },
  { ort: "Ludwigshafen", plz: "67059", lng: 8.44, lat: 49.48 },
  { ort: "Frankenthal", plz: "67227", lng: 8.35, lat: 49.53 },
  { ort: "Worms", plz: "67547", lng: 8.36, lat: 49.63 },
  { ort: "Landau", plz: "76829", lng: 8.12, lat: 49.2 },
  { ort: "Neustadt a. d. W.", plz: "67433", lng: 8.14, lat: 49.35 },
  { ort: "Bad Dürkheim", plz: "67098", lng: 8.17, lat: 49.46 },
  { ort: "Grünstadt", plz: "67269", lng: 8.17, lat: 49.57 },
  { ort: "Heidelberg", plz: "69117", lng: 8.69, lat: 49.41 },
  { ort: "Mannheim", plz: "68159", lng: 8.47, lat: 49.49 },
  { ort: "Weinheim", plz: "69469", lng: 8.67, lat: 49.55 },
  { ort: "Sinsheim", plz: "74889", lng: 8.88, lat: 49.25 },
  { ort: "Wiesloch", plz: "69168", lng: 8.7, lat: 49.29 },
  { ort: "Bruchsal", plz: "76646", lng: 8.6, lat: 49.12 },
  { ort: "Eppingen", plz: "75031", lng: 8.91, lat: 49.14 },
  { ort: "Mosbach", plz: "74821", lng: 9.15, lat: 49.35 },
  { ort: "Eberbach", plz: "69412", lng: 8.99, lat: 49.47 },
  { ort: "Buchen", plz: "74722", lng: 9.32, lat: 49.52 },
  { ort: "Walldürn", plz: "74731", lng: 9.37, lat: 49.58 },
  { ort: "Hockenheim", plz: "68766", lng: 8.55, lat: 49.32 },
  { ort: "Schwetzingen", plz: "68723", lng: 8.57, lat: 49.38 },
  { ort: "Germersheim", plz: "76726", lng: 8.37, lat: 49.22 },
  { ort: "Haßloch", plz: "67454", lng: 8.26, lat: 49.36 },
];

export interface A25Akteur {
  key: string;
  name: string;
  sektor: string;
  ortIdx: number;
  /** Sitz: Strasse fehlt = unvollstaendig; Pin fehlt = unvollstaendig. */
  strasse: string | null;
  ohnePin?: boolean;
  /** Anzahl Stroeme (0 = verwaist). */
  stroeme: number;
  /** created_at zurueckdatiert (Monate) — fuer den Verwaist-Hinweis. */
  alterMonate?: number;
  /** Stroeme ohne Beleg (ohne_beleg). */
  ohneBeleg?: boolean;
  hinweis?: string;
}

/** Mindestens 40 Akteure ueber alle Sektoren und Orte — Namen mit Rechtsformen fuer die Normalisierung (PR c). */
export const A25_AKTEURE: A25Akteur[] = [
  // Dubletten stark (aehnlicher Name, gleiche PLZ)
  { key: "mueller-agrar-1", name: "Müller Agrar GmbH", sektor: "landwirtschaft", ortIdx: 11, strasse: "Hauptstraße 12", stroeme: 2, hinweis: "Dublette stark A" },
  { key: "mueller-agrar-2", name: "Mueller Agrar", sektor: "landwirtschaft", ortIdx: 11, strasse: "Bahnhofstraße 3", stroeme: 1, hinweis: "Dublette stark A" },
  { key: "stadtwerke-speyer-1", name: "Stadtwerke Speyer GmbH", sektor: "energie", ortIdx: 0, strasse: "Industriestraße 9", stroeme: 2, hinweis: "Dublette stark B" },
  { key: "stadtwerke-speyer-2", name: "Stadtwerke Speyer", sektor: "energie", ortIdx: 0, strasse: null, stroeme: 1, hinweis: "Dublette stark B, unvollstaendig" },
  { key: "biogas-kraich-1", name: "Biogas Kraichgau GmbH & Co. KG", sektor: "energie", ortIdx: 14, strasse: "Am Hof 1", stroeme: 1, hinweis: "Dublette stark C" },
  { key: "biogas-kraich-2", name: "Biogas Kraichgau KG", sektor: "energie", ortIdx: 14, strasse: "Am Hof 1", stroeme: 1, hinweis: "Dublette stark C" },
  // Dubletten schwach (nur aehnlicher Name, andere PLZ)
  { key: "forst-rhein-1", name: "Forstbetrieb Rheinhessen e.K.", sektor: "forstwirtschaft", ortIdx: 3, strasse: "Waldweg 4", stroeme: 1, hinweis: "Dublette schwach D" },
  { key: "forst-rhein-2", name: "Forstbetrieb Rheinhessen", sektor: "forstwirtschaft", ortIdx: 7, strasse: "Waldweg 4", stroeme: 1, hinweis: "Dublette schwach D" },
  { key: "papier-neckar-1", name: "Papierfabrik Neckartal AG", sektor: "industrie", ortIdx: 16, strasse: "Neckarstraße 20", stroeme: 2, hinweis: "Dublette schwach E" },
  { key: "papier-neckar-2", name: "Papierfabrik Neckartal", sektor: "industrie", ortIdx: 15, strasse: "Neckarstraße 20", stroeme: 1, hinweis: "Dublette schwach E" },
  // Verwaiste (ohne Strom) — drei aelter als der Parameter (6 Monate), drei jung
  { key: "verwaist-alt-1", name: "Altholz Pfalz GmbH", sektor: "holzwirtschaft", ortIdx: 4, strasse: "Holzweg 2", stroeme: 0, alterMonate: 8, hinweis: "verwaist, 8 Monate" },
  { key: "verwaist-alt-2", name: "Kompostwerk Vorderpfalz", sektor: "abfallwirtschaft", ortIdx: 5, strasse: "Deponiestraße 1", stroeme: 0, alterMonate: 12, hinweis: "verwaist, 12 Monate" },
  { key: "verwaist-alt-3", name: "Gemeinde Haßloch", sektor: "kommunal", ortIdx: 22, strasse: "Rathausplatz 1", stroeme: 0, alterMonate: 7, hinweis: "verwaist, 7 Monate" },
  { key: "verwaist-jung-1", name: "Hof Sonnenberg GbR", sektor: "landwirtschaft", ortIdx: 6, strasse: "Sonnenberg 5", stroeme: 0, alterMonate: 1, hinweis: "verwaist, 1 Monat" },
  { key: "verwaist-jung-2", name: "Brauerei Bruchsal", sektor: "lebensmittel", ortIdx: 13, strasse: "Brauergasse 7", stroeme: 0, hinweis: "verwaist, neu" },
  { key: "verwaist-jung-3", name: "Stadt Hockenheim", sektor: "kommunal", ortIdx: 19, strasse: null, stroeme: 0, hinweis: "verwaist, neu, unvollstaendig" },
  // Unvollstaendig (ohne Strasse / ohne Pin)
  { key: "unvoll-1", name: "Sägewerk Odenwald GmbH", sektor: "holzwirtschaft", ortIdx: 17, strasse: null, stroeme: 1, hinweis: "unvollstaendig: ohne Strasse" },
  { key: "unvoll-2", name: "Mühle am Neckar", sektor: "lebensmittel", ortIdx: 8, strasse: "Mühlweg 2", ohnePin: true, stroeme: 1, hinweis: "unvollstaendig: ohne Pin" },
  { key: "unvoll-3", name: "Landkreis Germersheim", sektor: "kommunal", ortIdx: 21, strasse: null, ohnePin: true, stroeme: 2, hinweis: "unvollstaendig: ohne Strasse und Pin" },
  // Ohne Sektor (bewusste Auswahl, Systemzeile)
  { key: "ohne-1", name: "Verein Streuobst Weinstraße e.V.", sektor: "ohne_sektor", ortIdx: 4, strasse: "Obstgasse 3", stroeme: 1, hinweis: "ohne Sektor" },
  { key: "ohne-2", name: "Projektgesellschaft Rhein-Neckar mbH", sektor: "ohne_sektor", ortIdx: 9, strasse: "Planckstraße 8", stroeme: 1, hinweis: "ohne Sektor" },
  { key: "ohne-3", name: "Initiative Walldürn", sektor: "ohne_sektor", ortIdx: 18, strasse: null, stroeme: 0, hinweis: "ohne Sektor, verwaist" },
  // Ohne Beleg (Stroeme ohne Belegdatei)
  { key: "ohnebeleg-1", name: "Gärtnerei Weinheim OHG", sektor: "landwirtschaft", ortIdx: 10, strasse: "Gartenstraße 1", stroeme: 2, ohneBeleg: true, hinweis: "ohne Beleg" },
  { key: "ohnebeleg-2", name: "Entsorgung Mannheim GmbH", sektor: "abfallwirtschaft", ortIdx: 9, strasse: "Hafenstraße 50", stroeme: 1, ohneBeleg: true, hinweis: "ohne Beleg" },
  // Regelfaelle ueber alle Sektoren und Orte
  { key: "r-1", name: "Zuckerfabrik Wiesloch AG", sektor: "lebensmittel", ortIdx: 12, strasse: "Fabrikstraße 1", stroeme: 2 },
  { key: "r-2", name: "Raiffeisen Mosbach eG", sektor: "landwirtschaft", ortIdx: 15, strasse: "Marktstraße 4", stroeme: 1 },
  { key: "r-3", name: "Stadt Landau", sektor: "kommunal", ortIdx: 4, strasse: "Marktstraße 50", stroeme: 1 },
  { key: "r-4", name: "Chemiepark Ludwigshafen GmbH", sektor: "industrie", ortIdx: 1, strasse: "Carl-Bosch-Straße 38", stroeme: 2 },
  { key: "r-5", name: "Holzhof Buchen GbR", sektor: "holzwirtschaft", ortIdx: 17, strasse: "Am Holzplatz 2", stroeme: 1 },
  { key: "r-6", name: "AVR Abfallverwertung Rhein-Neckar", sektor: "abfallwirtschaft", ortIdx: 12, strasse: "Dietmar-Hopp-Straße 8", stroeme: 2 },
  { key: "r-7", name: "Energie Südwest AG", sektor: "energie", ortIdx: 4, strasse: "Industriestraße 18", stroeme: 1 },
  { key: "r-8", name: "Weingut Bad Dürkheim", sektor: "landwirtschaft", ortIdx: 6, strasse: "Weinstraße 100", stroeme: 1 },
  { key: "r-9", name: "Forstamt Pfälzerwald", sektor: "forstwirtschaft", ortIdx: 5, strasse: "Forsthausweg 1", stroeme: 2 },
  { key: "r-10", name: "Stadtreinigung Heidelberg", sektor: "abfallwirtschaft", ortIdx: 8, strasse: "Hardtstraße 2", stroeme: 1 },
  { key: "r-11", name: "Bäckerei Worms GmbH", sektor: "lebensmittel", ortIdx: 3, strasse: "Backgasse 9", stroeme: 1 },
  { key: "r-12", name: "Gemeinde Eberbach", sektor: "kommunal", ortIdx: 16, strasse: "Leopoldsplatz 1", stroeme: 1 },
  { key: "r-13", name: "Pellets Rhein-Neckar GmbH", sektor: "holzwirtschaft", ortIdx: 20, strasse: "Schälzigweg 3", stroeme: 1 },
  { key: "r-14", name: "Agrargenossenschaft Eppingen", sektor: "landwirtschaft", ortIdx: 14, strasse: "Feldweg 11", stroeme: 1 },
  { key: "r-15", name: "Biomassehof Frankenthal e.K.", sektor: "energie", ortIdx: 2, strasse: "Mörscher Straße 20", stroeme: 2 },
  { key: "r-16", name: "Papier & Pappe Germersheim", sektor: "industrie", ortIdx: 21, strasse: "Rheinstraße 7", stroeme: 1 },
  { key: "r-17", name: "Stadt Schwetzingen", sektor: "kommunal", ortIdx: 20, strasse: "Hebelstraße 1", stroeme: 1 },
  { key: "r-18", name: "Sägewerk Walldürn GmbH & Co. KG", sektor: "holzwirtschaft", ortIdx: 18, strasse: "Sägeweg 6", stroeme: 1 },
];

