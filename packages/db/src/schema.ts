import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  geometry,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
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
 * Belegtyp mit steigender Verbindlichkeit. `betriebsdaten` in Migration 0002
 * angehaengt (Postgres-Enums lassen nur Anhaengen zu, kein Umsortieren).
 */
export const belegTyp = pgEnum("beleg_typ", [
  "dokument_link",
  "gespraech",
  "angebot",
  "absichtserklaerung",
  "vertrag",
  "betriebsdaten",
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
  typ: belegTyp("typ").notNull(),
  dateiKey: text("datei_key"),
  linkUrl: text("link_url"),
  notiz: text("notiz"),
  gueltigBis: date("gueltig_bis"),
  // Bildet den "vollstaendige Pflichtfelder"-Teil der Qualitaetsmatrix ab
  // (siehe deriveQualitaet). Default false: ohne Zusicherung nicht extern belegt.
  externNachvollziehbar: boolean("extern_nachvollziehbar")
    .notNull()
    .default(false),
  // Typ-spezifische Zusatzfelder (z. B. gespraech: Datum/Partner/Notiz,
  // angebot: gueltig_bis-Vorbelegung). Struktur haengt am beleg_typ.
  metadata: jsonb("metadata"),
  // Fachlicher Erstellungszeitpunkt des Belegs, getrennt vom technischen created_at.
  erstelltAm: timestamp("erstellt_am", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Region ("Fokusregion") mit Flaechen-Geometrie und Bereitschaftsstufe. */
export const region = pgTable("region", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // Flaeche der Region als Polygon (AP1e, ersetzt Punkt+Radius aus 0003).
  // Zugehoerigkeit = ST_Contains(gebiet, standort_geom). Mittelpunkt bei Bedarf
  // per ST_Centroid(gebiet), keine eigene Spalte. Nie ueber Drizzle typisiert
  // gelesen/geschrieben – Zugriff ausschliesslich per raw sql (ST_*).
  gebiet: geometry("gebiet", { type: "point", srid: 4326 }).notNull(),
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
});

/** Akteur (Biomasse-Anbieter oder Output-Abnehmer). */
export const akteur = pgTable("akteur", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  sektor: text("sektor"),
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
 * Biomassestrom eines Akteurs mit eigenem Standort. KEINE manuell zugewiesene
 * Region – welche Region(en) den Strom erfassen, wird raeumlich aus standort_geom
 * und region.einzugsradius_km abgeleitet (ST_DWithin), nicht ueber einen FK.
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
  landkreis: text("landkreis"),
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
  saisonalitaet: jsonb("saisonalitaet").notNull(),
  preisMin: numeric("preis_min"),
  preisMittel: numeric("preis_mittel"),
  preisMax: numeric("preis_max"),
  preisHerkunft: preisHerkunft("preis_herkunft"),
  belegId: uuid("beleg_id").references(() => beleg.id),
  qualitaet: qualitaetsStufe("qualitaet"),
  status: datensatzStatus("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

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
  landkreis: text("landkreis"),
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
  saisonalitaet: jsonb("saisonalitaet").notNull(),
  belegId: uuid("beleg_id").references(() => beleg.id),
  qualitaet: qualitaetsStufe("qualitaet"),
  status: datensatzStatus("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

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
  (t) => [unique().on(t.akteurId, t.regionId)],
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
});

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
export const aenderung = pgTable("aenderung", {
  id: uuid("id").primaryKey().defaultRandom(),
  entitaetTyp: text("entitaet_typ").notNull(),
  entitaetId: uuid("entitaet_id").notNull(),
  zeitpunkt: timestamp("zeitpunkt", { withTimezone: true })
    .notNull()
    .defaultNow(),
  text: text("text").notNull(),
});
