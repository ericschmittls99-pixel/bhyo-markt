import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  geometry,
  integer,
  jsonb,
  numeric,
  pgEnum,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Die drei bestaetigten Enums aus docs/ap0-schema-entscheidungen.md. Werte in
// snake_case ohne Umlaute; deutsche Anzeige-Labels leben ausschliesslich im
// Frontend. Reihenfolge ist verbindlich (Postgres-Enums sind nicht umsortierbar).

/** Einheitlicher Datensatz-Status fuer Biomassestrom, Output-Bedarf, Akteur, Interesse. */
export const datensatzStatus = pgEnum("datensatz_status", [
  "entwurf",
  "in_pruefung",
  "geprueft",
  "verworfen",
]);

/**
 * Belegtypen (E34). Die DB-Reihenfolge ist Anhaenge-Historie, KEINE
 * Rangfolge: Postgres-Enums lassen nur Anhaengen zu (`betriebsdaten` 0002,
 * `webrecherche` 0021) und Umbenennen (`dokument_link` -> `dokument` 0021).
 * Die fachliche Reihenfolge (Betriebsdaten > Vertrag > Absichtserklaerung >
 * Angebot > Gespraech > Dokument > Webrecherche) lebt in
 * apps/web/lib/qualitaet.ts (BELEG_TYPEN) und gilt ueberall in der Anzeige.
 */
export const belegTyp = pgEnum("beleg_typ", [
  "dokument",
  "gespraech",
  "angebot",
  "absichtserklaerung",
  "vertrag",
  "betriebsdaten",
  "webrecherche",
]);

/** Kommunale Bereitschaftsstufe (Feld an der Region). */
export const bereitschaftStufe = pgEnum("bereitschaft_stufe", [
  "kein_kontakt",
  "erstgespraech",
  "positives_signal",
  "absichtserklaerung",
]);

// Vier weitere Enums aus docs/ap1a-handoff-datenmodell.md. Gleiche Regeln:
// snake_case, keine Umlaute, Reihenfolge verbindlich. materialart ist bewusst
// KEIN Enum, sondern eine Lookup-Tabelle (siehe unten) – es waechst und ein
// Enum-Wert liesse sich in Postgres nicht umbenennen oder entfernen.

/** Abgeleitete Qualitaetsstufe eines Belegs (A hoch, D niedrig). Nie gewaehlt. */
export const qualitaetsStufe = pgEnum("qualitaets_stufe", ["A", "B", "C", "D"]);
/**
 * F8/E30: Genau drei Rollen. "Bewerten" ist bewusst KEINE eigene Rolle — die
 * Frage wird erst mit AP3 geprueft. Reihenfolge = aufsteigende Rechte.
 */
export const benutzerRolle = pgEnum("benutzer_rolle", [
  "betrachter",
  "bearbeiter",
  "admin",
  // E42/AP2.1 PR b: Pruefer (sperren, zuweisen). DB-Reihenfolge = Anhaenge-
  // Historie; die Hierarchie steht in apps/web/lib/rechte/matrix.ts.
  "pruefer",
]);

// F0b: VG250-Ebenen — Laender (2-stelliger ARS) und Kreise (5-stellig).
export const verwaltungsEbene = pgEnum("verwaltungs_ebene", ["land", "kreis"]);

/** Herkunft des Preis-Korridors am Biomassestrom. */
export const preisHerkunft = pgEnum("preis_herkunft", [
  "eigene_datenbank",
  "marktdaten",
  "schaetzung",
]);

/** Lebenszyklus eines Analyse-Laufs. */
export const laufStatus = pgEnum("lauf_status", [
  "arbeitsfassung",
  "eingefroren",
]);

/**
 * Feedstock-Cluster (AP1f-a) – Ebene ueber der Materialart, chemische Systematik,
 * Farbschluessel auf der Karte. Ersetzt materialart_gruppe. Reihenfolge
 * verbindlich, snake_case ohne Umlaute.
 */
export const feedstockCluster = pgEnum("feedstock_cluster", [
  "organische_rest_abfallstoffe",
  "lignozellulosische_reststoffe",
  "nachwachsende_rohstoffe",
  "lipide_spezialfeedstocks",
  "polymere_synthetische_c_quellen",
]);

/**
 * Output-Gruppe (AP1f-a) – Ebene ueber dem Output-Produkt, Farbschluessel.
 * Reihenfolge folgt der Wertschoepfung (Primaerprodukte vor H2, Derivate danach).
 */
