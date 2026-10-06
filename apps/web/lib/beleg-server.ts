import { beleg } from "@bhyo/db/schema";
import { eq } from "drizzle-orm";

import { type AppDb, getBelegeBucket, getEnvironment } from "@/lib/db";
import {
  BELEG_TYPEN,
  type BelegTyp,
  brauchtGueltigBis,
  istBelegTyp,
  normalisiereUrl,
} from "@/lib/qualitaet";

/**
 * Geteilte Server-Helfer fuer die Erfassungs-Actions (PR 5): FormData-Zugriff,
 * Beleg anlegen/aktualisieren (inkl. R2-Upload), Aenderungsprotokoll. Kein
 * "use server" — diese Funktionen sind keine Actions, sondern deren Bausteine.
 */

// E34: Reihenfolge und Menge der Typen haben genau einen Ursprung.
export { BELEG_TYPEN };

export class ValidierungsFehler extends Error {}

export function text(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

export function pflicht(formData: FormData, key: string, label: string): string {
  const v = text(formData, key);
  if (!v) throw new ValidierungsFehler(`${label} ist ein Pflichtfeld.`);
  return v;
}

/**
 * AP2.7 PR a0 (E67): Beleg-Eingabe als reines Objekt — das Formular fuellt sie
 * aus FormData (belegEingabeAus), der Import spaeter aus seiner Zuordnung.
 * `typ` null oder ungueltig heisst: kein Beleg.
 */
export interface BelegEingabe {
  typ: string | null;
  quellenangabe: string | null;
  erhebungsdatum: string | null;
  link: string | null;
  gueltigBis: string | null;
  kernnotiz: string | null;
  externNachvollziehbar: boolean;
  /** Hochzuladende Datei; null = keine neue Datei. */
  datei: File | null;
  /**
   * AP2.7 PR b (E67): Datei liegt schon in R2 (bereinigte Kopie der
   * Importdatei) — Key uebernehmen statt hochladen. Hat Vorrang vor `datei`.
   */
  dateiKey?: string | null;
}

export function belegEingabeAus(formData: FormData): BelegEingabe {
  const datei = formData.get("beleg_datei");
  return {
    typ: text(formData, "beleg_typ"),
    quellenangabe: text(formData, "beleg_quellenangabe"),
    erhebungsdatum: text(formData, "beleg_erhebungsdatum"),
    link: text(formData, "beleg_link"),
    gueltigBis: text(formData, "beleg_gueltig_bis"),
    kernnotiz: text(formData, "beleg_kernnotiz"),
    externNachvollziehbar: formData.get("beleg_extern") === "on",
    datei: datei instanceof File && datei.size > 0 ? datei : null,
  };
}

function pflichtWert(v: string | null, label: string): string {
  if (!v) throw new ValidierungsFehler(`${label} ist ein Pflichtfeld.`);
  return v;
}

interface BelegDaten {
  typ: BelegTyp;
  quellenangabe: string;
  erhebungsdatum: string;
  linkUrl: string | null;
  /** E34: Freigabe zur externen Verwendung (F6) — kein Eingang der Stufe. */
  externNachvollziehbar: boolean;
  metadata: Record<string, unknown>;
  /** E33: nur bei den oberen vier Typen; die unteren drei tragen null. */
  gueltigBis: string | null;
}

function belegDatenAus(e: BelegEingabe): BelegDaten | null {
  const typ = e.typ;
  if (!istBelegTyp(typ)) return null;

  // Die Quellenangabe ist Pflicht fuer alle sieben Typen — hier als Bitte,
  // in der DB als Zusicherung (CHECK beleg_quellenangabe_check, 0021).
  const quellenangabe = pflichtWert(e.quellenangabe, "Quellenangabe");
  const erhebungsdatum = pflichtWert(e.erhebungsdatum, "Erhebungsdatum");
  const linkUrl = normalisiereUrl(e.link);

  // E33: Faelligkeit der oberen vier Typen kommt aus dem Formular (Pflicht
  // in der Oberflaeche; validiereFormular meldet es als Feldfehler, hier die
  // zweite Wache fuer Aufrufer ohne Formularvalidierung). Untere drei: null.
  const gueltigBis = brauchtGueltigBis(typ) ? pflichtWert(e.gueltigBis, "Gültig bis") : null;
  // E34: Formularpflicht Link bei Webrecherche — keine Stufenbedingung.
  if (typ === "webrecherche" && !linkUrl)
    throw new ValidierungsFehler("Link ist bei Webrecherche ein Pflichtfeld.");

  // Typ-spezifische Zusatzfelder in beleg.metadata. Seit E34 nur noch die
  // Quellenangabe und beim Gespraech die Kernnotiz; amtlich, Gespraechsdatum
  // und Gespraechspartner werden nicht mehr geschrieben oder gelesen.
  const metadata: Record<string, unknown> = { quellenangabe };
  if (typ === "gespraech") metadata.kernnotiz = e.kernnotiz;

  return {
    typ,
    quellenangabe,
    erhebungsdatum,
    linkUrl,
    externNachvollziehbar: e.externNachvollziehbar,
    metadata,
    gueltigBis,
  };
}

/**
 * Laedt eine optionale Beleg-Datei nach R2 hoch. Key mit Umgebungs-Praefix,
 * damit sich Preview-Test-Uploads nicht mit Production-Belegen vermischen.
 */
async function ladeDateiHoch(datei: File | null): Promise<string | null> {
  if (!datei || datei.size === 0) return null;
  const env = await getEnvironment();
  const safeName = datei.name.replace(/[^\w.\-]+/g, "_").slice(-80);
  const dateiKey = `belege/${env}/${crypto.randomUUID()}-${safeName}`;
  const bucket = await getBelegeBucket();
  await bucket.put(dateiKey, await datei.arrayBuffer(), {
    httpMetadata: { contentType: datei.type || "application/octet-stream" },
  });
  return dateiKey;
}

// E23: keine Stufe mehr im Ergebnis — die DB leitet sie als
// GENERATED-Spalte auf beleg selbst ab; die App schreibt sie nirgends.
export interface BelegErgebnis {
  belegId: string;
}

/** Legt die Beleg-Zeile neu an (Anlegen bzw. Strom ohne bisherigen Beleg). */
export async function erstelleBeleg(
  db: Pick<AppDb, "insert">,
  e: BelegEingabe,
): Promise<BelegErgebnis | null> {
  const d = belegDatenAus(e);
  if (!d) return null;
  const dateiKey = e.dateiKey ?? (await ladeDateiHoch(e.datei));

  const [row] = await db
    .insert(beleg)
    .values({
      typ: d.typ,
      dateiKey,
      linkUrl: d.linkUrl,
      externNachvollziehbar: d.externNachvollziehbar,
      metadata: d.metadata,
      gueltigBis: d.gueltigBis,
      // Erhebungsdatum als 00:00Z gespeichert: in Europe/Berlin ist das
      // 01:00/02:00 desselben Tages — der Kalendertag (lib/datum.ts) bleibt
      // der eingegebene, in UTC wie in Berlin.
      erstelltAm: new Date(d.erhebungsdatum),
    })
    .returning({ id: beleg.id });

  return { belegId: row!.id };
}

/**
 * Aktualisiert die bestehende Beleg-Zeile IN PLACE (Entscheidung Eric,
 * 2026-09-12). Eine neue Datei bekommt einen neuen R2-Key; das alte R2-Objekt
 * bleibt liegen, geloescht wird nichts. Ohne neue Datei bleibt der bestehende
 * dateiKey erhalten.
 */
export async function aktualisiereBeleg(
  db: Pick<AppDb, "select" | "update">,
  e: BelegEingabe,
  belegId: string,
): Promise<BelegErgebnis | null> {
  const d = belegDatenAus(e);
  if (!d) return null;

  const [alt] = await db
    .select({ dateiKey: beleg.dateiKey })
    .from(beleg)
    .where(eq(beleg.id, belegId))
    .limit(1);
  if (!alt) throw new ValidierungsFehler("Beleg nicht gefunden — bitte neu laden.");

  const neuerKey = await ladeDateiHoch(e.datei);
  const dateiKey = neuerKey ?? alt.dateiKey;

  await db
    .update(beleg)
    .set({
      typ: d.typ,
      dateiKey,
      linkUrl: d.linkUrl,
      externNachvollziehbar: d.externNachvollziehbar,
      metadata: d.metadata,
      gueltigBis: d.gueltigBis,
      erstelltAm: new Date(d.erhebungsdatum),
    })
    .where(eq(beleg.id, belegId));

  return { belegId };
}
