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

/** Output-Vektor eines Bedarfs. */
export const outputVektor = pgEnum("output_vektor", ["waerme", "h2", "co2"]);

/** Lebenszyklus eines Analyse-Laufs. */
export const laufStatus = pgEnum("lauf_status", [
  "arbeitsfassung",
  "eingefroren",
]);

// --- Kernentitaeten (Reihenfolge nach FK-Abhaengigkeiten) --------------------

/**
 * Materialart als Lookup-Tabelle statt Enum: die Liste waechst erfahrungsgemaess,
 * und ein Enum-Wert liesse sich in Postgres nicht umbenennen oder entfernen.
 */
export const materialart = pgTable("materialart", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
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

/** Region (Kommune/Standort) mit Bereitschaftsstufe. */
export const region = pgTable("region", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  standortGeom: geometry("standort_geom", {
    type: "point",
    srid: 4326,
  }).notNull(),
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

/** Biomassestrom eines Akteurs in einer Region. */
export const biomassestrom = pgTable("biomassestrom", {
  id: uuid("id").primaryKey().defaultRandom(),
  akteurId: uuid("akteur_id")
    .notNull()
    .references(() => akteur.id),
  regionId: uuid("region_id")
    .notNull()
    .references(() => region.id),
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

/** Output-Bedarf eines Akteurs in einer Region. */
export const outputBedarf = pgTable("output_bedarf", {
  id: uuid("id").primaryKey().defaultRandom(),
  akteurId: uuid("akteur_id")
    .notNull()
    .references(() => akteur.id),
  regionId: uuid("region_id")
    .notNull()
    .references(() => region.id),
  // Standort je Bedarf (analog biomassestrom): ein Akteur kann mehrere Sites
  // haben. Alle nullable, kein Geocoding in AP1b.
  bezeichnung: text("bezeichnung"),
  ort: text("ort"),
  landkreis: text("landkreis"),
  standortGeom: geometry("standort_geom", { type: "point", srid: 4326 }),
  kontaktperson: text("kontaktperson"),
  vektor: outputVektor("vektor").notNull(),
  mengeWert: numeric("menge_wert").notNull(),
  mengeEinheit: text("menge_einheit").notNull(),
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