export const outputGruppe = pgEnum("output_gruppe", [
  "primaerprodukte",
  "wasserstoff",
  "derivate",
  "add_ons",
]);

/** Ob ein Output-Produkt Zielprodukt oder Add-On (Koppelprodukt) ist. */
export const outputArt = pgEnum("output_art", ["target", "add_on"]);

/**
 * EINGEFRORENER Spaltentyp fuer region.gebiet — NICHT "korrigieren".
 *
 * Die echte Spalte ist seit Migration 0005 (von Hand) geometry(Polygon,4326);
 * Schema und alle Snapshots sagen aber "geometry(point)", weil drizzle-kit 0.31
 * weder Polygon noch SRID typisiert. Das ist diff-neutral und damit sicher:
 * `drizzle-kit generate` vergleicht Schema gegen Snapshot, nie gegen die
 * Datenbank — solange hier "geometry(point)" steht, entsteht KEIN ALTER.
 * Wer diesen String auf Polygon "richtigstellt", erzeugt beim naechsten
 * generate ein ALTER auf die produktive Regionsgeometrie. Deshalb ein
 * Custom-Type mit sprechendem Namen statt der eingebauten geometry():
 * der Rohtyp bleibt eingefroren, der Zugriff laeuft ohnehin nur ueber
 * raw SQL (ST_*).
 */
const geometryPolygonEingefroren = customType<{ data: unknown }>({
  dataType() {
    return "geometry(point)";
  },
});

// F0b: echter Typ fuer NEUE Spalten (kein Einfrieren noetig). Achtung
// drizzle-kit 0.31: SRID landet nicht in der Migration — von Hand auf
// geometry(MultiPolygon,4326) korrigieren, Snapshot unangetastet lassen.
const geometryMultiPolygon = customType<{ data: unknown }>({
  dataType() {
    return "geometry(MultiPolygon,4326)";
  },
});

// --- Kernentitaeten (Reihenfolge nach FK-Abhaengigkeiten) --------------------

/**
 * Materialart als Lookup-Tabelle statt Enum: die Liste waechst erfahrungsgemaess,
 * und ein Enum-Wert liesse sich in Postgres nicht umbenennen oder entfernen.
 */
export const materialart = pgTable("materialart", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
  // Feedstock-Cluster (AP1f-a, ersetzt gruppe). NOT NULL; Inline-Neuanlage-Pflichtfeld.
  cluster: feedstockCluster("cluster").notNull(),
});

/**
 * Output-Produkt als Lookup-Tabelle (AP1f-a, analog materialart) – zweistufig
 * wie die Feedstock-Seite: Produkt -> Gruppe. Die Liste waechst.
 */
export const outputProdukt = pgTable("output_produkt", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
  gruppe: outputGruppe("gruppe").notNull(),
  art: outputArt("art").notNull(),
});

