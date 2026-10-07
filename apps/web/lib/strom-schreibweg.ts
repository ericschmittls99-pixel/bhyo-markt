import { biomassestrom, outputBedarf, vergabeZeitraum } from "@bhyo/db/schema";
import { eq, sql } from "drizzle-orm";

import { belegEingabeAus, erstelleBeleg, ValidierungsFehler, type BelegEingabe } from "@/lib/beleg-server";
import { withDb, type AppDb } from "@/lib/db";
import { dezimalKanonisch, monatKanonisch } from "@/lib/eingabe-format";
import {
  herkunftOderNull,
  koordinateAus,
  monatZuBis,
  monatZuVon,
  validiereFormular,
  type FeldFehler,
  type FormularEingaben,
} from "@/lib/formular-modell";
import { protokolliere } from "@/lib/protokoll";
import { darf, type Rolle } from "@/lib/rechte";
import type { StromArt } from "@/lib/stroeme-modell";
import {
  naechsteReserviertSeit,
  validiereVergaben,
  vergabenZuWerten,
  type VergabeFormZeile,
} from "@/lib/verfuegbarkeit";

/**
 * AP2.7 PR a0 (E67): Der Schreibweg „Strom anlegen" als Baustein mit reinen
 * Eingabe-Objekten — ohne FormData, ohne Request-Kontext. Das Formular
 * (formular-actions.ts) uebersetzt FormData in eine StromEingabe und ruft
 * dieselbe Funktion wie spaeter der Import. Keine zweite Logik: Validierung,
 * Rechtepruefung (darf), Beleg, Insert, Vergaben und Protokoll (mit
 * Inbox-Zustellung) leben hier genau einmal.
 *
 * Kein "use server": Bausteine, keine Actions.
 */

export type Tx = Parameters<Parameters<AppDb["transaction"]>[0]>[0];

/** Wer handelt — genau die drei Angaben, die Rechte und Protokoll brauchen. */
export interface Handelnder {
  id: string;
  email: string;
  rolle: Rolle;
}

/** Freitextfelder, die das Formular nicht validiert, aber speichert. */
export interface StromFelder {
  bezeichnung: string | null;
  ort: string | null;
  strasse: string | null;
  hausnummer: string | null;
  plz: string | null;
  preisHerkunft: string | null;
  preisEinheit: string | null;
}

export interface StromEingabe {
  art: StromArt;
  /** Kanonische Werte (Dezimalpunkt, JJJJ-MM), wie validiereFormular sie erwartet. */
  eingaben: FormularEingaben;
  felder: StromFelder;
  vergaben: VergabeFormZeile[];
  reserviertBhyo: boolean;
  /** null = kein Beleg (nur beim Bearbeiten ohne bisherigen Beleg moeglich). */
  beleg: BelegEingabe | null;
  /**
   * AP2.7 PR b (E67/E48): ein schon angelegter, geteilter Beleg (ein Beleg je
   * Import-Lauf und Belegtyp) — dann wird kein eigener Beleg erstellt.
   */
  belegId?: string | null;
  /** AP2.7 PR c (E67): Lauf-ID am Ereignis „angelegt" (aenderung.import_lauf_id). */
  importLaufId?: string;
}

/** Feldfehler als Ausnahme — fuer Aufrufer, die nicht inline anzeigen, sondern je Zeile scheitern. */
export class FeldFehlerAusnahme extends Error {
  constructor(public readonly feldFehler: FeldFehler) {
    super(`Eingabe unvollständig: ${Object.keys(feldFehler).join(", ")}`);
  }
}

/** Beide Wachen des Formulars an einer Stelle: Felder und Vergabezeilen. */
export function pruefeStromEingabe(e: StromEingabe, kontext: { neu: boolean }): FeldFehler {
  return {
    ...validiereFormular(e.art, e.eingaben, kontext),
    ...validiereVergaben(e.eingaben.vonMonat, e.eingaben.bisMonat, e.vergaben),
  };
}

const s = (v: string | null) => v ?? "";
const leerZuNull = (v: string): string | null => (v.trim() === "" ? null : v);

function nichtLeer(v: string, label: string): string {
  if (v.trim() === "") throw new ValidierungsFehler(`${label} ist ein Pflichtfeld.`);
  return v;
}

