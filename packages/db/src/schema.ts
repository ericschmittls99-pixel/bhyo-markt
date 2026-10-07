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
  /**
   * AP2.4 PR a (E62, D3): „als abgelaufen markiert" — eine Eingabe des
   * Pruefers, nicht ableitbar, deshalb gespeichert. Wirkt auf den
   * Verifikationszustand (strom_verifikation) und wertet die Qualitaet um
   * eine Stufe ab (qualitaetsstufe, D bleibt D).
   */
  abgelaufenAm: date("abgelaufen_am"),
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
  // qualitaetsstufe(typ, datei_key, link_url, abgelaufen_am) aus Migration
  // 0032 (E62 D3: Markierung wertet eine Stufe ab; Spiegel von
  // apps/web/lib/qualitaet.ts, Paritaetstest im CI). Ein Schreibversuch
  // scheitert in Postgres; im TS-Typ ist die Spalte durch generatedAlwaysAs
  // aus allen Insert-/Update-Typen heraus.
  qualitaet: qualitaetsStufe("qualitaet").generatedAlwaysAs(
    sql`qualitaetsstufe(typ, datei_key, link_url, abgelaufen_am)`,
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
   * F5 PR B: Referenz auf `sektor.code` statt Freitext. Seit AP2.5 PR a1
   * (E66) ist „ohne Sektor" die Systemzeile 'ohne_sektor', nicht NULL;
   * seit AP2.5 PR a2 (Contract, Migration 0039) NOT NULL.
   */
  sektor: text("sektor")
    .notNull()
    .references(() => sektor.code),
  /**
   * AP2.5 PR a1 (E66, Praezisierung von F0a): der SITZ des Akteurs — ein
   * Ort je Bedeutung. Der Strom behaelt seinen Standort; kein Abgleich, kein
   * Vererben. Der Sitz wirkt nur in akteure., beim Dublettenabgleich und im
   * Kontakt. PLZ und Ort sind Pflicht (a2, Migration 0039), Adresse frei; der Kreis-ARS
   * kommt ueber den E25-Weg aus sitz_geom (View akteur_verwaltung) — darum
   * ist der Pin die Eingabe, die der Server verlangt (Geocoder aus PLZ/Ort).
   */
  sitzStrasse: text("sitz_strasse"),
  sitzHausnummer: text("sitz_hausnummer"),
  sitzPlz: text("sitz_plz").notNull(),
  sitzOrt: text("sitz_ort").notNull(),
  sitzGeom: geometry("sitz_geom", { type: "point", srid: 4326 }),
  // rollen, kontakt_email, kontakt_telefon, ansprechperson: entfallen mit
  // AP2.5 Contract (Migration 0040) — Kontakt lebt in der Tabelle kontaktperson.
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
export const sektor = pgTable(
  "sektor",
  {
    code: text("code").primaryKey(),
    label: text("label").notNull(),
    /** Reihenfolge in Auswahllisten; gleiche Werte alphabetisch. */
    sortierung: integer("sortierung").notNull().default(0),
    /**
     * AP2.3 PR b (E59): Sektoren pflegt der Admin in einstellungen.
     * `id` ist der Objektbezug fuers Ereignisprotokoll (aenderung.entitaet_id
     * ist uuid; der Code bleibt Schluessel und Fremdschluessel-Ziel).
     * Geloescht wird nicht: `aktiv = false` nimmt den Sektor aus der Auswahl,
     * Akteure behalten ihn und zeigen ihn als „(deaktiviert)".
     */
    id: uuid("id").notNull().unique().defaultRandom(),
    aktiv: boolean("aktiv").notNull().default(true),
  },
  (t) => [
    // E61 (0031): Eine Bezeichnung einmal — Vergleichsform ist die SQL-Funktion
    // sektor_label_norm (lower + btrim inkl. Tab/CR/LF); apps/web/lib/sektor.ts
    // (labelSchluessel) rechnet dieselbe Form, damit App und DB gleich urteilen.
    uniqueIndex("sektor_label_norm_idx").on(sql`sektor_label_norm(${t.label})`),
    // Codes wie alle Enum-Werte: snake_case ohne Umlaute. 'abnehmer' ist eine
    // Rolle (0020) und darf nie ein Sektor werden. 'ohne_sektor' ist seit
    // AP2.5 PR a1 (E66, Migration 0035) die SYSTEMZEILE: genau einmal
    // vorhanden, von Admins weder anlegbar noch umbenennbar noch
    // deaktivierbar noch loeschbar — das sichert der Trigger
    // sektor_systemzeile_wache (0035), nicht dieser CHECK.
    check("sektor_code_check", sql`${t.code} ~ '^[a-z0-9_]+$' and ${t.code} <> 'abnehmer'`),
    check("sektor_label_check", sql`length(btrim(${t.label})) > 0`),
    // E61: „Abnehmer" (eine Rolle, E23) und „ohne Sektor" sind als Bezeichnung
    // reserviert — „ohne Sektor" traegt allein die Systemzeile.
    check(
      "sektor_label_reserviert_check",
      sql`sektor_label_norm(${t.label}) <> 'abnehmer' and (sektor_label_norm(${t.label}) <> 'ohne sektor' or ${t.code} = 'ohne_sektor')`,
    ),
  ],
);

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
  materialartCode: text("materialart_code")
    .notNull()
    .references(() => materialart.code),
  mengeRohFm: numeric("menge_roh_fm").notNull(),
  // AP2.7 PR e (Eric 07.10.2026): NULL = unbekannt. Die Materialart-Referenz traegt
  // keine Typwerte; ein Strom ohne beide Werte ist unvollstaendig und wird nie
  // „geprueft" (CHECK biomassestrom_geprueft_vollstaendig_check, Migration 0047).
  tsAnteilPct: numeric("ts_anteil_pct"),
  aschegehaltPct: numeric("aschegehalt_pct"),
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
  // AP2.2 PR c: Zugriffsanfrage und Ablehnung (Anhaenge-Historie).
  "zugriff_angefragt",
  "zugriff_abgelehnt",
  // AP2.3 PR a: Parameter mit Verlauf.
  "parameter_gesetzt",
  "parameter_zurueckgenommen",
  // AP2.3 PR b: Sektorliste (Referenzliste) pflegbar.
  "sektor_angelegt",
  "sektor_umbenannt",
  "sektor_deaktiviert",
  "sektor_reaktiviert",
  // AP2.4 PR a (E62): jeder Statuswechsel mit eigener Art, strukturiert statt
  // Freitext — status_gesetzt bleibt nur fuer Altbestand. Dazu die
  // Verifikation (geprueft; reverifiziert folgt in PR b), das automatische
  // Ruecksetzen bei fachlicher Aenderung und die Ablauf-Markierung (D3).
  "in_pruefung_gegeben",
  "geprueft",
  "zurueckgegeben",
  "reaktiviert",
  "zurueckgesetzt",
  "als_abgelaufen_markiert",
  "abgelaufen_aufgehoben",
  // AP2.4 PR b (E63): erneute Verifikation ohne Statuswechsel — neuer Prueftag.
  "reverifiziert",
  // AP2.4 PR c (E63, D5): Weitergabe eines Pruefauftrags/Ablauf-Hinweises als Aufgabe.
  "weitergegeben",
  // AP2.5 PR a1 (E66): Stammdaten des Akteurs geaendert; verwaister Akteur geloescht (nur Admin).
  "akteur_geaendert",
  "akteur_geloescht",
  // AP2.5 PR b (E57/E47): Kontaktpersonen — Freitext traegt nie den Namen, nur IDs.
  "kontaktperson_angelegt",
  "kontaktperson_geaendert",
  "kontaktperson_geloescht",
  // AP2.5 PR b: Auskunft nach Art. 15 erstellt (nur Admin) — die Druckansicht ist nur ueber dieses Ereignis erreichbar.
  "auskunft_erstellt",
  // AP2.5 PR c (E66): Zusammenfuehren (Quelle → Ziel, nur IDs im Text; der
  // Trigger kontaktperson_kein_umhaengen laesst das Umhaengen nur mit diesem
  // Ereignis zu) und „keine Dublette" (Paar in akteur_keine_dublette).
  "akteur_zusammengefuehrt",
  "keine_dublette_markiert",
  "keine_dublette_aufgehoben",
  /** AP2.7 PR a (E67): Import — Quelle enthielt Ansprechpartner, nicht uebernommen (ohne Namen, mit Lauf-ID). */
  "kontaktdaten_uebersprungen",
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
    /** AP2.7 PR a (E67): Lauf-ID an jedem Ereignis des Imports (Migration 0043); sonst NULL. */
    importLaufId: uuid("import_lauf_id").references(() => importLauf.id),
  },
  (t) => [
    index("aenderung_entitaet_idx").on(t.entitaetTyp, t.entitaetId),
    index("aenderung_import_lauf_idx").on(t.importLaufId),
    check(
      "aenderung_urheber_check",
      sql`${t.art} = 'altbestand' or ${t.benutzerId} is not null`,
    ),
  ],
);