/** Beleg (Nachweis) fuer einen Wert. Wird von Region, Biomassestrom, Output-Bedarf referenziert. */
export const beleg = pgTable("beleg", {
  id: uuid("id").primaryKey().defaultRandom(),
  // E28/E29: interne Belegnummer B-000123 aus der Sequenz beleg_nr_seq.
  // VERGEBEN, nicht abgeleitet — aber mit genau einem Ursprung: die
  // Sequenz. Kein Anwendungscode und kein Formular setzt sie; ein Trigger
  // in Migration 0018 verhindert nachtraegliche Aenderungen.
  belegNr: text("beleg_nr")
    .notNull()
    .unique()
    .default(sql`'B-' || lpad(nextval('beleg_nr_seq')::text, 6, '0')`),
  typ: belegTyp("typ").notNull(),
  dateiKey: text("datei_key"),
  linkUrl: text("link_url"),
  notiz: text("notiz"),
  // E33: Faelligkeit der oberen vier Typen (Betriebsdaten, Vertrag,
  // Absichtserklaerung, Angebot) — dort Pflicht (Formular seit 0021, CHECK
  // folgt als eigene Migration in Schritt 3). Die unteren drei Typen tragen
  // hier nichts; ihre Frist ist die Typ-Frist ab erstellt_am.
  gueltigBis: date("gueltig_bis"),
  // E34: FREIGABE ZUR EXTERNEN VERWENDUNG (Kommunen-PDF, CSV — wirksam ab
  // F6). Seit 0021 KEIN Eingang der Qualitaets-Ableitung mehr; der Name ist
  // historisch. Default false: ohne ausdrueckliche Freigabe bleibt der Beleg
  // intern.
  externNachvollziehbar: boolean("extern_nachvollziehbar")
    .notNull()
    .default(false),
  // Typ-spezifische Zusatzfelder. Seit 0021 gelesen: quellenangabe (Pflicht,
  // CHECK beleg_quellenangabe_check) und kernnotiz (gespraech). Nicht mehr
  // gelesen, aber in Altzeilen vorhanden: amtlich, gespraechsdatum,
  // gespraechspartner (E34-Durchsicht 25.09.2026). Seed-Marker `seed`.
  metadata: jsonb("metadata"),
  // Fachlicher Erstellungszeitpunkt des Belegs, getrennt vom technischen created_at.
  erstelltAm: timestamp("erstellt_am", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // E23/E34: Die Stufe existiert nur als Ableitung — GENERATED aus den
  // Spalten DIESER Zeile ueber die IMMUTABLE SQL-Funktion
  // qualitaetsstufe(typ, datei_key, link_url) aus Migration 0021 (Spiegel von
  // apps/web/lib/qualitaet.ts, Paritaetstest im CI). Ein Schreibversuch
  // scheitert in Postgres; im TS-Typ ist die Spalte durch generatedAlwaysAs
  // aus allen Insert-/Update-Typen heraus.
  qualitaet: qualitaetsStufe("qualitaet").generatedAlwaysAs(
    sql`qualitaetsstufe(typ, datei_key, link_url)`,
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [
  // E34: Ein Formular ist eine Bitte, ein CHECK eine Zusicherung. Die
  // Quellenangabe ist fuer alle sieben Typen Pflicht; leer und reiner
  // Leerraum sind keine Quellenangabe. Prueft den JSON-Pfad, bis die
  // Quellenangabe eine eigene Spalte bekommt (Kandidat, siehe E34).
  check(
    "beleg_quellenangabe_check",
    sql`btrim(coalesce(${t.metadata} ->> 'quellenangabe', '')) <> ''`,
  ),
  // E33 (Schritt 3, Migration 0022): Die oberen vier Typen tragen ihre
  // Faelligkeit selbst — gueltig_bis ist bei ihnen Pflicht. Die unteren drei
  // (gespraech, dokument, webrecherche) haben kein Enddatum im Dokument;
  // fuer sie gilt die Typ-Frist ab erstellt_am (lib/verifizierung.ts).
  check(
    "beleg_gueltig_bis_check",
    sql`${t.typ} NOT IN ('betriebsdaten', 'vertrag', 'absichtserklaerung', 'angebot') OR ${t.gueltigBis} IS NOT NULL`,
  ),
]);

/**
 * F0b/E25: Verwaltungsgebiete aus VG250 (BKG), Ebenen Land und Kreis.
 * Referenziert wird ausschliesslich ueber den ARS, nie ueber den Namen —
 * der Name ist Anzeige. BEWUSST getrennt von `region` (Fokusregion mit
 * Bereitschaftsstufe = Projektregion); eine Region kann spaeter aus
 * Kreisen zusammengesetzt werden. Befuellt nur vom Import-Workflow
 * import-vg250 (PR B), nie aus der App. Landkreis/Bundesland eines Stroms
 * werden NIE gespeichert, sondern per Point-in-Polygon abgeleitet (E23) —
 * siehe View strom_verwaltung in Migration 0015.
 */
export const verwaltungsgebiet = pgTable("verwaltungsgebiet", {
  // Amtlicher Regionalschluessel: 2-stellig (Land) oder 5-stellig (Kreis).
  ars: text("ars").primaryKey(),
  ebene: verwaltungsEbene("ebene").notNull(),
  name: text("name").notNull(),
  // Bezeichnung der Gebietseinheit ("Landkreis", "Kreisfreie Stadt", ...).
  bez: text("bez").notNull(),
  // Volle Aufloesung fuer den raeumlichen Join (GF=4, EPSG:4326).
  geom: geometryMultiPolygon("geom").notNull(),
  // Vereinfachte Geometrie fuer karte. (ST_SimplifyPreserveTopology, PR B).
  geomAnzeige: geometryMultiPolygon("geom_anzeige").notNull(),
  // Gebietsstand der VG250-Lieferung.
  stichtag: date("stichtag").notNull(),
});

/** Region ("Fokusregion") mit Flaechen-Geometrie und Bereitschaftsstufe. */
export const region = pgTable("region", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // Flaeche der Region als Polygon (AP1e, ersetzt Punkt+Radius aus 0003).
  // Zugehoerigkeit = ST_Contains(gebiet, standort_geom). Mittelpunkt bei Bedarf
  // per ST_Centroid(gebiet), keine eigene Spalte. Nie ueber Drizzle typisiert
  // gelesen/geschrieben – Zugriff ausschliesslich per raw sql (ST_*).
  gebiet: geometryPolygonEingefroren("gebiet").notNull(),
  bereitschaftStufe: bereitschaftStufe("bereitschaft_stufe")
    .notNull()
    .default("kein_kontakt"),
  bereitschaftBelegId: uuid("bereitschaft_beleg_id").references(() => beleg.id),
  bereitschaftNotiz: text("bereitschaft_notiz"),
  bereitschaftStand: date("bereitschaft_stand"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
},
  (t) => [
    index("region_bereitschaft_beleg_id_idx").on(t.bereitschaftBelegId),
  ],
);

/** Akteur (Biomasse-Anbieter oder Output-Abnehmer). */
export const akteur = pgTable("akteur", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /**
   * F5 PR B: Referenz auf `sektor.code` statt Freitext. NULL ist der
   * benannte Zustand "ohne Sektor" — fehlende Information, nicht "sonstige".
   */
  sektor: text("sektor").references(() => sektor.code),
  rollen: text("rollen")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  kontaktEmail: text("kontakt_email"),
  kontaktTelefon: text("kontakt_telefon"),
  ansprechperson: text("ansprechperson"),
  status: datensatzStatus("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Sektor eines Akteurs als Referenzdaten (F5 PR B) — Muster wie `materialart`
 * und `output_produkt`: Codes liegen in einer Tabelle, nicht als Freitext.
 * Vorher war `akteur.sektor` ein freies Feld; zwei Schreibweisen ergaben zwei
 * Filterwerte.
 *
 * **Leer heisst „ohne Sektor", nicht „sonstige"** (Entscheidung Eric,
 * 25.09.2026): Ein Akteur ohne Sektor traegt eine fehlende Information, keine
 * Restkategorie.
 *
 * Ein neuer Sektor braucht kuenftig eine Migration — wie bei Materialarten
 * und Produkten.
 */
export const sektor = pgTable("sektor", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
  /** Reihenfolge in Auswahllisten; gleiche Werte alphabetisch. */
  sortierung: integer("sortierung").notNull().default(0),
});

/**
 * Biomassestrom eines Akteurs mit eigenem Standort. KEINE manuell zugewiesene
 * Region – welche Region(en) den Strom erfassen, wird raeumlich abgeleitet:
 * seit AP1e per ST_Contains(region.gebiet, standort_geom) gegen das
 * Regions-Polygon (frueher ST_DWithin mit einzugsradius_km), nicht ueber
 * einen FK.
 */
export const biomassestrom = pgTable("biomassestrom", {
  id: uuid("id").primaryKey().defaultRandom(),
  akteurId: uuid("akteur_id")
    .notNull()
    .references(() => akteur.id),
  // Standort gehoert an den einzelnen Strom, nicht an den Akteur – ein Akteur
  // kann mehrere Sites haben. Alle nullable, kein Geocoding in AP1b.
  bezeichnung: text("bezeichnung"),
  ort: text("ort"),
  // F0b: landkreis und bundesland liegen physisch noch in der Tabelle,
  // sind hier aber bewusst nicht mehr deklariert — beide werden raeumlich
  // aus standort_geom abgeleitet (View strom_verwaltung, E23/E25). Der
  // physische DROP folgt als Migration 0016 (PR D) nach Erics Review der
  // Abweichungsliste.
  // F0a (Entscheidung Eric 23.09.2026): Adresse liegt AM STROM, der Akteur
  // bekommt bewusst KEINE Adressfelder — zwei Ablagen fuer dieselbe
  // Information braeuchten eine Konfliktregel. Alle nullable.
  strasse: text("strasse"),
  hausnummer: text("hausnummer"),
  plz: text("plz"),
  standortGeom: geometry("standort_geom", { type: "point", srid: 4326 }),
  kontaktperson: text("kontaktperson"),
  materialartCode: text("materialart_code")
    .notNull()
    .references(() => materialart.code),
  mengeRohFm: numeric("menge_roh_fm").notNull(),
  tsAnteilPct: numeric("ts_anteil_pct").notNull(),
  aschegehaltPct: numeric("aschegehalt_pct").notNull(),
  // Trockenmasse (atro) deterministisch aus Rohmenge, TS-Anteil und Aschegehalt.
  // Generated Column: Postgres rechnet, es gibt keine schreibbare Spalte.
  mengeAtro: numeric("menge_atro").generatedAlwaysAs(
    sql`menge_roh_fm * ts_anteil_pct / 100 * (1 - aschegehalt_pct / 100)`,
  ),
  zeitraumVon: date("zeitraum_von").notNull(),
  zeitraumBis: date("zeitraum_bis").notNull(),
  // Saison-INDEX (23.09.2026): 12 Zahlen, Referenzmarke 100 (kein
  // "Durchschnitt" — ohne Normierung ist das Mittel beliebig). Die
  // Skala ist BEDEUTUNGSLOS — nur die Verhaeltnisse zaehlen (anteil_m =
  // wert_m / Summe). Alt-Bestand summiert auf 100 und liefert damit exakt
  // dieselben Anteile. NICHT "gut gemeint" normieren.
  saisonalitaet: jsonb("saisonalitaet").notNull(),
  preisMin: numeric("preis_min"),
  preisMittel: numeric("preis_mittel"),
  preisMax: numeric("preis_max"),
  preisHerkunft: preisHerkunft("preis_herkunft"),
  belegId: uuid("beleg_id").references(() => beleg.id),
  // E23: qualitaet liegt physisch noch in der Tabelle, ist hier aber bewusst
  // nicht mehr deklariert — die Stufe haengt an der Beleg-Zeile (Fremdzeile)
  // und wird ueber den beleg-Join gelesen. Der physische DROP folgt als
  // eigene Migration 0014 nach der Verifikation.
  status: datensatzStatus("status").notNull(),
  // Weiche Markierung ohne Zeitraum (AP1j): verfuegbar, aber fuer bhyo
  // reserviert (Projekt steht noch nicht). Unabhaengig von vergabe_zeitraum.
  reserviertBhyo: boolean("reserviert_bhyo").notNull().default(false),
  // Stempel beim SETZEN der Checkbox (Review AP1j PR 2): bleibt beim
  // Editieren stehen, wird beim Abwaehlen genullt. Die Veraltung laeuft
  // ueber die Verifikations-Faelligkeit (PR 5), nicht ueber eine eigene
  // Schwelle. null = nicht reserviert.
  reserviertSeit: date("reserviert_seit"),
  // E44 (AP2.1 PR b): Sperre am Strom — Inhaber und Zeitpunkt, beide NULL
  // oder beide gesetzt (CHECK). FK auf benutzer(id), nie auf die E-Mail.
  gesperrtVon: uuid("gesperrt_von").references(() => benutzer.id),
  gesperrtAm: timestamp("gesperrt_am", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
},
  (t) => [
    index("biomassestrom_akteur_id_idx").on(t.akteurId),
    index("biomassestrom_beleg_id_idx").on(t.belegId),
    index("biomassestrom_materialart_code_idx").on(t.materialartCode),
    check(
      "biomassestrom_sperre_check",
      sql`(${t.gesperrtVon} is null) = (${t.gesperrtAm} is null)`,
    ),
  ],
);

/**
 * Output-Bedarf eines Akteurs mit eigenem Standort. Wie biomassestrom ohne
 * region_id – die Regionszuordnung ist raeumlich (ST_DWithin), kein FK.
 */
export const outputBedarf = pgTable("output_bedarf", {
  id: uuid("id").primaryKey().defaultRandom(),
  akteurId: uuid("akteur_id")
    .notNull()
    .references(() => akteur.id),
  // Standort je Bedarf (analog biomassestrom): ein Akteur kann mehrere Sites
  // haben. Alle nullable, kein Geocoding in AP1b.
  bezeichnung: text("bezeichnung"),
  ort: text("ort"),
  // F0b: landkreis und bundesland liegen physisch noch in der Tabelle,
  // sind hier aber bewusst nicht mehr deklariert — beide werden raeumlich
  // aus standort_geom abgeleitet (View strom_verwaltung, E23/E25). Der
  // physische DROP folgt als Migration 0016 (PR D) nach Erics Review der
  // Abweichungsliste.
  // F0a (Entscheidung Eric 23.09.2026): Adresse liegt AM STROM, der Akteur
  // bekommt bewusst KEINE Adressfelder — zwei Ablagen fuer dieselbe
  // Information braeuchten eine Konfliktregel. Alle nullable.
  strasse: text("strasse"),
  hausnummer: text("hausnummer"),
  plz: text("plz"),
  standortGeom: geometry("standort_geom", { type: "point", srid: 4326 }),
  kontaktperson: text("kontaktperson"),
  // Output-Produkt (AP1f-a, ersetzt vektor). FK auf output_produkt.code.
  produktCode: text("produkt_code")
    .notNull()
    .references(() => outputProdukt.code),
  mengeWert: numeric("menge_wert").notNull(),
  mengeEinheit: text("menge_einheit").notNull(),
  // Abnahmepreis je Einheit (AP1i E6/E13, V2-Mockup). Alle drei nullable:
  // Bestandsdaten haben keinen Preis. Ein Preis ohne Herkunft traegt keine
  // Konfidenz — an preis_herkunft haengt AP3 die Erloesseite an (wie beim
  // Preis-Korridor am biomassestrom).
  preis: numeric("preis"),
  // Bewusst text wie menge_einheit; die UI erzwingt die feste Liste
  // €/t · €/MWh · €/kg · €/Nm³. Wird Enum, sobald AP3 damit rechnet.
  preisEinheit: text("preis_einheit"),
  preisHerkunft: preisHerkunft("preis_herkunft"),
  zeitraumVon: date("zeitraum_von").notNull(),
  zeitraumBis: date("zeitraum_bis").notNull(),
  // Saison-INDEX (23.09.2026): 12 Zahlen, Referenzmarke 100 (kein
  // "Durchschnitt" — ohne Normierung ist das Mittel beliebig). Die
  // Skala ist BEDEUTUNGSLOS — nur die Verhaeltnisse zaehlen (anteil_m =
  // wert_m / Summe). Alt-Bestand summiert auf 100 und liefert damit exakt
  // dieselben Anteile. NICHT "gut gemeint" normieren.
  saisonalitaet: jsonb("saisonalitaet").notNull(),
  belegId: uuid("beleg_id").references(() => beleg.id),
  // E23: qualitaet physisch noch da, bewusst nicht deklariert — Ableitung
  // ueber den beleg-Join, DROP als Migration 0014 (siehe biomassestrom).
  status: datensatzStatus("status").notNull(),
  // Weiche Markierung ohne Zeitraum (AP1j), analog biomassestrom.
  reserviertBhyo: boolean("reserviert_bhyo").notNull().default(false),
  // Stempel-Semantik wie biomassestrom.reserviert_seit.
  reserviertSeit: date("reserviert_seit"),
  // E44 (AP2.1 PR b): Sperre wie biomassestrom.
  gesperrtVon: uuid("gesperrt_von").references(() => benutzer.id),
  gesperrtAm: timestamp("gesperrt_am", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
},
  (t) => [
    index("output_bedarf_akteur_id_idx").on(t.akteurId),
    index("output_bedarf_beleg_id_idx").on(t.belegId),
    index("output_bedarf_produkt_code_idx").on(t.produktCode),
    check(
      "output_bedarf_sperre_check",
      sql`(${t.gesperrtVon} is null) = (${t.gesperrtAm} is null)`,
    ),
  ],
);

/**
 * E44 (AP2.1 PR b): Zuweisung eines gesperrten Stroms an weitere Nutzer.
 * Genau EIN Elternbezug (CHECK), typisierte FKs, keine polymorphe Referenz;
 * je Strom-Typ ein partieller Unique-Index auf (strom, nutzer). Entsperren
 * loescht alle Zuweisungen des Stroms (Anwendung, in derselben Transaktion).
 * Projekte folgen in AP5 nach demselben Muster.
 */
export const stromZuweisung = pgTable(
  "strom_zuweisung",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    biomassestromId: uuid("biomassestrom_id").references(() => biomassestrom.id),
    outputBedarfId: uuid("output_bedarf_id").references(() => outputBedarf.id),
    nutzerId: uuid("nutzer_id")
      .notNull()
      .references(() => benutzer.id),
    zugewiesenVon: uuid("zugewiesen_von")
      .notNull()
      .references(() => benutzer.id),
    zugewiesenAm: timestamp("zugewiesen_am", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "strom_zuweisung_genau_ein_strom_check",
      sql`num_nonnulls(${t.biomassestromId}, ${t.outputBedarfId}) = 1`,
    ),
    uniqueIndex("strom_zuweisung_biomasse_nutzer_uidx")
      .on(t.biomassestromId, t.nutzerId)
      .where(sql`${t.biomassestromId} is not null`),
    uniqueIndex("strom_zuweisung_output_nutzer_uidx")
      .on(t.outputBedarfId, t.nutzerId)
      .where(sql`${t.outputBedarfId} is not null`),
  ],
);

/**
 * Vergabezeitraum (AP1j): Abschnitt innerhalb des Verfuegbarkeitszeitraums,
 * in dem ein Strom an Dritte oder an bhyo vergeben ist; 0..n je Strom,
 * genau EIN Elternbezug. Der Verfuegbarkeitsstatus (verfuegbar / vergeben /
 * reserviert / abgelaufen / noch nicht verfuegbar) wird daraus abgeleitet,
 * nie gespeichert — Hierarchie und Konventionen in
 * docs/ap1j-handoff-verfuegbarkeit-vergabe.md. Offene Enden: vergeben_von
 * leer = ab Verfuegbarkeitsbeginn, vergeben_bis leer = unbefristet; eine
 * Zeile ganz ohne Datum ist keine Vergabe (CHECK), der Strom bleibt
 * verfuegbar.
 */
export const vergabeZeitraum = pgTable(
  "vergabe_zeitraum",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    biomassestromId: uuid("biomassestrom_id").references(() => biomassestrom.id),
    outputBedarfId: uuid("output_bedarf_id").references(() => outputBedarf.id),
    vergebenVon: date("vergeben_von"),
    vergebenBis: date("vergeben_bis"),
    // Empfaenger als Freitext — Beleg/Begruendung tragen die Quelle.
    vergebenAn: text("vergeben_an"),
    // true = an bhyo vergeben (gewonnene Ausschreibung), false = extern.
    anBhyo: boolean("an_bhyo").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("vergabe_zeitraum_biomassestrom_id_idx").on(t.biomassestromId),
    index("vergabe_zeitraum_output_bedarf_id_idx").on(t.outputBedarfId),
    check(
      "vergabe_ein_elternteil_check",
      sql`(${t.biomassestromId} IS NULL) <> (${t.outputBedarfId} IS NULL)`,
    ),
    check(
      "vergabe_mindestens_ein_datum_check",
      sql`${t.vergebenVon} IS NOT NULL OR ${t.vergebenBis} IS NOT NULL`,
    ),
  ],
);

/** Interesse eines Akteurs an einer Region (max. ein Datensatz je Paar). */
export const akteurInteresse = pgTable(
  "akteur_interesse",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    akteurId: uuid("akteur_id")
      .notNull()
      .references(() => akteur.id),
    regionId: uuid("region_id")
      .notNull()
      .references(() => region.id),
    status: datensatzStatus("status").notNull(),
    notiz: text("notiz"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("akteur_interesse_region_id_idx").on(t.regionId),unique().on(t.akteurId, t.regionId)],
);

/**
 * Nummernkreis fuer die Lauf-ID-Vergabe (Format BW-JJJJ-NNN). Bezug per Jahr
 * mit `SELECT ... FOR UPDATE`, nie `count(*) + 1` – das waere nicht kollisionssicher.
 */
export const laufNummernkreis = pgTable("lauf_nummernkreis", {
  jahr: integer("jahr").primaryKey(),
  letzteNummer: integer("letzte_nummer").notNull().default(0),
});

/** Analyse-Lauf (Grundgeruest). Ein eingefrorener Lauf muss reproduzierbar bleiben. */
export const analyseLauf = pgTable("analyse_lauf", {
  id: uuid("id").primaryKey().defaultRandom(),
  regionId: uuid("region_id")
    .notNull()
    .references(() => region.id),
  // Fachliche, sprechende ID im Format BW-JJJJ-NNN, vergeben ueber laufNummernkreis.
  laufId: text("lauf_id").notNull().unique(),
  status: laufStatus("status").notNull().default("arbeitsfassung"),
  baureiheGewaehlt: text("baureihe_gewaehlt"),
  eingefrorenAm: timestamp("eingefroren_am", { withTimezone: true }),
  parametersatzVersion: text("parametersatz_version"),
  rechenkernVersion: text("rechenkern_version"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
},
  (t) => [
    index("analyse_lauf_region_id_idx").on(t.regionId),
  ],
);

/**
 * Entfernung (Platzhalter). Polymorpher Bezug auf Biomassestrom oder
 * Output-Bedarf – bewusst ohne FK-Constraint auf ziel_id, dafuer ein CHECK auf
 * ziel_typ. Die eigentliche Distanzberechnung entsteht erst mit AP3.
 */
export const entfernung = pgTable(
  "entfernung",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    laufId: uuid("lauf_id")
      .notNull()
      .references(() => analyseLauf.id),
    zielTyp: text("ziel_typ").notNull(),
    zielId: uuid("ziel_id").notNull(),
    luftlinieKm: numeric("luftlinie_km").notNull(),
    umwegfaktor: numeric("umwegfaktor").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("entfernung_lauf_id_idx").on(t.laufId),
    check(
      "entfernung_ziel_typ_check",
      sql`${t.zielTyp} in ('biomassestrom', 'output_bedarf')`,
    ),
  ],
);

/**
 * Aenderungshistorie (read-only Log) fuer die Erfassungs-UI. Polymorpher Bezug
 * auf die geloggte Entitaet – wie bei entfernung bewusst ohne FK-Constraint,
 * damit ein Log-Eintrag auch einen spaeter verworfenen Datensatz ueberdauert.
 */
/**
 * AP2.2 PR a: Ereignisarten des Protokolls — genau die Arten, die ein
 * Schreibpfad erzeugt (apps/web/lib/protokoll), plus `altbestand` fuer
 * Zeilen von vor der Migration 0026. Anhaenge-Historie, nicht umsortierbar.
 */
export const ereignisArt = pgEnum("ereignis_art", [
  "angelegt",
  "geaendert",
  "status_gesetzt",
  "verworfen",
  "gesperrt",
  "entsperrt",
  "zugewiesen",
  "zuweisung_entfernt",
  "benutzer_angelegt",
  "rolle_gesetzt",
  "benutzer_aktiviert",
  "benutzer_deaktiviert",
  "region_angelegt",
  "akteur_angelegt",
  "projekt_angelegt",
  "altbestand",
]);

export const aenderung = pgTable(
  "aenderung",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entitaetTyp: text("entitaet_typ").notNull(),
    entitaetId: uuid("entitaet_id").notNull(),
    zeitpunkt: timestamp("zeitpunkt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    text: text("text").notNull(),
    /**
     * F8/E30: Urheber als eigene Spalte statt als Textpraefix in `text`. Der
     * Praefix bleibt in Altzeilen stehen, wird aber nicht mehr als Quelle
     * gelesen — nullable, weil Altzeilen bewusst NICHT durch Textzerlegung
     * nachgetragen werden (sie zeigen "unbekannt").
     */
    benutzerEmail: text("benutzer_email"),
    /**
     * AP2.2 PR a (Migration 0026): `aenderung` ist das Ereignisprotokoll.
     * Kein DEFAULT auf `art` — jede neue Zeile nennt ihre Art ausdruecklich;
     * Altzeilen tragen `altbestand`. `benutzer_id` ist der Urheber als FK
     * (Altzeilen per E-Mail-Join, sonst NULL). Der CHECK erzwingt: alles
     * ausser Altbestand hat einen Urheber.
     */
    art: ereignisArt("art").notNull(),
    benutzerId: uuid("benutzer_id").references(() => benutzer.id),
  },
  (t) => [
    index("aenderung_entitaet_idx").on(t.entitaetTyp, t.entitaetId),
    check(
      "aenderung_urheber_check",
      sql`${t.art} = 'altbestand' or ${t.benutzerId} is not null`,
    ),
  ],
);

/**
 * F8/E30: Rollen der internen Nutzenden. Die Identitaet kommt aus Cloudflare
 * Access, die Rolle aus dieser Tabelle — Access entscheidet, wer hereinkommt,
 * die Anwendung entscheidet, was diese Person darf.
 *
 * Die E-Mail ist der Primaerschluessel und liegt ausschliesslich in
 * Kleinschreibung vor (CHECK in der Migration); die Anwendung normalisiert
 * beim Vergleich ebenso. Kein Loeschen, nur `aktiv = false` — wie bei den
 * Referenzdaten.
 */
export const benutzer = pgTable(
  "benutzer",
  {
    email: text("email").primaryKey(),
    // AP2.1 PR b0: stabile Nutzer-ID fuer neue Referenzen (Sperren,
    // Zuweisungen ab PR b). Der PK bleibt die E-Mail; bestehende Referenzen
    // (aenderung.benutzer_email) bleiben unangetastet. Expand nach E21.
    id: uuid("id").notNull().defaultRandom().unique(),
    rolle: benutzerRolle("rolle").notNull(),
    name: text("name"),
    aktiv: boolean("aktiv").notNull().default(true),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true })
      .notNull()
      .defaultNow(),
    geaendertAm: timestamp("geaendert_am", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Eine Groesse, eine Schreibweise: Gross-/Kleinschreibung darf nicht
    // darueber entscheiden, ob jemand hereinkommt. Die Datenbank erzwingt
    // Kleinschreibung, die Anwendung normalisiert vor dem Vergleich.
    check("benutzer_email_lower_check", sql`${t.email} = lower(${t.email})`),
  ],
);