/** FormData-Zugriff: getrimmter Text oder null. (Spiegel von beleg-server.text, bewusst lokal.) */
function text(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function zahl(formData: FormData, key: string): string {
  return dezimalKanonisch(s(text(formData, key)));
}

export function saisonAusFormData(formData: FormData): number[] {
  return Array.from({ length: 12 }, (_, i) => {
    const n = Number(formData.get(`saison_${i}`));
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
}

/**
 * Uebersetzt das Formular in die Eingabe des Schreibwegs. F9: Deutscher Text
 * (Komma, MM/JJJJ) wird HIER einmal in die Speicherform gebracht; mehrdeutige
 * Zahlen bleiben stehen und werden von validiereFormular abgewiesen.
 */
export function stromEingabeAusFormData(art: StromArt, formData: FormData): StromEingabe {
  const datei = formData.get("beleg_datei");
  const eingaben: FormularEingaben = {
    akteurId: s(text(formData, "akteur_id")),
    materialartCode: s(text(formData, "materialart_code")),
    produktCode: s(text(formData, "produkt_code")),
    mengeRohFm: zahl(formData, "menge_roh_fm"),
    tsAnteilPct: zahl(formData, "ts_anteil_pct"),
    aschegehaltPct: zahl(formData, "aschegehalt_pct"),
    mengeWert: zahl(formData, "menge_wert"),
    mengeEinheit: s(text(formData, "menge_einheit")),
    preisMin: zahl(formData, "preis_min"),
    preisMittel: zahl(formData, "preis_mittel"),
    preisMax: zahl(formData, "preis_max"),
    preis: zahl(formData, "preis"),
    preisBezug: s(text(formData, "preis_bezug")),
    vonMonat: monatKanonisch(s(text(formData, "zeitraum_von"))),
    bisMonat: monatKanonisch(s(text(formData, "zeitraum_bis"))),
    begruendung: s(text(formData, "begruendung")),
    belegTyp: s(text(formData, "beleg_typ")),
    belegQuellenangabe: s(text(formData, "beleg_quellenangabe")),
    belegErhebungsdatum: s(text(formData, "beleg_erhebungsdatum")),
    lat: s(text(formData, "lat")),
    lng: s(text(formData, "lng")),
    saison: saisonAusFormData(formData),
    // Beim Bearbeiten zaehlt eine bereits hinterlegte Datei weiter als Datei.
    belegHatDatei:
      (datei instanceof File && datei.size > 0) || formData.get("beleg_datei_vorhanden") === "1",
    belegLink: s(text(formData, "beleg_link")),
    belegGueltigBis: s(text(formData, "beleg_gueltig_bis")),
  };
  // Vergabezeilen (AP1j): das Panel nummeriert lueckenlos ab 0 und legt je
  // Zeile einen Marker ab — auch Leerzeilen, damit die Fehler-Indizes passen.
  const vergaben: VergabeFormZeile[] = [];
  for (let i = 0; formData.get(`vergabe_${i}_marker`) != null; i++) {
    vergaben.push({
      vonMonat: monatKanonisch(s(text(formData, `vergabe_${i}_von`))),
      bisMonat: monatKanonisch(s(text(formData, `vergabe_${i}_bis`))),
      an: s(text(formData, `vergabe_${i}_an`)),
      anBhyo: formData.get(`vergabe_${i}_bhyo`) === "on",
    });
  }
  return {
    art,
    eingaben,
    felder: {
      bezeichnung: text(formData, "bezeichnung"),
      ort: text(formData, "ort"),
      strasse: text(formData, "strasse"),
      hausnummer: text(formData, "hausnummer"),
      plz: text(formData, "plz"),
      preisHerkunft: text(formData, "preis_herkunft"),
      preisEinheit: text(formData, "preis_einheit"),
    },
    vergaben,
    reserviertBhyo: formData.get("reserviert_bhyo") === "on",
    beleg: belegEingabeAus(formData),
  };
}

/** Die Spaltenwerte eines Stroms aus der Eingabe — fuer Anlegen UND Bearbeiten dieselbe Stelle. */
export function stromWerte(e: StromEingabe) {
  // F0a: Pin-Koordinate fuer standort_geom. F0b: Landkreis und Bundesland
  // werden raeumlich abgeleitet (strom_verwaltung), nie geschrieben.
  const koordinate = koordinateAus(e.eingaben);
  const gemeinsam = {
    akteurId: e.eingaben.akteurId,
    bezeichnung: e.felder.bezeichnung,
    ort: e.felder.ort,
    strasse: e.felder.strasse,
    hausnummer: e.felder.hausnummer,
    plz: e.felder.plz,
    standortGeom: koordinate
      ? sql`ST_SetSRID(ST_MakePoint(${koordinate.lng}, ${koordinate.lat}), 4326)`
      : null,
    zeitraumVon: monatZuVon(e.eingaben.vonMonat),
    zeitraumBis: monatZuBis(e.eingaben.bisMonat),
    saisonalitaet: e.eingaben.saison,
    reserviertBhyo: e.reserviertBhyo,
  };
  const werte =
    e.art === "biomasse"
      ? {
          ...gemeinsam,
          materialartCode: e.eingaben.materialartCode,
          // Aus `eingaben`, nicht aus dem Rohtext: sonst landete "1,5" in numeric.
          mengeRohFm: nichtLeer(e.eingaben.mengeRohFm, "Rohmenge"),
          // PR e: leer = unbekannt (NULL), nie ein erfundener Wert.
          tsAnteilPct: leerZuNull(e.eingaben.tsAnteilPct),
          aschegehaltPct: leerZuNull(e.eingaben.aschegehaltPct),
          preisMin: leerZuNull(e.eingaben.preisMin),
          preisMittel: leerZuNull(e.eingaben.preisMittel),
          preisMax: leerZuNull(e.eingaben.preisMax),
          preisHerkunft: herkunftOderNull(e.felder.preisHerkunft),
          // E69: Bezug nur mit Preis; validiereFormular hat ihn dann als fm|atro gesichert.
          preisBezug:
            e.eingaben.preisMin.trim() || e.eingaben.preisMittel.trim() || e.eingaben.preisMax.trim()
              ? (e.eingaben.preisBezug as "fm" | "atro")
              : null,
        }
      : {
          ...gemeinsam,
          produktCode: e.eingaben.produktCode,
          mengeWert: nichtLeer(e.eingaben.mengeWert, "Bedarfsmenge"),
          mengeEinheit: nichtLeer(e.eingaben.mengeEinheit, "Einheit"),
          preis: leerZuNull(e.eingaben.preis),
          preisEinheit: e.felder.preisEinheit,
          preisHerkunft: herkunftOderNull(e.felder.preisHerkunft),
        };
  return { werte, koordinate };
}

/**
 * Vergabezeilen sind Formular-verwaltete Attribute ohne eigenen Status: je
 * Speichern vollstaendig ersetzen — die Nachvollziehbarkeit liegt in der
 * Aenderungshistorie ueber die Begruendungspflicht.
 */
export async function vergabenSpeichern(tx: Tx, art: StromArt, stromId: string, vergaben: VergabeFormZeile[]) {
  const elternSpalte = art === "biomasse" ? vergabeZeitraum.biomassestromId : vergabeZeitraum.outputBedarfId;
  await tx.delete(vergabeZeitraum).where(eq(elternSpalte, stromId));
  const werte = vergabenZuWerten(vergaben);
  if (werte.length)
    await tx.insert(vergabeZeitraum).values(
      werte.map((v) => ({
        ...v,
        biomassestromId: art === "biomasse" ? stromId : null,
        outputBedarfId: art === "biomasse" ? null : stromId,
      })),
    );
}

/**
 * Legt einen Strom samt Beleg, Vergaben und Protokoll in der uebergebenen
 * Transaktion an. Reihenfolge wie bisher im Formular: Rechte, Validierung,
 * dann Beleg (R2-Upload erst nach der Validierung — keine R2-Waisen), Insert
 * mit Status entwurf (E8), Vergaben, Protokoll (stellt zu).
 *
 * Wirft FeldFehlerAusnahme (Validierung), ValidierungsFehler (zweite Wache)
 * oder Error bei fehlendem Recht — der Aufrufer entscheidet, ob er die
 * Transaktion verwirft oder (Import, Savepoint) nur die Zeile.
 */
export async function stromAnlegenInTx(
  tx: Tx,
  handelnder: Handelnder,
  e: StromEingabe,
  heute: string,
): Promise<{ id: string }> {
  // F8/E30, E42: Rechte VOR jeder Wirkung — auch hier, nicht nur am Eingang
  // der Action, damit kein Aufrufer am Baustein vorbei schreiben kann.
  if (!darf(handelnder, "strom.anlegen")) throw new ValidierungsFehler("Kein Recht für diese Aktion.");
  const feldFehler = pruefeStromEingabe(e, { neu: true });
  if (Object.keys(feldFehler).length > 0) throw new FeldFehlerAusnahme(feldFehler);

  const entitaet = e.art === "biomasse" ? "biomassestrom" : "output_bedarf";
  const { werte } = stromWerte(e);
  const belegId = e.belegId ?? (e.beleg ? (await erstelleBeleg(tx, e.beleg))?.belegId ?? null : null);
  const reserviertSeit = naechsteReserviertSeit(e.reserviertBhyo, null, heute);
  let id: string;
  if (e.art === "biomasse") {
    const [row] = await tx
      .insert(biomassestrom)
      .values({ ...werte, reserviertSeit, belegId, status: "entwurf" } as never)
      .returning({ id: biomassestrom.id });
    id = row!.id;
  } else {
    const [row] = await tx
      .insert(outputBedarf)
      .values({ ...werte, reserviertSeit, belegId, status: "entwurf" } as never)
      .returning({ id: outputBedarf.id });
    id = row!.id;
  }
  await vergabenSpeichern(tx, e.art, id, e.vergaben);
  await protokolliere(tx, {
    art: "angelegt",
    entitaet,
    id,
    benutzerId: handelnder.id,
    benutzerEmail: handelnder.email,
    text: e.eingaben.begruendung,
    importLaufId: e.importLaufId,
  });
  return { id };
}

/** Anlegen in eigener Transaktion — der Weg des Formulars. */
export function stromAnlegen(handelnder: Handelnder, e: StromEingabe, heute: string): Promise<{ id: string }> {
  return withDb((db) => db.transaction((tx) => stromAnlegenInTx(tx, handelnder, e, heute)));
}