/**
 * AP2.2 PR b: Inbox. Typen und Zustaende als Enums (Anhaenge-Historie).
 * `aenderung_eintrag` = „Aenderung an meinem Eintrag"; PR c ergaenzt
 * zugriffsanfrage, freischaltung, zugriff_abgelehnt.
 */
export const inboxTyp = pgEnum("inbox_typ", [
  "aenderung_eintrag",
  // AP2.2 PR c
  "zugriffsanfrage",
  "freischaltung",
  "zugriff_abgelehnt",
  // AP2.4 PR a (E62): Pruefauftrag an die Pruefer, Rueckmeldung an den Ausloeser.
  "pruefauftrag",
  "pruefung_erledigt",
  // AP2.4 PR b (E63): Hinweise des taeglichen Jobs, zustandsbasiert (lib/inbox/hinweise.ts).
  "verifikation_laeuft_ab",
  "verifikation_abgelaufen",
  // AP2.4 PR c (E63, D5): Aufgabe an eine Person („Bitte aktualisieren"), aus Weitergeben.
  "aufgabe",
  // AP2.5 PR a1 (E66): verwaister Akteur (kein Strom) seit N Monaten — Hinweis des Jobs an die Admins.
  "akteur_verwaist",
  // AP2.5 PR b (E57): Loeschpruefung — Kontaktperson ohne Aktivitaet seit M Monaten, Hinweis an die Admins.
  "kontaktperson_loeschpruefung",
  /** AP2.7 PR a (E67): ein gebuendelter Eintrag je Import-Lauf an alle aktiven Pruefer und Admins (Zaehler im Text). */
  "import_abgeschlossen",
]);
export const inboxZustand = pgEnum("inbox_zustand", ["offen", "erledigt", "verworfen"]);

/**
 * AP2.5 PR b (E66/E57/E47): Kontaktperson eines Akteurs. Jede Person gehoert zu
 * genau EINEM Akteur — kein Umhaengen (Trigger kontaktperson_kein_umhaengen in
 * 0036; wechselt jemand den Arbeitgeber, wird eine neue Person angelegt).
 * Laengengrenzen per CHECK. Die Notiz traegt den Hinweis „Keine privaten oder
 * sensiblen Angaben". Echtes Loeschen (DSGVO): Protokoll und Inbox speichern
 * nur die ID, Namen werden erst bei der Anzeige aufgeloest; Backups halten
 * geloeschte Daten noch 30 Tage (docs/betrieb.md).
 */
export const kontaktperson = pgTable(
  "kontaktperson",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    akteurId: uuid("akteur_id")
      .notNull()
      .references(() => akteur.id),
    name: text("name").notNull(),
    funktion: text("funktion"),
    mailDienstlich: text("mail_dienstlich"),
    telefon: text("telefon"),
    notiz: text("notiz"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("kontaktperson_akteur_id_idx").on(t.akteurId),
    check("kontaktperson_name_check", sql`length(btrim(${t.name})) between 1 and 200`),
    check("kontaktperson_funktion_check", sql`${t.funktion} is null or length(${t.funktion}) <= 120`),
    check("kontaktperson_mail_check", sql`${t.mailDienstlich} is null or length(${t.mailDienstlich}) <= 200`),
    check("kontaktperson_telefon_check", sql`${t.telefon} is null or length(${t.telefon}) <= 60`),
    check("kontaktperson_notiz_check", sql`${t.notiz} is null or length(${t.notiz}) <= 1000`),
  ],
);

/**
 * AP2.5 PR c (E66): Ein Paar, das jemand als „keine Dublette" markiert hat —
 * es wird nicht mehr vorgeschlagen. Geordnet (akteur_a < akteur_b, CHECK), je
 * Paar genau einmal (UNIQUE). Zwei Fremdschluessel mit ON DELETE CASCADE:
 * verschwindet ein Akteur (Zusammenfuehren, Loeschen verwaist), ist die
 * Markierung gegenstandslos. Protokolliert als keine_dublette_markiert.
 */
export const akteurKeineDublette = pgTable(
  "akteur_keine_dublette",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    akteurA: uuid("akteur_a")
      .notNull()
      .references(() => akteur.id, { onDelete: "cascade" }),
    akteurB: uuid("akteur_b")
      .notNull()
      .references(() => akteur.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("akteur_keine_dublette_paar_uniq").on(t.akteurA, t.akteurB),
    check("akteur_keine_dublette_ordnung_check", sql`${t.akteurA} < ${t.akteurB}`),
  ],
);

/**
 * Inbox-Eintrag je Empfaenger. Buendelung per DB: je Strom-Typ ein
 * partieller Unique-Index (Empfaenger, Strom) WHERE offen AND
 * aenderung_eintrag — die Zustellung ist ein Upsert (anzahl + 1, Ausloeser/
 * Ereignis/aktualisiert_am neu, gelesen_am NULL). Nach „erledigt" entsteht
 * bei der naechsten Aenderung ein neuer Eintrag. Einzige Schreibstelle ist
 * apps/web/lib/inbox (CI: inbox-check).
 */
export const inboxEintrag = pgTable(
  "inbox_eintrag",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empfaengerId: uuid("empfaenger_id")
      .notNull()
      .references(() => benutzer.id),
    /** NULL nur bei den Hinweisen des Jobs (PR b, CHECK inbox_eintrag_urheber_check). */
    ausloeserId: uuid("ausloeser_id").references(() => benutzer.id),
    typ: inboxTyp("typ").notNull(),
    biomassestromId: uuid("biomassestrom_id").references(() => biomassestrom.id),
    outputBedarfId: uuid("output_bedarf_id").references(() => outputBedarf.id),
    /**
     * AP2.5 PR a1 (E66): Objektbezug Akteur fuer den Hinweis akteur_verwaist.
     * Wird der (verwaiste) Akteur von Hand geloescht, gehen seine Hinweise mit
     * (ON DELETE CASCADE) — ein Hinweis auf ein geloeschtes Objekt waere leer.
     */
    akteurId: uuid("akteur_id").references(() => akteur.id, { onDelete: "cascade" }),
    /** AP2.5 PR b (E57): Objektbezug Kontaktperson fuer die Loeschpruefung; echtes Loeschen nimmt die Hinweise mit (CASCADE). */
    kontaktpersonId: uuid("kontaktperson_id").references(() => kontaktperson.id, { onDelete: "cascade" }),
    /** AP2.7 PR a (E67): Lauf-Bezug des Typs import_abgeschlossen (Migration 0043). */
    importLaufId: uuid("import_lauf_id").references(() => importLauf.id),
    /** Letztes Ereignis des Buendels (Protokoll); NULL nur bei den Hinweisen des Jobs (PR b). */
    ereignisId: uuid("ereignis_id").references(() => aenderung.id),
    /**
     * AP2.4 PR b (E63): Bezugsdatum eines Job-Hinweises = verifiziert_bis am
     * Lauftag (NULL bei Pruefdatum unbekannt). Idempotenz: je Empfaenger,
     * Typ, Strom und Bezugsdatum EIN Eintrag, dauerhaft — ein zweiter Lauf
     * erzeugt nichts, eine neue Verifikation ergibt ein neues Bezugsdatum.
     */
    bezugsdatum: date("bezugsdatum"),
    anzahl: integer("anzahl").notNull().default(1),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
    aktualisiertAm: timestamp("aktualisiert_am", { withTimezone: true }).notNull().defaultNow(),
    gelesenAm: timestamp("gelesen_am", { withTimezone: true }),
    zustand: inboxZustand("zustand").notNull().default("offen"),
    zustandSeit: timestamp("zustand_seit", { withTimezone: true }).notNull().defaultNow(),
    /** PR c: Notiz der Zugriffsanfrage (max. 500 Zeichen, geprueft im Code). */
    notiz: text("notiz"),
    /**
     * AP2.4 PR c (E63, D5): Aufgabentext beim Typ aufgabe — nicht leer,
     * hoechstens 500 Zeichen, bei jedem anderen Typ NULL (CHECK
     * inbox_eintrag_aufgabe_check; dieselbe Regel serverseitig in lib/inbox/aufgabe.ts).
     */
    aufgabe: text("aufgabe"),
  },
  (t) => [
    // Genau EIN Objektbezug: Biomassestrom, Output-Bedarf, (PR a1) Akteur, (PR b) Kontaktperson
    // oder (AP2.7 PR c, Migration 0046) Import-Lauf — 0043 hatte die Spalte, aber nicht den CHECK
    // erweitert; der erste echte Abschluss eines Laufs scheiterte daran (Befund 06.10.2026).
    check(
      "inbox_eintrag_genau_ein_strom_check",
      sql`num_nonnulls(${t.biomassestromId}, ${t.outputBedarfId}, ${t.akteurId}, ${t.kontaktpersonId}, ${t.importLaufId}) = 1`,
    ),
    check("inbox_eintrag_anzahl_check", sql`${t.anzahl} >= 1`),
    // AP2.4 PR c: Aufgabentext nur beim Typ aufgabe, dort Pflicht (1–500 Zeichen ohne Rand).
    check(
      "inbox_eintrag_aufgabe_check",
      sql`(inbox_typ_text(${t.typ}) = 'aufgabe' and ${t.aufgabe} is not null and length(btrim(${t.aufgabe})) between 1 and 500) or (inbox_typ_text(${t.typ}) <> 'aufgabe' and ${t.aufgabe} is null)`,
    ),
    // PR b: Nur die Job-Hinweise kommen ohne Urheber und Ereignis; jeder andere
    // Typ traegt beides (vorher NOT NULL auf beiden Spalten).
    check(
      "inbox_eintrag_urheber_check",
      sql`inbox_typ_text(${t.typ}) in ('verifikation_laeuft_ab', 'verifikation_abgelaufen', 'akteur_verwaist', 'kontaktperson_loeschpruefung') or (${t.ausloeserId} is not null and ${t.ereignisId} is not null)`,
    ),
    uniqueIndex("inbox_eintrag_biomasse_offen_uidx")
      .on(t.empfaengerId, t.biomassestromId)
      .where(sql`${t.zustand} = 'offen' and ${t.typ} = 'aenderung_eintrag' and ${t.biomassestromId} is not null`),
    uniqueIndex("inbox_eintrag_output_offen_uidx")
      .on(t.empfaengerId, t.outputBedarfId)
      .where(sql`${t.zustand} = 'offen' and ${t.typ} = 'aenderung_eintrag' and ${t.outputBedarfId} is not null`),
    // PR c: Zugriffsanfrage — je Empfaenger, Strom UND Anfragendem ein offener
    // Eintrag (zwei Anfragende = zwei Eintraege). Das Praedikat vergleicht
    // ueber inbox_typ_text() (IMMUTABLE, Migration 0028): Der neue Enum-Wert
    // ist in derselben Migrations-Transaktion nicht als Literal verwendbar,
    // und der nackte Cast ::text ist fuer ein Index-Praedikat nicht immutable.
    uniqueIndex("inbox_eintrag_biomasse_anfrage_uidx")
      .on(t.empfaengerId, t.biomassestromId, t.ausloeserId)
      .where(sql`${t.zustand} = 'offen' and inbox_typ_text(${t.typ}) = 'zugriffsanfrage' and ${t.biomassestromId} is not null`),
    uniqueIndex("inbox_eintrag_output_anfrage_uidx")
      .on(t.empfaengerId, t.outputBedarfId, t.ausloeserId)
      .where(sql`${t.zustand} = 'offen' and inbox_typ_text(${t.typ}) = 'zugriffsanfrage' and ${t.outputBedarfId} is not null`),
    // AP2.4 PR a (E62): Pruefauftrag — je Pruefer und Strom EIN offener Eintrag
    // (Buendelung); Praedikat wieder ueber inbox_typ_text (neuer Enum-Wert).
    uniqueIndex("inbox_eintrag_biomasse_pruefauftrag_uidx")
      .on(t.empfaengerId, t.biomassestromId)
      .where(sql`${t.zustand} = 'offen' and inbox_typ_text(${t.typ}) = 'pruefauftrag' and ${t.biomassestromId} is not null`),
    uniqueIndex("inbox_eintrag_output_pruefauftrag_uidx")
      .on(t.empfaengerId, t.outputBedarfId)
      .where(sql`${t.zustand} = 'offen' and inbox_typ_text(${t.typ}) = 'pruefauftrag' and ${t.outputBedarfId} is not null`),
    // AP2.4 PR b (E63): Job-Hinweise — je Empfaenger, Typ, Strom und
    // Bezugsdatum genau ein Eintrag, ueber alle Zustaende (Idempotenz des
    // taeglichen Laufs). In der Migration mit NULLS NOT DISTINCT, damit das
    // leere Bezugsdatum (Pruefdatum unbekannt) nur einmal zustellt — das kann
    // der Schema-Builder nicht ausdruecken; die SQL-Datei ist massgeblich.
    uniqueIndex("inbox_eintrag_biomasse_hinweis_uidx")
      .on(t.empfaengerId, t.typ, t.biomassestromId, t.bezugsdatum)
      .where(sql`inbox_typ_text(${t.typ}) in ('verifikation_laeuft_ab', 'verifikation_abgelaufen') and ${t.biomassestromId} is not null`),
    uniqueIndex("inbox_eintrag_output_hinweis_uidx")
      .on(t.empfaengerId, t.typ, t.outputBedarfId, t.bezugsdatum)
      .where(sql`inbox_typ_text(${t.typ}) in ('verifikation_laeuft_ab', 'verifikation_abgelaufen') and ${t.outputBedarfId} is not null`),
    // AP2.5 PR a1 (E66): Verwaist-Hinweis — je Empfaenger, Akteur und
    // Bezugsdatum (seit wann verwaist) genau ein Eintrag, ueber alle Zustaende;
    // NULLS NOT DISTINCT in der Migration (0035), die SQL-Datei ist massgeblich.
    uniqueIndex("inbox_eintrag_akteur_hinweis_uidx")
      .on(t.empfaengerId, t.typ, t.akteurId, t.bezugsdatum)
      .where(sql`inbox_typ_text(${t.typ}) = 'akteur_verwaist' and ${t.akteurId} is not null`),
    // AP2.5 PR b (E57): Loeschpruefung — je Empfaenger, Kontaktperson und Bezugsdatum
    // (letzte Aktivitaet) genau ein Eintrag; NULLS NOT DISTINCT in der Migration (0036).
    uniqueIndex("inbox_eintrag_kontaktperson_hinweis_uidx")
      .on(t.empfaengerId, t.typ, t.kontaktpersonId, t.bezugsdatum)
      .where(sql`inbox_typ_text(${t.typ}) = 'kontaktperson_loeschpruefung' and ${t.kontaktpersonId} is not null`),
    // AP2.7 PR a (E67): genau ein Eintrag je Lauf und Empfaenger (Praedikat ueber inbox_typ_text, neuer Enum-Wert).
    uniqueIndex("inbox_eintrag_import_uidx")
      .on(t.empfaengerId, t.typ, t.importLaufId)
      .where(sql`inbox_typ_text(${t.typ}) = 'import_abgeschlossen' and ${t.importLaufId} is not null`),
    // Zaehler der Navigation: ungelesene offene Eintraege je Empfaenger.
    index("inbox_eintrag_zaehler_idx")
      .on(t.empfaengerId)
      .where(sql`${t.zustand} = 'offen' and ${t.gelesenAm} is null`),
  ],
);

/**
 * AP2.3 PR a (E59/E60): Parameter mit Verlauf. Schluessel sind Text, keine
 * Enum-Werte (E53: neue Enum-Werte sind in derselben Migration nicht als
 * Literal nutzbar). Neue Schluessel kommen nur per Migration zusammen mit
 * ihrem Verbraucher.
 */
export const parameterDefinition = pgTable("parameter_definition", {
  /** z. B. verifikationsfrist.gespraech */
  schluessel: text("schluessel").primaryKey(),
  bezeichnung: text("bezeichnung").notNull(),
  /** z. B. monate */
  einheit: text("einheit").notNull(),
  min: integer("min").notNull(),
  max: integer("max").notNull(),
  beschreibung: text("beschreibung").notNull(),
});

/**
 * E60: Ein Wert gilt ab einem Datum, nie rueckwirkend; alte Werte bleiben im
 * Verlauf. '-infinity' = benannter Zustand „seit Einfuehrung" (Startwerte aus
 * der Migration, ohne Urheber). Unveraenderlich per Trigger (UPDATE nie,
 * DELETE nur fuer kuenftige Werte) — Migration 0029. Gelesen wird
 * ausschliesslich ueber die SQL-Funktion parameter_wert(schluessel, stichtag).
 */
export const parameterWert = pgTable(
  "parameter_wert",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    schluessel: text("schluessel")
      .notNull()
      .references(() => parameterDefinition.schluessel),
    wert: integer("wert").notNull(),
    gueltigAb: date("gueltig_ab").notNull(),
    begruendung: text("begruendung").notNull(),
    erstelltVon: uuid("erstellt_von").references(() => benutzer.id),
    erstelltAm: timestamp("erstellt_am", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("parameter_wert_schluessel_gueltig_ab_unique").on(t.schluessel, t.gueltigAb),
    check("parameter_wert_begruendung_check", sql`length(trim(${t.begruendung})) > 0`),
    // Nie rueckwirkend: gueltig_ab liegt nicht vor dem Tag der Erfassung (Berlin).
    check(
      "parameter_wert_nie_rueckwirkend_check",
      sql`${t.gueltigAb} = '-infinity'::date or ${t.gueltigAb} >= (${t.erstelltAm} at time zone 'Europe/Berlin')::date`,
    ),
    // Startwerte (seit Einfuehrung) haben keinen Urheber; alles andere schon.
    check(
      "parameter_wert_urheber_check",
      sql`${t.gueltigAb} = '-infinity'::date or ${t.erstelltVon} is not null`,
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

/**
 * AP2.4 PR b (E63): Protokoll des taeglichen Jobs. Je Job und Stichtag
 * (Kalendertag Berlin) genau ein Lauf — der Cron feuert um 03:00 und 04:00
 * UTC, nur der Lauf um 05:00 Berlin laeuft weiter; UNIQUE(job, stichtag)
 * macht den Start idempotent. Die Job-Wache (GitHub, 06:00 Berlin, nur
 * lesend) ist rot, wenn fuer heute kein Lauf mit ergebnis = ok steht.
 */
export const jobLauf = pgTable(
  "job_lauf",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    job: text("job").notNull(),
    stichtag: date("stichtag").notNull(),
    gestartetAm: timestamp("gestartet_am", { withTimezone: true }).notNull().defaultNow(),
    beendetAm: timestamp("beendet_am", { withTimezone: true }),
    /** laeuft | ok | fehler */
    ergebnis: text("ergebnis").notNull().default("laeuft"),
    /** Zugestellte Hinweise (ok) — null, solange der Lauf laeuft oder scheiterte. */
    anzahl: integer("anzahl"),
    /** Fehlertext (ergebnis = fehler). */
    fehler: text("fehler"),
    /** Abgeraeumte Job-Hinweise (Bedingung zum Stichtag nicht mehr gueltig), seit Migration 0041. */
    abgeraeumt: integer("abgeraeumt"),
    /**
     * Betrieb 06.10.2026 (Eric): Laufzeit messen. ausgeloest_am = Cron-Zeitpunkt
     * (scheduledTime); gestartet_am (DB-Zeit des ersten Schreibens) minus
     * ausgeloest_am ist der Verbindungsaufbau (Hyperdrive, Neon-Kaltstart).
     */
    ausgeloestAm: timestamp("ausgeloest_am", { withTimezone: true }),
    /** Millisekunden je Schritt des Laufs ({ verbindung, zustellen, …, gesamt }), seit Migration 0042. */
    schritte: jsonb("schritte").$type<Record<string, number>>(),
  },
  (t) => [
    unique("job_lauf_job_stichtag_unique").on(t.job, t.stichtag),
    check("job_lauf_ergebnis_check", sql`${t.ergebnis} in ('laeuft', 'ok', 'fehler')`),
  ],
);

// --- AP2.7 Excel-Import (E67, Migration 0043) -------------------------------
// Entscheidung E67 (docs/ap0-schema-entscheidungen.md): Ein Lauf importiert
// Stroeme einer Art samt Akteur. Zeilen tragen NUR zugeordnete Zielfelder als
// jsonb — nie Personen-Spalten (CHECK import_zeile_felder_check); deren
// Inhalte werden nirgends gespeichert, auch nicht in Zwischenstaenden. Der
// taegliche Job loescht import_zeile 30 Tage nach Abschluss (PR c), die
// Zaehler bleiben am Lauf.

/** Vorlage: Spalten- und Werte-Zuordnung, fuer alle mit Import-Recht. */
export const importVorlage = pgTable(
  "import_vorlage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** Herkunft der Dateien in Worten (z. B. „Landwirtschaftskammer, Jahresmeldung"). */
    quelle: text("quelle"),
    /** Spalten-Zuordnung: Quellspalte → Zielfeld | "person" | "ignorieren". */
    spalten: jsonb("spalten").$type<Record<string, string>>().notNull(),
    /** Werte-Zuordnung je Zielfeld: Quellwert → Code (z. B. „Gülle" → materialart). */
    werte: jsonb("werte").$type<Record<string, Record<string, string>>>().notNull(),
    erstellerId: uuid("ersteller_id")
      .notNull()
      .references(() => benutzer.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("import_vorlage_name_unique").on(t.name),
    check("import_vorlage_name_check", sql`length(btrim(${t.name})) between 1 and 120`),
  ],
);

export const IMPORT_LAUF_STATUS = ["angelegt", "zugeordnet", "aufgeloest", "probelauf", "ausgefuehrt", "zurueckgenommen", "fehler"] as const;
export type ImportLaufStatus = (typeof IMPORT_LAUF_STATUS)[number];

/** Ein Import-Lauf: eine Datei, eine Art, ein Belegtyp, ein Standard-Sektor. */
export const importLauf = pgTable(
  "import_lauf",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** biomasse | output — die Art wird je Lauf gewaehlt (E67). */
    art: text("art").notNull(),
    dateiname: text("dateiname").notNull(),
    /** SHA-256 der Originaldatei (hex); gleicher Hash wie ein frueherer Lauf → Warnung vor dem Start. */
    dateiHash: text("datei_hash").notNull(),
    belegTyp: belegTyp("beleg_typ").notNull(),
    /** Sektor neuer Akteure ohne Spaltenwert (Pflichtauswahl, ohne_sektor erlaubt). */
    standardSektor: text("standard_sektor")
      .notNull()
      .references(() => sektor.code),
    vorlageId: uuid("vorlage_id").references(() => importVorlage.id),
    erstellerId: uuid("ersteller_id")
      .notNull()
      .references(() => benutzer.id),
    status: text("status").notNull().default("angelegt"),
    /** Zaehler je Lauf ({ zeilen, importiert, uebersprungen, fehler, aehnlich, akteure_neu, … }) — bleiben nach dem Aufraeumen der Zeilen. */
    zaehler: jsonb("zaehler").$type<Record<string, number>>(),
    /**
     * AP2.7 PR b: Belegdaten des Lauf-Belegs (ein Beleg je Lauf und Belegtyp,
     * E48/E67). Erhebungsdatum und — bei den oberen vier Typen (E33) —
     * Gueltig-bis fragt der Probelauf ab; E67 legt sie nicht fest, geraten
     * wird nichts (Entscheidung fuer Eric markiert, PR b).
     */
    belegErhebungsdatum: date("beleg_erhebungsdatum"),
    belegGueltigBis: date("beleg_gueltig_bis"),
    // AP2.7 PR e: gewaehltes Tabellenblatt und Kopfzeile (1-basiert, wie in Excel) — fuer Bericht und Nacharbeit.
    blatt: text("blatt"),
    kopfzeile: integer("kopfzeile"),
    // AP2.7 PR e: Zeitraum des Laufs fuer Zeilen ohne eigenen Wert (Pflicht am Lauf, keine Vorbelegung).
    zeitraumVon: date("zeitraum_von"),
    zeitraumBis: date("zeitraum_bis"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    abgeschlossenAm: timestamp("abgeschlossen_am", { withTimezone: true }),
    zurueckgenommenAm: timestamp("zurueckgenommen_am", { withTimezone: true }),
  },
  (t) => [
    index("import_lauf_datei_hash_idx").on(t.dateiHash),
    check("import_lauf_art_check", sql`${t.art} in ('biomasse', 'output')`),
    check("import_lauf_status_check", sql`${t.status} in ('angelegt', 'zugeordnet', 'aufgeloest', 'probelauf', 'ausgefuehrt', 'zurueckgenommen', 'fehler')`),
    check("import_lauf_datei_hash_check", sql`${t.dateiHash} ~ '^[0-9a-f]{64}$'`),
    check("import_lauf_dateiname_check", sql`length(btrim(${t.dateiname})) between 1 and 255`),
  ],
);

export const IMPORT_ZEILE_STATUS = ["offen", "fehler", "aehnlich", "importiert", "uebersprungen"] as const;
export type ImportZeileStatus = (typeof IMPORT_ZEILE_STATUS)[number];

/**
 * Schluessel, die in import_zeile.felder nie vorkommen duerfen (E67, DSGVO):
 * Personen-Spalten werden erkannt oder als „Person – wird nicht uebernommen"
 * markiert und ihre Inhalte nie gespeichert. Der CHECK ist die Zusicherung
 * der Datenbank, der Mapper (PR b) die der Anwendung.
 */
export const IMPORT_PERSONEN_SCHLUESSEL = ["ansprechpartner", "ansprechperson", "kontakt", "kontaktperson", "person", "email", "e_mail", "mail", "telefon", "mobil", "handy", "fax"] as const;

/** Eine Zeile der Quelldatei: nur zugeordnete Zielfelder, Status, Ergebnis. */
export const importZeile = pgTable(
  "import_zeile",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    laufId: uuid("lauf_id")
      .notNull()
      .references(() => importLauf.id, { onDelete: "cascade" }),
    zeilennummer: integer("zeilennummer").notNull(),
    /** Nur zugeordnete Zielfelder (Schluessel = Zielfeld), nie Personen-Spalten. */
    felder: jsonb("felder").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("offen"),
    fehlergrund: text("fehlergrund"),
    /** Angelegter Strom (je nach Art des Laufs genau eine der beiden Spalten). */
    biomassestromId: uuid("biomassestrom_id").references(() => biomassestrom.id),
    outputBedarfId: uuid("output_bedarf_id").references(() => outputBedarf.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("import_zeile_lauf_zeile_unique").on(t.laufId, t.zeilennummer),
    index("import_zeile_status_idx").on(t.laufId, t.status),
    check("import_zeile_status_check", sql`${t.status} in ('offen', 'fehler', 'aehnlich', 'importiert', 'uebersprungen')`),
    check("import_zeile_strom_check", sql`not (${t.biomassestromId} is not null and ${t.outputBedarfId} is not null)`),
    check(
      "import_zeile_felder_check",
      sql`jsonb_typeof(${t.felder}) = 'object' and not (${t.felder} ?| array['ansprechpartner', 'ansprechperson', 'kontakt', 'kontaktperson', 'person', 'email', 'e_mail', 'mail', 'telefon', 'mobil', 'handy', 'fax'])`,
    ),
  ],
);
